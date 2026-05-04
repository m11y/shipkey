import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanProject,
  scanProjectRecursive,
} from "../../src/scanner/project";

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), "shipkey-project-test-"));
  mkdirSync(join(TMP, "apps/api"), { recursive: true });

  writeFileSync(join(TMP, ".env"), "ROOT_KEY=root\n");
  writeFileSync(join(TMP, "apps/api/.env"), "API_KEY=child\n");
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
    })
  );
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("project scanning scope", () => {
  test("scanProject only scans the current directory", async () => {
    const result = await scanProject(TMP, TMP);
    expect(result.stats.envFiles).toBe(1);
    expect(result.stats.envVars).toBe(1);
  });

  test("scanProjectRecursive still scans nested directories", async () => {
    const result = await scanProjectRecursive(TMP);
    expect(result.stats.envFiles).toBe(2);
    expect(result.stats.envVars).toBe(2);
  });

  test("scanProject returns stable ordering for defaults and providers", async () => {
    writeFileSync(
      join(TMP, ".env"),
      [
        "ZETA_FLAG=1",
        "STRIPE_SECRET_KEY=stripe",
        "ALPHA_FLAG=2",
        "AWS_ACCESS_KEY_ID=aws",
        "CLOUDFLARE_API_TOKEN=cf",
      ].join("\n") + "\n"
    );
    writeFileSync(
      join(TMP, ".dev.vars"),
      ["DEV_BETA=2", "DEV_ALPHA=1"].join("\n") + "\n"
    );
    mkdirSync(join(TMP, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(TMP, ".github", "workflows", "deploy.yml"),
      [
        "jobs:",
        "  deploy:",
        "    steps:",
        "      - uses: cloudflare/wrangler-action@v3",
        "        with:",
        "          command: pages deploy",
        "      - run: echo ${{ secrets.STRIPE_SECRET_KEY }}",
        "      - run: echo ${{ secrets.AWS_ACCESS_KEY_ID }}",
        "      - run: echo ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      ].join("\n") + "\n"
    );
    writeFileSync(
      join(TMP, "wrangler.toml"),
      [
        'name = "edge-app"',
        'routes = ["example.com/*"]',
        "",
        "[[r2_buckets]]",
        'binding = "FILES"',
        'bucket_name = "files"',
      ].join("\n") + "\n"
    );
    writeFileSync(
      join(TMP, "package.json"),
      JSON.stringify({
        name: "stable-order",
        dependencies: {
          stripe: "^18.0.0",
          "@aws-sdk/client-s3": "^3.0.0",
        },
      })
    );

    execSync("git init", { cwd: TMP, stdio: "ignore" });
    execSync("git remote add origin git@github.com:acme/example.git", {
      cwd: TMP,
      stdio: "ignore",
    });

    const result = await scanProject(TMP, TMP);

    expect(result.config.defaults).toEqual({
      ALPHA_FLAG: "2",
      DEV_ALPHA: "1",
      DEV_BETA: "2",
      ZETA_FLAG: "1",
    });
    expect(Object.keys(result.config.defaults ?? {})).toEqual([
      "ALPHA_FLAG",
      "DEV_ALPHA",
      "DEV_BETA",
      "ZETA_FLAG",
    ]);
    expect(Object.keys(result.config.providers ?? {})).toEqual([
      "AWS",
      "Cloudflare",
      "Stripe",
    ]);
    expect(result.config.providers?.AWS).toEqual({
      fields: ["AWS_ACCESS_KEY_ID"],
      guide_url: "https://console.aws.amazon.com/iam/",
      guide: "AWS Console > IAM > Users > Security credentials",
      permissions: [{ permission: "S3", source: "package.json" }],
    });
    expect(result.config.providers?.Cloudflare).toEqual({
      fields: ["CLOUDFLARE_API_TOKEN"],
      guide_url: "https://dash.cloudflare.com/profile/api-tokens",
      guide: "Cloudflare Dashboard > Profile > API Tokens > Create Token",
      permissions: [
        { permission: "Cloudflare Pages: Edit", source: "workflow" },
        { permission: "R2 Storage: Edit", source: "wrangler.toml" },
        { permission: "Workers Scripts: Edit", source: "wrangler.toml" },
        { permission: "Zone > Workers Routes: Edit", source: "wrangler.toml" },
      ],
    });
    expect(result.config.providers?.Stripe).toEqual({
      fields: ["STRIPE_SECRET_KEY"],
      guide_url: "https://dashboard.stripe.com/apikeys",
      guide: "Stripe Dashboard > Developers > API Keys",
      permissions: [
        {
          permission: "Secret key (full API access)",
          source: "package.json",
        },
      ],
    });
    expect(result.workflowSecrets).toEqual([
      "AWS_ACCESS_KEY_ID",
      "CLOUDFLARE_API_TOKEN",
      "STRIPE_SECRET_KEY",
    ]);
    expect(result.config.targets).toEqual({
      github: {
        "acme/example": [
          "AWS_ACCESS_KEY_ID",
          "CLOUDFLARE_API_TOKEN",
          "STRIPE_SECRET_KEY",
        ],
      },
      cloudflare: {
        "edge-app": ["DEV_ALPHA", "DEV_BETA"],
      },
    });
  });

  test("scanProject treats POSTGRES_DSN as a secret", async () => {
    writeFileSync(join(TMP, ".env"), "POSTGRES_DSN=postgres://user:pass@db/app\n");

    const result = await scanProject(TMP, TMP);

    expect(result.config.defaults).toBeUndefined();
    expect(result.config.providers?.General).toEqual({
      fields: ["POSTGRES_DSN"],
    });
  });

  test("scanProject respects shipkey secret directives over heuristics", async () => {
    writeFileSync(
      join(TMP, ".env"),
      [
        "# shipkey: secret",
        "APNS_TEAM_ID=ABCDE12345",
        "# shipkey: secret=false",
        "NEXT_PUBLIC_API_KEY=demo",
      ].join("\n") + "\n"
    );

    const result = await scanProject(TMP, TMP);

    expect(result.config.providers?.General).toEqual({
      fields: ["APNS_TEAM_ID"],
    });
    expect(result.config.defaults).toEqual({
      NEXT_PUBLIC_API_KEY: "demo",
    });
  });

  test("scanProject does not treat managed directive as secret classification", async () => {
    writeFileSync(
      join(TMP, ".env"),
      "PLAIN_VALUE=demo # shipkey: managed=true\n"
    );

    const result = await scanProject(TMP, TMP);

    expect(result.config.providers?.General).toBeUndefined();
    expect(result.config.defaults).toEqual({
      PLAIN_VALUE: "demo",
    });
  });
});
