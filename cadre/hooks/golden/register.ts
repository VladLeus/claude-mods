/**
 * The engine-driven golden fixtures of `/cadre init --dry-run` (D-219): what memIo cannot see, the option previews of
 * the AskUserQuestion rewrite and the rows of the Pane render, as register.test.ts drives them through the real
 * engine. Captured from that run (a temporary log line in each spec) and pasted as printed; only an approved
 * behaviour-change commit may change a fixture. Data only: register.test.ts imports it.
 */

/**
 * Each question the init dry run of the D3/R1 world (initWorld) asked on the main screen, in order: its header chip
 * (null when none), its options as the dialog drew them and the option preview of each (null where none). The spec
 * seats the pane inline again at each ask, as a terminal main screen keeps it drawn. The first question comes before
 * any block, so it has no preview. "Use these roles?" has none either, and that is a test-kit artifact: the kit draws
 * the pane only on a mount, the first block of a run clears its seat (D3), and the re-seat at that ask lands after its
 * options were rewritten, while a terminal draws the pane as soon as it opens.
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
      null,
      null,
      null
    ]
  },
  {
    "header": "Framework",
    "options": [
      "Same for all roles",
      "Per role",
      "Describe your own"
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
      "GSD",
      "superpowers",
      "none (built-in)",
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
    "header": "Security",
    "options": [
      "Install",
      "Not now",
      "Describe your own"
    ],
    "previews": [
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```"
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
      "Per role",
      "Describe your own"
    ],
    "previews": [
      "**Roles**\n```\nProposed roles:\n  PM (pm)                 Owns product decisions: scope, requirements and acceptance.\n  Team Lead (tl)          Owns architecture and QA decisions; reviews and merges the work.\n  Security (security)     Owns security decisions and reviews.\nChanges from the scan:\n  dropped be: no source code found\n  dropped fe: no frontend framework found (react, vue, next, svelte, angular)\n  dropped qa: no tests or E2E setup found\n```",
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
      "Decline",
      "Describe your own"
    ],
    "previews": [
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```"
    ]
  },
  {
    "header": "Hunk 2 of 2",
    "options": [
      "Accept",
      "Decline",
      "Describe your own"
    ],
    "previews": [
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```"
    ]
  },
  {
    "header": "Git policy",
    "options": [
      "Commit definitions (default)",
      "Commit all",
      "Ignore all of .cadre/",
      "Describe your own"
    ],
    "previews": [
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```",
      "**Recommendations**\n```\nRecommendations (print-only; init asks before it installs any):\n- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)\n    run: claude plugin install claude-security@claude-plugins-official\n- security-guidance for Security: no hooks warn the Security role about risky edits\n    run: claude plugin install security-guidance@claude-plugins-official\n```"
    ]
  },
  {
    "header": "Launch",
    "options": [
      "Git root of this repo",
      "The folder I run it from",
      "Another folder in this repo",
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
    "header": "Review",
    "options": [
      "Confirm",
      "Change roles",
      "Change git policy",
      "Change launcher start"
    ],
    "previews": [
      "**Review**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)\n    [hard] Autopilot, agent-fleet and the handoff skills are always available\n    [hard] Permission mode: auto\n    [none] Attended: GSD workflows need Bash; this role runs them through a person\n    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)\n  decisions:\n    Product: pm -> human (queue_question)\n    Arch: tl -> human (queue_question)\n    Security: security -> human (queue_question)\n    QA: tl -> human (queue_question)\n  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)\nScope card: Team Lead (tl)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n```\n…",
      "**Review**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)\n    [hard] Autopilot, agent-fleet and the handoff skills are always available\n    [hard] Permission mode: auto\n    [none] Attended: GSD workflows need Bash; this role runs them through a person\n    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)\n  decisions:\n    Product: pm -> human (queue_question)\n    Arch: tl -> human (queue_question)\n    Security: security -> human (queue_question)\n    QA: tl -> human (queue_question)\n  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)\nScope card: Team Lead (tl)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n```\n…",
      "**Review**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)\n    [hard] Autopilot, agent-fleet and the handoff skills are always available\n    [hard] Permission mode: auto\n    [none] Attended: GSD workflows need Bash; this role runs them through a person\n    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)\n  decisions:\n    Product: pm -> human (queue_question)\n    Arch: tl -> human (queue_question)\n    Security: security -> human (queue_question)\n    QA: tl -> human (queue_question)\n  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)\nScope card: Team Lead (tl)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n```\n…",
      "**Review**\n```\nRoles:\n  PM (pm)\n  Team Lead (tl)\n  Security (security)\nScope card: PM (pm)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n    [hard] Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)\n    [hard] No Bash tool (denied)\n    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied\n    [best-effort] No other scanned MCP servers to deny\n    [none] MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied\n    [best-effort] Skills: only the listed skills are linked\n    [none] Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)\n    [hard] Autopilot, agent-fleet and the handoff skills are always available\n    [hard] Permission mode: auto\n    [none] Attended: GSD workflows need Bash; this role runs them through a person\n    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)\n  decisions:\n    Product: pm -> human (queue_question)\n    Arch: tl -> human (queue_question)\n    Security: security -> human (queue_question)\n    QA: tl -> human (queue_question)\n  memory: <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)\nScope card: Team Lead (tl)\n  framework: GSD; model: opus + medium; permission mode: auto\n  skills: none\n  MCP servers: none\n  not given skills: none\n  not given MCP: none\n  hooks loaded: none\n  hooks loaded by project settings: none\n  hooks not loaded: none\n  rules:\n```\n…"
    ]
  }
]

/**
 * The cadre-init pane as the terminal draws it after the init dry run of initWorld, one drawing per placement (inline
 * on the main screen, docked): the review block, each row as the texts of its spans in order, a row with no spans as
 * its own text.
 */
