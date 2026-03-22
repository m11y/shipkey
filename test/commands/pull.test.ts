import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { MockBackend } from "../helpers/mock-backend";
import { OnePasswordBackend } from "../../src/backends/onepassword";
import { BitwardenBackend } from "../../src/backends/bitwarden";
import {
  planDefaultsFill,
  planEnvMerge,
  pullCommand,
  resolveRemoteEntries,
  writeIfNotDryRun,
} from "../../src/commands/pull";

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

  test("resolveRemoteEntries prefers listEntries over per-key reads", async () => {
    const backend = new MockBackend();
    backend.seed("OpenAI", "myapp", "dev", "OPENAI_API_KEY", "sk-123");

    const result = await resolveRemoteEntries(backend, "myapp", "dev", "shipkey");

    expect(result.failures).toHaveLength(0);
    expect(result.entries).toEqual([
      {
        ref: {
          vault: "shipkey",
          provider: "OpenAI",
          project: "myapp",
          env: "dev",
          field: "OPENAI_API_KEY",
        },
        value: "sk-123",
      },
    ]);
    expect(backend.calls.some((call) => call.method === "listEntries")).toBe(true);
    expect(backend.calls.some((call) => call.method === "read")).toBe(false);
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

  test("pull command exposes a dry-run option", () => {
    const option = pullCommand.options.find((opt) => opt.long === "--dry-run");
    expect(option).toBeDefined();
  });

  test("writeIfNotDryRun skips file writes in dry-run mode", async () => {
    const tmpDir = join(import.meta.dir, "__pull_write_dry_run__");
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, ".env");
    writeFileSync(filePath, "EXISTING=1\n");

    const wrote = await writeIfNotDryRun(filePath, "UPDATED=2\n", true);

    expect(wrote).toBe(false);
    expect(readFileSync(filePath, "utf-8")).toBe("EXISTING=1\n");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writeIfNotDryRun writes file when dry-run is disabled", async () => {
    const tmpDir = join(import.meta.dir, "__pull_write_real__");
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, ".env");

    const wrote = await writeIfNotDryRun(filePath, "UPDATED=2\n", false);

    expect(wrote).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("UPDATED=2\n");
    rmSync(tmpDir, { recursive: true, force: true });
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

describe("pull .env in-place merge with shipkey marker", () => {
  const TMP = join(import.meta.dir, "__pull_env_inplace__");

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  test("preserves comments, blank lines, and key ordering", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(
      envPath,
      [
        "# Database config",
        "DATABASE_URL=postgresql://localhost/mydb",
        "PORT=3000",
        "",
        "# Third-party APIs",
        "STRIPE_KEY=sk_test_old",
      ].join("\n")
    );

    const existing = await readFile(envPath, "utf-8");
    const result = planEnvMerge(existing, [
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "DATABASE_URL" },
        value: "postgresql://prod/mydb",
      },
      {
        ref: { vault: "shipkey", provider: "Stripe", project: "myapp", env: "dev", field: "STRIPE_KEY" },
        value: "sk_live_new",
      },
    ]);
    await writeFile(envPath, result.lines.join("\n"));

    const lines = readFileSync(envPath, "utf-8").split("\n");
    expect(lines[0]).toBe("# Database config");
    expect(lines[1]).toBe("DATABASE_URL=postgresql://prod/mydb # generated by shipkey");
    expect(lines[2]).toBe("PORT=3000");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("# Third-party APIs");
    expect(lines[5]).toBe("STRIPE_KEY=sk_live_new # generated by shipkey");
  });

  test("local-only keys are preserved untouched", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "API_KEY=from_vault\nMY_LOCAL=debug_val\n");

    const existing = await readFile(envPath, "utf-8");
    const result = planEnvMerge(existing, [
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "API_KEY" },
        value: "new_val",
      },
    ]);
    await writeFile(envPath, result.lines.join("\n"));

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("MY_LOCAL=debug_val");
    expect(content).not.toContain("MY_LOCAL=debug_val # generated by shipkey");
    expect(content).toContain("API_KEY=new_val # generated by shipkey");
  });

  test("removes managed keys that were deleted from the password manager", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "OLD_KEY=old_val # generated by shipkey\nLOCAL=x\n");

    const existing = await readFile(envPath, "utf-8");
    const result = planEnvMerge(existing, []);
    await writeFile(envPath, result.lines.join("\n"));

    const content = readFileSync(envPath, "utf-8");
    expect(content).not.toContain("OLD_KEY=old_val");
    expect(content).toContain("LOCAL=x");
    expect(result.removed).toEqual(["OLD_KEY"]);
  });

  test("appends new keys from password manager not in local file", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "EXISTING=val\n");

    const existing = await readFile(envPath, "utf-8");
    const result = planEnvMerge(existing, [
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "EXISTING" },
        value: "updated",
      },
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "BRAND_NEW" },
        value: "fresh",
      },
    ]);
    await writeFile(envPath, result.lines.join("\n"));

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("EXISTING=updated # generated by shipkey");
    expect(content).toContain("BRAND_NEW=fresh # generated by shipkey");
    expect(result.updated).toEqual(["EXISTING"]);
    expect(result.added).toEqual(["BRAND_NEW"]);
  });

  test("creates .env from scratch when file does not exist", async () => {
    const envPath = join(TMP, ".env");

    const result = planEnvMerge(null, [
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "KEY_A" },
        value: "val_a",
      },
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "KEY_B" },
        value: "val_b",
      },
    ]);
    await writeFile(envPath, result.lines.join("\n"));

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("KEY_A=val_a # generated by shipkey");
    expect(content).toContain("KEY_B=val_b # generated by shipkey");
  });

  test("repeated pulls do not duplicate keys", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "API_KEY=v1\nDB_URL=db1\n");

    const entries = [
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "API_KEY" },
        value: "v2",
      },
      {
        ref: { vault: "shipkey", provider: "General", project: "myapp", env: "dev", field: "DB_URL" },
        value: "db2",
      },
    ];

    let existing = await readFile(envPath, "utf-8");
    let result = planEnvMerge(existing, entries);
    await writeFile(envPath, result.lines.join("\n"));
    existing = await readFile(envPath, "utf-8");
    result = planEnvMerge(existing, entries);
    await writeFile(envPath, result.lines.join("\n"));

    const lines = readFileSync(envPath, "utf-8").split("\n");
    const apiLines = lines.filter((l) => l.startsWith("API_KEY="));
    const dbLines = lines.filter((l) => l.startsWith("DB_URL="));
    expect(apiLines).toHaveLength(1);
    expect(dbLines).toHaveLength(1);
  });
});

