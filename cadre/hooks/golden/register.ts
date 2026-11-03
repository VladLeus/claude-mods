/**
 * The engine-driven golden fixtures of `/cadre init --dry-run` (D-219): what memIo cannot see, the option previews of
 * the AskUserQuestion rewrite and the rows of the Pane render, as register.test.ts drives them through the real
 * engine. Captured from that run (a temporary log line in each spec) and pasted as printed; only an approved
 * behaviour-change commit may change a fixture. Data only: register.test.ts imports it.
 */

/**
 * Each question the init dry run of the D3/R1 world (initWorld) asked on the main screen, in order: its header chip
 * (null when none), its options as the dialog drew them and the option preview of each (null where none), the
 * question's own context (D-203). The run is given no presentation, as the test kit stamps none, so no preview line
 * is wrapped (previewColumns, D-231); a register spec pins the wrap at 80 columns. The spec seats the pane inline again
 * at each ask, as a terminal main screen keeps it drawn. Every question carries a context of its own (D-300), the
 * hunk questions their before, after and why (D-287); only a question that takes a typed answer gets Describe your own
 * (D-234). The Review is paged (D-233, ASKED #19): its first page, with Next page, Confirm and Change something…. The
 * pane opens as the run starts (D-324), so the seat the kit records at the consent holds for every later question;
 * the consent itself has no preview, as the kit seats the pane only at its ask, after its options were rewritten.
 */
export const GOLDEN_PREVIEWS: readonly {
  readonly header: string | null
  readonly options: readonly string[]
  readonly previews: readonly (string | null)[]
}[] = [
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
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
    ]
  },
  {
    "header": "Framework",
    "options": [
      "Same for all roles",
      "Per role"
    ],
    "previews": [
      "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/; enabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
      "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/; enabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```"
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
      "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/; enabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
      "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/; enabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
      "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/; enabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```",
      "**Frameworks**\n```\nGSD: in use 1.16.0 (.planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core)\nsuperpowers: in use 6.4.1 (docs/superpowers/; enabledPlugins[\"superpowers@claude-plugins-official\"]=true (user))\n```"
    ]
  },
  {
    "header": "Security",
    "options": [
      "Install",
      "Not now"
    ],
    "previews": [
      "**Security plugins**\n```\nclaude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.\nsecurity-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits.\n```",
      "**Security plugins**\n```\nclaude-security@claude-plugins-official: claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.\nsecurity-guidance@claude-plugins-official: security-guidance adds hooks that warn about risky edits.\n```"
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
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
    ]
  },
  {
    "header": "Model",
    "options": [
      "Same for all roles",
      "Per role"
    ],
    "previews": [
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
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
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```"
    ]
  },
  {
    "header": "Hunk 1 of 2",
    "options": [
      "Accept",
      "Decline"
    ],
    "previews": [
      "**.planning/config.json: mode**\n```\n  before: not set (GSD default)\n  after:  \"yolo\"\nWhy: interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended\nRequired for unattended GSD roles.\n```",
      "**.planning/config.json: mode**\n```\n  before: not set (GSD default)\n  after:  \"yolo\"\nWhy: interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended\nRequired for unattended GSD roles.\n```"
    ]
  },
  {
    "header": "Hunk 2 of 2",
    "options": [
      "Accept",
      "Decline"
    ],
    "previews": [
      "**.planning/config.json: workflow.text\\_mode**\n```\n  before: not set (GSD default)\n  after:  false\nWhy: text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall\nRequired for unattended GSD roles.\n```",
      "**.planning/config.json: workflow.text\\_mode**\n```\n  before: not set (GSD default)\n  after:  false\nWhy: text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall\nRequired for unattended GSD roles.\n```"
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
      "**Review (page 1 of 7)**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n```",
      "**Review (page 1 of 7)**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n```",
      "**Review (page 1 of 7)**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n```"
    ]
  }
]

/**
 * The cadre-init pane as the terminal draws it at the first Review question of the init dry run of initWorld, one
 * drawing per placement (inline on the main screen, docked): the Review's own context, its first page on a pane
 * surface (D-233, D-299), its lines wrapped to the 60 columns of the test's pane body (D-231), each row as the texts
 * of its spans in order, a row with no spans as its own text. After the run the pane draws its empty frame (D-304).
 */
export const GOLDEN_PANE_ROWS: {
  readonly inline: readonly (readonly string[])[]
  readonly dock: readonly (readonly string[])[]
} = {
  "inline": [
    [
      "Review (page 1 of 7)"
    ],
    [
      "Roles:"
    ],
    [
      "  PM (pm)"
    ],
    [
      "  Team Lead (tl)"
    ],
    [
      "  Security (security)"
    ],
    [
      "Scope card:",
      " ",
      "PM (pm)"
    ],
    [
      "  ",
      "framework:",
      " GSD",
      "; ",
      "model:",
      " opus + medium",
      "; ",
      "permission mode:"
    ],
    [
      "auto"
    ],
    [
      "  ",
      "skills:",
      " none"
    ],
    [
      "  ",
      "MCP servers:",
      " none"
    ],
    [
      "  ",
      "not given skills:",
      " none"
    ],
    [
      "  ",
      "not given MCP:",
      " none"
    ],
    [
      "  ",
      "hooks loaded:",
      " none"
    ],
    [
      "  ",
      "hooks loaded by project settings:",
      " none"
    ],
    [
      "  ",
      "hooks not loaded:",
      " none"
    ],
    [
      "  rules:"
    ],
    [
      "    ",
      "[hard]",
      " Plugins: only agent-fleet@local-mods,"
    ],
    [
      "autopilot@local-mods, cadre@local-mods load"
    ],
    [
      "(--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[hard]",
      " No Bash tool (denied)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws"
    ],
    [
      "are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as"
    ],
    [
      "unusual names or ~/.claude.json without consent, are not"
    ],
    [
      "denied"
    ]
  ],
  "dock": [
    [
      "Review (page 1 of 7)"
    ],
    [
      "Roles:"
    ],
    [
      "  PM (pm)"
    ],
    [
      "  Team Lead (tl)"
    ],
    [
      "  Security (security)"
    ],
    [
      "Scope card:",
      " ",
      "PM (pm)"
    ],
    [
      "  ",
      "framework:",
      " GSD",
      "; ",
      "model:",
      " opus + medium",
      "; ",
      "permission mode:"
    ],
    [
      "auto"
    ],
    [
      "  ",
      "skills:",
      " none"
    ],
    [
      "  ",
      "MCP servers:",
      " none"
    ],
    [
      "  ",
      "not given skills:",
      " none"
    ],
    [
      "  ",
      "not given MCP:",
      " none"
    ],
    [
      "  ",
      "hooks loaded:",
      " none"
    ],
    [
      "  ",
      "hooks loaded by project settings:",
      " none"
    ],
    [
      "  ",
      "hooks not loaded:",
      " none"
    ],
    [
      "  rules:"
    ],
    [
      "    ",
      "[hard]",
      " Plugins: only agent-fleet@local-mods,"
    ],
    [
      "autopilot@local-mods, cadre@local-mods load"
    ],
    [
      "(--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[hard]",
      " No Bash tool (denied)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws"
    ],
    [
      "are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as"
    ],
    [
      "unusual names or ~/.claude.json without consent, are not"
    ],
    [
      "denied"
    ]
  ]
}
