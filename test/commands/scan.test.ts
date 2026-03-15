import { describe, test, expect } from "bun:test";
import { diffDefaults } from "../../src/commands/scan";

describe("diffDefaults", () => {
  test("returns null when no changes", () => {
    const result = diffDefaults(
      { PORT: "3000", NODE_ENV: "development" },
      { PORT: "3000", NODE_ENV: "development" }
    );
    expect(result).toBeNull();
  });

  test("detects added keys", () => {
    const result = diffDefaults(
      { PORT: "3000" },
      { PORT: "3000", LOG_LEVEL: "info" }
    );
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([["LOG_LEVEL", "info"]]);
    expect(result!.changed).toEqual([]);
    expect(result!.removed).toEqual([]);
  });

  test("detects changed values", () => {
    const result = diffDefaults(
      { PORT: "3000", NODE_ENV: "development" },
      { PORT: "8080", NODE_ENV: "development" }
    );
    expect(result).not.toBeNull();
    expect(result!.changed).toEqual([["PORT", "3000", "8080"]]);
    expect(result!.added).toEqual([]);
    expect(result!.removed).toEqual([]);
  });

  test("detects removed keys", () => {
    const result = diffDefaults(
      { PORT: "3000", OLD_KEY: "val" },
      { PORT: "3000" }
    );
    expect(result).not.toBeNull();
    expect(result!.removed).toEqual(["OLD_KEY"]);
    expect(result!.added).toEqual([]);
    expect(result!.changed).toEqual([]);
  });

  test("detects all types of changes together", () => {
    const result = diffDefaults(
      { PORT: "3000", OLD: "x", SAME: "y" },
      { PORT: "8080", NEW: "z", SAME: "y" }
    );
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([["NEW", "z"]]);
    expect(result!.changed).toEqual([["PORT", "3000", "8080"]]);
    expect(result!.removed).toEqual(["OLD"]);
  });

  test("handles undefined existing (first scan)", () => {
    const result = diffDefaults(undefined, { PORT: "3000" });
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([["PORT", "3000"]]);
  });

  test("handles undefined scanned (no defaults found)", () => {
    const result = diffDefaults({ PORT: "3000" }, undefined);
    expect(result).not.toBeNull();
    expect(result!.removed).toEqual(["PORT"]);
  });

  test("handles both undefined", () => {
    const result = diffDefaults(undefined, undefined);
    expect(result).toBeNull();
  });
});
