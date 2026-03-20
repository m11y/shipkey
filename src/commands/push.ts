import { Command } from "commander";
import { scanSingleDir, walkDirsWithShipkey } from "../scanner";
import { getBackend } from "../backends";
import { loadConfig } from "../config";
import { resolve, relative } from "path";
import { createInterface } from "readline";
import type { ShipkeyConfig } from "../config";
import type { SecretRef } from "../backends/types";
import type { ScanResult } from "../scanner/types";

interface SecretRefDiff {
  added: SecretRef[];
  removed: SecretRef[];
}

function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function refKey(ref: SecretRef): string {
  return `${ref.vault}\0${ref.provider}\0${ref.project}\0${ref.env}\0${ref.field}`;
}

export function collectDesiredSecretRefs(
  config: ShipkeyConfig,
  env: string,
  vault: string
): SecretRef[] {
  const refs: SecretRef[] = [];

  for (const [provider, providerConfig] of Object.entries(config.providers ?? {})) {
    for (const field of providerConfig.fields) {
      refs.push({
        vault,
        provider,
        project: config.project,
        env,
        field,
      });
    }
  }

  return refs;
}

export function diffSecretRefs(
  desired: SecretRef[],
  existing: SecretRef[]
): SecretRefDiff | null {
  const desiredMap = new Map(desired.map((ref) => [refKey(ref), ref]));
  const existingMap = new Map(existing.map((ref) => [refKey(ref), ref]));
  const added: SecretRef[] = [];
  const removed: SecretRef[] = [];

  for (const [key, ref] of desiredMap) {
    if (!existingMap.has(key)) {
      added.push(ref);
    }
  }

  for (const [key, ref] of existingMap) {
    if (!desiredMap.has(key)) {
      removed.push(ref);
    }
  }

  return added.length > 0 || removed.length > 0 ? { added, removed } : null;
}

export function collectLocalSecretValues(result: ScanResult): Map<string, string> {
  const values = new Map<string, string>();

  for (const group of result.groups) {
    for (const file of group.files) {
      if (file.isTemplate) continue;
      for (const variable of file.vars) {
        if (!values.has(variable.key) && variable.value != null && variable.value.length > 0) {
          values.set(variable.key, variable.value);
        }
      }
    }
  }

  return values;
}

export const pushCommand = new Command("push")
  .description("Push env values from local files to your password manager")
  .option("-e, --env <env>", "environment (overrides shipkey.json)")
  .option("--vault <vault>", "Vault or folder name", "shipkey")
  .argument("[dir]", "project directory", ".")
  .action(async (dir: string, opts) => {
    const projectRoot = resolve(dir);

    const shipkeyDirs = await walkDirsWithShipkey(projectRoot);

    if (shipkeyDirs.length === 0) {
      console.error(
        "  No shipkey.json found. Run `shipkey scan` first."
      );
      process.exit(1);
    }

    for (const d of shipkeyDirs) {
      const relDir = relative(projectRoot, d) || ".";
      console.log(`\n  [${relDir}]`);

      let config;
      try {
        config = await loadConfig(d);
      } catch {
        console.error(`  ✗ Could not read shipkey.json in ${relDir}`);
        continue;
      }

      const backendName = config.backend ?? "1password";
      if (backendName !== "bitwarden") {
        console.error(
          "  ✗ Deletion-aware push currently only supports the Bitwarden backend."
        );
        continue;
      }

      const backend = getBackend(config.backend);
      const env = opts.env ?? config.env ?? "dev";
      const vault = opts.vault ?? config.vault ?? "shipkey";
      if (!(await backend.isAvailable())) {
        console.error(
          `  ✗ ${backend.name} CLI not available. Run 'shipkey setup' for installation instructions.`
        );
        continue;
      }

      const desiredRefs = collectDesiredSecretRefs(config, env, vault);
      const existingRefs = await backend.list(config.project, env, vault);
      const diff = diffSecretRefs(desiredRefs, existingRefs);

      if (!diff) {
        console.log("  No secret changes to push.");
        continue;
      }

      if (diff.added.length > 0) {
        console.log(`  Added secrets (${diff.added.length}):`);
        for (const ref of diff.added) {
          console.log(`    + ${ref.provider}.${ref.field}`);
        }
      }

      if (diff.removed.length > 0) {
        console.log(`  Removed secrets (${diff.removed.length}):`);
        for (const ref of diff.removed) {
          console.log(`    - ${ref.provider}.${ref.field}`);
        }
      }

      if (diff.added.length > 0) {
        const result = await scanSingleDir(d);
        const localValues = collectLocalSecretValues(result);
        const entries = diff.added.flatMap((ref) => {
          const value = localValues.get(ref.field);
          if (value == null) {
            console.error(
              `  ✗ Missing local value for ${ref.provider}.${ref.field}; skipped.`
            );
            return [];
          }
          return [{ ref, value }];
        });

        if (entries.length > 0) {
          console.log(`  Writing ${entries.length} new secret(s) to ${backend.name}...`);
          for (const entry of entries) {
            try {
              await backend.write(entry);
              console.log(`  ✓ ${entry.ref.provider}.${entry.ref.field} → ${backend.name}`);
            } catch (err) {
              console.error(
                `  ✗ ${entry.ref.provider}.${entry.ref.field} — ${
                  err instanceof Error ? err.message : err
                }`
              );
            }
          }
        }
      }

      if (diff.removed.length > 0) {
        if (!backend.delete) {
          console.error(
            `  ✗ ${backend.name} backend does not support deleting secrets in push yet.`
          );
          continue;
        }

        for (const ref of diff.removed) {
          const confirm = await promptYesNo(
            `  Delete ${ref.provider}.${ref.field} from ${backend.name}? [y/N]: `
          );
          if (!confirm) {
            console.log(`  Skipped ${ref.provider}.${ref.field}`);
            continue;
          }

          try {
            await backend.delete(ref);
            console.log(`  ✓ Deleted ${ref.provider}.${ref.field} from ${backend.name}`);
          } catch (err) {
            console.error(
              `  ✗ Delete ${ref.provider}.${ref.field} — ${
                err instanceof Error ? err.message : err
              }`
            );
          }
        }
      }
    }

    console.log("\nDone.");
  });
