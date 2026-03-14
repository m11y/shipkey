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
});
