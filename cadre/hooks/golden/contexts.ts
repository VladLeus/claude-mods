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
        "title": "Review",
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
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Team Lead (tl)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Security (security)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Private files per role (written after Confirm):",
          "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "File plan:",
          "  create    .cadre/INDEX.md",
          "  create    .cadre/bin/pm (executable)",
          "  create    .cadre/bin/security (executable)",
          "  create    .cadre/bin/tl (executable)",
          "  create    .cadre/cadre.json",
          "  create    .cadre/manifest.json",
          "  create    .cadre/pm/CLAUDE.md",
          "  create    .cadre/pm/ROLE.md",
          "  create    .cadre/pm/kickoff.txt",
          "  create    .cadre/pm/mcp.json",
          "  create    .cadre/pm/role.json",
          "  create    .cadre/pm/settings.json",
          "  create    .cadre/security/CLAUDE.md",
          "  create    .cadre/security/ROLE.md",
          "  create    .cadre/security/kickoff.txt",
          "  create    .cadre/security/mcp.json",
          "  create    .cadre/security/role.json",
          "  create    .cadre/security/settings.json",
          "  create    .cadre/tl/CLAUDE.md",
          "  create    .cadre/tl/ROLE.md",
          "  create    .cadre/tl/kickoff.txt",
          "  create    .cadre/tl/mcp.json",
          "  create    .cadre/tl/role.json",
          "  create    .cadre/tl/settings.json",
          "  create    .gitignore",
          "            # >>> cadre",
          "            thoughts/",
          "            .cadre/*/.runtime/",
          "            .cadre/**/*.cadre-new",
          "            CLAUDE-SECURITY-*/",
          "            # <<< cadre",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
          "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
          "Launchers start in: the git root",
          "warning: could not list the repo root (treated as unknown)"
        ],
        "kind": "review"
      },
      "acceptsTyped": true
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
        "title": "Review",
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
          "    [hard] No Bash tool (denied)",
          "    [best-effort] Reads and edits under src are denied; the patterns match at any depth",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] Attended: GSD workflows need Bash; this role runs them through a person",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Team Lead (tl)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: BE (be)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/be/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/be/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/be/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: FE (fe)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/fe/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/fe/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/fe/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: QA (qa)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/qa/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/qa/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/qa/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Security (security)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Private files per role (written after Confirm):",
          "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/be/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/fe/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/qa/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "File plan:",
          "  create    .cadre/INDEX.md",
          "  create    .cadre/be/CLAUDE.md",
          "  create    .cadre/be/ROLE.md",
          "  create    .cadre/be/kickoff.txt",
          "  create    .cadre/be/mcp.json",
          "  create    .cadre/be/role.json",
          "  create    .cadre/be/settings.json",
          "  create    .cadre/bin/be (executable)",
          "  create    .cadre/bin/fe (executable)",
          "  create    .cadre/bin/pm (executable)",
          "  create    .cadre/bin/qa (executable)",
          "  create    .cadre/bin/security (executable)",
          "  create    .cadre/bin/tl (executable)",
          "  create    .cadre/cadre.json",
          "  create    .cadre/fe/CLAUDE.md",
          "  create    .cadre/fe/ROLE.md",
          "  create    .cadre/fe/kickoff.txt",
          "  create    .cadre/fe/mcp.json",
          "  create    .cadre/fe/role.json",
          "  create    .cadre/fe/settings.json",
          "  create    .cadre/manifest.json",
          "  create    .cadre/pm/CLAUDE.md",
          "  create    .cadre/pm/ROLE.md",
          "  create    .cadre/pm/kickoff.txt",
          "  create    .cadre/pm/mcp.json",
          "  create    .cadre/pm/role.json",
          "  create    .cadre/pm/settings.json",
          "  create    .cadre/qa/CLAUDE.md",
          "  create    .cadre/qa/ROLE.md",
          "  create    .cadre/qa/kickoff.txt",
          "  create    .cadre/qa/mcp.json",
          "  create    .cadre/qa/role.json",
          "  create    .cadre/qa/settings.json",
          "  create    .cadre/security/CLAUDE.md",
          "  create    .cadre/security/ROLE.md",
          "  create    .cadre/security/kickoff.txt",
          "  create    .cadre/security/mcp.json",
          "  create    .cadre/security/role.json",
          "  create    .cadre/security/settings.json",
          "  create    .cadre/tl/CLAUDE.md",
          "  create    .cadre/tl/ROLE.md",
          "  create    .cadre/tl/kickoff.txt",
          "  create    .cadre/tl/mcp.json",
          "  create    .cadre/tl/role.json",
          "  create    .cadre/tl/settings.json",
          "  create    .gitignore",
          "            # >>> cadre",
          "            thoughts/",
          "            .cadre/*/.runtime/",
          "            .cadre/**/*.cadre-new",
          "            CLAUDE-SECURITY-*/",
          "            # <<< cadre",
          "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)",
          "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
          "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
          "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
          "Summary: 46 create, 0 change, 0 leave, 0 conflict, 2 hunks (2 accepted)",
          "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
          "Launchers start in: the git root"
        ],
        "kind": "review"
      },
      "acceptsTyped": true
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
        "title": "Review",
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
          "    [hard] No Bash tool (denied)",
          "    [best-effort] Reads and edits under src are denied; the patterns match at any depth",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Team Lead (tl)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: BE (be)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/be/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/be/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/be/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: FE (fe)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/fe/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/fe/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/fe/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: QA (qa)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/qa/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/qa/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/qa/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Security (security)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Private files per role (written after Confirm):",
          "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/be/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/fe/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/qa/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "File plan:",
          "  create    .cadre/INDEX.md",
          "  create    .cadre/be/CLAUDE.md",
          "  create    .cadre/be/ROLE.md",
          "  create    .cadre/be/kickoff.txt",
          "  create    .cadre/be/mcp.json",
          "  create    .cadre/be/role.json",
          "  create    .cadre/be/settings.json",
          "  create    .cadre/bin/be (executable)",
          "  create    .cadre/bin/fe (executable)",
          "  create    .cadre/bin/pm (executable)",
          "  create    .cadre/bin/qa (executable)",
          "  create    .cadre/bin/security (executable)",
          "  create    .cadre/bin/tl (executable)",
          "  create    .cadre/cadre.json",
          "  create    .cadre/fe/CLAUDE.md",
          "  create    .cadre/fe/ROLE.md",
          "  create    .cadre/fe/kickoff.txt",
          "  create    .cadre/fe/mcp.json",
          "  create    .cadre/fe/role.json",
          "  create    .cadre/fe/settings.json",
          "  create    .cadre/manifest.json",
          "  create    .cadre/pm/CLAUDE.md",
          "  create    .cadre/pm/ROLE.md",
          "  create    .cadre/pm/kickoff.txt",
          "  create    .cadre/pm/mcp.json",
          "  create    .cadre/pm/role.json",
          "  create    .cadre/pm/settings.json",
          "  create    .cadre/qa/CLAUDE.md",
          "  create    .cadre/qa/ROLE.md",
          "  create    .cadre/qa/kickoff.txt",
          "  create    .cadre/qa/mcp.json",
          "  create    .cadre/qa/role.json",
          "  create    .cadre/qa/settings.json",
          "  create    .cadre/security/CLAUDE.md",
          "  create    .cadre/security/ROLE.md",
          "  create    .cadre/security/kickoff.txt",
          "  create    .cadre/security/mcp.json",
          "  create    .cadre/security/role.json",
          "  create    .cadre/security/settings.json",
          "  create    .cadre/tl/CLAUDE.md",
          "  create    .cadre/tl/ROLE.md",
          "  create    .cadre/tl/kickoff.txt",
          "  create    .cadre/tl/mcp.json",
          "  create    .cadre/tl/role.json",
          "  create    .cadre/tl/settings.json",
          "  create    .gitignore",
          "            # >>> cadre",
          "            thoughts/",
          "            .cadre/*/.runtime/",
          "            .cadre/**/*.cadre-new",
          "            CLAUDE-SECURITY-*/",
          "            # <<< cadre",
          "Summary: 46 create, 0 change, 0 leave, 0 conflict, 0 hunks",
          "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
          "Launchers start in: the git root"
        ],
        "kind": "review"
      },
      "acceptsTyped": true
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
      "context": {
        "title": "MCP: sentry",
        "lines": [
          "Source: session",
          "Tools: 1 (issues)",
          "Recommended: none"
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
          "codex:rescue: Bearer FAKE-TOKEN-0123. Recommended: none."
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
          "  <repo>/CLAUDE.md",
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
          "<repo>/CLAUDE.md"
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
        "title": "Review",
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
          "    [best-effort] Denied servers: tools removed and the whole server denied (deniedMcpServers; best-effort)",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] Attended: this role needs a person for framework steps that cannot run unattended",
          "    [none] Attended: GSD workflows need Bash; this role runs them through a person",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Team Lead (tl)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] Scanned MCP servers not given are denied: sentry",
          "    [best-effort] Denied servers: tools removed and the whole server denied (deniedMcpServers; best-effort)",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] Attended: this role needs a person for framework steps that cannot run unattended",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Security (security)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] Scanned MCP servers not given are denied: sentry",
          "    [best-effort] Denied servers: tools removed and the whole server denied (deniedMcpServers; best-effort)",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] Attended: this role needs a person for framework steps that cannot run unattended",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Private files per role (written after Confirm):",
          "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "File plan:",
          "  create    .cadre/INDEX.md",
          "  create    .cadre/bin/pm (executable)",
          "  create    .cadre/bin/security (executable)",
          "  create    .cadre/bin/tl (executable)",
          "  create    .cadre/cadre.json",
          "  create    .cadre/manifest.json",
          "  create    .cadre/pm/CLAUDE.md",
          "  create    .cadre/pm/ROLE.md",
          "  create    .cadre/pm/kickoff.txt",
          "  create    .cadre/pm/mcp.json",
          "  create    .cadre/pm/role.json",
          "  create    .cadre/pm/settings.json",
          "  create    .cadre/security/CLAUDE.md",
          "  create    .cadre/security/ROLE.md",
          "  create    .cadre/security/kickoff.txt",
          "  create    .cadre/security/mcp.json",
          "  create    .cadre/security/role.json",
          "  create    .cadre/security/settings.json",
          "  create    .cadre/tl/CLAUDE.md",
          "  create    .cadre/tl/ROLE.md",
          "  create    .cadre/tl/kickoff.txt",
          "  create    .cadre/tl/mcp.json",
          "  create    .cadre/tl/role.json",
          "  create    .cadre/tl/settings.json",
          "  create    .gitignore",
          "            # >>> cadre",
          "            thoughts/",
          "            .cadre/*/.runtime/",
          "            .cadre/**/*.cadre-new",
          "            CLAUDE-SECURITY-*/",
          "            # <<< cadre",
          "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)",
          "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
          "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
          "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
          "  hunk      .planning/config.json  hooks.context_warnings: not set (GSD default) -> false  (optional, accepted)",
          "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set hooks.context_warnings false",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted)",
          "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
          "Launchers start in: the git root",
          "warning: could not list the repo root (treated as unknown)"
        ],
        "kind": "review"
      },
      "acceptsTyped": true
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
        "title": "Review",
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
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Team Lead (tl)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Scope card: Security (security)",
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
          "    [best-effort] Bash runs in the sandbox (hard on macOS, best-effort on Linux)",
          "    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied",
          "    [best-effort] No other scanned MCP servers to deny",
          "    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied",
          "    [best-effort] Skills: only the listed skills are linked",
          "    [none] Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)",
          "    [hard] Autopilot, agent-fleet and the handoff skills are always available",
          "    [hard] Permission mode: auto",
          "    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)",
          "  decisions:",
          "    Product: pm -> human (queue_question)",
          "    Arch: tl -> human (queue_question)",
          "    Security: security -> human (queue_question)",
          "    QA: tl -> human (queue_question)",
          "  memory: <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)",
          "Instructions per role:",
          "  pm: none",
          "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "  tl: 1 topic: Git and commits; 1 memory",
          "    memories are linked read-only (best effort: Edit and Write are denied; a Bash write is not blocked)",
          "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "  security: 1 topic: Security rules; 0 memories",
          "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
          "Kept with the root session only: 0 topics, 1 memory",
          "File plan:",
          "  create    .cadre/INDEX.md",
          "  create    .cadre/bin/pm (executable)",
          "  create    .cadre/bin/security (executable)",
          "  create    .cadre/bin/tl (executable)",
          "  create    .cadre/cadre.json",
          "  create    .cadre/manifest.json",
          "  create    .cadre/pm/CLAUDE.md",
          "  create    .cadre/pm/ROLE.md",
          "  create    .cadre/pm/kickoff.txt",
          "  create    .cadre/pm/mcp.json",
          "  create    .cadre/pm/role.json",
          "  create    .cadre/pm/settings.json",
          "  create    .cadre/security/CLAUDE.md",
          "  create    .cadre/security/ROLE.md",
          "  create    .cadre/security/kickoff.txt",
          "  create    .cadre/security/mcp.json",
          "  create    .cadre/security/role.json",
          "  create    .cadre/security/settings.json",
          "  create    .cadre/tl/CLAUDE.md",
          "  create    .cadre/tl/ROLE.md",
          "  create    .cadre/tl/kickoff.txt",
          "  create    .cadre/tl/mcp.json",
          "  create    .cadre/tl/role.json",
          "  create    .cadre/tl/settings.json",
          "  create    .gitignore",
          "            # >>> cadre",
          "            thoughts/",
          "            .cadre/*/.runtime/",
          "            .cadre/**/*.cadre-new",
          "            CLAUDE-SECURITY-*/",
          "            # <<< cadre",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
          "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
          "Launchers start in: the git root",
          "warning: could not list the repo root (treated as unknown)"
        ],
        "kind": "review"
      },
      "acceptsTyped": true
    }
  ],
  "regenDry": []
}
