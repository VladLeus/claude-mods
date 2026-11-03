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
      "context": {
        "title": "Read ~/.claude.json?",
        "lines": [
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "kind": "consent",
        "summary": "1 file, MCP server names only",
        "pane": {
          "asked": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\nWithout it, init still finds MCP servers in .mcp.json, your plugins and this session.",
          "text": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\n1 file, MCP server names only"
        }
      },
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Use these roles?\nProposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan.",
          "text": "Use these roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "security",
        "summary": "2 plugins to install: claude-security, security-guidance",
        "pane": {
          "asked": "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.\nNothing is installed before you confirm the final review, and a --dry-run installs nothing.",
          "text": "Install from claude-plugins-official after you confirm the plan: the missing security plugins?\n2 plugins to install: claude-security, security-guidance"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Autopilot duration for roles?\nApplies to every role: pm, tl, security.",
          "text": "Autopilot duration for roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Model and effort: same for all roles, or per role?\nRoles: pm, tl, security.",
          "text": "Model and effort: same for all roles, or per role?\n3 roles: pm, tl, security"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Model and effort for all roles?\nModels: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max.",
          "text": "Model and effort for all roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "git-policy",
        "summary": "Recommended: commit definitions",
        "pane": {
          "asked": "Git policy for .cadre/?\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed.",
          "text": "Git policy for .cadre/?\nRecommended: commit definitions"
        }
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
        "kind": "launch",
        "summary": "3 launchers",
        "pane": {
          "asked": "Where should the role launchers start their sessions? (asked once for this repo)\nThe launcher of each role (pm, tl, security) starts its session there.",
          "text": "Where should the role launchers start their sessions? (asked once for this repo)\n3 launchers"
        }
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
        "kind": "review",
        "summary": "25 files, 3 roles",
        "pane": {
          "asked": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\nSummary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root\nUse a button, or type duration, model, assignments, memory, env or hunks under Other.",
          "text": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n25 files, 3 roles\nReview (page 1 of 7)"
        }
      },
      "acceptsTyped": false
    }
  ],
  "gsd": [
    {
      "header": "claude.json",
      "context": {
        "title": "Read ~/.claude.json?",
        "lines": [
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "kind": "consent",
        "summary": "1 file, MCP server names only",
        "pane": {
          "asked": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\nWithout it, init still finds MCP servers in .mcp.json, your plugins and this session.",
          "text": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\n1 file, MCP server names only"
        }
      },
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Use these roles?\nProposed: PM (pm), Team Lead (tl), BE (be), FE (fe), QA (qa), Security (security); 1 change from the scan.",
          "text": "Use these roles?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "security",
        "summary": "2 plugins to install: claude-security, security-guidance",
        "pane": {
          "asked": "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.\nNothing is installed before you confirm the final review, and a --dry-run installs nothing.",
          "text": "Install from claude-plugins-official after you confirm the plan: the missing security plugins?\n2 plugins to install: claude-security, security-guidance"
        }
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Autopilot duration for roles?\nApplies to every role: pm, tl, be, fe, qa, security.",
          "text": "Autopilot duration for roles?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Model and effort: same for all roles, or per role?\nRoles: pm, tl, be, fe, qa, security.",
          "text": "Model and effort: same for all roles, or per role?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Model and effort for all roles?\nModels: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max.",
          "text": "Model and effort for all roles?\n6 roles: pm, tl, be, fe, qa, security"
        }
      },
      "acceptsTyped": true
    },
    {
      "header": "Hunk 1 of 2",
      "context": {
        "title": ".planning/config.json: mode",
        "lines": [
          "  before: not set (GSD default)",
          "  after:  \"yolo\"",
          "Why: interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended",
          "Required for unattended GSD roles."
        ],
        "kind": "hunk",
        "summary": "  after:  \"yolo\"",
        "pane": {
          "asked": ".planning/config.json: mode",
          "text": ".planning/config.json: mode\n  after:  \"yolo\""
        }
      },
      "acceptsTyped": false
    },
    {
      "header": "Hunk 2 of 2",
      "context": {
        "title": ".planning/config.json: workflow.text_mode",
        "lines": [
          "  before: not set (GSD default)",
          "  after:  false",
          "Why: text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall",
          "Required for unattended GSD roles."
        ],
        "kind": "hunk",
        "summary": "  after:  false",
        "pane": {
          "asked": ".planning/config.json: workflow.text_mode",
          "text": ".planning/config.json: workflow.text_mode\n  after:  false"
        }
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
        "kind": "git-policy",
        "summary": "Recommended: commit definitions",
        "pane": {
          "asked": "Git policy for .cadre/?\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed.",
          "text": "Git policy for .cadre/?\nRecommended: commit definitions"
        }
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
        "kind": "launch",
        "summary": "6 launchers",
        "pane": {
          "asked": "Where should the role launchers start their sessions? (asked once for this repo)\nThe launcher of each role (pm, tl, be, fe, qa, security) starts its session there.",
          "text": "Where should the role launchers start their sessions? (asked once for this repo)\n6 launchers"
        }
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
        "kind": "review",
        "summary": "46 files, 6 roles",
        "pane": {
          "asked": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\nSummary: 46 create, 0 change, 0 leave, 0 conflict, 2 hunks (2 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root\nUse a button, or type duration, model, assignments, memory, env or hunks under Other.",
          "text": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n46 files, 6 roles\nReview (page 1 of 13)"
        }
      },
      "acceptsTyped": false
    }
  ],
  "superpowers": [
    {
      "header": "claude.json",
      "context": {
        "title": "Read ~/.claude.json?",
        "lines": [
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "kind": "consent",
        "summary": "1 file, MCP server names only",
        "pane": {
          "asked": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\nWithout it, init still finds MCP servers in .mcp.json, your plugins and this session.",
          "text": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\n1 file, MCP server names only"
        }
      },
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Use these roles?\nProposed: PM (pm), Team Lead (tl), BE (be), FE (fe), QA (qa), Security (security); 1 change from the scan.",
          "text": "Use these roles?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "security",
        "summary": "2 plugins to install: claude-security, security-guidance",
        "pane": {
          "asked": "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.\nNothing is installed before you confirm the final review, and a --dry-run installs nothing.",
          "text": "Install from claude-plugins-official after you confirm the plan: the missing security plugins?\n2 plugins to install: claude-security, security-guidance"
        }
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Autopilot duration for roles?\nApplies to every role: pm, tl, be, fe, qa, security.",
          "text": "Autopilot duration for roles?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Model and effort: same for all roles, or per role?\nRoles: pm, tl, be, fe, qa, security.",
          "text": "Model and effort: same for all roles, or per role?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "roles",
        "summary": "6 roles: pm, tl, be, fe, qa, security",
        "pane": {
          "asked": "Model and effort for all roles?\nModels: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max.",
          "text": "Model and effort for all roles?\n6 roles: pm, tl, be, fe, qa, security"
        }
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
        "kind": "git-policy",
        "summary": "Recommended: commit definitions",
        "pane": {
          "asked": "Git policy for .cadre/?\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed.",
          "text": "Git policy for .cadre/?\nRecommended: commit definitions"
        }
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
        "kind": "launch",
        "summary": "6 launchers",
        "pane": {
          "asked": "Where should the role launchers start their sessions? (asked once for this repo)\nThe launcher of each role (pm, tl, be, fe, qa, security) starts its session there.",
          "text": "Where should the role launchers start their sessions? (asked once for this repo)\n6 launchers"
        }
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
        "kind": "review",
        "summary": "46 files, 6 roles",
        "pane": {
          "asked": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\nSummary: 46 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root\nUse a button, or type duration, model, assignments, memory, env or hunks under Other.",
          "text": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n46 files, 6 roles\nReview (page 1 of 13)"
        }
      },
      "acceptsTyped": false
    }
  ],
  "everyStep": [
    {
      "header": "claude.json",
      "context": {
        "title": "Read ~/.claude.json?",
        "lines": [
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "kind": "consent",
        "summary": "1 file, MCP server names only",
        "pane": {
          "asked": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\nWithout it, init still finds MCP servers in .mcp.json, your plugins and this session.",
          "text": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\n1 file, MCP server names only"
        }
      },
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Use these roles?\nProposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan.",
          "text": "Use these roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "detection",
        "summary": "2 frameworks found: gsd, superpowers",
        "pane": {
          "asked": "Which framework do the roles use? (asked because more than one framework is in use)\nRoles: pm, tl, security.",
          "text": "Which framework do the roles use? (asked because more than one framework is in use)\n2 frameworks found: gsd, superpowers"
        }
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
        "kind": "detection",
        "summary": "2 frameworks found: gsd, superpowers",
        "pane": {
          "asked": "Framework for all roles?\nRoles: pm, tl, security.",
          "text": "Framework for all roles?\n2 frameworks found: gsd, superpowers"
        }
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
        "kind": "security",
        "summary": "2 plugins to install: claude-security, security-guidance",
        "pane": {
          "asked": "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.\nNothing is installed before you confirm the final review, and a --dry-run installs nothing.",
          "text": "Install from claude-plugins-official after you confirm the plan: the missing security plugins?\n2 plugins to install: claude-security, security-guidance"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Autopilot duration for roles?\nApplies to every role: pm, tl, security.",
          "text": "Autopilot duration for roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Model and effort: same for all roles, or per role?\nRoles: pm, tl, security.",
          "text": "Model and effort: same for all roles, or per role?\n3 roles: pm, tl, security"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Model and effort for all roles?\nModels: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max.",
          "text": "Model and effort for all roles?\n3 roles: pm, tl, security"
        }
      },
      "acceptsTyped": true
    },
    {
      "header": "MCP",
      "context": {
        "title": "MCP servers",
        "lines": [
          "sentry: session, 1 tool. Recommended: none."
        ],
        "kind": "mcp-server",
        "summary": "1 server, 0 recommended",
        "pane": {
          "asked": "Which roles get the MCP servers (1)? Pick how to hand them out.\n1 MCP server; each question shows its source, its tools and the roles it is recommended for.",
          "text": "Which roles get the MCP servers (1)? Pick how to hand them out.\n1 server, 0 recommended"
        }
      },
      "acceptsTyped": false
    },
    {
      "header": "MCP",
      "context": {
        "title": "MCP servers",
        "lines": [
          "sentry: session, 1 tool. Recommended: none."
        ],
        "kind": "mcp-server",
        "summary": "1 server, 0 recommended",
        "pane": {
          "asked": "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)\nRoles: pm, tl, security. A role not given the server cannot use it.",
          "text": "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)\n1 server, 0 recommended"
        }
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
        "kind": "skill-group",
        "summary": "1 skill. Recommended: none",
        "pane": {
          "asked": "Which roles get codex skills (1)? (e.g. BE, QA, or none)\nRoles: pm, tl, security. A role given these skills can run them in its session; a role not given them cannot.",
          "text": "Which roles get codex skills? (e.g. BE, QA, or none)\n1 skill. Recommended: none"
        }
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
        "kind": "instructions",
        "summary": "2 files, 1 memory",
        "pane": {
          "asked": "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.\nFound: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 0 rule files, AGENTS.md no, 1 memory. No keeps the whole-file questions.",
          "text": "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.\n2 files, 1 memory"
        }
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
        "kind": "memory-group",
        "summary": "1 file",
        "pane": {
          "asked": "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)\nRoles: pm, tl, security. Their content is never shown or committed.",
          "text": "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)\n1 file"
        }
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
        "kind": "memory-group",
        "summary": "1 file",
        "pane": {
          "asked": "Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)\nRoles: pm, tl, security. Their content is never shown or committed.",
          "text": "Which roles get the auto-memories for this repo? (e.g. PM, TL, or none)\n1 file"
        }
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
        "kind": "memory-group",
        "summary": "1 file",
        "pane": {
          "asked": "Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)\nRoles: pm, tl, security. Their content is never shown or committed.",
          "text": "Which roles get the project CLAUDE.md? (e.g. PM, TL, or none)\n1 file"
        }
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
        "kind": "env",
        "summary": "2 env names",
        "pane": {
          "asked": "Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)\nRoles: pm, tl, security. Every role carries the same names; values are filled in at launch.",
          "text": "Which env variables do roles carry? (values are never stored; e.g. API_KEY, or none)\n2 env names"
        }
      },
      "acceptsTyped": true
    },
    {
      "header": "Hunk 1 of 3",
      "context": {
        "title": ".planning/config.json: mode",
        "lines": [
          "  before: not set (GSD default)",
          "  after:  \"yolo\"",
          "Why: interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended",
          "Required for unattended GSD roles."
        ],
        "kind": "hunk",
        "summary": "  after:  \"yolo\"",
        "pane": {
          "asked": ".planning/config.json: mode",
          "text": ".planning/config.json: mode\n  after:  \"yolo\""
        }
      },
      "acceptsTyped": false
    },
    {
      "header": "Hunk 2 of 3",
      "context": {
        "title": ".planning/config.json: workflow.text_mode",
        "lines": [
          "  before: not set (GSD default)",
          "  after:  false",
          "Why: text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall",
          "Required for unattended GSD roles."
        ],
        "kind": "hunk",
        "summary": "  after:  false",
        "pane": {
          "asked": ".planning/config.json: workflow.text_mode",
          "text": ".planning/config.json: workflow.text_mode\n  after:  false"
        }
      },
      "acceptsTyped": false
    },
    {
      "header": "Hunk 3 of 3",
      "context": {
        "title": ".planning/config.json: hooks.context_warnings",
        "lines": [
          "  before: not set (GSD default)",
          "  after:  false",
          "Why: only when gsd-statusline is the statusline: gsd-context-monitor warnings conflict with the autopilot handoff",
          "Optional."
        ],
        "kind": "hunk",
        "summary": "  after:  false",
        "pane": {
          "asked": ".planning/config.json: hooks.context_warnings",
          "text": ".planning/config.json: hooks.context_warnings\n  after:  false"
        }
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
        "kind": "git-policy",
        "summary": "Recommended: commit definitions",
        "pane": {
          "asked": "Git policy for .cadre/?\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed.",
          "text": "Git policy for .cadre/?\nRecommended: commit definitions"
        }
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
        "kind": "launch",
        "summary": "3 launchers",
        "pane": {
          "asked": "Where should the role launchers start their sessions? (asked once for this repo)\nThe launcher of each role (pm, tl, security) starts its session there.",
          "text": "Where should the role launchers start their sessions? (asked once for this repo)\n3 launchers"
        }
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
        "kind": "review",
        "summary": "25 files, 3 roles",
        "pane": {
          "asked": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\nSummary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root\nUse a button, or type duration, model, assignments, memory, env or hunks under Other.",
          "text": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n25 files, 3 roles\nReview (page 1 of 8)"
        }
      },
      "acceptsTyped": false
    }
  ],
  "parts": [
    {
      "header": "claude.json",
      "context": {
        "title": "Read ~/.claude.json?",
        "lines": [
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "kind": "consent",
        "summary": "1 file, MCP server names only",
        "pane": {
          "asked": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\nWithout it, init still finds MCP servers in .mcp.json, your plugins and this session.",
          "text": "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.\n1 file, MCP server names only"
        }
      },
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Use these roles?\nProposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan.",
          "text": "Use these roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "security",
        "summary": "2 plugins to install: claude-security, security-guidance",
        "pane": {
          "asked": "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.\nNothing is installed before you confirm the final review, and a --dry-run installs nothing.",
          "text": "Install from claude-plugins-official after you confirm the plan: the missing security plugins?\n2 plugins to install: claude-security, security-guidance"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Autopilot duration for roles?\nApplies to every role: pm, tl, security.",
          "text": "Autopilot duration for roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Model and effort: same for all roles, or per role?\nRoles: pm, tl, security.",
          "text": "Model and effort: same for all roles, or per role?\n3 roles: pm, tl, security"
        }
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
        "kind": "roles",
        "summary": "3 roles: pm, tl, security",
        "pane": {
          "asked": "Model and effort for all roles?\nModels: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max.",
          "text": "Model and effort for all roles?\n3 roles: pm, tl, security"
        }
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
        "kind": "instructions",
        "summary": "1 file, 2 memories",
        "pane": {
          "asked": "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.\nFound: global CLAUDE.md yes, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 2 memories. No keeps the whole-file questions.",
          "text": "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.\n1 file, 2 memories"
        }
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
        "kind": "instructions",
        "summary": "2 topics, 2 memories, 3 recommended",
        "pane": {
          "asked": "How do you want to hand out the instruction parts and memories?\n2 topics from 1 file and 2 memories; the pane shows each with the roles it is recommended for.",
          "text": "How do you want to hand out the instruction parts and memories?\n2 topics, 2 memories, 3 recommended"
        }
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
        "kind": "improver-install",
        "summary": "2 roles: tl, security",
        "pane": {
          "asked": "Install claude-md-management from claude-plugins-official after you confirm the plan? Its claude-md-improver tidies each role's built CLAUDE.md, and you accept or keep each change.\nWithout it the built files stay as cadre wrote them; a --dry-run installs nothing.",
          "text": "Install claude-md-management from claude-plugins-official after you confirm the plan? Its claude-md-improver tidies each role's built CLAUDE.md, and you accept or keep each change.\n2 roles: tl, security"
        }
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
        "kind": "git-policy",
        "summary": "Recommended: commit definitions",
        "pane": {
          "asked": "Git policy for .cadre/?\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed.",
          "text": "Git policy for .cadre/?\nRecommended: commit definitions"
        }
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
        "kind": "launch",
        "summary": "3 launchers",
        "pane": {
          "asked": "Where should the role launchers start their sessions? (asked once for this repo)\nThe launcher of each role (pm, tl, security) starts its session there.",
          "text": "Where should the role launchers start their sessions? (asked once for this repo)\n3 launchers"
        }
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
        "kind": "review",
        "summary": "25 files, 3 roles",
        "pane": {
          "asked": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\nSummary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root\nUse a button, or type duration, model, assignments, memory, env or hunks under Other.",
          "text": "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n25 files, 3 roles\nReview (page 1 of 8)"
        }
      },
      "acceptsTyped": false
    }
  ],
  "regenDry": []
}
