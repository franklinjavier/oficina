# oficina

shadcn-compatible registry for Grok Bot templates.

Install templates with the official [shadcn CLI](https://ui.shadcn.com/docs/cli) only. There is no `oficina add`, `oficina publish`, or other custom installer.

Official commands:

```bash
npx shadcn@latest add @oficina/<item>
npx shadcn@latest add franklinjavier/oficina/<item>
npx shadcn@latest view
npx shadcn@latest search @oficina
npx shadcn@latest build
npx shadcn@latest registry validate
```

## Add the `@oficina` namespace

In the project that will receive a template, add the registry URL template to `components.json`. `{name}` must resolve to a built item JSON file:

```json
{
  "registries": {
    "@oficina": "https://<host>/r/{name}.json"
  }
}
```

Examples:

```json
{
  "registries": {
    "@oficina": "https://raw.githubusercontent.com/franklinjavier/oficina/main/public/r/{name}.json"
  }
}
```

```bash
npx shadcn@latest registry add @oficina=https://raw.githubusercontent.com/franklinjavier/oficina/main/public/r/{name}.json
```

`@oficina/orchestrator` then resolves to `https://<host>/r/orchestrator.json`. The catalog is served separately at `https://<host>/r/registry.json`.

You do not need `components.json` to install from the public GitHub registry address.

## Install a template

Namespace, after `@oficina` is configured:

```bash
npx shadcn@latest add @oficina/orchestrator
```

GitHub address, no namespace setup:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator
```

A branch, tag, or commit SHA can be pinned:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator#main
```

Preview without writing files:

```bash
npx shadcn@latest add @oficina/orchestrator --dry-run
npx shadcn@latest add franklinjavier/oficina/orchestrator --dry-run
```

## Inspect and search

```bash
npx shadcn@latest view @oficina/orchestrator
npx shadcn@latest view franklinjavier/oficina/orchestrator
npx shadcn@latest view ./public/r/orchestrator.json
npx shadcn@latest search @oficina
npx shadcn@latest search franklinjavier/oficina
npx shadcn@latest list franklinjavier/oficina
```

## Example item

`orchestrator` is a sanitized, invented Grok Bot snapshot for a first-mate-shaped fleet coordinator named Helm.

It includes profile name/title/description, an optional generic avatar, skill pointers (plus one generic `route-work` body), and disabled routine templates with secrets stripped.

It does not include conversation history, private memory, credentials, tokens, or live agent databases.

After `shadcn add`, apply the snapshot by hand in Grok Bot: edit the profile, enable matching skills, and create routines from the templates.

## Build and validate

This repository is a source registry (`registry.json` at the repo root) plus a built registry (`public/r`).

```bash
npx shadcn@latest build
npx shadcn@latest registry validate
```

`shadcn build` reads `registry.json` and writes item JSON to `public/r`. Commit an updated `public/r` when items change so the hosted namespace URL stays in sync.

## What this registry will not ship

- Secrets, tokens, or sign-ins
- Live agent databases or local computer state
- Private memory logs or conversation history
- Real people's names
