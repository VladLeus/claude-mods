/**
 * The claude check of /cadre start (D-107), a layer 10 module: the oldest claude cadre starts a role with
 * (MIN_CLAUDE_VERSION), the version a `claude --version` text gives by the launcher's own rule (parseClaudeVersion),
 * and claudeRefusal, which runs `claude --version` through the HostIo port and gives its refusal when claude cannot
 * run or gives an older or unreadable version, else null; /cadre epic runs the same check (D-165). It imports core and
 * the types; the start command and epic read it.
 */
import type { HostIo } from '../../types'
import { clean } from '../core/text'

/** The oldest claude cadre starts a role with (D-107): the engine floor the launcher's flags need. */
export const MIN_CLAUDE_VERSION: readonly [number, number, number] = [2, 1, 295]

/**
 * A line of `claude --version` that gives a version: it starts with three runs of digits joined by dots, whatever
 * follows, as the launcher's sed program reads it (cadre_claude_ok).
 */
const CLAUDE_VERSION_LINE = /^(\d+)\.(\d+)\.(\d+)/

/**
 * The version a `claude --version` text gives (D-107), by the launcher's rule (cadre_claude_ok): the three numbers at
 * the start of the one line that starts with a version; null when no line or more than one line does.
 */
export function parseClaudeVersion(text: string): readonly [number, number, number] | null {
  const found = text.split('\n').flatMap(line => {
    const match = CLAUDE_VERSION_LINE.exec(line)

    return match === null ? [] : [match]
  })
  if (found.length !== 1) return null
  const [, major, minor, patch] = found[0] ?? []
  if (major === undefined || minor === undefined || patch === undefined) return null

  return [Number(major), Number(minor), Number(patch)]
}

/** Whether a claude version is MIN_CLAUDE_VERSION or newer, compared part by part from the first (D-107). */
export function isSupportedClaude(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version
  const [minMajor, minMinor, minPatch] = MIN_CLAUDE_VERSION
  if (major !== minMajor) return major > minMajor
  if (minor !== minMinor) return minor > minMinor

  return patch >= minPatch
}

/** How long `claude --version` may run before it is given up. */
const CLAUDE_VERSION_TIMEOUT_MS = 10_000

/** The refusal when `claude --version` cannot run or exits non-zero (D-107). */
export const START_NO_CLAUDE =
  'cadre start could not run claude --version, so it stopped: install Claude Code 2.1.295 or newer.'

/** The most characters of what `claude --version` gave that a refusal shows. */
const VERSION_SHOWN_CHARS = 40

/**
 * The refusal when the claude on PATH is older than 2.1.295, or gives no version cadre can read (D-107). The text
 * `claude --version` gave is shown cleaned, as reportText cleans a foreign value, and capped at 40 characters.
 */
export function claudeTooOldReply(versionText: string): string {
  const shown = clean(versionText, VERSION_SHOWN_CHARS)

  return `cadre start needs claude 2.1.295 or newer on PATH; claude --version gave: ${shown}`
}

/**
 * Why the claude on PATH, the one the launcher execs (RESEARCH 1.2), must not start the role (D-107), or null:
 * `claude --version` that cannot run or exits non-zero (START_NO_CLAUDE); an output in which parseClaudeVersion reads
 * no version (no line, or more than one, starts with one), or one older than MIN_CLAUDE_VERSION (claudeTooOldReply,
 * with the first line of the output). It runs in the home folder when there is one, as every install run does
 * (T-03-46), so no repo-level settings take part in the one `claude` run of /cadre start (#72 B1). /cadre epic reuses
 * it before it creates anything (D-165).
 */
export async function claudeRefusal(host: HostIo, home: string | null): Promise<string | null> {
  const options = home === null ? {} : { cwd: home }
  const run = await host.run(['claude', '--version'], { ...options, timeoutMs: CLAUDE_VERSION_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) return START_NO_CLAUDE
  const version = parseClaudeVersion(run.stdout)
  if (version !== null && isSupportedClaude(version)) return null

  return claudeTooOldReply(run.stdout.split('\n')[0] ?? '')
}
