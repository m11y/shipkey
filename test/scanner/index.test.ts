import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scan } from "../../src/scanner";

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), "shipkey-scan-test-"));
  mkdirSync(join(TMP, "apps/api"), { recursive: true });
  mkdirSync(join(TMP, "node_modules/pkg"), { recursive: true });

  writeFileSync(
    join(TMP, ".env.example"),
    "DATABASE_URL=\nAPI_KEY=\nSECRET="
  );
  writeFileSync(
    join(TMP, ".env"),
    "DATABASE_URL=postgres://localhost\nAPI_KEY=sk-123\nSECRET=mysecret"
  );
  writeFileSync(
    join(TMP, "apps/api/.dev.vars.example"),
    "STRIPE_KEY=\nWEBHOOK_SECRET="
  );
  // Should be ignored
  writeFileSync(
    join(TMP, "node_modules/pkg/.env"),
    "IGNORED=true"
  );
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scan", () => {
  test("discovers env files recursively, skipping node_modules", async () => {
    const result = await scan(TMP);
    expect(result.totalFiles).toBe(3);
    expect(result.totalVars).toBe(8); // 3 + 3 + 2
  });

  test("groups files by sub-project", async () => {
    const result = await scan(TMP);
    const rootGroup = result.groups.find((g) => g.path === ".");
    const apiGroup = result.groups.find((g) => g.path === "apps/api");

    expect(rootGroup).toBeDefined();
    expect(rootGroup!.files).toHaveLength(2); // .env.example + .env
    expect(apiGroup).toBeDefined();
    expect(apiGroup!.files).toHaveLength(1); // .dev.vars.example
  });

  test("marks template files correctly", async () => {
    const result = await scan(TMP);
    const rootGroup = result.groups.find((g) => g.path === ".")!;
    const templateFile = rootGroup.files.find((f) =>
      f.path.includes(".example")
    );
    const realFile = rootGroup.files.find((f) => !f.path.includes(".example"));

    expect(templateFile!.isTemplate).toBe(true);
    expect(realFile!.isTemplate).toBe(false);
  });
});
