import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  scanPackageJson,
  scanPackageJsonsRecursive,
} from "../../../src/scanner/parsers/packagejson";

const TMP = join(import.meta.dir, "__packagejson_fixtures__");

beforeEach(() => {
  mkdirSync(join(TMP, "apps/api"), { recursive: true });

  writeFileSync(
    join(TMP, "package.json"),
    JSON.stringify({
      dependencies: {
        react: "^19.0.0",
      },
    })
  );

  writeFileSync(
    join(TMP, "apps/api/package.json"),
    JSON.stringify({
      dependencies: {
        stripe: "^18.0.0",
      },
      devDependencies: {
        wrangler: "^4.0.0",
      },
    })
  );
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("package.json scanning", () => {
  test("scanPackageJson only reads the current directory", async () => {
    const result = await scanPackageJson(TMP);
    expect(result.dependencies).toEqual(["react"]);
  });

  test("scanPackageJsonsRecursive includes nested package.json files", async () => {
    const result = await scanPackageJsonsRecursive(TMP);
    expect(result.dependencies.sort()).toEqual(["react", "stripe", "wrangler"]);
  });
});
