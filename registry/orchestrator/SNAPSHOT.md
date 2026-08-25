# Orchestrator snapshot

Fictional Grok Bot template for a first-mate-shaped orchestrator named Helm.

Install this item with the official shadcn CLI:

```bash
npx shadcn@latest add franklinjavier/oficina/orchestrator
```

There is no custom Oficina installer and no custom domain.

## Included

- `profile.json` — invented name, title, and description
- `avatar.svg` — generic geometric mark, not a likeness
- `skills.json` — skill pointers, plus one generic `route-work` body
- `routines/*.template.json` — disabled schedule templates with no secrets

## Excluded on purpose

- Conversation history and chat attachments
- Learned or private memory
- Credentials, tokens, and sign-ins
- Live agent databases or local computer state
- Real people's names

## Apply by hand

1. Create a Grok Bot and open **Bot actions → Edit Profile**.
2. Copy `name`, `title`, and `description` from `profile.json`.
3. Optionally set the avatar from `avatar.svg`.
4. Enable matching skills from `/` or **Settings → Plugins → Yours**. Treat pointer-only entries as hints.
5. Create routines from the templates after you attach local sources. Leave them disabled until a test run is safe.

This snapshot is a starting kit, not a dump of a live agent.