export const GOLDEN_PANE_ROWS: {
  readonly inline: readonly (readonly string[])[]
  readonly dock: readonly (readonly string[])[]
} = {
  "inline": [
    [
      "Review"
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
      "permission mode:",
      " auto"
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
      " Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[hard]",
      " No Bash tool (denied)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
    ],
    [
      "    ",
      "[best-effort]",
      " Skills: only the listed skills are linked"
    ],
    [
      "    ",
      "[none]",
      " Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)"
    ],
    [
      "    ",
      "[hard]",
      " Autopilot, agent-fleet and the handoff skills are always available"
    ],
    [
      "    ",
      "[hard]",
      " Permission mode: auto"
    ],
    [
      "    ",
      "[none]",
      " Attended: GSD workflows need Bash; this role runs them through a person"
    ],
    [
      "    ",
      "[none]",
      " MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)"
    ],
    [
      "  decisions:"
    ],
    [
      "    ",
      "Product:",
      " pm -> human (queue_question)"
    ],
    [
      "    ",
      "Arch:",
      " tl -> human (queue_question)"
    ],
    [
      "    ",
      "Security:",
      " security -> human (queue_question)"
    ],
    [
      "    ",
      "QA:",
      " tl -> human (queue_question)"
    ],
    [
      "  ",
      "memory:",
      " <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch",
      "; ",
      "<config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)"
    ],
    [
      "Scope card:",
      " ",
      "Team Lead (tl)"
    ],
    [
      "  ",
      "framework:",
      " GSD",
      "; ",
      "model:",
      " opus + medium",
      "; ",
      "permission mode:",
      " auto"
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
      " Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[best-effort]",
      " Bash runs in the sandbox (hard on macOS, best-effort on Linux)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
    ],
    [
      "    ",
      "[best-effort]",
      " Skills: only the listed skills are linked"
    ],
    [
      "    ",
      "[none]",
      " Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)"
    ],
    [
      "    ",
      "[hard]",
      " Autopilot, agent-fleet and the handoff skills are always available"
    ],
    [
      "    ",
      "[hard]",
      " Permission mode: auto"
    ],
    [
      "    ",
      "[none]",
      " MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)"
    ],
    [
      "  decisions:"
    ],
    [
      "    ",
      "Product:",
      " pm -> human (queue_question)"
    ],
    [
      "    ",
      "Arch:",
      " tl -> human (queue_question)"
    ],
    [
      "    ",
      "Security:",
      " security -> human (queue_question)"
    ],
    [
      "    ",
      "QA:",
      " tl -> human (queue_question)"
    ],
    [
      "  ",
      "memory:",
      " <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch",
      "; ",
      "<config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)"
    ],
    [
      "Scope card:",
      " ",
      "Security (security)"
    ],
    [
      "  ",
      "framework:",
      " GSD",
      "; ",
      "model:",
      " opus + medium",
      "; ",
      "permission mode:",
      " auto"
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
      " Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[best-effort]",
      " Bash runs in the sandbox (hard on macOS, best-effort on Linux)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
    ],
    [
      "    ",
      "[best-effort]",
      " Skills: only the listed skills are linked"
    ],
    [
      "    ",
      "[none]",
      " Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)"
    ],
    [
      "    ",
      "[hard]",
      " Autopilot, agent-fleet and the handoff skills are always available"
    ],
    [
      "    ",
      "[hard]",
      " Permission mode: auto"
    ],
    [
      "    ",
      "[none]",
      " MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)"
    ],
    [
      "  decisions:"
    ],
    [
      "    ",
      "Product:",
      " pm -> human (queue_question)"
    ],
    [
      "    ",
      "Arch:",
      " tl -> human (queue_question)"
    ],
    [
      "    ",
      "Security:",
      " security -> human (queue_question)"
    ],
    [
      "    ",
      "QA:",
      " tl -> human (queue_question)"
    ],
    [
      "  ",
      "memory:",
      " <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch",
      "; ",
      "<config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)"
    ],
    [
      "Private files per role (written after Confirm):"
    ],
    [
      "    ",
      "private files:",
      " <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)"
    ],
    [
      "    ",
      "private files:",
      " <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)"
    ],
    [
      "    ",
      "private files:",
      " <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)"
    ],
    [
      "File plan:"
    ],
    [
      "  ",
      "create",
      "    .cadre/INDEX.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/bin/pm (executable)"
    ],
    [
      "  ",
      "create",
      "    .cadre/bin/security (executable)"
    ],
    [
      "  ",
      "create",
      "    .cadre/bin/tl (executable)"
    ],
    [
      "  ",
      "create",
      "    .cadre/cadre.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/manifest.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/CLAUDE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/ROLE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/kickoff.txt"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/mcp.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/role.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/settings.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/CLAUDE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/ROLE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/kickoff.txt"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/mcp.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/role.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/settings.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/CLAUDE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/ROLE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/kickoff.txt"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/mcp.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/role.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/settings.json"
    ],
    [
      "  ",
      "create",
      "    .gitignore"
    ],
    [
      "            # >>> cadre"
    ],
    [
      "            thoughts/"
    ],
    [
      "            .cadre/*/.runtime/"
    ],
    [
      "            .cadre/**/*.cadre-new"
    ],
    [
      "            CLAUDE-SECURITY-*/"
    ],
    [
      "            # <<< cadre"
    ],
    [
      "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)"
    ],
    [
      "            ",
      "run:",
      " node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo"
    ],
    [
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)"
    ],
    [
      "            ",
      "run:",
      " node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false"
    ],
    [
      "Summary:",
      " ",
      "25",
      " create, ",
      "0",
      " change, ",
      "0",
      " leave, ",
      "0",
      " conflict, ",
      "2",
      " hunks (",
      "2",
      " accepted)"
    ],
    [
      "Git policy:",
      " commit definitions (.cadre/*/.runtime/ ignored)"
    ],
    [
      "Launchers start in:",
      " the git root"
    ],
    [
      "warning:",
      " could not list docs/superpowers (treated as unknown)"
    ]
  ],
  "dock": [
    [
      "Review"
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
      "permission mode:",
      " auto"
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
      " Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[hard]",
      " No Bash tool (denied)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
    ],
    [
      "    ",
      "[best-effort]",
      " Skills: only the listed skills are linked"
    ],
    [
      "    ",
      "[none]",
      " Loads .cadre/pm/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/pm/instructions/)"
    ],
    [
      "    ",
      "[hard]",
      " Autopilot, agent-fleet and the handoff skills are always available"
    ],
    [
      "    ",
      "[hard]",
      " Permission mode: auto"
    ],
    [
      "    ",
      "[none]",
      " Attended: GSD workflows need Bash; this role runs them through a person"
    ],
    [
      "    ",
      "[none]",
      " MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)"
    ],
    [
      "  decisions:"
    ],
    [
      "    ",
      "Product:",
      " pm -> human (queue_question)"
    ],
    [
      "    ",
      "Arch:",
      " tl -> human (queue_question)"
    ],
    [
      "    ",
      "Security:",
      " security -> human (queue_question)"
    ],
    [
      "    ",
      "QA:",
      " tl -> human (queue_question)"
    ],
    [
      "  ",
      "memory:",
      " <config dir>/cadre/<repo>-<hash8>/pm/ (rendered at launch",
      "; ",
      "<config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)"
    ],
    [
      "Scope card:",
      " ",
      "Team Lead (tl)"
    ],
    [
      "  ",
      "framework:",
      " GSD",
      "; ",
      "model:",
      " opus + medium",
      "; ",
      "permission mode:",
      " auto"
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
      " Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[best-effort]",
      " Bash runs in the sandbox (hard on macOS, best-effort on Linux)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
    ],
    [
      "    ",
      "[best-effort]",
      " Skills: only the listed skills are linked"
    ],
    [
      "    ",
      "[none]",
      " Loads .cadre/tl/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/tl/instructions/)"
    ],
    [
      "    ",
      "[hard]",
      " Autopilot, agent-fleet and the handoff skills are always available"
    ],
    [
      "    ",
      "[hard]",
      " Permission mode: auto"
    ],
    [
      "    ",
      "[none]",
      " MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)"
    ],
    [
      "  decisions:"
    ],
    [
      "    ",
      "Product:",
      " pm -> human (queue_question)"
    ],
    [
      "    ",
      "Arch:",
      " tl -> human (queue_question)"
    ],
    [
      "    ",
      "Security:",
      " security -> human (queue_question)"
    ],
    [
      "    ",
      "QA:",
      " tl -> human (queue_question)"
    ],
    [
      "  ",
      "memory:",
      " <config dir>/cadre/<repo>-<hash8>/tl/ (rendered at launch",
      "; ",
      "<config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)"
    ],
    [
      "Scope card:",
      " ",
      "Security (security)"
    ],
    [
      "  ",
      "framework:",
      " GSD",
      "; ",
      "model:",
      " opus + medium",
      "; ",
      "permission mode:",
      " auto"
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
      " Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load (--setting-sources project whitelist)"
    ],
    [
      "    ",
      "[best-effort]",
      " Bash runs in the sandbox (hard on macOS, best-effort on Linux)"
    ],
    [
      "    ",
      "[best-effort]",
      " Reads of .env, .env.*, ~/.ssh and ~/.aws are denied"
    ],
    [
      "    ",
      "[best-effort]",
      " No other scanned MCP servers to deny"
    ],
    [
      "    ",
      "[none]",
      " MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied"
    ],
    [
      "    ",
      "[best-effort]",
      " Skills: only the listed skills are linked"
    ],
    [
      "    ",
      "[none]",
      " Loads .cadre/security/CLAUDE.md and its private instructions (<config dir>/cadre/<repo>-<hash8>/security/instructions/)"
    ],
    [
      "    ",
      "[hard]",
      " Autopilot, agent-fleet and the handoff skills are always available"
    ],
    [
      "    ",
      "[hard]",
      " Permission mode: auto"
    ],
    [
      "    ",
      "[none]",
      " MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)"
    ],
    [
      "  decisions:"
    ],
    [
      "    ",
      "Product:",
      " pm -> human (queue_question)"
    ],
    [
      "    ",
      "Arch:",
      " tl -> human (queue_question)"
    ],
    [
      "    ",
      "Security:",
      " security -> human (queue_question)"
    ],
    [
      "    ",
      "QA:",
      " tl -> human (queue_question)"
    ],
    [
      "  ",
      "memory:",
      " <config dir>/cadre/<repo>-<hash8>/security/ (rendered at launch",
      "; ",
      "<config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)"
    ],
    [
      "Private files per role (written after Confirm):"
    ],
    [
      "    ",
      "private files:",
      " <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)"
    ],
    [
      "    ",
      "private files:",
      " <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)"
    ],
    [
      "    ",
      "private files:",
      " <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)"
    ],
    [
      "File plan:"
    ],
    [
      "  ",
      "create",
      "    .cadre/INDEX.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/bin/pm (executable)"
    ],
    [
      "  ",
      "create",
      "    .cadre/bin/security (executable)"
    ],
    [
      "  ",
      "create",
      "    .cadre/bin/tl (executable)"
    ],
    [
      "  ",
      "create",
      "    .cadre/cadre.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/manifest.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/CLAUDE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/ROLE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/kickoff.txt"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/mcp.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/role.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/pm/settings.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/CLAUDE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/ROLE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/kickoff.txt"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/mcp.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/role.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/security/settings.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/CLAUDE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/ROLE.md"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/kickoff.txt"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/mcp.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/role.json"
    ],
    [
      "  ",
      "create",
      "    .cadre/tl/settings.json"
    ],
    [
      "  ",
      "create",
      "    .gitignore"
    ],
    [
      "            # >>> cadre"
    ],
    [
      "            thoughts/"
    ],
    [
      "            .cadre/*/.runtime/"
    ],
    [
      "            .cadre/**/*.cadre-new"
    ],
    [
      "            CLAUDE-SECURITY-*/"
    ],
    [
      "            # <<< cadre"
    ],
    [
      "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)"
    ],
    [
      "            ",
      "run:",
      " node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo"
    ],
    [
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)"
    ],
    [
      "            ",
      "run:",
      " node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false"
    ],
    [
      "Summary:",
      " ",
      "25",
      " create, ",
      "0",
      " change, ",
      "0",
      " leave, ",
      "0",
      " conflict, ",
      "2",
      " hunks (",
      "2",
      " accepted)"
    ],
    [
      "Git policy:",
      " commit definitions (.cadre/*/.runtime/ ignored)"
    ],
    [
      "Launchers start in:",
      " the git root"
    ],
    [
      "warning:",
      " could not list docs/superpowers (treated as unknown)"
    ]
  ]
}
