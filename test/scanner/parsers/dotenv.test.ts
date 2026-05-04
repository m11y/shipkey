import { describe, test, expect } from "bun:test";
import { parseDotenv } from "../../../src/scanner/parsers/dotenv";

describe("parseDotenv", () => {
  test("parses KEY=VALUE lines and extracts keys", () => {
    const content = `
DATABASE_URL=postgres://localhost:5432/db
API_KEY=sk-test-123
`;
    const result = parseDotenv(content);
    const keys = result.map((r) => r.key);
    expect(keys).toEqual(["DATABASE_URL", "API_KEY"]);
  });

  test("parses template placeholders and extracts keys", () => {
    const content = `
DATABASE_URL=
API_KEY=your-api-key-here
SECRET=
`;
    const result = parseDotenv(content);
    const keys = result.map((r) => r.key);
    expect(keys).toEqual(["DATABASE_URL", "API_KEY", "SECRET"]);
  });

  test("skips comments and blank lines", () => {
    const content = `
# This is a comment
DATABASE_URL=test

# Another comment
API_KEY=key
`;
    const result = parseDotenv(content);
    expect(result).toHaveLength(2);
  });

  test("handles quoted values", () => {
    const content = `SECRET="hello world"
KEY='single quoted'`;
    const result = parseDotenv(content);
    const keys = result.map((r) => r.key);
    expect(keys).toEqual(["SECRET", "KEY"]);
  });

  test("parses shipkey secret directive on the next env var", () => {
    const content = `
# shipkey: secret
APNS_TEAM_ID=ABCDE12345
`;
    const result = parseDotenv(content);
    expect(result).toEqual([
      {
        key: "APNS_TEAM_ID",
        value: "ABCDE12345",
        directive: { secret: true },
      },
    ]);
  });

  test("parses shipkey secret=false directive", () => {
    const content = `
# shipkey: secret=false
NEXT_PUBLIC_API_KEY=demo
`;
    const result = parseDotenv(content);
    expect(result[0]?.directive).toEqual({ secret: false });
  });

  test("parses inline shipkey directive comments", () => {
    const content = `
APNS_TEAM_ID=ABCDE12345 # shipkey: secret
NEXT_PUBLIC_API_KEY=demo # shipkey: secret=false
API_KEY=sk-test # shipkey: secret=true, managed=true
`;
    const result = parseDotenv(content);
    expect(result).toEqual([
      {
        key: "APNS_TEAM_ID",
        value: "ABCDE12345",
        directive: { secret: true },
      },
      {
        key: "NEXT_PUBLIC_API_KEY",
        value: "demo",
        directive: { secret: false },
      },
      {
        key: "API_KEY",
        value: "sk-test",
        directive: { secret: true, managed: true },
      },
    ]);
  });

  test("does not treat # inside quotes as inline shipkey comments", () => {
    const content = `
FOO="bar # shipkey: secret"
`;
    const result = parseDotenv(content);
    expect(result).toEqual([
      {
        key: "FOO",
        value: "bar # shipkey: secret",
      },
    ]);
  });

  test("clears pending shipkey directive across blank lines", () => {
    const content = `
# shipkey: secret

APNS_TEAM_ID=ABCDE12345
`;
    const result = parseDotenv(content);
    expect(result[0]?.directive).toBeUndefined();
  });
});
