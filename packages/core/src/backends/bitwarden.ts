import type { SecretBackend, SecretRef, SecretEntry } from "./types";
import { exec as execCmd } from "../exec";

async function exec(args: string[]): Promise<string> {
  return execCmd("bw", args);
}

/** Bitwarden custom field types */
const FIELD_TYPE_HIDDEN = 1;

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

  private sectionName(project: string, env: string): string {
    return `${project}-${env}`;
  }

  /** Encode a field name for storage as a custom field: "project-env.FIELD_NAME" */
  buildFieldName(ref: SecretRef): string {
    const section = this.sectionName(ref.project, ref.env);
    return `${section}.${ref.field}`;
  }

  /** Parse a custom field name back into project, env, field */
  static parseFieldName(
    fieldName: string,
  ): { project: string; env: string; field: string } | null {
    const dotIndex = fieldName.indexOf(".");
    if (dotIndex === -1) return null;

    const section = fieldName.slice(0, dotIndex);
    const field = fieldName.slice(dotIndex + 1);
    const dashIndex = section.lastIndexOf("-");
    if (dashIndex === -1) return null;

    return {
      project: section.slice(0, dashIndex),
      env: section.slice(dashIndex + 1),
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
    provider: string,
    folderId: string,
  ): Promise<BwItem | null> {
    try {
      const raw = await exec([
        "list",
        "items",
        "--folderid",
        folderId,
        "--search",
        provider,
      ]);
      const items: BwItem[] = JSON.parse(raw);
      return items.find((i) => i.name === provider) || null;
    } catch {
      return null;
    }
  }

  async read(ref: SecretRef): Promise<string> {
    await this.ensureUnlocked();

    const folderId = await this.findOrCreateFolder(ref.vault);
    const item = await this.findItem(ref.provider, folderId);
    if (!item) {
      throw new Error(
        `Item "${ref.provider}" not found in folder "${ref.vault}"`,
      );
    }

    const fieldName = this.buildFieldName(ref);
    const field = item.fields?.find((f) => f.name === fieldName);
    if (!field) {
      throw new Error(
        `Field "${fieldName}" not found in item "${ref.provider}"`,
      );
    }

    return field.value;
  }

  async write(entry: SecretEntry): Promise<void> {
    await this.ensureUnlocked();

    const { ref, value } = entry;
    const folderId = await this.findOrCreateFolder(ref.vault);
    const fieldName = this.buildFieldName(ref);
    const existingItem = await this.findItem(ref.provider, folderId);

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
      template.name = ref.provider;
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

    const existingItem = await this.findItem(ref.provider, folderId);
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
      if (!item.fields) continue;
      for (const field of item.fields) {
        const parsed = BitwardenBackend.parseFieldName(field.name);
        if (!parsed) continue;

        if (project && parsed.project !== project) continue;
        if (env && parsed.env !== env) continue;

        refs.push({
          vault,
          provider: item.name,
          project: parsed.project,
          env: parsed.env,
          field: parsed.field,
        });
      }
    }

    return refs;
  }
}
