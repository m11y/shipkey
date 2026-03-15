import { readFile } from "fs/promises";
import { join } from "path";

export interface PermissionHint {
  permission: string;
  source: string;
}

export interface ProviderConfig {
  fields: string[];
  guide_url?: string;
  guide?: string;
  permissions?: PermissionHint[];
}

export interface TargetConfig {
  [destination: string]: string[] | Record<string, string>;
}

export interface ShipkeyConfig {
  project: string;
  vault: string;
  backend?: string; // "1password" | "bitwarden", defaults to "1password"
  defaults?: Record<string, string>; // non-secret keys with default values
  providers?: Record<string, ProviderConfig>;
  targets?: {
    github?: TargetConfig;
    cloudflare?: TargetConfig;
  };
}

export async function loadConfig(dir: string): Promise<ShipkeyConfig> {
  const configPath = join(dir, "shipkey.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Cannot read ${configPath}. Run 'shipkey init' or create it manually.`
    );
  }
}

import type { SecretBackend } from "./backends/types";

/**
 * Build a map of env key → inline reference (e.g. op:// URI).
 * For backends that don't support inline refs (e.g. Bitwarden), values will be null.
 */
export function buildSecretRefMap(
  config: ShipkeyConfig,
  backend: SecretBackend,
  env = "prod"
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!config.providers) return map;

  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const field of provider.fields) {
      const ref = {
        vault: config.vault,
        provider: providerName,
        project: config.project,
        env,
        field,
      };
      const inlineRef = backend.buildInlineRef?.(ref) ?? null;
      map.set(field, inlineRef);
    }
  }
  return map;
}

/** @deprecated Use buildSecretRefMap instead */
export function buildEnvKeyToOpRef(
  config: ShipkeyConfig,
  env = "prod"
): Map<string, string> {
  const map = new Map<string, string>();
  if (!config.providers) return map;

  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const field of provider.fields) {
      const opRef = `op://${config.vault}/${providerName}/${config.project}-${env}/${field}`;
      map.set(field, opRef);
    }
  }
  return map;
}
