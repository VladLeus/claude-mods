/**
 * The excludes of an epic worktree (D-147, D-172), a layer 11 module: the main checkout's entries the mirror reads
 * (untrackedEntries), the text of the excludes file that hides cadre's links and each role's `.runtime/` from git in
 * the worktree (excludesText), and where the user's global excludes file is (globalExcludesPath). It is pure and
 * imports core and the types; the mirror run reads it.
 */
import type { HostRun } from '../../types'
import { sortedUnique } from '../core/text'
import { CONTRACTS } from '../locales/contracts'

/**
 * The entries of the main checkout that the epic worktree mirrors (D-147): the NUL-ended names of the LS_OTHERS_ARGV
 * and LS_IGNORED_ARGV runs, each without the trailing `/` git gives a folder, once each and sorted (sortedUnique). An
 * empty name is dropped.
 */
export function untrackedEntries(others: string, ignored: string): string[] {
  const names = [...others.split('\0'), ...ignored.split('\0')]

  return sortedUnique(names.map(name => (name.endsWith('/') ? name.slice(0, -1) : name)).filter(name => name !== ''))
}

/** The file in the worktree's git dir that hides cadre's links from git (D-147), beside the epic record. */
export const EXCLUDES_FILE = 'cadre-links.exclude'

/**
 * The excludes line that hides each role's own `.runtime/` in the worktree (AUTO-PICK #25, RESEARCH Pitfall 5): the
 * mirror makes `.cadre/<id>/` a real folder there, so the files a render writes into it would show as untracked.
 */
export const RUNTIME_EXCLUDE_LINE = CONTRACTS.runtimeExcludeLine

/** The line that starts cadre's own lines in the excludes file. */
const EXCLUDES_HEADING = CONTRACTS.excludesHeading

/**
 * The excludes line of a link (03.1-W2 S2): `/` then the path with gitignore's special characters `\`, `*`, `?` and
 * `[` escaped by a backslash, and each trailing space written `\ `, so the line matches the link's own name and
 * nothing else.
 */
function excludesLine(path: string): string {
  const escaped = path.replace(/[\\*?[]/g, char => `\\${char}`).replace(/ +$/, spaces => spaces.replace(/ /g, '\\ '))

  return `/${escaped}`
}

/**
 * The text of the worktree's excludes file (D-147): the user's global excludes text, ended with a newline when it is
 * not empty and has none, then EXCLUDES_HEADING, one excludesLine per hidden path (each link, and each copy of a
 * GIT_FILE_NAMES file, 03.1 S1), sorted and once each, and RUNTIME_EXCLUDE_LINE last. The leading `/` matches the link
 * at the worktree root only; an env file copy gets no line, as main ignores it already (D-172).
 */
export function excludesText(globalText: string, links: readonly string[]): string {
  const head = globalText === '' || globalText.endsWith('\n') ? globalText : `${globalText}\n`
  const lines = [EXCLUDES_HEADING, ...sortedUnique(links).map(excludesLine), RUNTIME_EXCLUDE_LINE]

  return `${head}${lines.join('\n')}\n`
}

/** The trimmed first line of a run that exited 0, when it is an absolute path; null for anything else. */
function absoluteOutput(run: HostRun | null): string | null {
  if (run === null || run.exitCode !== 0) return null
  const line = (run.stdout.split('\n')[0] ?? '').trim()

  return line.startsWith('/') ? line : null
}

/**
 * The path of the user's global excludes file, as git finds it (D-147): what the GLOBAL_EXCLUDES_ARGV run names, else
 * `<XDG_CONFIG_HOME>/git/ignore` from the XDG_ARGV run, else `<home>/.config/git/ignore`; null with no home. A run's
 * output counts only when it exited 0 and its trimmed first line is an absolute path.
 */
export function globalExcludesPath(config: HostRun | null, xdg: HostRun | null, home: string | null): string | null {
  const configured = absoluteOutput(config)
  if (configured !== null) return configured
  const xdgHome = absoluteOutput(xdg)
  if (xdgHome !== null) return `${xdgHome}/git/ignore`
  if (home === null) return null

  return `${home}/.config/git/ignore`
}
