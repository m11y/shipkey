import { Command } from "commander";
import { scan } from "../scanner";
import { getBackend } from "../backends";
import { guessProvider } from "../providers";
import { loadConfig } from "../config";
import { resolve, basename } from "path";

export const pushCommand = new Command("push")
  .description("Push env values from local files to your password manager")
  .option("-e, --env <env>", "environment (dev/prod)", "prod")
  .option("--vault <vault>", "Vault or folder name", "shipkey")
  .option("--project <name>", "project name (defaults to directory name)")
  .argument("[dir]", "project directory", ".")
  .action(async (dir: string, opts) => {
    const projectRoot = resolve(dir);
    const project = opts.project || basename(projectRoot);
    const env = opts.env;
    const vault = opts.vault;

    let backendName = "1password";
    try {
      const config = await loadConfig(projectRoot);
      if (config.backend) backendName = config.backend;
    } catch {
      // No config file — use default backend
    }
    const backend = getBackend(backendName);

    if (!(await backend.isAvailable())) {
      console.error(
        `Error: ${backend.name} CLI not available. Run 'shipkey setup' for installation instructions.`
      );
      process.exit(1);
    }

    console.log(`Scanning ${projectRoot}...\n`);
    const result = await scan(projectRoot);

    // Collect real (non-template) vars with values
    const entries = result.groups.flatMap((g) =>
      g.files
        .filter((f) => !f.isTemplate)
        .flatMap((f) =>
          f.vars
            .filter((v) => v.value && v.value.length > 0)
            .map((v) => ({
              key: v.key,
              value: v.value!,
              provider: guessProvider(v.key),
            }))
        )
    );

    if (entries.length === 0) {
      console.log("No env values found to push. Only template files?");
      return;
    }

    console.log(`Pushing ${entries.length} keys to ${backend.name}...\n`);

    for (const entry of entries) {
      try {
        await backend.write({
          ref: {
            vault,
            provider: entry.provider,
            project,
            env,
            field: entry.key,
          },
          value: entry.value,
        });
        console.log(`  ✓ ${entry.key} → ${backend.name}`);
      } catch (err) {
        console.error(
          `  ✗ ${entry.key} — ${err instanceof Error ? err.message : err}`
        );
      }
    }

    console.log(`\nDone. Saved to vault: ${vault}`);
  });
