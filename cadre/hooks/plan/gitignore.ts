/**
 * The cadre block of the root .gitignore, a layer 5 module: its on-disk markers, the lines each git policy ignores,
 * the block merged into the file's text, and the warning when the block has no end marker (PLAN-03, D-64, D-90, D-99,
 * decision #39). It imports paths and the types, so the file plan and init read the block here.
 */
import type { GitPolicy } from '../../types'
import { CONTRACTS } from '../locales/contracts'
import { RUNTIME_RENDERED } from '../paths'

/**
 * The begin marker of the cadre block in the root `.gitignore`. The marker strings are an on-disk contract: re-runs,
 * regen and a later uninstall find the block by them (D-64).
 */
export const IGNORE_BEGIN = CONTRACTS.ignoreBegin

/** The end marker of the cadre block in the root `.gitignore`; an on-disk contract like IGNORE_BEGIN (D-64). */
export const IGNORE_END = CONTRACTS.ignoreEnd

/** The scratch copies a conflict plans beside a user-edited file are for diffing and never go into git (D-99). */
const CADRE_NEW_LINE = '.cadre/**/*.cadre-new'

/**
 * The cadre block line for the security reports: claude-security writes a CLAUDE-SECURITY-<timestamp>/ report folder
 * into the repo, with findings that must not be committed by mistake (decision #39, T-03-43).
 */
export const SECURITY_REPORTS_LINE = 'CLAUDE-SECURITY-*/'

/** The lines that already ignore the `thoughts/` folder, where the handoffs live (D-64). */
const THOUGHTS_LINES: readonly string[] = ['thoughts/', '/thoughts', 'thoughts', '/thoughts/']

/** The lines of a text, each with its own line ending, so joining them gives the text back byte for byte. */
function linesOf(text: string): string[] {
  return text.split(/(?<=\n)/)
}

/** A line without its line ending, `\n` or `\r\n`, so a file with Windows line endings is read the same way. */
function lineText(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/**
 * Where the cadre block sits in the lines of a `.gitignore`: the index of the first begin marker line and of the first
 * end marker line after it. A marker that is not there is -1, so a begin marker with no end marker is { begin >= 0,
 * end: -1 }. A marker is a whole line.
 */
function blockMarkers(lines: readonly string[]): { readonly begin: number; readonly end: number } {
  const begin = lines.findIndex(line => lineText(line) === IGNORE_BEGIN)
  if (begin === -1) return { begin, end: -1 }
  const end = lines.findIndex((line, index) => index > begin && lineText(line) === IGNORE_END)

  return { begin, end }
}

/**
 * The lines the cadre block holds for a git policy, without the thoughts/ line (D-64, D-90, D-99). `definitions`
 * ignores every `.runtime` folder wholesale, `all` ignores only the per-user rendered files in them, and `ignore`
 * ignores all of `.cadre/`. The first two also ignore the `.cadre-new` scratch copies. Each call gives a new array.
 */
export function ignoreLines(policy: GitPolicy): string[] {
  if (policy === 'ignore') return ['.cadre/']
  if (policy === 'all') return [...RUNTIME_RENDERED.map(name => `.cadre/*/.runtime/${name}`), CADRE_NEW_LINE]

  return ['.cadre/*/.runtime/', CADRE_NEW_LINE]
}

/**
 * Whether the `.gitignore` text already ignores `thoughts/` on a line of its own, outside the cadre block: `thoughts/`,
 * `/thoughts`, `thoughts` or `/thoughts/`. A line inside the block does not count, since the block is rewritten. Only
 * this file is read, so a nested or a global ignore file is not consulted (best effort, PLAN-03). With a block that
 * never ends, everything after its begin marker counts as inside it.
 */
export function hasThoughtsIgnore(text: string | null): boolean {
  if (text === null) return false
  const lines = linesOf(text)
  const { begin, end } = blockMarkers(lines)
  const outside = begin === -1 ? lines : [...lines.slice(0, begin), ...(end === -1 ? [] : lines.slice(end + 1))]

  return outside.some(line => THOUGHTS_LINES.includes(lineText(line)))
}

/**
 * The lines of the cadre block for a policy and the current `.gitignore` text: `thoughts/` first, unless
 * hasThoughtsIgnore finds it already ignored outside the block, then the policy's lines (PLAN-03, D-64, D-90), and
 * SECURITY_REPORTS_LINE last when the team has a role that stands for Security (`hasSecurityRole`, decision #39).
 */
export function gitignoreLines(
  policy: GitPolicy,
  existing: string | null,
  hasSecurityRole: boolean = false,
): string[] {
  const reports = hasSecurityRole ? [SECURITY_REPORTS_LINE] : []
  if (hasThoughtsIgnore(existing)) return [...ignoreLines(policy), ...reports]

  return ['thoughts/', ...ignoreLines(policy), ...reports]
}

/**
 * The `.gitignore` text with the cadre block set to `lines`: the text between the begin and the end marker is replaced,
 * or the block is appended when there is none (a missing file gives the block alone). No line outside the block is
 * touched, byte for byte, and a marker that ends in a carriage return is still found. A begin marker with no end marker
 * after it is a block cadre cannot tell the extent of, so the result is null and the caller asks for a fix by hand
 * (D-64). The lines are plain ignore patterns and the block is always written with `\n`.
 */
export function mergeIgnoreBlock(existing: string | null, lines: readonly string[]): string | null {
  const block = [IGNORE_BEGIN, ...lines, IGNORE_END].map(line => `${line}\n`).join('')
  if (existing === null) return block
  const old = linesOf(existing)
  const { begin, end } = blockMarkers(old)
  if (begin === -1) return `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${block}`
  if (end === -1) return null

  return `${old.slice(0, begin).join('')}${block}${old.slice(end + 1).join('')}`
}

/** The warning when the cadre block in the `.gitignore` has a begin marker and no end marker. */
export const OPEN_BLOCK_WARNING =
  'the cadre block in .gitignore has no end marker: fix it by hand; the ignore block is not planned'
