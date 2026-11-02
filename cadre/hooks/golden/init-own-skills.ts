/**
 * The golden fixture of the user's own skills handed out by a model recommendation in `/cadre init --dry-run` (D-219,
 * ASKED #30): one dry run over ownSkillsWorld (worlds.ts) whose model recommends deploy-notes to security and tl,
 * answered OWN_ACCEPTED, so it pins the own-skills question, the recommendation block, the prompt and the reply.
 * Captured from the code by a scratch run and pasted as printed; init-own-skills.test.ts runs it again and compares with
 * toEqual. Only an approved behaviour-change commit may change the fixture. Only the golden modules import it.
 */
import type { GoldenRun } from './types'

/** The own-skills dry run by the answer its hand-out question got. */
export const GOLDEN_INIT_OWN_SKILLS: Readonly<Record<string, GoldenRun>> = {
  "accepted": {
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
          "How do you want to hand out your own skills (2)?",
          "2 skills with no plugin; the pane shows what each does and the roles it is recommended for."
        ],
        "header": "Skills",
        "options": [
          "Accept recommendations",
          "Go one by one",
          "Whole group"
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
      }
    ],
    "logged": [
      "No session history for this repo."
    ],
    "shown": [
      {
        "key": "scan",
        "title": "Scan",
        "lines": [
          "Repo scan (read-only):",
          "  stack: none; frontend: none; backend: none",
          "  tests: none; E2E: none",
          "  existing .cadre/: none",
          "User setup (names only):",
          "  plugins: 0",
          "  skills: 2; agents: 0; MCP servers: none",
          "  global ~/.claude/CLAUDE.md: no; memories: 0; CLAUDE.md files: none",
          "warning: could not list the repo root (treated as unknown)"
        ]
      },
      {
        "key": "roles",
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
        ]
      },
      {
        "key": "recommendations",
        "title": "Recommendations",
        "lines": [
          "Recommendations (print-only; init asks before it installs any):",
          "- GSD for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop",
          "    run: npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global",
          "- superpowers for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop",
          "    run: claude plugin install superpowers@claude-plugins-official",
          "- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)",
          "    run: claude plugin install claude-security@claude-plugins-official",
          "- security-guidance for Security: no hooks warn the Security role about risky edits",
          "    run: claude plugin install security-guidance@claude-plugins-official"
        ]
      },
      {
        "key": "skills",
        "title": "Your own skills",
        "lines": [
          "Skills with no plugin (a role given a skill can run it in its session; a role not given it cannot):",
          "  deploy-notes: Write the release notes for a deploy.",
          "    recommended: tl, security",
          "  my-skill: No description.",
          "    recommended: none"
        ]
      },
      {
        "key": "review",
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
          "  not given skills: deploy-notes, my-skill",
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
          "  skills: deploy-notes",
          "  MCP servers: none",
          "  not given skills: my-skill",
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
          "  skills: deploy-notes",
          "  MCP servers: none",
          "  not given skills: my-skill",
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
          "warning: could not list the repo root (treated as unknown)",
          "Recommendations (print-only; init asks before it installs any):",
          "- GSD for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop",
          "    run: npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global",
          "- superpowers for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop",
          "    run: claude plugin install superpowers@claude-plugins-official",
          "- claude-security for Security: claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)",
          "    run: claude plugin install claude-security@claude-plugins-official",
          "- security-guidance for Security: no hooks warn the Security role about risky edits",
          "    run: claude plugin install security-guidance@claude-plugins-official"
        ]
      }
    ],
    "promptHashes": [
      "a069abe0cd128173fcc0a0cbe670363ea4216d7fe1a6eb8b5b150556c721a6db"
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
