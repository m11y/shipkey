import type { SecretBackend, SecretRef, SecretEntry } from "./types";
import { exec as execCmd } from "../exec";

async function exec(args: string[]): Promise<string> {
  return execCmd("bw", args);
}

/** Bitwarden custom field types */
const FIELD_TYPE_HIDDEN = 1;
const ITEM_NAME_SEPARATOR = "__";
const FIELD_NAME_SEPARATOR = ".";

interface BwCustomField {
  name: string;
  value: string;
  type: number;
}

interface BwItem {
  id: string;
  name: string;
  type: number;
  folderId: string | null;
  fields?: BwCustomField[];
  notes?: string;
}

interface BwFolder {
  id: string;
  name: string;
}

export class BitwardenBackend implements SecretBackend {
  readonly name = "Bitwarden";

  buildItemName(ref: SecretRef): string {
    return `${ref.project}${ITEM_NAME_SEPARATOR}${ref.env}`;
  }

  /** Parse an item title like "project__env" back into project and env */
  static parseItemName(
    itemName: string,
  ): { project: string; env: string } | null {
    const separatorIndex = itemName.lastIndexOf(ITEM_NAME_SEPARATOR);
    if (separatorIndex === -1) return null;

    const project = itemName.slice(0, separatorIndex);
    const env = itemName.slice(separatorIndex + ITEM_NAME_SEPARATOR.length);
    if (!project || !env) return null;

    return {
      project,
      env,
    };
  }

  /** Encode a field name for storage as a custom field: "provider.FIELD_NAME" */
  buildFieldName(ref: SecretRef): string {
    return `${ref.provider}${FIELD_NAME_SEPARATOR}${ref.field}`;
  }

  /** Parse a custom field name back into provider and field */
  static parseFieldName(
    fieldName: string,
  ): { provider: string; field: string } | null {
    const dotIndex = fieldName.lastIndexOf(FIELD_NAME_SEPARATOR);
    if (dotIndex === -1) return null;

    const provider = fieldName.slice(0, dotIndex);
    const field = fieldName.slice(dotIndex + FIELD_NAME_SEPARATOR.length);
    if (!provider || !field) return null;

    return {
      provider,
      field,
    };
  }

  buildInlineRef(): null {
    return null;
  }

  async isAvailable(): Promise<boolean> {
    const status = await this.checkStatus();
    return status === "ready";
  }

  async checkStatus(): Promise<"not_installed" | "not_logged_in" | "ready"> {
    try {
      await exec(["--version"]);
    } catch {
      return "not_installed";
    }
    try {
      const output = await exec(["status"]);
      const status = JSON.parse(output);
      if (status.status === "unauthenticated") {
        return "not_logged_in";
      }
      if (status.status === "locked") {
        return "not_logged_in";
      }
      // "unlocked" means ready
      return "ready";
    } catch {
      return "not_logged_in";
    }
  }

  private async ensureUnlocked(): Promise<void> {
    const output = await exec(["status"]);
    const status = JSON.parse(output);
    if (status.status === "locked") {
      throw new Error("Bitwarden vault is locked. Run: bw unlock");
    }
    if (status.status === "unauthenticated") {
      throw new Error("Bitwarden CLI not logged in. Run: bw login");
    }
  }

  private async findOrCreateFolder(name: string): Promise<string> {
    const existing = await this.findFolder(name);
    if (existing) return existing;

    // Create folder via template
    const templateRaw = await exec(["get", "template", "folder"]);
    const template = JSON.parse(templateRaw);
    template.name = name;
    const encodedFolder = Buffer.from(JSON.stringify(template)).toString(
      "base64",
    );
    const created = await exec(["create", "folder", encodedFolder]);
    const folder: BwFolder = JSON.parse(created);
    return folder.id;
  }

  private async findFolder(name: string): Promise<string | null> {
    const foldersRaw = await exec(["list", "folders"]);
    const folders: BwFolder[] = JSON.parse(foldersRaw);
    const existing = folders.find((f) => f.name === name);
    return existing?.id ?? null;
  }

  private async findItem(
    itemName: string,
    folderId: string,
  ): Promise<BwItem | null> {
    try {
      const raw = await exec([
        "list",
        "items",
        "--folderid",
        folderId,
        "--search",
        itemName,
      ]);
      const items: BwItem[] = JSON.parse(raw);
      return items.find((i) => i.name === itemName) || null;
    } catch {
      return null;
    }
  }

