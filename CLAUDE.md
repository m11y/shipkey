# shipkey

CLI tool and core library for managing developer API keys securely.

**Repo:** `chekusu/shipkey`
**Role:** Core product code — CLI binary, `@shipkey/core` npm package, provider detection, secret backends.

## Development Rules

- **Unit tests required**: Every code change must include corresponding unit tests. Tests live in `test/` mirroring `src/` structure (e.g., `src/commands/pull.ts` → `test/commands/pull.test.ts`). Run with `bun test`.
- **Build & install locally after changes**: After modifying code, always run `bun run build && npm link` so the global `shipkey` command uses the latest build. The symlink at `/opt/homebrew/bin/shipkey` points to `./dist/index.js` in this repo.

## Repository Structure

- `src/` — CLI source code (commands: setup, push, pull, sync, list, scan)
- `packages/core/` — `@shipkey/core` shared library (backends, providers, types)
- `.github/workflows/release.yml` — Builds CLI binaries + publishes `@shipkey/core` to npm

## What belongs here

- CLI commands and logic
- `@shipkey/core`: secret backends (1Password, Bitwarden), provider detection/registry
- Release workflows for CLI binary and npm packages
- Tests

## What does NOT belong here

- Web landing page, marketing UI → goes to `chekusu/shipkey.dev`
- Setup wizard frontend components → goes to `chekusu/shipkey.dev`
- Web deployment workflows → goes to `chekusu/shipkey.dev`
