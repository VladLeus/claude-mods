/**
 * The excludes of an epic worktree, a layer 11 module: the main checkout's entries the mirror reads (untrackedEntries)
 * and the paths it copies (includedEntries), the text of the excludes file that hides cadre's links and each role's
 * `.runtime/` from git in the worktree (excludesText), and where the user's global excludes file is
 * (globalExcludesPath). It is pure and imports core and the types; the mirror run reads it.
 */
import type { HostRun } from '../../types'
import { sortedUnique } from '../core/text'
import { CONTRACTS } from '../locales/contracts'

/** The NUL-ended names of an ls-files run, without the trailing `/` git gives a folder; an empty name is dropped. */
function listedNames(stdout: string): string[] {
  return stdout
    .split('\0')
    .map(name => (name.endsWith('/') ? name.slice(0, -1) : name))
    .filter(name => name !== '')
}

/**
 * The entries of the main checkout that the epic worktree mirrors: the names of the LS_OTHERS_ARGV and LS_IGNORED_ARGV
 * runs (listedNames), once each and sorted.
 */
export function untrackedEntries(others: string, ignored: string): string[] {
  return sortedUnique([...listedNames(others), ...listedNames(ignored)])
}

/**
 * The paths of the main checkout that the epic worktree gets as copies, from the names of the INCLUDED_ARGV and
 * LS_IGNORED_ARGV runs: a named path at or below an ignored entry, and an ignored entry below a named path, once each
 * and sorted. A named path git does not ignore is dropped.
 */
export function includedEntries(included: string, ignored: string): string[] {
  const named = listedNames(included)
  const ignoredNames = listedNames(ignored)
  const isBelow = (path: string, folder: string) => path.startsWith(`${folder}/`)
  const kept = named.filter(name => ignoredNames.some(entry => name === entry || isBelow(name, entry)))
  const below = ignoredNames.filter(entry => named.some(name => isBelow(entry, name)))

  return sortedUnique([...kept, ...below])
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
 * The text of the worktree's excludes file: the user's global excludes text, ended with a newline when it is not empty
 * and has none, then EXCLUDES_HEADING, one excludesLine per hidden path (each link, and each copy of a git file or of
 * the sizing rubric), sorted and once each, and RUNTIME_EXCLUDE_LINE last. The leading `/` matches the link at the
 * worktree root only; an env file copy gets no line, as main ignores it already (D-172).
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
