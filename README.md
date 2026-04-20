<p align="center">
  <strong>English</strong> | <a href="https://github.com/chekusu/shipkey/blob/main/README.zh.md">中文</a> | <a href="https://github.com/chekusu/shipkey/blob/main/README.ja.md">日本語</a>
</p>

# shipkey

Scan, backup, and sync all your project API keys with one command. Powered by 1Password & Bitwarden.

## Why

- `.env` files get lost when you switch machines
- Secrets scattered across GitHub, Cloudflare, and local files
- New team members spend hours collecting API keys
- No one remembers which permissions a token needs

shipkey solves all of this.

## Quick Start

```bash
# Install (standalone binary)
curl -fsSL https://shipkey.dev/install.sh | bash

# Scan your project and launch the setup wizard
shipkey setup
```

> **Tip:** `shipkey setup` will automatically open a web-based wizard connected to a local API server, guiding you through each provider with step-by-step instructions and saving keys to your password manager (1Password or Bitwarden).

### Install via npm

You can also install shipkey as a project devDependency to pin the version per project:

```bash
# npm
npm install -D shipkey

# bun
bun add -d shipkey
```

Then run via `npx` / `bunx`:

```bash
npx shipkey setup
bunx shipkey pull
```

Or add scripts to your `package.json`:

```json
{
  "scripts": {
    "setup": "shipkey setup",
    "keys:pull": "shipkey pull",
    "keys:push": "shipkey push"
  }
}
```

## How It Works

```
shipkey scan     →  Detect files in the current directory
                    Generate shipkey.json with providers & permissions

shipkey setup    →  Open browser wizard to enter API keys
                    Save to password manager + local .env.local/.dev.vars

shipkey pull     →  Restore keys for the current directory
                    New machine ready in seconds

shipkey sync     →  Push secrets for the current directory
                    One command, all platforms
```

## Supported Backends

| Backend | CLI | Read | Write | List |
|---------|-----|------|-------|------|
| [1Password](https://1password.com/) | `op` | ✅ | ✅ | ✅ |
| [Bitwarden](https://bitwarden.com/) | `bw` | ✅ | ✅ | ✅ |

Set the backend in `shipkey.json`:

```json
{
  "backend": "bitwarden"
}
```

Default is `"1password"` if omitted (backwards compatible).

## Commands

### `shipkey setup [dir]`

Launch an interactive browser-based setup wizard.

```bash
shipkey setup                  # Current directory, prod env
shipkey setup -e dev           # Dev environment
shipkey setup --port 3000      # Specify API port
shipkey setup --no-open        # Don't auto-open browser
```

The wizard provides:
- Step-by-step guides for each provider (Cloudflare, AWS, Stripe, etc.)
- Auto-inferred permission recommendations from your project code
- One-click save to 1Password or Bitwarden
- CLI status checks (op/bw, gh, wrangler) with install instructions

### `shipkey scan [dir]`

Scan the current directory and generate `shipkey.json`.

```bash
shipkey scan                   # Scan current directory and write config
shipkey scan --dry-run         # Preview without writing
```

`shipkey scan` previews the detected changes first, and only writes `shipkey.json` after confirmation when changes are found.

You can override secret detection in `.env` files with a directive comment on the line above:

```dotenv
# shipkey: secret
APNS_TEAM_ID=ABCDE12345

# shipkey: secret=false
NEXT_PUBLIC_API_KEY=demo

APNS_KEY_ID=ABC123 # shipkey: secret
```

The directive can be placed on the line above or as a trailing comment on the same line. If omitted, shipkey falls back to its normal secret-detection heuristics.

Detects:
- `.env`, `.env.local`, `.env.example`, `.dev.vars`, `.envrc`
- GitHub Actions workflow secrets
- Wrangler bindings (KV, R2, D1, Queues, AI)
- `package.json` dependencies (AWS SDK, Supabase, Stripe, etc.)

Auto-infers required permissions per provider.

### `shipkey push [dir]`

Push local env values from the current directory to your password manager.

```bash
shipkey push                   # Push dev env
shipkey push -e prod           # Push prod env
shipkey push --vault myteam    # Custom vault
```

### `shipkey pull [dir]`

Pull secrets for the current directory and generate local env files.

```bash
shipkey pull                   # Pull dev env
shipkey pull -e prod           # Pull prod env
shipkey pull --dry-run         # Preview pull diff without writing files
shipkey pull --no-envrc        # Skip .envrc generation
shipkey pull --no-dev-vars     # Skip .dev.vars generation
```

Generates:
- `.envrc` with `op://` references for direnv (1Password) or direct values (Bitwarden)
- `.dev.vars` with resolved values for Cloudflare Workers

### `shipkey sync [target] [dir]`

Sync secrets for the current directory to external platforms.

```bash
shipkey sync                   # Sync all targets
shipkey sync github            # GitHub Actions only
shipkey sync cloudflare        # Cloudflare Workers only
```

Supported targets:
- **GitHub Actions** — sets repository secrets via `gh secret set`
- **Cloudflare Workers** — sets secrets via `wrangler secret put`

### `shipkey list [dir]`

List all stored secrets in your password manager.

```bash
shipkey list                   # Current project
shipkey list --all             # All projects
shipkey list -e prod           # Filter by environment
```

## Configuration

`shipkey.json` is auto-generated by `shipkey scan`. You can also edit it manually.

```json
{
  "project": "my-app",
  "vault": "shipkey",
  "backend": "1password",
  "providers": {
    "Cloudflare": {
      "fields": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
    },
    "Stripe": {
      "fields": ["STRIPE_SECRET_KEY"]
    }
  },
  "targets": {
    "github": {
      "owner/repo": ["CLOUDFLARE_API_TOKEN", "STRIPE_SECRET_KEY"]
    }
  }
}
```

## Storage Structure

### 1Password

Secrets are stored as items in a vault, organized by section:

```
op://{vault}/{provider}/{project}-{env}/{FIELD}
```

Example:

```
op://shipkey/Cloudflare/my-app-prod/CLOUDFLARE_API_TOKEN
op://shipkey/Stripe/my-app-dev/STRIPE_SECRET_KEY
```

### Bitwarden

Secrets are stored as Secure Note items in a folder, using custom hidden fields:

```
Folder: {vault}
  Item: {provider}  (Secure Note)
    Field: {project}-{env}.{FIELD}  (Hidden)
```

Example:

```
Folder: shipkey
  Item: Cloudflare
    Field: my-app-prod.CLOUDFLARE_API_TOKEN = sk-xxx
  Item: Stripe
    Field: my-app-dev.STRIPE_SECRET_KEY = sk-xxx
```

## Requirements

- [Bun](https://bun.sh) runtime
- One of the following password manager CLIs:
  - [1Password CLI](https://developer.1password.com/docs/cli/) (`op`)
    ```bash
    brew install --cask 1password-cli
    ```
  - [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`)
    ```bash
    npm install -g @bitwarden/cli
    ```
- [GitHub CLI](https://cli.github.com/) (`gh`) — for GitHub Actions sync
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — for Cloudflare Workers sync

## License

MIT
