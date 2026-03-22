import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { resolveProjectDir } from "../../src/commands/project-scope";

const TMP = join(import.meta.dir, "__project_scope_fixtures__");

beforeEach(() => {
  mkdirSync(join(TMP, "child"), { recursive: true });
  writeFileSync(join(TMP, "shipkey.json"), "{}\n");
  writeFileSync(join(TMP, "child/shipkey.json"), "{}\n");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("project scope", () => {
  test("resolveProjectDir only resolves the current directory config", async () => {
    expect(await resolveProjectDir(TMP)).toBe(TMP);
    expect(await resolveProjectDir(join(TMP, "child"))).toBe(join(TMP, "child"));
  });

  test("resolveProjectDir does not recurse into child directories", async () => {
    const emptyDir = join(TMP, "empty");
    mkdirSync(emptyDir, { recursive: true });
    expect(await resolveProjectDir(emptyDir)).toBeNull();
  });
});
