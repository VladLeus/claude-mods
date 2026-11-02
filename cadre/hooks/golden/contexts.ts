/**
 * The golden of every question's own context (D-203, D-234, D-236): for each ask of the five init dry runs of the
 * golden worlds (worlds.ts) and of the regen dry run (beOnlyWorld), its header chip, its own context (null when it has
 * none) and whether it takes a typed answer, as memIo recorded the specs. Captured from the code by a scratch run and
 * pasted as printed; contexts.test.ts runs each again and compares with toEqual. Only an approved behaviour-change
 * commit may change it. Only the golden modules import it.
 */
import type { AskContext } from '../../types'

/** One ask as GOLDEN_CONTEXTS keeps it: its header chip, its own context and whether it takes a typed answer. */
export type GoldenContextAsk = {
  readonly header: string | null
  readonly context: AskContext | null
  readonly acceptsTyped: boolean
}

/** Each run's asks in order, by run name: the five init dry runs by golden world, then the regen dry run. */
export const GOLDEN_CONTEXTS: Readonly<Record<string, readonly GoldenContextAsk[]>> = {
  "nothing": [
    {
      "header": "claude.json",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Roles",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Security",
      "context": {
        "title": "Security plugins",
        "lines": [
          "claude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.",
          "security-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits."
        ],
        "kind": "security"
      },
      "acceptsTyped": false
    },
    {
      "header": "Duration",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Git policy",
      "context": {
        "title": "Git policy",
        "lines": [
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.",
          "Commit all: only per-user files are ignored.",
          "Ignore all: nothing in .cadre/ is committed."
        ],
        "kind": "git-policy"
      },
      "acceptsTyped": false
    },
    {
      "header": "Launch",
      "context": {
        "title": "Launch",
        "lines": [
          "Git root: the top of this repo, the same for every launcher.",
          "Run folder: wherever you run a launcher from.",
          "Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security"
        ],
        "kind": "launch"
      },
      "acceptsTyped": false
    },
    {
      "header": "Review",
      "context": {
        "title": "Review (page 1 of 7)",
        "lines": [
          "Roles:",
          "  PM (pm)",
          "  Team Lead (tl)",
          "  Security (security)",
          "Scope card: PM (pm)",
          "  framework: built-in; model: opus + medium; permission mode: auto",
          "  skills: none",
          "  MCP servers: none",
          "  not given skills: none",
          "  not given MCP: none",
          "  hooks loaded: none",
          "  hooks loaded by project settings: none",
          "  hooks not loaded: none",
          "  rules:",
          "    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)",
          "    [hard] No Bash tool (denied)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
        ],
        "kind": "review"
      },
      "acceptsTyped": false
    }
  ],
  "gsd": [
    {
      "header": "claude.json",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Roles",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Security",
      "context": {
        "title": "Security plugins",
        "lines": [
          "claude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.",
          "security-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits."
        ],
        "kind": "security"
      },
      "acceptsTyped": false
    },
    {
      "header": "Duration",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Hunk 1 of 2",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Hunk 2 of 2",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Git policy",
      "context": {
        "title": "Git policy",
        "lines": [
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.",
          "Commit all: only per-user files are ignored.",
          "Ignore all: nothing in .cadre/ is committed."
        ],
        "kind": "git-policy"
      },
      "acceptsTyped": false
    },
    {
      "header": "Launch",
      "context": {
        "title": "Launch",
        "lines": [
          "Git root: the top of this repo, the same for every launcher.",
          "Run folder: wherever you run a launcher from.",
          "Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/be, .cadre/bin/fe, .cadre/bin/qa, .cadre/bin/security"
        ],
        "kind": "launch"
      },
      "acceptsTyped": false
    },
    {
      "header": "Review",
      "context": {
        "title": "Review (page 1 of 13)",
        "lines": [
          "Roles:",
          "  PM (pm)",
          "  Team Lead (tl)",
          "  BE (be)",
          "  FE (fe)",
          "  QA (qa)",
          "  Security (security)",
          "Scope card: PM (pm)",
          "  framework: GSD; model: opus + medium; permission mode: auto",
          "  skills: none",
          "  MCP servers: none",
          "  not given skills: none",
          "  not given MCP: none",
          "  hooks loaded: none",
          "  hooks loaded by project settings: none",
          "  hooks not loaded: none",
          "  rules:",
          "    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)",
          "    [hard] No Bash tool (denied)"
        ],
        "kind": "review"
      },
      "acceptsTyped": false
    }
  ],
  "superpowers": [
    {
      "header": "claude.json",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Roles",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Security",
      "context": {
        "title": "Security plugins",
        "lines": [
          "claude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.",
          "security-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits."
        ],
        "kind": "security"
      },
      "acceptsTyped": false
    },
    {
      "header": "Duration",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  BE (be)                 Implements the backend and core code.",
          "  FE (fe)                 Implements the frontend.",
          "  QA (qa)                 Owns tests and end-to-end checks.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  kept be: source code found (TypeScript), no backend framework (package.json)"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Git policy",
      "context": {
        "title": "Git policy",
        "lines": [
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.",
          "Commit all: only per-user files are ignored.",
          "Ignore all: nothing in .cadre/ is committed."
        ],
        "kind": "git-policy"
      },
      "acceptsTyped": false
    },
    {
      "header": "Launch",
      "context": {
        "title": "Launch",
        "lines": [
          "Git root: the top of this repo, the same for every launcher.",
          "Run folder: wherever you run a launcher from.",
          "Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/be, .cadre/bin/fe, .cadre/bin/qa, .cadre/bin/security"
        ],
        "kind": "launch"
      },
      "acceptsTyped": false
    },
    {
      "header": "Review",
      "context": {
        "title": "Review (page 1 of 13)",
        "lines": [
          "Roles:",
          "  PM (pm)",
          "  Team Lead (tl)",
          "  BE (be)",
          "  FE (fe)",
          "  QA (qa)",
          "  Security (security)",
          "Scope card: PM (pm)",
          "  framework: superpowers; model: opus + medium; permission mode: auto",
          "  skills: none",
          "  MCP servers: none",
          "  not given skills: none",
          "  not given MCP: none",
          "  hooks loaded: none",
          "  hooks loaded by project settings: none",
          "  hooks not loaded: none",
          "  rules:",
          "    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)",
          "    [hard] No Bash tool (denied)"
        ],
        "kind": "review"
      },
      "acceptsTyped": false
    }
  ],
  "everyStep": [
    {
      "header": "claude.json",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Roles",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Framework",
      "context": {
        "title": "Frameworks",
        "lines": [
          "GSD: in use (.planning/ (dir))",
          "superpowers: in use (docs/superpowers/)"
        ],
        "kind": "detection"
      },
      "acceptsTyped": false
    },
    {
      "header": "Framework",
      "context": {
        "title": "Frameworks",
        "lines": [
          "GSD: in use (.planning/ (dir))",
          "superpowers: in use (docs/superpowers/)"
        ],
        "kind": "detection"
      },
      "acceptsTyped": true
    },
    {
      "header": "Security",
      "context": {
        "title": "Security plugins",
        "lines": [
          "claude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.",
          "security-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits."
        ],
        "kind": "security"
      },
      "acceptsTyped": false
    },
    {
      "header": "Duration",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "MCP",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "MCP",
      "context": {
        "title": "MCP servers",
        "lines": [
          "sentry: session, 1 tool. Recommended: none."
        ],
        "kind": "mcp-server"
      },
      "acceptsTyped": true
    },
    {
      "header": "Skills",
      "context": {
        "title": "Skills: codex",
        "lines": [
          "Recommended: none",
          "codex:rescue: Bearer [hidden]. Recommended: none."
        ],
        "kind": "skill-group"
      },
      "acceptsTyped": true
    },
    {
      "header": "Instructions",
      "context": {
        "title": "Instruction files",
        "lines": [
          "Files found by name (nothing is read before a yes):",
          "  ~/.claude/CLAUDE.md",
          "  repo/CLAUDE.md",
          "Memories:",
          "  notes.md"
        ],
        "kind": "instructions"
      },
      "acceptsTyped": false
    },
    {
      "header": "Memory",
      "context": {
        "title": "Global CLAUDE.md",
        "lines": [
          "~/.claude/CLAUDE.md and the files it imports"
        ],
        "kind": "memory-group"
      },
      "acceptsTyped": true
    },
    {
      "header": "Memory",
      "context": {
        "title": "Auto-memories",
        "lines": [
          "notes.md"
        ],
        "kind": "memory-group"
      },
      "acceptsTyped": true
    },
    {
      "header": "Memory",
      "context": {
        "title": "Project CLAUDE.md",
        "lines": [
          "repo/CLAUDE.md"
        ],
        "kind": "memory-group"
      },
      "acceptsTyped": true
    },
    {
      "header": "Env",
      "context": {
        "title": "Env variables",
        "lines": [
          "Env variable names in your settings (values are never read):",
          "  API_KEY",
          "  JIRA_URL"
        ],
        "kind": "env"
      },
      "acceptsTyped": true
    },
    {
      "header": "Hunk 1 of 3",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Hunk 2 of 3",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Hunk 3 of 3",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Git policy",
      "context": {
        "title": "Git policy",
        "lines": [
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.",
          "Commit all: only per-user files are ignored.",
          "Ignore all: nothing in .cadre/ is committed."
        ],
        "kind": "git-policy"
      },
      "acceptsTyped": false
    },
    {
      "header": "Launch",
      "context": {
        "title": "Launch",
        "lines": [
          "Git root: the top of this repo, the same for every launcher.",
          "Run folder: wherever you run a launcher from.",
          "Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security"
        ],
        "kind": "launch"
      },
      "acceptsTyped": false
    },
    {
      "header": "Review",
      "context": {
        "title": "Review (page 1 of 8)",
        "lines": [
          "Roles:",
          "  PM (pm)",
          "  Team Lead (tl)",
          "  Security (security)",
          "Scope card: PM (pm)",
          "  framework: GSD; model: opus + medium; permission mode: auto",
          "  skills: none",
          "  MCP servers: none",
          "  not given skills: codex:rescue",
          "  not given MCP: sentry",
          "  hooks loaded: gsd-secret-read-guard.js",
          "  hooks loaded by project settings: none",
          "  hooks not loaded: my-hook.sh",
          "  rules:",
          "    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)",
          "    [hard] No Bash tool (denied)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] Scanned MCP servers not given are denied: sentry",
          "    [best-effort] Denied servers: tools removed and the whole server denied (deniedMcpServers; best-effort)"
        ],
        "kind": "review"
      },
      "acceptsTyped": false
    }
  ],
  "parts": [
    {
      "header": "claude.json",
      "context": null,
      "acceptsTyped": false
    },
    {
      "header": "Roles",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Security",
      "context": {
        "title": "Security plugins",
        "lines": [
          "claude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.",
          "security-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits."
        ],
        "kind": "security"
      },
      "acceptsTyped": false
    },
    {
      "header": "Duration",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": false
    },
    {
      "header": "Model",
      "context": {
        "title": "Roles",
        "lines": [
          "Proposed roles:",
          "  PM (pm)                 Owns product decisions: scope, requirements and acceptance.",
          "  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.",
          "  Security (security)     Owns security decisions and reviews.",
          "Changes from the scan:",
          "  dropped be: no source code found",
          "  dropped fe: no frontend framework found (react, vue, next, svelte, angular)",
          "  dropped qa: no tests or E2E setup found"
        ],
        "kind": "roles"
      },
      "acceptsTyped": true
    },
    {
      "header": "Instructions",
      "context": {
        "title": "Instruction files",
        "lines": [
          "Files found by name (nothing is read before a yes):",
          "  ~/.claude/CLAUDE.md",
          "Memories:",
          "  squad.md",
          "  workflow.md"
        ],
        "kind": "instructions"
      },
      "acceptsTyped": false
    },
    {
      "header": "Instructions",
      "context": {
        "title": "Instruction parts",
        "lines": [
          "Read for this run; a plain init writes the repo parts you hand out to .cadre/<role>/CLAUDE.md after Confirm:",
          "  Security rules: How secrets stay out of the repo.",
          "    from: ~/.claude/CLAUDE.md > Security",
          "    recommended: security",
          "  Git and commits: How commits are made.",
          "    from: ~/.claude/CLAUDE.md > Git",
          "    recommended: tl",
          "Memories (each linked, never copied, when a role gets it):",
          "  squad.md: Unsigned commits on per-phase branches.",
          "    recommended: tl",
          "  workflow.md: No summary in MEMORY.md.",
          "    recommended: none"
        ],
        "kind": "instructions"
      },
      "acceptsTyped": false
    },
    {
      "header": "Improver",
      "context": {
        "title": "Improver install",
        "lines": [
          "Built CLAUDE.md files it would tidy:",
          "  tl: .cadre/tl/CLAUDE.md",
          "  security: .cadre/security/CLAUDE.md"
        ],
        "kind": "improver-install"
      },
      "acceptsTyped": false
    },
    {
      "header": "Git policy",
      "context": {
        "title": "Git policy",
        "lines": [
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.",
          "Commit all: only per-user files are ignored.",
          "Ignore all: nothing in .cadre/ is committed."
        ],
        "kind": "git-policy"
      },
      "acceptsTyped": false
    },
    {
      "header": "Launch",
      "context": {
        "title": "Launch",
        "lines": [
          "Git root: the top of this repo, the same for every launcher.",
          "Run folder: wherever you run a launcher from.",
          "Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security"
        ],
        "kind": "launch"
      },
      "acceptsTyped": false
    },
    {
      "header": "Review",
      "context": {
        "title": "Review (page 1 of 8)",
        "lines": [
          "Roles:",
          "  PM (pm)",
          "  Team Lead (tl)",
          "  Security (security)",
          "Scope card: PM (pm)",
          "  framework: built-in; model: opus + medium; permission mode: auto",
          "  skills: none",
          "  MCP servers: none",
          "  not given skills: none",
          "  not given MCP: none",
          "  hooks loaded: none",
          "  hooks loaded by project settings: none",
          "  hooks not loaded: none",
          "  rules:",
          "    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)",
          "    [hard] No Bash tool (denied)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
        ],
        "kind": "review"
      },
      "acceptsTyped": false
    }
  ],
  "regenDry": []
}
