import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { MockBackend } from "../helpers/mock-backend";
import { OnePasswordBackend } from "../../src/backends/onepassword";
import { BitwardenBackend } from "../../src/backends/bitwarden";
import { writeEnvFile } from "../../src/env-writer";

describe("pull command logic", () => {
  test("backend.list and backend.read retrieves stored values", async () => {
    const backend = new MockBackend();
    backend.seed("OpenAI", "myapp", "dev", "OPENAI_API_KEY", "sk-123");
    backend.seed("Stripe", "myapp", "dev", "STRIPE_KEY", "sk_test_456");

    const refs = await backend.list("myapp", "dev");
    expect(refs).toHaveLength(2);

    for (const ref of refs) {
      const value = await backend.read(ref);
      expect(value).toBeTruthy();
    }
  });

  test("1Password backend buildInlineRef returns op:// URI for .envrc", () => {
    const backend = new OnePasswordBackend();
    const ref = {
      vault: "shipkey",
      provider: "OpenAI",
      project: "myapp",
      env: "prod",
      field: "OPENAI_API_KEY",
    };
    const inlineRef = backend.buildInlineRef(ref);
    expect(inlineRef).toBe("op://shipkey/OpenAI/myapp-prod/OPENAI_API_KEY");
  });

  test("Bitwarden backend buildInlineRef returns null (direct values)", () => {
    const backend = new BitwardenBackend();
    const ref = {
      vault: "shipkey",
      provider: "OpenAI",
      project: "myapp",
      env: "prod",
      field: "OPENAI_API_KEY",
    };
    expect(backend.buildInlineRef(ref)).toBeNull();
  });

  test("MockBackend list handles empty vault gracefully", async () => {
    const backend = new MockBackend();
    const refs = await backend.list("myapp", "dev");
    expect(refs).toHaveLength(0);
  });

  test("envrc line generation differs by backend type", () => {
    const ref = {
      vault: "shipkey",
      provider: "OpenAI",
      project: "myapp",
      env: "prod",
      field: "OPENAI_API_KEY",
    };

    const opBackend = new OnePasswordBackend();
    const opInlineRef = opBackend.buildInlineRef(ref);
    const opLine = `export OPENAI_API_KEY=$(op read "${opInlineRef}")`;
    expect(opLine).toContain("op read");
    expect(opLine).toContain("op://");

    const bwBackend = new BitwardenBackend();
    const bwInlineRef = bwBackend.buildInlineRef(ref);
    expect(bwInlineRef).toBeNull();
    // When null, pull.ts writes direct value: export KEY="value"
  });
});

describe("pull writes env file via writeEnvFile", () => {
  const TMP = join(import.meta.dir, "__pull_env_fixtures__");

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  test("pull writes pulled keys to .env via writeEnvFile", async () => {
    // Simulate what pull.ts does: build envVars map from entries, then call writeEnvFile
    const backend = new MockBackend();
    backend.seed("OpenAI", "myapp", "dev", "OPENAI_API_KEY", "sk-123");
    backend.seed("Stripe", "myapp", "dev", "STRIPE_KEY", "sk_test_456");

    const refs = await backend.list("myapp", "dev");
    const envVars: Record<string, string> = {};
    for (const ref of refs) {
      const value = await backend.read(ref);
      envVars[ref.field] = value;
    }

    const envFile = await writeEnvFile(TMP, envVars);
    expect(envFile).toBe(".env");
    expect(existsSync(join(TMP, ".env"))).toBe(true);

    const content = readFileSync(join(TMP, ".env"), "utf-8");
    expect(content).toContain("OPENAI_API_KEY=sk-123");
    expect(content).toContain("STRIPE_KEY=sk_test_456");
  });

  test("pull writeEnvFile merges with existing .env content", async () => {
    // Pre-existing .env with a manual key
    writeFileSync(join(TMP, ".env"), "MANUAL_KEY=manual_value\nOLD_KEY=old\n");

    const envVars: Record<string, string> = {
      OLD_KEY: "new_value",
      FRESH_KEY: "fresh",
    };

    await writeEnvFile(TMP, envVars);
    const content = readFileSync(join(TMP, ".env"), "utf-8");

    // Existing unmanaged key preserved
    expect(content).toContain("MANUAL_KEY=manual_value");
    // Existing key updated in-place
    expect(content).toContain("OLD_KEY=new_value");
    expect(content).not.toContain("OLD_KEY=old");
    // New key appended
    expect(content).toContain("FRESH_KEY=fresh");
  });

  test("pull writeEnvFile targets .dev.vars when wrangler.toml exists", async () => {
    writeFileSync(join(TMP, "wrangler.toml"), "name = 'my-worker'\n");

    const envVars = { API_SECRET: "secret123" };
    const envFile = await writeEnvFile(TMP, envVars);

    expect(envFile).toBe(".dev.vars");
    const content = readFileSync(join(TMP, ".dev.vars"), "utf-8");
    expect(content).toContain("API_SECRET=secret123");
  });
});

