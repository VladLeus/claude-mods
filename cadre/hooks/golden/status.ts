/**
 * The golden fixtures of `/cadre status` (D-219): one run per state the status specs cover, keyed by the StatusState
 * it reports (done, running, not started, stopped, unknown), each in the s9 world of `status states (D-111)`, where the
 * title search finds the session s9. Captured from the code by a scratch run and pasted as printed; status.test.ts in
 * this folder runs each again and compares with toEqual. Only an approved behaviour-change commit may change a fixture.
 * Only the golden modules import it.
 */
import type { GoldenCommand } from './types'

/** Each status run by the state it reports. */
export const GOLDEN_STATUS: Readonly<Record<string, GoldenCommand>> = {
  "done": {
    "reply": [
      "cadre status be",
      "state: done",
      "session: s9 (found by its name cadre-be)",
      "autopilot: finished (done): handed back to the person",
      "latest handoff: none yet",
      "DONE.md: not written yet"
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "/usr/bin/grep -E ^\\{\"type\":\"custom-title\" -- /home/u/.claude/projects/-repo/s9.jsonl @ -"
    ]
  },
  "running": {
    "reply": [
      "cadre status be",
      "state: running",
      "session: s9 (found by its name cadre-be)",
      "autopilot: finished (done): handed back to the person",
      "latest handoff: none yet",
      "DONE.md: not written yet"
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "/usr/bin/grep -E ^\\{\"type\":\"custom-title\" -- /home/u/.claude/projects/-repo/s9.jsonl @ -"
    ]
  },
  "not started": {
    "reply": [
      "cadre status be",
      "state: not started",
      "session: s9 (found by its name cadre-be)",
      "autopilot: no log line",
      "latest handoff: none yet",
      "DONE.md: not written yet"
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "/usr/bin/grep -E ^\\{\"type\":\"custom-title\" -- /home/u/.claude/projects/-repo/s9.jsonl @ -"
    ]
  },
  "stopped": {
    "reply": [
      "cadre status be",
      "state: stopped",
      "session: s9 (found by its name cadre-be)",
      "autopilot: finished (time): handed back to the person",
      "latest handoff: none yet",
      "DONE.md: not written yet"
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "/usr/bin/grep -E ^\\{\"type\":\"custom-title\" -- /home/u/.claude/projects/-repo/s9.jsonl @ -"
    ]
  },
  "unknown": {
    "reply": [
      "cadre status be",
      "state: unknown",
      "session: s9 (found by its name cadre-be)",
      "autopilot: finished (done): handed back to the person",
      "latest handoff: none yet",
      "DONE.md: not written yet"
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "/usr/bin/grep -E ^\\{\"type\":\"custom-title\" -- /home/u/.claude/projects/-repo/s9.jsonl @ -"
    ]
  }
}
