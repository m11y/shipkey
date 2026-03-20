import { Command } from "commander";
import { resolve, join, relative } from "path";
import { writeFile } from "fs/promises";
import { createInterface } from "readline";
import { walkAndScan, printScanSummary } from "../scanner/project";
import { loadConfig, type ShipkeyConfig } from "../config";

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

async function promptBackend(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      "\n  Select a backend:\n    1) 1Password (default)\n    2) Bitwarden\n  Choice [1]: ",
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== "n");
    });
  });
}

interface DefaultsDiff {
  added: [string, string][];   // new keys not in existing config
  changed: [string, string, string][]; // [key, oldVal, newVal]
  removed: string[];           // keys in config but no longer in .env
}

type ProviderField = [string, string]; // [provider, field]

interface ProvidersDiff {
  added: ProviderField[];
  removed: ProviderField[];
}

export function diffDefaults(
  existing: Record<string, string> | undefined,
  scanned: Record<string, string> | undefined
): DefaultsDiff | null {
  const oldDefaults = existing ?? {};
  const newDefaults = scanned ?? {};
  const diff: DefaultsDiff = { added: [], changed: [], removed: [] };

  for (const [key, newVal] of Object.entries(newDefaults)) {
    if (!(key in oldDefaults)) {
      diff.added.push([key, newVal]);
    } else if (oldDefaults[key] !== newVal) {
      diff.changed.push([key, oldDefaults[key], newVal]);
    }
  }

  for (const key of Object.keys(oldDefaults)) {
    if (!(key in newDefaults)) {
      diff.removed.push(key);
    }
  }

  const hasChanges = diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;
  return hasChanges ? diff : null;
}

export function diffProviders(
  existing: ShipkeyConfig["providers"] | undefined,
  scanned: ShipkeyConfig["providers"] | undefined
): ProvidersDiff | null {
  const added: ProviderField[] = [];
  const removed: ProviderField[] = [];
  const existingProviders = existing ?? {};
  const scannedProviders = scanned ?? {};

  for (const [providerName, provider] of Object.entries(scannedProviders)) {
    const existingFields = new Set(existingProviders[providerName]?.fields ?? []);
    for (const field of provider.fields) {
      if (!existingFields.has(field)) {
        added.push([providerName, field]);
      }
    }
  }

  for (const [providerName, provider] of Object.entries(existingProviders)) {
    const scannedFields = new Set(scannedProviders[providerName]?.fields ?? []);
    for (const field of provider.fields) {
      if (!scannedFields.has(field)) {
        removed.push([providerName, field]);
      }
    }
  }

  return added.length > 0 || removed.length > 0 ? { added, removed } : null;
}

function printDefaultsDiff(diff: DefaultsDiff): void {
  console.log(`\n  ${BOLD}Defaults diff:${RESET}`);
  for (const [key, val] of diff.added) {
    console.log(`  ${GREEN}+ ${key}=${val}${RESET}`);
  }
  for (const [key, oldVal, newVal] of diff.changed) {
    console.log(`  ${RED}- ${key}=${oldVal}${RESET}`);
    console.log(`  ${GREEN}+ ${key}=${newVal}${RESET}`);
  }
  for (const key of diff.removed) {
    console.log(`  ${RED}- ${key}${DIM} (removed from .env)${RESET}`);
  }
}

function printProvidersDiff(diff: ProvidersDiff): void {
  console.log(`\n  ${BOLD}Secrets diff:${RESET}`);
  for (const [providerName, field] of diff.added) {
    console.log(`  ${GREEN}+ ${providerName}.${field}${RESET}`);
  }
  for (const [providerName, field] of diff.removed) {
    console.log(`  ${RED}- ${providerName}.${field}${DIM} (removed from scan)${RESET}`);
  }
}

export const scanCommand = new Command("scan")
  .description("Scan project and generate shipkey.json in each directory with .env files")
  .option("--dry-run", "print results without writing shipkey.json")
  .argument("[dir]", "project directory", ".")
  .action(async (dir: string, opts: { dryRun?: boolean }) => {
    const projectRoot = resolve(dir);
    console.log(`Scanning ${projectRoot}...\n`);

    const found = await walkAndScan(projectRoot);

    if (found.length === 0) {
      console.log("  No .env files found.");
      return;
    }

    // Pre-load existing configs
    const existingConfigs = new Map<string, ShipkeyConfig | undefined>();
    for (const { dir: d } of found) {
      try {
        existingConfigs.set(d, await loadConfig(d));
      } catch {
        existingConfigs.set(d, undefined);
      }
    }

    // Prompt once if any directory doesn't have a backend configured yet
    let chosenBackend: string | undefined;
    const anyNeedsBackend = [...existingConfigs.values()].some((c) => !c?.backend);
    if (anyNeedsBackend && !opts.dryRun) {
      const choice = await promptBackend();
      chosenBackend = choice === "2" ? "bitwarden" : "1password";
    }

    for (const { dir: d, result } of found) {
      const relDir = relative(projectRoot, d) || ".";
      console.log(`\n  [${relDir}]`);
      printScanSummary(result);

      const existingConfig = existingConfigs.get(d);

      // Always show diff (dry-run or not)
      const diff = diffDefaults(existingConfig?.defaults, result.config.defaults);
      if (diff) {
        printDefaultsDiff(diff);
      }
      const providersDiff = diffProviders(
        existingConfig?.providers,
        result.config.providers
      );
      if (providersDiff) {
        printProvidersDiff(providersDiff);
      }

      if (!opts.dryRun) {
        result.config.backend = existingConfig?.backend ?? chosenBackend ?? "1password";

        // Prompt to accept defaults changes
        if (diff) {
          const accept = await promptYesNo(
            `\n  ${YELLOW}Update defaults in shipkey.json? [Y/n]:${RESET} `
          );
          if (!accept) {
            result.config.defaults = existingConfig?.defaults;
          }
        }

        const outPath = join(d, "shipkey.json");
        await writeFile(outPath, JSON.stringify(result.config, null, 2) + "\n");
        console.log(`  ✓ Written ${relative(projectRoot, outPath) || "shipkey.json"}`);
      }
    }

    if (opts.dryRun) {
      console.log(`\n  (dry-run: no shipkey.json files written)`);
    } else {
      console.log(`\n  Done. ${found.length} shipkey.json file(s) written.`);
    }
  });
