# oficina

A thin exporter that writes a Grok Bot factory as a shadcn `registry:block`, plus one fictional example item (`orchestrator`).

This repository is the tool. It is not the catalog friends install from, and you do not send a pull request here to share a factory. There is no `oficina add`, `oficina publish`, custom domain, or pastecn.com upload.

## Friend flow

Account A exports locally, pushes the block to **their** public GitHub repo, and sends Account B the `owner/repo/item` address. Account B installs with the official [shadcn CLI](https://ui.shadcn.com/docs/cli) and applies the files in Grok Bot. Nobody else is in that loop.

## Export (account A)

From a Grok Bot agent folder, or a parent that contains many agents:

```bash
npx tsx scripts/export-factory.ts --from <path-to-grok-bot-agent-dir> --name <item-slug>
```

That writes a `registry:block` to `registry/<item-slug>/` and updates `registry.json` in the current directory (`--out` to pick another repo root). It copies the safe agent tree: profile, avatar, sanitized settings, automations/routines, skill files that live with the agent, and other non-secret files.

It does not copy `memory/`, transcripts, `factory.db`, `store.db`, credentials, or connector tokens. Token-looking strings, emails, and webhook keys are stripped. The command refuses (and `--dry-run` reports) if the source still looks like it contains credentials.

Preview without writing:

```bash
npx tsx scripts/export-factory.ts --from <path> --name <item-slug> --dry-run
```

If you cloned this tool just to run the script, point `--out` at **your** templates repo so this example catalog is left alone.

## Publish (account A)

Commit `registry.json` and `registry/<item-slug>/` to **your** public GitHub repository. GitHub install reads that source registry. Optional local check:

```bash
npx shadcn@latest build
npx shadcn@latest registry validate
```

Then push. You now have an install address: `<your-github-owner>/<your-repo>/<item-slug>`.

## Install (account B)

One official command, from the directory that should receive the files:

```bash
npx shadcn@latest add <owner>/<repo>/<item>
```

If they already host built item JSON, the same snapshot works as:

```bash
npx shadcn@latest add https://<host>/r/<item>.json
```

`~/` in `files[].target` is the project cwd, not `$HOME`. Files land at `oficina/bots/<agent>/` under that directory. Apply them in Grok Bot: edit the profile from `oficina/bots/<agent>/profile.json`, enable matching skills, and create routines from the templates.

## Example item in this repo

`orchestrator` is a sanitized, invented Grok Bot snapshot for a first-mate-shaped fleet coordinator named Helm. It is an example of the file shape, not a publish target for your factory.

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator
```

That writes `oficina/bots/orchestrator/*` under the directory where it runs.

Pin a revision or preview:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator#main
npx shadcn@latest add franklinjavier/oficina/orchestrator --dry-run
npx shadcn@latest view franklinjavier/oficina/orchestrator
```

## Build and validate (this example)

This repository keeps a source `registry.json` for the example item. `shadcn build` writes flattened JSON to `public/r` for CI.

```bash
npx shadcn@latest build
npx shadcn@latest registry validate
```

## What the exporter will not ship

- Secrets, tokens, or sign-ins
- Live agent databases or local computer state
- Private memory logs or conversation history
- Real people's names
