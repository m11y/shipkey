import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { SyncTarget, SyncResult, TargetStatus } from "./types";

export class CloudflareTarget implements SyncTarget {
  readonly name = "Cloudflare Workers";

  private getWranglerConfigPaths(): string[] {
    const home = homedir();
    const custom = process.env.WRANGLER_HOME;
    const paths: string[] = [];
    if (custom) paths.push(join(custom, "config", "default.toml"));
    if (process.platform === "darwin") {
      paths.push(join(home, "Library", "Preferences", ".wrangler", "config", "default.toml"));
    }
    // XDG / Linux / fallback
    const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
    paths.push(join(xdg, ".wrangler", "config", "default.toml"));
    // Windows
    if (process.env.APPDATA) {
      paths.push(join(process.env.APPDATA, ".wrangler", "config", "default.toml"));
    }
    return paths;
  }

  private async checkAuthFromConfig(): Promise<boolean> {
    for (const configPath of this.getWranglerConfigPaths()) {
      try {
        const config = await readFile(configPath, "utf-8");
        if (config.includes("oauth_token") || config.includes("api_token")) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  async checkStatus(): Promise<TargetStatus> {
    try {
      const proc = Bun.spawn(["wrangler", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode !== 0) return "not_installed";
    } catch {
      return "not_installed";
    }

    // Try wrangler whoami first (most accurate when network is available)
    try {
      const proc = Bun.spawn(["wrangler", "whoami"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      if (stdout.includes("You are logged in")) return "ready";
    } catch {}

    // Fallback: check local config file (works offline / when Bun.spawn network fails)
    if (await this.checkAuthFromConfig()) return "ready";

    return "not_authenticated";
  }

  async isAvailable(): Promise<boolean> {
    const status = await this.checkStatus();
    return status === "ready";
  }

  installHint(): string {
    return (
      "Wrangler CLI not found.\n" +
      "  Install: npm i -g wrangler\n" +
      "  Then:    wrangler login"
    );
  }

  buildCommand(secretName: string, projectName: string): string[] {
    return ["wrangler", "secret", "put", secretName, "--name", projectName];
  }

  async sync(
    secrets: { name: string; value: string }[],
    projectName: string
  ): Promise<SyncResult> {
    const result: SyncResult = { success: [], failed: [] };

    for (const secret of secrets) {
      try {
        const args = this.buildCommand(secret.name, projectName);
        const proc = Bun.spawn(args, {
          stdin: new Response(secret.value).body!,
          stdout: "pipe",
          stderr: "pipe",
        });
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          result.failed.push({ name: secret.name, error: stderr.trim() });
        } else {
          result.success.push(secret.name);
        }
      } catch (err) {
        result.failed.push({
          name: secret.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }
}
