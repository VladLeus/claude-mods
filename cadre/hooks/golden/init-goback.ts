/**
 * The golden fixtures of the `/cadre init` review go-backs (D-219): one dry run over the `nothing` world per go-back,
 * the review answered first with a button (Change roles, Change git policy, Change launcher start) or a typed item
 * (duration, model, assignments, memory, env, hunks), then Confirm; every other question keeps its INIT_ANSWERS value.
 * Captured from the code by a scratch run and pasted as printed; init-goback.test.ts runs each again and compares with
 * toEqual. Only an approved behaviour-change commit may change a fixture. Only the golden modules import it.
 */
import type { GoldenRun } from './types'

/** Each go-back run by the review item it answers first. */
export const GOLDEN_INIT_GOBACK: Readonly<Record<string, GoldenRun>> = {
  "roles": {
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "policy": {
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "launch": {
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "duration": {
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
  "model": {
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
      "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
      "Launchers start in: the git root",
      "Private files per role (written after Confirm):",
      "    private files: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/tl/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "    private files: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md and instructions.json (outside the repo, never committed)",
      "Dry run: nothing was written."
    ]
  },
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
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
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
          "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
          "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
      "No session history for this repo."
    ],
    "shown": [],
    "promptHashes": [],
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
      "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
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
