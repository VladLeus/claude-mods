/**
 * The golden fixtures of every `/cadre init` refusal (D-219): one run per refusal of the init guard, in the worlds the
 * initGuard specs use, and the cancel after three unusable answers to the first question. Captured from the code by a
 * scratch run and pasted as printed; init-refusals.test.ts runs each again and compares with toEqual. Only an approved
 * behaviour-change commit may change a fixture. Only the golden modules import it.
 */
import type { GoldenRun } from './types'

/** Each refused or cancelled run by what init refused. */
export const GOLDEN_INIT_REFUSALS: Readonly<Record<string, GoldenRun>> = {
  "notInteractive": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init needs an interactive session to ask its questions. Run /cadre init in a terminal session, not with claude -p."
    ]
  },
  "rootUnknown": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init could not read the session root, so it stopped before reading anything."
    ]
  },
  "homeFolder": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init needs a repo root other than your home folder. Open the session in a repo and run /cadre init again."
    ]
  },
  "fileSystemRoot": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init needs a repo root other than the file system root (/). Open the session in a repo and run /cadre init again."
    ]
  },
  "noGitRepo": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init needs a git repo: run git init first"
    ]
  },
  "belowGitTop": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "run /cadre init from the repo root: /repo"
    ]
  },
  "autopilotActive": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init does not run inside an active autopilot run in this session. Stop it with /autopilot stop, or run /cadre init in another session."
    ]
  },
  "autopilotUnknown": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre init can't tell whether autopilot is running in this session (its status file could not be read), so it stopped."
    ]
  },
  "unusableAnswers": {
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
          "'maybe' isn't one of: \"No, skip it\", \"Yes, read names only\".",
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
          "'maybe' isn't one of: \"No, skip it\", \"Yes, read names only\".",
          "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
          "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
        ],
        "header": "claude.json",
        "options": [
          "No, skip it",
          "Yes, read names only"
        ],
        "multiSelect": false
      }
    ],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "init cancelled, nothing written: No usable answer after 3 tries."
    ]
  }
}
