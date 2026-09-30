---
name: lexi-skill-creator
description: "Guides users through creating, validating, and publishing agent skills to the Lexi registry."
version: 1.0.0
author: lexi
tags:
  - skill
  - create
  - publish
  - reskill
---

# Lexi Skill Creator

Create and publish Agent Skills for the Lexi platform. Skills are compact, triggerable workflows loaded from `SKILL.md`.

> **Default Registry (dev):** `http://localhost:8668`
> Skill names use scope prefix `@<NEXT_PUBLIC_REGISTRY_SCOPE>/` (dev = `@dev/my-skill`).

## When to Use

- User wants to create a new skill
- User asks how to publish a skill to Lexi
- User needs `SKILL.md` structure or validation help
- User mentions scope, registry, or skill packaging

## Skill Directory Shape

```text
my-skill/
  SKILL.md          required
  scripts/          optional helpers
  references/       optional docs
  assets/           optional templates
```

## SKILL.md Rules

- Frontmatter needs `name` + `description` (quote description)
- `name` must be hyphen-case: `my-skill` (maps to `/my-skill` slash command)
- Keep body lean; move long docs to `references/`
- Validate after edits:

```bash
python .claude/skills/lexi-skill-creator/scripts/quick_validate.py path/to/skill-dir
```

## Create Locally

```bash
mkdir -p my-skill
cat > my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: "Short trigger description for when to use this skill."
---

# My Skill

Workflow steps here.
EOF
```

## Publish to Lexi Registry

### Option A: Console Web UI

1. Open Console → Skills → Publish (`/next/skills/publish`)
2. Skill name field shows `@dev/` prefix (from `NEXT_PUBLIC_REGISTRY_SCOPE`)
3. Upload folder or paste content; submit version `1.0.0`

### Option B: reskill CLI

```bash
# Login (token from Console / account settings)
npx reskill@latest login --registry http://localhost:8668 --token <token>

# Dry-run validate
npx reskill@latest publish ./my-skill --dry-run --registry http://localhost:8668

# Publish (scope enforced: @dev/my-skill in dev)
npx reskill@latest publish ./my-skill -y --registry http://localhost:8668
```

Published skills appear in registry; agents can call `/my-skill` (lazy-installed on first use).

## Scope Rules

- Dev environment: only `@dev/<name>` allowed (via `NEXT_PUBLIC_REGISTRY_SCOPE=dev`)
- Personal scopes like `@user/foo` are not supported on internal registry

## Verify

```bash
npx reskill@latest info @dev/my-skill --registry http://localhost:8668
npx reskill@latest find "my" --json --registry http://localhost:8668
```

## Common Errors

| Error | Fix |
|-------|-----|
| `Unknown scope` | Use `@dev/` prefix matching env scope |
| `Name must be hyphen-case` | Rename skill dir / frontmatter name |
| `Validation failed` | Run `quick_validate.py` on skill directory |
