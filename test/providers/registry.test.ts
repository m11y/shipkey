import { describe, test, expect } from "bun:test";
import { isSecretKey } from "../../packages/core/src/providers/registry";

describe("isSecretKey", () => {
  test("keys matching known providers are secrets", () => {
    expect(isSecretKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretKey("STRIPE_SECRET_KEY")).toBe(true);
    expect(isSecretKey("SUPABASE_URL")).toBe(true);
    expect(isSecretKey("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(isSecretKey("GITHUB_CLIENT_SECRET")).toBe(true);
    expect(isSecretKey("ANTHROPIC_API_KEY")).toBe(true);
  });

  test("General keys with sensitive words are secrets", () => {
    expect(isSecretKey("SECRET_KEY")).toBe(true);
    expect(isSecretKey("API_KEY")).toBe(true);
    expect(isSecretKey("ACCESS_TOKEN")).toBe(true);
    expect(isSecretKey("DB_PASSWORD")).toBe(true);
    expect(isSecretKey("PRIVATE_KEY")).toBe(true);
    expect(isSecretKey("MY_CREDENTIAL")).toBe(true);
    expect(isSecretKey("JWT_AUTH_SECRET")).toBe(true);
  });

  test("plain config keys are NOT secrets", () => {
    expect(isSecretKey("PORT")).toBe(false);
    expect(isSecretKey("NODE_ENV")).toBe(false);
    expect(isSecretKey("LOG_LEVEL")).toBe(false);
    expect(isSecretKey("HOST")).toBe(false);
    expect(isSecretKey("APP_NAME")).toBe(false);
    expect(isSecretKey("BASE_URL")).toBe(false);
    expect(isSecretKey("DEBUG")).toBe(false);
    expect(isSecretKey("TIMEOUT")).toBe(false);
    expect(isSecretKey("MAX_RETRIES")).toBe(false);
  });
});
