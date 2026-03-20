import { describe, test, expect } from "bun:test";
import { MockBackend } from "../helpers/mock-backend";
import {
  collectDesiredSecretRefs,
  collectLocalSecretValues,
  diffSecretRefs,
  diffSecretValues,
  formatSecretLabel,
  resolveAddedSecretEntries,
} from "../../src/commands/push";

describe("push command logic", () => {
  test("MockBackend.write stores values correctly", async () => {
    const backend = new MockBackend();
    await backend.write({
      ref: {
        vault: "shipkey",
        provider: "OpenAI",
        project: "myapp",
        env: "dev",
        field: "OPENAI_API_KEY",
      },
      value: "sk-test-123",
    });

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].method).toBe("write");

    const value = await backend.read({
      vault: "shipkey",
      provider: "OpenAI",
      project: "myapp",
      env: "dev",
      field: "OPENAI_API_KEY",
    });
    expect(value).toBe("sk-test-123");
  });

  test("MockBackend.write overwrites existing values", async () => {
    const backend = new MockBackend();
    const ref = {
      vault: "shipkey",
      provider: "Stripe",
      project: "myapp",
      env: "prod",
      field: "STRIPE_KEY",
    };

    await backend.write({ ref, value: "old-value" });
    await backend.write({ ref, value: "new-value" });

    const value = await backend.read(ref);
    expect(value).toBe("new-value");
  });

  test("MockBackend handles empty scan gracefully", async () => {
    const backend = new MockBackend();
    const refs = await backend.list("nonexistent", "dev");
    expect(refs).toHaveLength(0);
  });

  test("MockBackend.write uses correct vault from ref", async () => {
    const backend = new MockBackend();
    await backend.write({
      ref: {
        vault: "custom-vault",
        provider: "AWS",
        project: "myapp",
        env: "prod",
        field: "AWS_ACCESS_KEY_ID",
      },
      value: "AKIAIOSFODNN7EXAMPLE",
    });

    expect(backend.calls[0].args[0].ref.vault).toBe("custom-vault");
  });

  test("MockBackend.delete removes stored values", async () => {
    const backend = new MockBackend();
    const ref = {
      vault: "shipkey",
      provider: "OpenAI",
      project: "myapp",
      env: "dev",
      field: "OPENAI_API_KEY",
    };

    await backend.write({ ref, value: "sk-test-123" });
    await backend.delete(ref);

    await expect(backend.read(ref)).rejects.toThrow("Not found");
    expect(backend.calls.some((call) => call.method === "delete")).toBe(true);
  });

  test("collectDesiredSecretRefs builds refs from shipkey providers", () => {
    const refs = collectDesiredSecretRefs(
      {
        project: "myapp",
        vault: "shipkey",
        providers: {
          OpenAI: { fields: ["OPENAI_API_KEY"] },
          Stripe: { fields: ["STRIPE_SECRET_KEY"] },
        },
      },
      "prod",
      "custom-vault"
    );

    expect(refs).toEqual([
      {
        vault: "custom-vault",
        provider: "OpenAI",
        project: "myapp",
        env: "prod",
        field: "OPENAI_API_KEY",
      },
      {
        vault: "custom-vault",
        provider: "Stripe",
        project: "myapp",
        env: "prod",
        field: "STRIPE_SECRET_KEY",
      },
    ]);
  });

  test("diffSecretRefs detects added and removed refs", () => {
    const result = diffSecretRefs(
      [
        {
          vault: "shipkey",
          provider: "OpenAI",
          project: "myapp",
          env: "dev",
          field: "OPENAI_API_KEY",
        },
        {
          vault: "shipkey",
          provider: "Stripe",
          project: "myapp",
          env: "dev",
          field: "STRIPE_SECRET_KEY",
        },
      ],
      [
        {
          vault: "shipkey",
          provider: "OpenAI",
          project: "myapp",
          env: "dev",
          field: "OPENAI_API_KEY",
        },
        {
          vault: "shipkey",
          provider: "Anthropic",
          project: "myapp",
          env: "dev",
          field: "ANTHROPIC_API_KEY",
        },
      ]
    );

    expect(result).toEqual({
      added: [
        {
          vault: "shipkey",
          provider: "Stripe",
          project: "myapp",
          env: "dev",
          field: "STRIPE_SECRET_KEY",
        },
      ],
      removed: [
        {
          vault: "shipkey",
          provider: "Anthropic",
          project: "myapp",
          env: "dev",
          field: "ANTHROPIC_API_KEY",
        },
      ],
    });
  });

  test("diffSecretValues detects local and remote value mismatches", () => {
    const refs = [
      {
        vault: "shipkey",
        provider: "OpenAI",
        project: "myapp",
        env: "dev",
        field: "OPENAI_API_KEY",
      },
      {
        vault: "shipkey",
        provider: "Stripe",
        project: "myapp",
        env: "dev",
        field: "STRIPE_SECRET_KEY",
      },
    ];

    const localValues = new Map([
      ["OPENAI_API_KEY", "sk-local"],
      ["STRIPE_SECRET_KEY", "stripe-same"],
    ]);

    const remoteValues = new Map([
      ["shipkey\0OpenAI\0myapp\0dev\0OPENAI_API_KEY", "sk-remote"],
      ["shipkey\0Stripe\0myapp\0dev\0STRIPE_SECRET_KEY", "stripe-same"],
    ]);

    expect(diffSecretValues(refs, localValues, remoteValues)).toEqual([
      {
        ref: refs[0],
        localValue: "sk-local",
        remoteValue: "sk-remote",
      },
    ]);
  });

  test("diffSecretValues ignores refs missing local or remote values", () => {
    const refs = [
      {
        vault: "shipkey",
        provider: "OpenAI",
        project: "myapp",
        env: "dev",
        field: "OPENAI_API_KEY",
      },
    ];

    expect(
      diffSecretValues(
        refs,
        new Map(),
        new Map([["shipkey\0OpenAI\0myapp\0dev\0OPENAI_API_KEY", "sk-remote"]])
      )
    ).toEqual([]);

    expect(
      diffSecretValues(
        refs,
        new Map([["OPENAI_API_KEY", "sk-local"]]),
        new Map()
      )
    ).toEqual([]);
  });

  test("resolveAddedSecretEntries separates writable and missing refs", () => {
    const refs = [
      {
        vault: "shipkey",
        provider: "OpenAI",
        project: "myapp",
        env: "dev",
        field: "OPENAI_API_KEY",
      },
      {
        vault: "shipkey",
        provider: "Stripe",
        project: "myapp",
        env: "dev",
        field: "STRIPE_SECRET_KEY",
      },
    ];

    const result = resolveAddedSecretEntries(
      refs,
      new Map([["OPENAI_API_KEY", "sk-local"]])
    );

    expect(result).toEqual({
      entries: [
        {
          ref: refs[0],
          value: "sk-local",
        },
      ],
      missing: [refs[1]],
    });
  });

  test("formatSecretLabel renders provider and field", () => {
    expect(
      formatSecretLabel({
        vault: "shipkey",
        provider: "OpenAI",
        project: "myapp",
        env: "dev",
        field: "OPENAI_API_KEY",
      })
    ).toBe("OpenAI.OPENAI_API_KEY");
  });

  test("collectLocalSecretValues ignores template files and keeps first real value", () => {
    const values = collectLocalSecretValues({
      projectRoot: ".",
      totalFiles: 3,
      totalVars: 4,
      groups: [
        {
          path: ".",
          files: [
            {
              path: ".env.example",
              isTemplate: true,
              vars: [
                { key: "OPENAI_API_KEY", value: undefined, source: ".env.example", isTemplate: true },
              ],
            },
            {
              path: ".env",
              isTemplate: false,
              vars: [
                { key: "OPENAI_API_KEY", value: "sk-live", source: ".env", isTemplate: false },
                { key: "STRIPE_SECRET_KEY", value: "stripe-live", source: ".env", isTemplate: false },
              ],
            },
            {
              path: ".env.local",
              isTemplate: false,
              vars: [
                { key: "OPENAI_API_KEY", value: "sk-local", source: ".env.local", isTemplate: false },
              ],
            },
          ],
        },
      ],
    });

    expect(values.get("OPENAI_API_KEY")).toBe("sk-live");
    expect(values.get("STRIPE_SECRET_KEY")).toBe("stripe-live");
  });
});
