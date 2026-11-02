/**
 * The engine-driven golden of `/cadre init --dry-run` on the TUI default (D-208, D-219): the terminal main screen, as
 * the engine stamps it (`isFullscreen` false), in a session drawn on the terminal alone, where no side pane opens. Its
 * specs live in register.test.ts, the one test file that drives the real engine (plan-check B6), and run the world of
 * the D3/R1 specs with one skill of the user's own, so init also asks the model. Captured from that run (a temporary
 * log line in the spec) and pasted as printed. Data only: register.test.ts imports it.
 */

/**
 * What the TUI-default dry run did: each pane it opened (none), each status line it set, null for a clear (D-232),
 * each line it logged, each dialog with its header chip (null when none), its options as drawn and the preview of each
 * (null where none; D-208, D-228), and its reply, split on '\n'.
 */
export const GOLDEN_TUI: {
  readonly opens: readonly string[]
  readonly statuses: readonly (string | null)[]
  readonly logs: readonly string[]
  readonly asks: readonly {
    readonly header: string | null
    readonly options: readonly string[]
    readonly previews: readonly (string | null)[]
  }[]
  readonly reply: readonly string[]
} = {
  "opens": [],
  "statuses": [
    null,
    "cadre: scanning the repo…",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "cadre: recommending skills…",
    "cadre: recommending skills…",
    "cadre: recommending skills…",
    null,
    null,
    null,
    null,
    null,
    null,
    null
  ],
  "logs": [
    "No session history for this repo."
  ],
  "asks": [
    {
      "header": "claude.json",
      "options": [
        "No, skip it",
        "Yes, read names only"
      ],
      "previews": [
        null,
        null
      ]
    },
    {
      "header": "Roles",
      "options": [
        "Use these roles",
        "Adjust them",
        "Describe my own structure"
      ],
      "previews": [
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
      ]
    },
    {
      "header": "Framework",
      "options": [
        "Same for all roles",
        "Per role"
      ],
      "previews": [
        "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/;\nenabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
        "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/;\nenabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```"
      ]
    },
    {
      "header": "Framework",
      "options": [
        "GSD",
        "superpowers",
        "none (built-in)",
        "Describe your own"
      ],
      "previews": [
        "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/;\nenabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
        "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/;\nenabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
        "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/;\nenabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
        "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/;\nenabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```"
      ]
    },
    {
      "header": "Security",
      "options": [
        "Install",
        "Not now"
      ],
      "previews": [
        "**Security plugins**\n```\nclaude-security@claude-plugins-official: claude-security gives the Security role a\nreview skill (/claude-security), needs Python 3.9 or newer and writes\nCLAUDE-SECURITY-<time>/ report folders into the repo.\nsecurity-guidance@claude-plugins-official: security-guidance adds hooks that warn\nabout risky edits.\n```",
        "**Security plugins**\n```\nclaude-security@claude-plugins-official: claude-security gives the Security role a\nreview skill (/claude-security), needs Python 3.9 or newer and writes\nCLAUDE-SECURITY-<time>/ report folders into the repo.\nsecurity-guidance@claude-plugins-official: security-guidance adds hooks that warn\nabout risky edits.\n```"
      ]
    },
    {
      "header": "Duration",
      "options": [
        "4h",
        "2h",
        "8h",
        "Describe your own"
      ],
      "previews": [
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
      ]
    },
    {
      "header": "Model",
      "options": [
        "Same for all roles",
        "Per role"
      ],
      "previews": [
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
      ]
    },
    {
      "header": "Model",
      "options": [
        "opus + medium",
        "sonnet + medium",
        "sonnet + high",
        "Describe your own"
      ],
      "previews": [
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
        "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and\nacceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges\nthe work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
      ]
    },
    {
      "header": "Skills",
      "options": [
        "Go one by one",
        "Whole group"
      ],
      "previews": [
        "**Your own skills**\n```\nSkills with no plugin (a role given a skill can run it in its session; a role not\ngiven it cannot):\n  deploy-notes: Write the release notes for a deploy.\n    recommended: none\nThe model gave no usable recommendation: no role gets a skill unless you pick one.\n```",
        "**Your own skills**\n```\nSkills with no plugin (a role given a skill can run it in its session; a role not\ngiven it cannot):\n  deploy-notes: Write the release notes for a deploy.\n    recommended: none\nThe model gave no usable recommendation: no role gets a skill unless you pick one.\n```"
      ]
    },
    {
      "header": "Skills",
      "options": [
        "None",
        "All roles",
        "Describe your own"
      ],
      "previews": [
        "**Skills: your own**\n```\ndeploy-notes: Write the release notes for a deploy. Recommended: none.\n```",
        "**Skills: your own**\n```\ndeploy-notes: Write the release notes for a deploy. Recommended: none.\n```",
        "**Skills: your own**\n```\ndeploy-notes: Write the release notes for a deploy. Recommended: none.\n```"
      ]
    },
    {
      "header": "Hunk 1 of 2",
      "options": [
        "Accept",
        "Decline"
      ],
      "previews": [
        null,
        null
      ]
    },
    {
      "header": "Hunk 2 of 2",
      "options": [
        "Accept",
        "Decline"
      ],
      "previews": [
        null,
        null
      ]
    },
    {
      "header": "Git policy",
      "options": [
        "Commit definitions (default)",
        "Commit all",
        "Ignore all of .cadre/"
      ],
      "previews": [
        "**Git policy**\n```\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/.\nCommit all: only per-user files are ignored.\nIgnore all: nothing in .cadre/ is committed.\n```",
        "**Git policy**\n```\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/.\nCommit all: only per-user files are ignored.\nIgnore all: nothing in .cadre/ is committed.\n```",
        "**Git policy**\n```\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/.\nCommit all: only per-user files are ignored.\nIgnore all: nothing in .cadre/ is committed.\n```"
      ]
    },
    {
      "header": "Launch",
      "options": [
        "Git root of this repo",
        "The folder I run it from",
        "Another folder in this repo"
      ],
      "previews": [
        "**Launch**\n```\nGit root: the top of this repo, the same for every launcher.\nRun folder: wherever you run a launcher from.\nLaunchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security\n```",
        "**Launch**\n```\nGit root: the top of this repo, the same for every launcher.\nRun folder: wherever you run a launcher from.\nLaunchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security\n```",
        "**Launch**\n```\nGit root: the top of this repo, the same for every launcher.\nRun folder: wherever you run a launcher from.\nLaunchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security\n```"
      ]
    },
    {
      "header": "Review",
      "options": [
        "Next page",
        "Confirm",
        "Change something…"
      ],
      "previews": [
        "**Review (page 1 of 7)**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: deploy-notes\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods,\ncadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or\n~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config\ndir>/cadre/<repo>-<hash8>/pm/instructions/)\n```",
        "**Review (page 1 of 7)**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: deploy-notes\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods,\ncadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or\n~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config\ndir>/cadre/<repo>-<hash8>/pm/instructions/)\n```",
        "**Review (page 1 of 7)**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: deploy-notes\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods,\ncadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or\n~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config\ndir>/cadre/<repo>-<hash8>/pm/instructions/)\n```"
      ]
    }
  ],
  "reply": [
    "cadre init --dry-run",
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
    "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
    "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
    "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
    "Summary: 25 create, 0 change, 0 leave, 0 conflict, 2 hunks (2 accepted)",
    "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
    "Launchers start in: the git root",
    "Private files per role (written after Confirm):",
    "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
    "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
    "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
    "Dry run: nothing was written."
  ]
}
