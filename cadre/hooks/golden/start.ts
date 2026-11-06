/**
 * The golden fixtures of `/cadre start` (D-219): one run that renders the role be over the applied world of the
 * runStart specs, and one run per refusal in runStart's order (repo, team, launcher, claude), each world failing every
 * later check too, so the reply and the host runs pin the order. Captured from the code by a scratch run and pasted as
 * printed; start.test.ts in this folder runs each again and compares with toEqual. Only an approved behaviour-change
 * commit may change a fixture. Only the golden modules import it.
 */
import type { GoldenCommand } from './types'

/** Each start run by what it pins: the render, then each refusal in runStart's order. */
export const GOLDEN_START: Readonly<Record<string, GoldenCommand>> = {
  "render": {
    "reply": [
      "cadre start be",
      "Rendered .cadre/be/.runtime/ (1 link).",
      "warning: could not list the repo root (treated as unknown)",
      "warning: .cadre/bin/be is not the launcher this cadre writes today (written by an older cadre or for another setup): run /cadre regen be to update it",
      "warning: skill create-handoff-doc was not found in your user skills: not linked",
      "warning: skill resume-handoff-doc was not found in your user skills: not linked",
      "Run this in a terminal to start role be:",
      "  /repo/.cadre/bin/be",
      "Copied to the clipboard."
    ],
    "writes": [
      {
        "path": "/repo/.cadre/be/.runtime/settings.json",
        "sha256": "8b9afaf08c9c854fcc5368465a80b2e49dd5f7312019402fa6169723b4b781dd",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/.runtime/mcp.json",
        "sha256": "d8e397af03b5b032f21d0aa967086f0c78b33c87b76f2e9898ae0a144df7de02",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/.runtime/probe-expectations.json",
        "sha256": "d77ca02f4bb5851151e866fefd969dba402d886148ab453fd4373442dad16c99",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/.runtime/inbox.md",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/.runtime/stamp",
        "sha256": "66fd6f3ca295efcacea48fe6fbe88df117d8ff931fc92eb6fbb6d2f61495721c",
        "isWritten": true
      }
    ],
    "calls": [
      "claude --version @ /home/u",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo",
      "/bin/mkdir -p -- /repo/.cadre/be/.runtime @ -",
      "/bin/mkdir -p -- /repo/.cadre/be/.runtime/overlay @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/repo-6b4ca2db/be/instructions @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/be @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/be/instructions @ -",
      "/bin/ln -sfn /home/u/.claude/cadre/repo-6b4ca2db/be/instructions /repo/.cadre/be/.runtime/private-instructions @ -",
      "/usr/bin/pbcopy @ -"
    ]
  },
  "refusalRepo": {
    "reply": [
      "run /cadre start from the repo root: /repo"
    ],
    "writes": [],
    "calls": []
  },
  "refusalTeam": {
    "reply": [
      "cadre start needs .cadre/cadre.json from /cadre init: run /cadre init first."
    ],
    "writes": [],
    "calls": []
  },
  "refusalLauncher": {
    "reply": [
      ".cadre/bin/be is missing or not in .cadre/manifest.json: run /cadre regen be."
    ],
    "writes": [],
    "calls": []
  },
  "refusalClaude": {
    "reply": [
      "cadre start could not run claude --version, so it stopped: install Claude Code 2.1.295 or newer."
    ],
    "writes": [],
    "calls": [
      "claude --version @ /home/u"
    ]
  }
}
