import { describe, test, expect } from "bun:test";
import { BitwardenBackend } from "../../src/backends/bitwarden";

describe("BitwardenBackend", () => {
  test("name is 'Bitwarden'", () => {
    const backend = new BitwardenBackend();
    expect(backend.name).toBe("Bitwarden");
  });

  test("builds correct item name for storage", () => {
    const backend = new BitwardenBackend();
    const ref = {
      vault: "shipkey",
      provider: "OpenRouter",
      project: "shipcast",
      env: "dev",
      field: "OPENROUTER_API_KEY",
    };
    expect(backend.buildItemName(ref)).toBe("shipcast__dev");
  });

  test("builds correct field name for storage", () => {
    const backend = new BitwardenBackend();
    const ref = {
      vault: "shipkey",
      provider: "OpenRouter",
      project: "shipcast",
      env: "dev",
      field: "OPENROUTER_API_KEY",
    };
    expect(backend.buildFieldName(ref)).toBe("OpenRouter.OPENROUTER_API_KEY");
  });

  test("parses item name back to components", () => {
    const parsed = BitwardenBackend.parseItemName("shipcast__dev");
    expect(parsed).toEqual({
      project: "shipcast",
      env: "dev",
    });
  });

  test("parseItemName keeps project names containing separators", () => {
    const parsed = BitwardenBackend.parseItemName("ship__web__prod");
    expect(parsed).toEqual({
      project: "ship__web",
      env: "prod",
    });
  });

  test("parses field name back to components", () => {
    const parsed = BitwardenBackend.parseFieldName("OpenRouter.OPENROUTER_API_KEY");
    expect(parsed).toEqual({
      provider: "OpenRouter",
      field: "OPENROUTER_API_KEY",
    });
  });

  test("parseFieldName keeps provider names containing dots", () => {
    const parsed = BitwardenBackend.parseFieldName("fal.ai.FAL_KEY");
    expect(parsed).toEqual({
      provider: "fal.ai",
      field: "FAL_KEY",
    });
  });

  test("parseItemName and parseFieldName return null for invalid format", () => {
    expect(BitwardenBackend.parseItemName("invalid")).toBeNull();
    expect(BitwardenBackend.parseItemName("__dev")).toBeNull();
    expect(BitwardenBackend.parseItemName("shipcast__")).toBeNull();
    expect(BitwardenBackend.parseFieldName("invalid")).toBeNull();
    expect(BitwardenBackend.parseFieldName(".FIELD")).toBeNull();
    expect(BitwardenBackend.parseFieldName("Provider.")).toBeNull();
  });

  test("buildInlineRef returns null (Bitwarden has no inline refs)", () => {
    const backend = new BitwardenBackend();
    const ref = {
      vault: "shipkey",
      provider: "OpenRouter",
      project: "shipcast",
      env: "dev",
      field: "OPENROUTER_API_KEY",
    };
    expect(backend.buildInlineRef(ref)).toBeNull();
  });
});
