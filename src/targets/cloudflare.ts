import type { SyncTarget, SyncResult, TargetStatus } from "./types";

export class CloudflareTarget implements SyncTarget {
  readonly name = "Cloudflare Workers";

  async checkStatus(): Promise<TargetStatus> {
    try {
      // Single call: wrangler whoami checks both installation and authentication
      const proc = Bun.spawn(["wrangler", "whoami"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      if (proc.exitCode !== 0) {
        if (stderr.includes("not authenticated") || stderr.includes("not logged")) {
          return "not_authenticated";
        }
        return "not_installed";
      }
      return "ready";
    } catch {
      return "not_installed";
    }
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