describe("pull .dev.vars merge behavior", () => {
  const TMP = join(import.meta.dir, "__pull_devvars_fixtures__");

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  test(".dev.vars merge updates existing keys in-place", async () => {
    // Simulate existing .dev.vars with some keys
    writeFileSync(
      join(TMP, ".dev.vars"),
      "# Auto-generated by shipkey\nDB_URL=old_db\nAPI_KEY=old_api\n"
    );

    // Simulate the merge logic from pull.ts
    const { readFile, writeFile } = await import("fs/promises");
    const entries = [
      { key: "API_KEY", value: "new_api" },
      { key: "NEW_SECRET", value: "secret123" },
    ];

    const devVarsPath = join(TMP, ".dev.vars");
    let existingContent = "";
    try {
      existingContent = await readFile(devVarsPath, "utf-8");
    } catch {
      // noop
    }

    let lines = existingContent ? existingContent.split("\n") : [];
    const updatedKeys = new Set<string>();

    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
      lines = [
        "# Auto-generated by shipkey — do not edit manually",
        "# Project: test  Environment: dev",
        "",
      ];
    }

    for (let i = 0; i < lines.length; i++) {
      for (const e of entries) {
        if (lines[i].startsWith(`${e.key}=`)) {
          lines[i] = `${e.key}=${e.value}`;
          updatedKeys.add(e.key);
        }
      }
    }

    const newEntries = entries.filter((e) => !updatedKeys.has(e.key));
    for (const e of newEntries) {
      const newLine = `${e.key}=${e.value}`;
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.splice(lines.length - 1, 0, newLine);
      } else {
        lines.push(newLine);
      }
    }

    const devVarsContent =
      lines.join("\n") + (lines[lines.length - 1] !== "" ? "\n" : "");
    await writeFile(devVarsPath, devVarsContent);

    const content = readFileSync(devVarsPath, "utf-8");

    // Comment preserved
    expect(content).toContain("# Auto-generated by shipkey");
    // Existing key NOT overwritten — updated in-place
    expect(content).toContain("API_KEY=new_api");
    expect(content).not.toContain("API_KEY=old_api");
    // Untouched key preserved
    expect(content).toContain("DB_URL=old_db");
    // New key appended
    expect(content).toContain("NEW_SECRET=secret123");

    // Verify ordering: DB_URL still before API_KEY (in-place update)
    const contentLines = content.split("\n").filter((l) => l.includes("=") && !l.startsWith("#"));
    const dbIdx = contentLines.findIndex((l) => l.startsWith("DB_URL="));
    const apiIdx = contentLines.findIndex((l) => l.startsWith("API_KEY="));
    expect(dbIdx).toBeLessThan(apiIdx);
  });

  test(".dev.vars creates file with header when none exists", async () => {
    const { readFile, writeFile } = await import("fs/promises");
    const entries = [{ key: "SECRET", value: "val" }];

    const devVarsPath = join(TMP, ".dev.vars");
    let existingContent = "";
    try {
      existingContent = await readFile(devVarsPath, "utf-8");
    } catch {
      // noop
    }

    let lines = existingContent ? existingContent.split("\n") : [];
    const updatedKeys = new Set<string>();

    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
      lines = [
        "# Auto-generated by shipkey — do not edit manually",
        "# Project: myapp  Environment: dev",
        "",
      ];
    }

    for (let i = 0; i < lines.length; i++) {
      for (const e of entries) {
        if (lines[i].startsWith(`${e.key}=`)) {
          lines[i] = `${e.key}=${e.value}`;
          updatedKeys.add(e.key);
        }
      }
    }

    const newEntries = entries.filter((e) => !updatedKeys.has(e.key));
    for (const e of newEntries) {
      const newLine = `${e.key}=${e.value}`;
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.splice(lines.length - 1, 0, newLine);
      } else {
        lines.push(newLine);
      }
    }

    const devVarsContent =
      lines.join("\n") + (lines[lines.length - 1] !== "" ? "\n" : "");
    await writeFile(devVarsPath, devVarsContent);

    const content = readFileSync(devVarsPath, "utf-8");

    expect(content).toContain("# Auto-generated by shipkey");
    expect(content).toContain("SECRET=val");
  });

  test(".dev.vars merge does not duplicate keys on repeated pulls", async () => {
    const { readFile, writeFile } = await import("fs/promises");
    const devVarsPath = join(TMP, ".dev.vars");

    // First pull
    writeFileSync(devVarsPath, "# Header\nKEY_A=val1\n");

    // Simulate a second pull with same key + new key
    const entries = [
      { key: "KEY_A", value: "val1_updated" },
      { key: "KEY_B", value: "val2" },
    ];

    let existingContent = await readFile(devVarsPath, "utf-8");
    let lines = existingContent.split("\n");
    const updatedKeys = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      for (const e of entries) {
        if (lines[i].startsWith(`${e.key}=`)) {
          lines[i] = `${e.key}=${e.value}`;
          updatedKeys.add(e.key);
        }
      }
    }

    const newEntries = entries.filter((e) => !updatedKeys.has(e.key));
    for (const e of newEntries) {
      const newLine = `${e.key}=${e.value}`;
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.splice(lines.length - 1, 0, newLine);
      } else {
        lines.push(newLine);
      }
    }

    const devVarsContent =
      lines.join("\n") + (lines[lines.length - 1] !== "" ? "\n" : "");
    await writeFile(devVarsPath, devVarsContent);

    const content = readFileSync(devVarsPath, "utf-8");

    // KEY_A should appear exactly once (updated, not duplicated)
    const keyAMatches = content.split("\n").filter((l) => l.startsWith("KEY_A="));
    expect(keyAMatches).toHaveLength(1);
    expect(keyAMatches[0]).toBe("KEY_A=val1_updated");

    // KEY_B appended
    expect(content).toContain("KEY_B=val2");
  });
});