describe("pull defaults from shipkey.json", () => {
  const TMP = join(import.meta.dir, "__pull_defaults__");

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  test("fills missing defaults into .env", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "API_KEY=secret # generated by shipkey\n");

    const content = await readFile(envPath, "utf-8");
    const result = planDefaultsFill(content.split("\n"), {
      PORT: "3000",
      NODE_ENV: "development",
    });
    await writeFile(envPath, result.lines.join("\n"));

    const nextContent = readFileSync(envPath, "utf-8");
    expect(result.added).toEqual(["PORT", "NODE_ENV"]);
    expect(nextContent).toContain("PORT=3000");
    expect(nextContent).toContain("NODE_ENV=development");
    // Defaults should NOT have the shipkey marker
    expect(nextContent).not.toContain("PORT=3000 # generated by shipkey");
  });

  test("does not overwrite existing keys with defaults", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "PORT=8080\nAPI_KEY=secret\n");

    const content = await readFile(envPath, "utf-8");
    const result = planDefaultsFill(content.split("\n"), {
      PORT: "3000",
      LOG_LEVEL: "info",
    });
    await writeFile(envPath, result.lines.join("\n"));

    const nextContent = readFileSync(envPath, "utf-8");
    expect(result.added).toEqual(["LOG_LEVEL"]);
    expect(nextContent).toContain("PORT=8080");
    expect(nextContent).not.toContain("PORT=3000");
    expect(nextContent).toContain("LOG_LEVEL=info");
  });

  test("no-op when all defaults already exist", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "PORT=8080\nNODE_ENV=production\n");

    const content = await readFile(envPath, "utf-8");
    const result = planDefaultsFill(content.split("\n"), {
      PORT: "3000",
      NODE_ENV: "development",
    });

    expect(result.added).toEqual([]);
    expect(result.lines.join("\n")).toBe("PORT=8080\nNODE_ENV=production\n");
  });

  test("repeated pulls do not duplicate defaults", async () => {
    const envPath = join(TMP, ".env");
    writeFileSync(envPath, "API_KEY=secret\n");

    const defaults = { PORT: "3000", LOG_LEVEL: "info" };
    let content = await readFile(envPath, "utf-8");
    let result = planDefaultsFill(content.split("\n"), defaults);
    await writeFile(envPath, result.lines.join("\n"));
    content = await readFile(envPath, "utf-8");
    result = planDefaultsFill(content.split("\n"), defaults);
    await writeFile(envPath, result.lines.join("\n"));

    const lines = readFileSync(envPath, "utf-8").split("\n");
    const portLines = lines.filter((l) => l.startsWith("PORT="));
    expect(portLines).toHaveLength(1);
  });
});

describe("push skips defaults", () => {
  test("filters out keys present in config.defaults", () => {
    const defaultKeys = new Set(Object.keys({ PORT: "3000", NODE_ENV: "development" }));
    const allVars = [
      { key: "API_KEY", value: "secret" },
      { key: "PORT", value: "3000" },
      { key: "STRIPE_KEY", value: "sk_live" },
      { key: "NODE_ENV", value: "production" },
    ];

    const filtered = allVars.filter((v) => !defaultKeys.has(v.key));
    expect(filtered).toEqual([
      { key: "API_KEY", value: "secret" },
      { key: "STRIPE_KEY", value: "sk_live" },
    ]);
  });
});
