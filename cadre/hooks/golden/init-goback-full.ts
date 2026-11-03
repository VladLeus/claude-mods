/**
 * The golden fixtures of the `/cadre init` review go-backs that the `nothing` world leaves empty (D-219, ASKED #30): one
 * dry run over the everyStep world (worlds.ts) per typed item that re-asks questions with content there (assignments,
 * memory, env, hunks), the review answered first with the item, then Confirm; every other question keeps its
 * PARTS_DECLINED value. Captured from the code by a scratch run and pasted as printed; init-goback-full.test.ts runs
 * each again and compares with toEqual. Only an approved behaviour-change commit may change a fixture. Only the golden
 * modules import it.
 */
import type { GoldenRun } from './types'

/** Each go-back run over the everyStep world by the typed review item it answers first. */
export const GOLDEN_INIT_GOBACK_FULL: Readonly<Record<string, GoldenRun>> = {
  "assignments": {
    "asks": [
      {
        "question": [
          "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "header": "claude.json",
        "options": [
          "No, skip it",
          "Yes, read names only"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Use these roles?",
          "Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan."
        ],
        "header": "Roles",
        "options": [
          "Use these roles",
          "Adjust them",
          "Describe my own structure"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which framework do the roles use? (asked because more than one framework is in use)",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Framework for all roles?",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "GSD",
          "superpowers",
          "none (built-in)"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.",
          "Nothing is installed before you confirm the final review, and a --dry-run installs nothing."
        ],
        "header": "Security",
        "options": [
          "Install",
          "Not now"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Autopilot duration for roles?",
          "Applies to every role: pm, tl, security."
        ],
        "header": "Duration",
        "options": [
          "4h",
          "2h",
          "8h"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort: same for all roles, or per role?",
          "Roles: pm, tl, security."
        ],
        "header": "Model",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort for all roles?",
          "Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max."
        ],
        "header": "Model",
        "options": [
          "opus + medium",
          "sonnet + medium",
          "sonnet + high"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the MCP servers (1)? Pick how to hand them out.",
          "1 MCP server; each question shows its source, its tools and the roles it is recommended for."
        ],
        "header": "MCP",
        "options": [
          "Go one by one",
          "Whole group"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role not given the server cannot use it."
        ],
        "header": "MCP",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get codex skills (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role given these skills can run them in its session; a role not given them cannot."
        ],
        "header": "Skills",
        "options": [
          "Go one by one",
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.",
          "Found: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 0 rule files, AGENTS.md no, 1 memory. No keeps the whole-file questions."
        ],
        "header": "Instructions",
        "options": [
          "No, skip it",
          "Yes, read them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)",
          "Roles: pm, tl, security. Every role carries the same names; values are filled in at launch."
        ],
        "header": "Env",
        "options": [
          "None",
          "All of them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: mode"
        ],
        "header": "Hunk 1 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: workflow.text_mode"
        ],
        "header": "Hunk 2 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: hooks.context_warnings"
        ],
        "header": "Hunk 3 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Git policy for .cadre/?",
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed."
        ],
        "header": "Git policy",
        "options": [
          "Commit definitions (default)",
          "Commit all",
          "Ignore all of .cadre/"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Where should the role launchers start their sessions? (asked once for this repo)",
          "The launcher of each role (pm, tl, security) starts its session there."
        ],
        "header": "Launch",
        "options": [
          "Git root of this repo",
          "The folder I run it from",
          "Another folder in this repo"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the MCP servers (1)? Pick how to hand them out.",
          "1 MCP server; each question shows its source, its tools and the roles it is recommended for."
        ],
        "header": "MCP",
        "options": [
          "Go one by one",
          "Whole group"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role not given the server cannot use it."
        ],
        "header": "MCP",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get codex skills (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role given these skills can run them in its session; a role not given them cannot."
        ],
        "header": "Skills",
        "options": [
          "Go one by one",
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      }
    ],
    "logged": [
      "No session history for this repo.",
      "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
    ],
    "shown": [
      {
        "key": "notes",
        "title": "Notes",
        "lines": [
          "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
        ]
      }
    ],
    "promptHashes": [
      "73ed8a25af823e7774847203e3339bade6da6f7cdfe71913f7258a90cfca6f63",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "a5452cf1b1e18f52222fc72b9effa70502e0bed5559e357ade2dd50ed907c30c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c"
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
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
      "  hunk      .planning/config.json  hooks.context_warnings: not set (GSD default) -> false  (optional, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set hooks.context_warnings false",
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted)",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "memory": {
    "asks": [
      {
        "question": [
          "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "header": "claude.json",
        "options": [
          "No, skip it",
          "Yes, read names only"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Use these roles?",
          "Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan."
        ],
        "header": "Roles",
        "options": [
          "Use these roles",
          "Adjust them",
          "Describe my own structure"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which framework do the roles use? (asked because more than one framework is in use)",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Framework for all roles?",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "GSD",
          "superpowers",
          "none (built-in)"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.",
          "Nothing is installed before you confirm the final review, and a --dry-run installs nothing."
        ],
        "header": "Security",
        "options": [
          "Install",
          "Not now"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Autopilot duration for roles?",
          "Applies to every role: pm, tl, security."
        ],
        "header": "Duration",
        "options": [
          "4h",
          "2h",
          "8h"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort: same for all roles, or per role?",
          "Roles: pm, tl, security."
        ],
        "header": "Model",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort for all roles?",
          "Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max."
        ],
        "header": "Model",
        "options": [
          "opus + medium",
          "sonnet + medium",
          "sonnet + high"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the MCP servers (1)? Pick how to hand them out.",
          "1 MCP server; each question shows its source, its tools and the roles it is recommended for."
        ],
        "header": "MCP",
        "options": [
          "Go one by one",
          "Whole group"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role not given the server cannot use it."
        ],
        "header": "MCP",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get codex skills (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role given these skills can run them in its session; a role not given them cannot."
        ],
        "header": "Skills",
        "options": [
          "Go one by one",
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.",
          "Found: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 0 rule files, AGENTS.md no, 1 memory. No keeps the whole-file questions."
        ],
        "header": "Instructions",
        "options": [
          "No, skip it",
          "Yes, read them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)",
          "Roles: pm, tl, security. Every role carries the same names; values are filled in at launch."
        ],
        "header": "Env",
        "options": [
          "None",
          "All of them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: mode"
        ],
        "header": "Hunk 1 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: workflow.text_mode"
        ],
        "header": "Hunk 2 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: hooks.context_warnings"
        ],
        "header": "Hunk 3 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Git policy for .cadre/?",
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed."
        ],
        "header": "Git policy",
        "options": [
          "Commit definitions (default)",
          "Commit all",
          "Ignore all of .cadre/"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Where should the role launchers start their sessions? (asked once for this repo)",
          "The launcher of each role (pm, tl, security) starts its session there."
        ],
        "header": "Launch",
        "options": [
          "Git root of this repo",
          "The folder I run it from",
          "Another folder in this repo"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      }
    ],
    "logged": [
      "No session history for this repo.",
      "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
    ],
    "shown": [
      {
        "key": "notes",
        "title": "Notes",
        "lines": [
          "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
        ]
      }
    ],
    "promptHashes": [
      "73ed8a25af823e7774847203e3339bade6da6f7cdfe71913f7258a90cfca6f63",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "a5452cf1b1e18f52222fc72b9effa70502e0bed5559e357ade2dd50ed907c30c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c"
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
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
      "  hunk      .planning/config.json  hooks.context_warnings: not set (GSD default) -> false  (optional, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set hooks.context_warnings false",
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted)",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "env": {
    "asks": [
      {
        "question": [
          "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "header": "claude.json",
        "options": [
          "No, skip it",
          "Yes, read names only"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Use these roles?",
          "Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan."
        ],
        "header": "Roles",
        "options": [
          "Use these roles",
          "Adjust them",
          "Describe my own structure"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which framework do the roles use? (asked because more than one framework is in use)",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Framework for all roles?",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "GSD",
          "superpowers",
          "none (built-in)"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.",
          "Nothing is installed before you confirm the final review, and a --dry-run installs nothing."
        ],
        "header": "Security",
        "options": [
          "Install",
          "Not now"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Autopilot duration for roles?",
          "Applies to every role: pm, tl, security."
        ],
        "header": "Duration",
        "options": [
          "4h",
          "2h",
          "8h"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort: same for all roles, or per role?",
          "Roles: pm, tl, security."
        ],
        "header": "Model",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort for all roles?",
          "Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max."
        ],
        "header": "Model",
        "options": [
          "opus + medium",
          "sonnet + medium",
          "sonnet + high"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the MCP servers (1)? Pick how to hand them out.",
          "1 MCP server; each question shows its source, its tools and the roles it is recommended for."
        ],
        "header": "MCP",
        "options": [
          "Go one by one",
          "Whole group"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role not given the server cannot use it."
        ],
        "header": "MCP",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get codex skills (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role given these skills can run them in its session; a role not given them cannot."
        ],
        "header": "Skills",
        "options": [
          "Go one by one",
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.",
          "Found: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 0 rule files, AGENTS.md no, 1 memory. No keeps the whole-file questions."
        ],
        "header": "Instructions",
        "options": [
          "No, skip it",
          "Yes, read them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)",
          "Roles: pm, tl, security. Every role carries the same names; values are filled in at launch."
        ],
        "header": "Env",
        "options": [
          "None",
          "All of them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: mode"
        ],
        "header": "Hunk 1 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: workflow.text_mode"
        ],
        "header": "Hunk 2 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: hooks.context_warnings"
        ],
        "header": "Hunk 3 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Git policy for .cadre/?",
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed."
        ],
        "header": "Git policy",
        "options": [
          "Commit definitions (default)",
          "Commit all",
          "Ignore all of .cadre/"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Where should the role launchers start their sessions? (asked once for this repo)",
          "The launcher of each role (pm, tl, security) starts its session there."
        ],
        "header": "Launch",
        "options": [
          "Git root of this repo",
          "The folder I run it from",
          "Another folder in this repo"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)",
          "Roles: pm, tl, security. Every role carries the same names; values are filled in at launch."
        ],
        "header": "Env",
        "options": [
          "None",
          "All of them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      }
    ],
    "logged": [
      "No session history for this repo.",
      "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
    ],
    "shown": [
      {
        "key": "notes",
        "title": "Notes",
        "lines": [
          "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
        ]
      }
    ],
    "promptHashes": [
      "73ed8a25af823e7774847203e3339bade6da6f7cdfe71913f7258a90cfca6f63",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "a5452cf1b1e18f52222fc72b9effa70502e0bed5559e357ade2dd50ed907c30c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c"
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
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
      "  hunk      .planning/config.json  hooks.context_warnings: not set (GSD default) -> false  (optional, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set hooks.context_warnings false",
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted)",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "hunks": {
    "asks": [
      {
        "question": [
          "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "header": "claude.json",
        "options": [
          "No, skip it",
          "Yes, read names only"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Use these roles?",
          "Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan."
        ],
        "header": "Roles",
        "options": [
          "Use these roles",
          "Adjust them",
          "Describe my own structure"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which framework do the roles use? (asked because more than one framework is in use)",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Framework for all roles?",
          "Roles: pm, tl, security."
        ],
        "header": "Framework",
        "options": [
          "GSD",
          "superpowers",
          "none (built-in)"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.",
          "Nothing is installed before you confirm the final review, and a --dry-run installs nothing."
        ],
        "header": "Security",
        "options": [
          "Install",
          "Not now"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Autopilot duration for roles?",
          "Applies to every role: pm, tl, security."
        ],
        "header": "Duration",
        "options": [
          "4h",
          "2h",
          "8h"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort: same for all roles, or per role?",
          "Roles: pm, tl, security."
        ],
        "header": "Model",
        "options": [
          "Same for all roles",
          "Per role"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Model and effort for all roles?",
          "Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max."
        ],
        "header": "Model",
        "options": [
          "opus + medium",
          "sonnet + medium",
          "sonnet + high"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the MCP servers (1)? Pick how to hand them out.",
          "1 MCP server; each question shows its source, its tools and the roles it is recommended for."
        ],
        "header": "MCP",
        "options": [
          "Go one by one",
          "Whole group"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role not given the server cannot use it."
        ],
        "header": "MCP",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get codex skills (1)? (e.g. BE, QA, or none)",
          "Roles: pm, tl, security. A role given these skills can run them in its session; a role not given them cannot."
        ],
        "header": "Skills",
        "options": [
          "Go one by one",
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? Nothing from your global files or memories is committed, and originals are never edited.",
          "Found: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 0 rule files, AGENTS.md no, 1 memory. No keeps the whole-file questions."
        ],
        "header": "Instructions",
        "options": [
          "No, skip it",
          "Yes, read them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)",
          "Roles: pm, tl, security. Their content is never shown or committed."
        ],
        "header": "Memory",
        "options": [
          "None",
          "All roles"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)",
          "Roles: pm, tl, security. Every role carries the same names; values are filled in at launch."
        ],
        "header": "Env",
        "options": [
          "None",
          "All of them"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: mode"
        ],
        "header": "Hunk 1 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: workflow.text_mode"
        ],
        "header": "Hunk 2 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: hooks.context_warnings"
        ],
        "header": "Hunk 3 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Git policy for .cadre/?",
          "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed."
        ],
        "header": "Git policy",
        "options": [
          "Commit definitions (default)",
          "Commit all",
          "Ignore all of .cadre/"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Where should the role launchers start their sessions? (asked once for this repo)",
          "The launcher of each role (pm, tl, security) starts its session there."
        ],
        "header": "Launch",
        "options": [
          "Git root of this repo",
          "The folder I run it from",
          "Another folder in this repo"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: mode"
        ],
        "header": "Hunk 1 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: workflow.text_mode"
        ],
        "header": "Hunk 2 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: hooks.context_warnings"
        ],
        "header": "Hunk 3 of 3",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
          "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
        ],
        "header": "Review",
        "options": [
          "Next page",
          "Confirm",
          "Change something…"
        ],
        "multiSelect": false
      }
    ],
    "logged": [
      "No session history for this repo.",
      "attended: GSD needs a person until mode and workflow.text_mode are set as proposed",
      "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
    ],
    "shown": [
      {
        "key": "notes",
        "title": "Notes",
        "lines": [
          "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
        ]
      },
      {
        "key": "notes",
        "title": "Notes",
        "lines": [
          "attended: GSD needs a person until mode and workflow.text_mode are set as proposed"
        ]
      }
    ],
    "promptHashes": [
      "73ed8a25af823e7774847203e3339bade6da6f7cdfe71913f7258a90cfca6f63",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "b0ffcdc1549fb1f75a563b1cb102c2049200b5609496358160e4481165ff0f95",
      "a5452cf1b1e18f52222fc72b9effa70502e0bed5559e357ade2dd50ed907c30c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c",
      "11d63e0be53d8180ea3aa5348775dd81a9fce25081e868f42f313ad7e1ffa72c"
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
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
      "  hunk      .planning/config.json  hooks.context_warnings: not set (GSD default) -> false  (optional, accepted)",
      "            run: node .claude/gsd-core/bin/gsd-tools.cjs config-set hooks.context_warnings false",
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 3 hunks (3 accepted)",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  }
}
