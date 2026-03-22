import type { SecretBackend, SecretRef, SecretEntry } from "../../src/backends/types";

export class MockBackend implements SecretBackend {
  readonly name = "Mock";
  readonly calls: { method: string; args: any[] }[] = [];
  private store = new Map<string, string>();

  private refKey(ref: SecretRef): string {
    return `${ref.vault}/${ref.provider}/${ref.project}-${ref.env}/${ref.field}`;
  }

  async isAvailable() {
    return true;
  }

  async checkStatus() {
    return "ready" as const;
  }

  async read(ref: SecretRef) {
    this.calls.push({ method: "read", args: [ref] });
    const key = this.refKey(ref);
    const value = this.store.get(key);
    if (value === undefined) {
      throw new Error(`Not found: ${key}`);
    }
    return value;
  }

  async write(entry: SecretEntry) {
    this.calls.push({ method: "write", args: [entry] });
    const key = this.refKey(entry.ref);
    this.store.set(key, entry.value);
  }

  async delete(ref: SecretRef) {
    this.calls.push({ method: "delete", args: [ref] });
    this.store.delete(this.refKey(ref));
  }

  async list(project?: string, env?: string, vault?: string) {
    this.calls.push({ method: "list", args: [project, env, vault] });
    const refs: SecretRef[] = [];
    for (const [key] of this.store) {
      // Parse "vault/Provider/project-env/field"
      const parts = key.split("/");
      if (parts.length !== 4) continue;
      const [storedVault, provider, section, field] = parts;
      const dashIndex = section.lastIndexOf("-");
      if (dashIndex === -1) continue;
      const proj = section.slice(0, dashIndex);
      const e = section.slice(dashIndex + 1);
      if (vault && storedVault !== vault) continue;
      if (project && proj !== project) continue;
      if (env && e !== env) continue;
      refs.push({ vault: storedVault, provider, project: proj, env: e, field });
    }
    return refs;
  }

  async listEntries(project?: string, env?: string, vault?: string) {
    this.calls.push({ method: "listEntries", args: [project, env, vault] });
    const entries: SecretEntry[] = [];
    for (const [key, value] of this.store) {
      const parts = key.split("/");
      if (parts.length !== 4) continue;
      const [storedVault, provider, section, field] = parts;
      const dashIndex = section.lastIndexOf("-");
      if (dashIndex === -1) continue;
      const proj = section.slice(0, dashIndex);
      const e = section.slice(dashIndex + 1);
      if (vault && storedVault !== vault) continue;
      if (project && proj !== project) continue;
      if (env && e !== env) continue;
      entries.push({
        ref: { vault: storedVault, provider, project: proj, env: e, field },
        value,
      });
    }
    return entries;
  }

  buildInlineRef() {
    return null;
  }

  seed(
    vaultOrProvider: string,
    providerOrProject: string,
    projectOrEnv: string,
    envOrField: string,
    fieldOrValue: string,
    maybeValue?: string
  ) {
    const hasExplicitVault = maybeValue !== undefined;
    const vault = hasExplicitVault ? vaultOrProvider : "shipkey";
    const provider = hasExplicitVault ? providerOrProject : vaultOrProvider;
    const project = hasExplicitVault ? projectOrEnv : providerOrProject;
    const env = hasExplicitVault ? envOrField : projectOrEnv;
    const field = hasExplicitVault ? fieldOrValue : envOrField;
    const value = hasExplicitVault ? maybeValue : fieldOrValue;

    this.store.set(`${vault}/${provider}/${project}-${env}/${field}`, value);
  }

  reset() {
    this.calls.length = 0;
    this.store.clear();
  }
}
