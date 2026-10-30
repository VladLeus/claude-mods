/**
 * The engine-driven golden of `/cadre init --dry-run` on the TUI default (D-208, D-219): the terminal main screen, as
 * the engine stamps it (`isFullscreen` false), in a session drawn on the terminal alone, where no side pane opens. Its
 * specs live in register.test.ts, the one test file that drives the real engine (plan-check B6), and run the world of
 * the D3/R1 specs with one skill of the user's own, so init also asks the model. Captured from that run (a temporary
 * log line in the spec) and pasted as printed. Data only: register.test.ts imports it.
 */

/** What the TUI-default dry run did: each pane it opened (none), each line it logged and its reply, split on '\n'. */
export const GOLDEN_TUI: {
  readonly opens: readonly string[]
  readonly logs: readonly string[]
  readonly reply: readonly string[]
} = {
  "opens": [],
  "logs": [
    "No session history for this repo."
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
