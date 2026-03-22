import { describe, test, expect } from "bun:test";
import {
  diffConfigMeta,
  diffDefaults,
  diffProviders,
  diffTargets,
} from "../../src/commands/scan";

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

describe("diffProviders", () => {
  test("detects added fields in the same provider", () => {
    const result = diffProviders(
      {
        OpenAI: { fields: ["OPENAI_API_KEY"] },
      },
      {
        OpenAI: { fields: ["OPENAI_API_KEY", "OPENAI_ORG_ID"] },
      }
    );
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([["OpenAI", "OPENAI_ORG_ID"]]);
    expect(result!.removed).toEqual([]);
  });

  test("detects removed fields in the same provider", () => {
    const result = diffProviders(
      {
        OpenAI: { fields: ["OPENAI_API_KEY", "OPENAI_ORG_ID"] },
      },
      {
        OpenAI: { fields: ["OPENAI_API_KEY"] },
      }
    );
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([]);
    expect(result!.removed).toEqual([["OpenAI", "OPENAI_ORG_ID"]]);
  });

  test("detects removed fields when a provider disappears entirely", () => {
    const result = diffProviders(
      {
        OpenAI: { fields: ["OPENAI_API_KEY"] },
        Anthropic: { fields: ["ANTHROPIC_API_KEY"] },
      },
      {
        OpenAI: { fields: ["OPENAI_API_KEY"] },
      }
    );
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([]);
    expect(result!.removed).toEqual([["Anthropic", "ANTHROPIC_API_KEY"]]);
  });

  test("detects additions and removals together", () => {
    const result = diffProviders(
      {
        OpenAI: { fields: ["OPENAI_API_KEY"] },
        Anthropic: { fields: ["ANTHROPIC_API_KEY"] },
      },
      {
        OpenAI: { fields: ["OPENAI_API_KEY", "OPENAI_ORG_ID"] },
        Stripe: { fields: ["STRIPE_SECRET_KEY"] },
      }
    );
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([
      ["OpenAI", "OPENAI_ORG_ID"],
      ["Stripe", "STRIPE_SECRET_KEY"],
    ]);
    expect(result!.removed).toEqual([["Anthropic", "ANTHROPIC_API_KEY"]]);
  });

  test("handles undefined values", () => {
    expect(
      diffProviders(
        undefined,
        {
          OpenAI: { fields: ["OPENAI_API_KEY"] },
        }
      )
    ).toEqual({
      added: [["OpenAI", "OPENAI_API_KEY"]],
      removed: [],
    });

    expect(
      diffProviders(
        {
          OpenAI: { fields: ["OPENAI_API_KEY"] },
        },
        undefined
      )
    ).toEqual({
      added: [],
      removed: [["OpenAI", "OPENAI_API_KEY"]],
    });
  });

  test("returns null when both are undefined", () => {
    const result = diffProviders(undefined, undefined);
    expect(result).toBeNull();
  });
});

describe("diffConfigMeta", () => {
  test("detects top-level config changes", () => {
    const result = diffConfigMeta(
      {
        project: "myapp",
        vault: "shipkey",
        env: "dev",
        backend: "1password",
      },
      {
        project: "myapp-renamed",
        vault: "shipkey",
        env: "prod",
        backend: "bitwarden",
      }
    );

    expect(result).toEqual({
      changed: [
        ["project", "myapp", "myapp-renamed"],
        ["env", "dev", "prod"],
        ["backend", "1password", "bitwarden"],
      ],
    });
  });

  test("returns null when top-level config is unchanged", () => {
    const result = diffConfigMeta(
      {
        project: "myapp",
        vault: "shipkey",
        env: "dev",
        backend: "1password",
      },
      {
        project: "myapp",
        vault: "shipkey",
        env: "dev",
        backend: "1password",
      }
    );

    expect(result).toBeNull();
  });
});

describe("diffTargets", () => {
  test("detects added and removed target entries", () => {
    const result = diffTargets(
      {
        github: {
          "owner/repo": ["OLD_SECRET", "SAME_SECRET"],
        },
      },
      {
        github: {
          "owner/repo": ["NEW_SECRET", "SAME_SECRET"],
        },
        cloudflare: {
          worker: ["CF_SECRET"],
        },
      }
    );

    expect(result).toEqual({
      added: [
        "cloudflare/worker:CF_SECRET",
        "github/owner/repo:NEW_SECRET",
      ],
      removed: ["github/owner/repo:OLD_SECRET"],
    });
  });

  test("returns null when targets are unchanged", () => {
    const result = diffTargets(
      {
        github: {
          "owner/repo": ["SECRET_A", "SECRET_B"],
        },
      },
      {
        github: {
          "owner/repo": ["SECRET_B", "SECRET_A"],
        },
      }
    );

    expect(result).toBeNull();
  });
});