  async read(ref: SecretRef): Promise<string> {
    await this.ensureUnlocked();

    const folderId = await this.findOrCreateFolder(ref.vault);
    const itemName = this.buildItemName(ref);
    const item = await this.findItem(itemName, folderId);
    if (!item) {
      throw new Error(
        `Item "${itemName}" not found in folder "${ref.vault}"`,
      );
    }

    const fieldName = this.buildFieldName(ref);
    const field = item.fields?.find((f) => f.name === fieldName);
    if (!field) {
      throw new Error(
        `Field "${fieldName}" not found in item "${itemName}"`,
      );
    }

    return field.value;
  }

  async write(entry: SecretEntry): Promise<void> {
    await this.ensureUnlocked();

    const { ref, value } = entry;
    const folderId = await this.findOrCreateFolder(ref.vault);
    const itemName = this.buildItemName(ref);
    const fieldName = this.buildFieldName(ref);
    const existingItem = await this.findItem(itemName, folderId);

    if (existingItem) {
      // Update existing item — merge fields
      const fields = existingItem.fields || [];
      const existingFieldIndex = fields.findIndex(
        (f) => f.name === fieldName,
      );
      if (existingFieldIndex !== -1) {
        fields[existingFieldIndex].value = value;
      } else {
        fields.push({
          name: fieldName,
          value,
          type: FIELD_TYPE_HIDDEN,
        });
      }
      existingItem.fields = fields;
      const encoded = Buffer.from(JSON.stringify(existingItem)).toString(
        "base64",
      );
      await exec(["edit", "item", existingItem.id, encoded]);
    } else {
      // Create new Secure Note item
      const templateRaw = await exec(["get", "template", "item"]);
      const template = JSON.parse(templateRaw);
      template.type = 2; // Secure Note
      template.secureNote = { type: 0 };
      template.name = itemName;
      template.folderId = folderId;
      template.fields = [
        {
          name: fieldName,
          value,
          type: FIELD_TYPE_HIDDEN,
        },
      ];
      const encoded = Buffer.from(JSON.stringify(template)).toString("base64");
      await exec(["create", "item", encoded]);
    }
  }

  async delete(ref: SecretRef): Promise<void> {
    await this.ensureUnlocked();

    const folderId = await this.findFolder(ref.vault);
    if (!folderId) return;

    const existingItem = await this.findItem(this.buildItemName(ref), folderId);
    if (!existingItem) return;

    const fieldName = this.buildFieldName(ref);
    const nextFields = (existingItem.fields || []).filter(
      (f) => f.name !== fieldName,
    );

    if (nextFields.length === (existingItem.fields || []).length) {
      return;
    }

    if (nextFields.length === 0) {
      await exec(["delete", "item", existingItem.id]);
      return;
    }

    existingItem.fields = nextFields;
    const encoded = Buffer.from(JSON.stringify(existingItem)).toString("base64");
    await exec(["edit", "item", existingItem.id, encoded]);
  }

  async list(
    project?: string,
    env?: string,
    vault = "shipkey",
  ): Promise<SecretRef[]> {
    await this.ensureUnlocked();

    // Find the folder
    const foldersRaw = await exec(["list", "folders"]);
    const folders: BwFolder[] = JSON.parse(foldersRaw);
    const folder = folders.find((f) => f.name === vault);
    if (!folder) return [];

    const itemsRaw = await exec([
      "list",
      "items",
      "--folderid",
      folder.id,
    ]);
    const items: BwItem[] = JSON.parse(itemsRaw);
    const refs: SecretRef[] = [];

    for (const item of items) {
      const parsedItem = BitwardenBackend.parseItemName(item.name);
      if (!parsedItem) continue;

      if (project && parsedItem.project !== project) continue;
      if (env && parsedItem.env !== env) continue;

      if (!item.fields) continue;
      for (const field of item.fields) {
        const parsed = BitwardenBackend.parseFieldName(field.name);
        if (!parsed) continue;

        refs.push({
          vault,
          provider: parsed.provider,
          project: parsedItem.project,
          env: parsedItem.env,
          field: parsed.field,
        });
      }
    }

    return refs;
  }
}
