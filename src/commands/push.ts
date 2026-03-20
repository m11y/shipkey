import { Command } from "commander";
import { scanSingleDir, walkDirsWithShipkey } from "../scanner";
import { getBackend } from "../backends";
import { loadConfig } from "../config";
import { resolve, relative } from "path";
import { createInterface } from "readline";
import type { ShipkeyConfig } from "../config";
import type { SecretRef } from "../backends/types";
import type { ScanResult } from "../scanner/types";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface SecretRefDiff {
  added: SecretRef[];
  removed: SecretRef[];
}

interface ChangedSecretValue {
  ref: SecretRef;
  localValue: string;
  remoteValue: string;
}

interface AddedSecretEntry {
  ref: SecretRef;
  value: string;
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

export function diffSecretValues(
  refs: SecretRef[],
  localValues: Map<string, string>,
  remoteValues: Map<string, string>
): ChangedSecretValue[] {
  const changed: ChangedSecretValue[] = [];

  for (const ref of refs) {
    const localValue = localValues.get(ref.field);
    const remoteValue = remoteValues.get(refKey(ref));
    if (localValue == null || remoteValue == null) continue;
    if (localValue !== remoteValue) {
      changed.push({ ref, localValue, remoteValue });
    }
  }

  return changed;
}

export function resolveAddedSecretEntries(
  refs: SecretRef[],
  localValues: Map<string, string>
): {
  entries: AddedSecretEntry[];
  missing: SecretRef[];
} {
  const entries: AddedSecretEntry[] = [];
  const missing: SecretRef[] = [];

  for (const ref of refs) {
    const value = localValues.get(ref.field);
    if (value == null) {
      missing.push(ref);
      continue;
    }
    entries.push({ ref, value });
  }

  return { entries, missing };
}

export function formatSecretLabel(ref: SecretRef): string {
  return `${ref.provider}.${ref.field}`;
}

export const pushCommand = new Command("push")
  .description("Push env values from local files to your password manager")
  .option("-e, --env <env>", "environment (overrides shipkey.json)")
  .option("--vault <vault>", "Vault or folder name", "shipkey")
  .option("--dry-run", "show changes without writing or deleting secrets")
  .argument("[dir]", "project directory", ".")
  .action(async (dir: string, opts) => {
    const projectRoot = resolve(dir);
    const isDryRun = Boolean(opts.dryRun);

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
      const existingRefKeys = new Set(existingRefs.map(refKey));
      const sharedRefs = desiredRefs.filter((ref) => existingRefKeys.has(refKey(ref)));

      if (!diff && sharedRefs.length === 0) {
        console.log("  No secret changes to push.");
        continue;
      }

      const result = await scanSingleDir(d);
      const localValues = collectLocalSecretValues(result);

      const remoteValues = new Map<string, string>();
      for (const ref of sharedRefs) {
        if (!localValues.has(ref.field)) continue;
        try {
          remoteValues.set(refKey(ref), await backend.read(ref));
        } catch (err) {
          console.error(
            `  ✗ Could not read ${ref.provider}.${ref.field} from ${backend.name} — ${
              err instanceof Error ? err.message : err
            }`
          );
        }
      }

      const changedValues = diffSecretValues(sharedRefs, localValues, remoteValues);

      if (!diff && changedValues.length === 0) {
        console.log("  No secret changes to push.");
        continue;
      }

      if (diff?.added.length) {
        console.log(`  ${BOLD}Added secrets (${diff.added.length}):${RESET}`);
        for (const ref of diff.added) {
          console.log(`    ${GREEN}+ ${formatSecretLabel(ref)}${RESET}`);
        }
      }

      if (changedValues.length > 0) {
        console.log(`  ${BOLD}Changed secrets (${changedValues.length}):${RESET}`);
        for (const entry of changedValues) {
          console.log(`    ${YELLOW}~ ${formatSecretLabel(entry.ref)}${RESET}`);
        }
      }

      if (diff?.removed.length) {
        console.log(`  ${BOLD}Removed secrets (${diff.removed.length}):${RESET}`);
        for (const ref of diff.removed) {
          console.log(`    ${RED}- ${formatSecretLabel(ref)}${RESET}`);
        }
      }

      const addedResolution = diff?.added.length
        ? resolveAddedSecretEntries(diff.added, localValues)
        : { entries: [], missing: [] as SecretRef[] };

      for (const ref of addedResolution.missing) {
        console.error(
          `  ${RED}✗ Missing local value for ${formatSecretLabel(ref)}; skipped.${RESET}`
        );
      }

      if (isDryRun) {
        if (addedResolution.entries.length > 0) {
          console.log(
            `  ${DIM}Would write ${addedResolution.entries.length} new secret(s) to ${backend.name}.${RESET}`
          );
        }
        if (changedValues.length > 0) {
          console.log(
            `  ${DIM}Would prompt to overwrite ${changedValues.length} existing secret(s) in ${backend.name}.${RESET}`
          );
        }
        if (diff?.removed.length) {
          console.log(
            `  ${DIM}Would prompt to delete ${diff.removed.length} secret(s) from ${backend.name}.${RESET}`
          );
        }
        console.log(`  ${DIM}(dry-run: no secrets were changed)${RESET}`);
        continue;
      }

      if (addedResolution.entries.length > 0) {
        console.log(
          `  ${DIM}Writing ${addedResolution.entries.length} new secret(s) to ${backend.name}...${RESET}`
        );
        for (const entry of addedResolution.entries) {
          try {
            await backend.write(entry);
            console.log(
              `  ${GREEN}✓ ${formatSecretLabel(entry.ref)} → ${backend.name}${RESET}`
            );
          } catch (err) {
            console.error(
              `  ${RED}✗ ${formatSecretLabel(entry.ref)} — ${
                err instanceof Error ? err.message : err
              }${RESET}`
            );
          }
        }
      }

      if (changedValues.length > 0) {
        for (const entry of changedValues) {
          const confirm = await promptYesNo(
            `  ${YELLOW}Overwrite ${formatSecretLabel(entry.ref)} in ${backend.name}? [y/N]:${RESET} `
          );
          if (!confirm) {
            console.log(`  ${DIM}Skipped ${formatSecretLabel(entry.ref)}${RESET}`);
            continue;
          }

          try {
            await backend.write({ ref: entry.ref, value: entry.localValue });
            console.log(
              `  ${GREEN}✓ Updated ${formatSecretLabel(entry.ref)} in ${backend.name}${RESET}`
            );
          } catch (err) {
            console.error(
              `  ${RED}✗ Update ${formatSecretLabel(entry.ref)} — ${
                err instanceof Error ? err.message : err
              }${RESET}`
            );
          }
        }
      }

      if (diff?.removed.length) {
        if (!backend.delete) {
          console.error(
            `  ✗ ${backend.name} backend does not support deleting secrets in push yet.`
          );
          continue;
        }

        for (const ref of diff.removed) {
          const confirm = await promptYesNo(
            `  ${YELLOW}Delete ${formatSecretLabel(ref)} from ${backend.name}? [y/N]:${RESET} `
          );
          if (!confirm) {
            console.log(`  ${DIM}Skipped ${formatSecretLabel(ref)}${RESET}`);
            continue;
          }

          try {
            await backend.delete(ref);
            console.log(
              `  ${GREEN}✓ Deleted ${formatSecretLabel(ref)} from ${backend.name}${RESET}`
            );
          } catch (err) {
            console.error(
              `  ${RED}✗ Delete ${formatSecretLabel(ref)} — ${
                err instanceof Error ? err.message : err
              }${RESET}`
            );
          }
        }
      }
    }

    console.log("\nDone.");
  });
