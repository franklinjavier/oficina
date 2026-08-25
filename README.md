# oficina

shadcn-compatible registry for Grok Bot templates.

Install templates with the official [shadcn CLI](https://ui.shadcn.com/docs/cli) from this GitHub repository. There is no `oficina add`, `oficina publish`, custom domain, or other custom installer.

## Install

```bash
npx shadcn@latest add franklinjavier/oficina/<item>
```

Example:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator
```

That command writes `oficina/bots/orchestrator/*` under the directory where it runs. In shadcn `files[].target`, `~/` is the project cwd, not `$HOME`.

Pin a branch, tag, or commit SHA when you need a fixed revision:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator#main
```

Preview without writing files:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator --dry-run
```

The CLI reads the root `registry.json` in this public repository. No custom domain is required.

## Inspect and search

```bash
npx shadcn@latest view franklinjavier/oficina/orchestrator
npx shadcn@latest search franklinjavier/oficina
npx shadcn@latest list franklinjavier/oficina
```

Maintainers can also inspect a locally built item:

```bash
npx shadcn@latest view ./public/r/orchestrator.json
```

## Example item

`orchestrator` is a sanitized, invented Grok Bot snapshot for a first-mate-shaped fleet coordinator named Helm.

It includes profile name/title/description, an optional generic avatar, skill pointers (plus one generic `route-work` body), and disabled routine templates with secrets stripped.

It does not include conversation history, private memory, credentials, tokens, or live agent databases.

After `shadcn add`, the files are at `oficina/bots/orchestrator/` in the directory where the command ran. Apply that snapshot by hand in Grok Bot: edit the profile from `oficina/bots/orchestrator/profile.json`, enable matching skills, and create routines from the templates.

## Build and validate

This repository is a source registry (`registry.json` at the repo root). `shadcn build` writes flattened item JSON to `public/r` for CI and local inspection. GitHub install uses the source registry.

```bash
npx shadcn@latest build
npx shadcn@latest registry validate
```

## What this registry will not ship

- Secrets, tokens, or sign-ins
- Live agent databases or local computer state
- Private memory logs or conversation history
- Real people's names
