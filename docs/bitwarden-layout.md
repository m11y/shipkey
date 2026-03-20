# Bitwarden Storage Layout

## Context

The previous Bitwarden layout grouped secrets by provider:

- Folder: `shipkey`
- Item title: provider name, for example `OpenAI`
- Field name: `project-env.FIELD`

This caused multiple projects and environments to be mixed into the same Bitwarden Secure Note. In practice, a single provider item could contain secrets for many unrelated projects, which made the vault hard to browse and reason about.

## Decision

Bitwarden storage is now project-centric.

- Folder: `vault`
- Item title: `project__env`
- Field name: `provider.field`

Examples:

- Folder: `shipkey`
- Item: `shipkey-web__dev`
- Fields:
  - `OpenAI.OPENAI_API_KEY`
  - `Stripe.STRIPE_SECRET_KEY`

## Why `project__env`

We explicitly chose `__` as the item-title separator.

Reasons:

- It is easier to scan in the Bitwarden UI than a dash-separated title.
- It is less likely to conflict with normal project slugs than `-` or `_`.
- It keeps all secrets for one project environment in one place.

## Scope

This change applies only to the Bitwarden backend.

1Password is not part of this layout change.

## Compatibility

There is no backward compatibility layer.

- Old Bitwarden entries are not migrated automatically.
- Old Bitwarden entries are not read by the new layout.
- Users who want the new structure should push secrets again.

This is intentional. The chosen path is to keep the implementation simple and clean instead of carrying both layouts indefinitely.

## Operational Notes

- `push` is the source of truth for writing the new layout into Bitwarden.
- `push --dry-run` should show the new-layout diff without mutating Bitwarden.
- Delete and overwrite prompts operate against the new `project__env` / `provider.field` structure.
