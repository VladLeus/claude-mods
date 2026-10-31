/**
 * The line diff, a layer 8 module: the changed lines of two texts, kept by their longest common subsequence, and the
 * pane rows that show them, capped (G-02-1f, D-141). It imports core, so the improver block of apply reads it here.
 */
import { reportText } from '../core/text'
import { tn } from '../locales/t'

/** One changed line of a line diff (G-02-1f, D-141): a line only the new text has, or one only the old text had. */
export type DiffRow = {
  readonly kind: 'added' | 'removed'
  readonly line: string
}

/** A line diff (G-02-1f, D-141): its changed lines in text order, and how many lines were added and removed. */
export type LineDiff = {
  readonly rows: readonly DiffRow[]
  readonly added: number
  readonly removed: number
}

/**
 * The most cells the table of a line diff may hold, one per pair of lines compared (T-02-77): past it the differing
 * middle of two texts counts as removed, then added, so a huge text cannot stall the session.
 */
const MAX_DIFF_CELLS = 1_000_000

/** The diff that keeps no line: each old line as a removed row, then each new line as an added row. */
function replacedRows(old: readonly string[], now: readonly string[]): DiffRow[] {
  return [
    ...old.map((line): DiffRow => ({ kind: 'removed', line })),
    ...now.map((line): DiffRow => ({ kind: 'added', line })),
  ]
}

/**
 * The rows of the differing middle of two texts (lineDiff): the longest common subsequence over lines is kept and every
 * other line is a row, in text order, the removed lines of a change before its added ones. The table holds, for each
 * pair of positions, the length of the longest common subsequence of the lines from there on; past MAX_DIFF_CELLS cells
 * no table is made and every line is a row (replacedRows).
 */
function middleRows(old: readonly string[], now: readonly string[]): DiffRow[] {
  const width = now.length + 1
  if (old.length === 0 || now.length === 0 || (old.length + 1) * width > MAX_DIFF_CELLS) return replacedRows(old, now)
  const lengths = new Uint32Array((old.length + 1) * width)
  const at = (row: number, column: number): number => lengths[row * width + column] ?? 0
  for (let row = old.length - 1; row >= 0; row -= 1) {
    for (let column = now.length - 1; column >= 0; column -= 1) {
      const isSame = old[row] === now[column]
      lengths[row * width + column] = isSame
        ? at(row + 1, column + 1) + 1
        : Math.max(at(row + 1, column), at(row, column + 1))
    }
  }
  const rows: DiffRow[] = []
  let oldAt = 0
  let nowAt = 0
  while (oldAt < old.length || nowAt < now.length) {
    const removed = old[oldAt]
    const added = now[nowAt]
    if (removed !== undefined && removed === added) {
      oldAt += 1
      nowAt += 1
      continue
    }
    if (removed !== undefined && (added === undefined || at(oldAt + 1, nowAt) >= at(oldAt, nowAt + 1))) {
      rows.push({ kind: 'removed', line: removed })
      oldAt += 1
      continue
    }
    if (added !== undefined) rows.push({ kind: 'added', line: added })
    nowAt += 1
  }

  return rows
}

/**
 * The line diff of two texts (G-02-1f, D-141): each text is split at every `\n`, so two texts that differ always give
 * a row; the lines both texts start and end with are set aside, and over the lines between them the longest common
 * subsequence is kept (middleRows). Every other line is a row; equal texts give none.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const old = before.split('\n')
  const now = after.split('\n')
  let start = 0
  while (start < old.length && start < now.length && old[start] === now[start]) start += 1
  let oldEnd = old.length
  let nowEnd = now.length
  while (oldEnd > start && nowEnd > start && old[oldEnd - 1] === now[nowEnd - 1]) {
    oldEnd -= 1
    nowEnd -= 1
  }
  const rows = middleRows(old.slice(start, oldEnd), now.slice(start, nowEnd))
  const added = rows.filter(row => row.kind === 'added').length

  return { rows, added, removed: rows.length - added }
}

/** The most rows of one file's diff the improver block shows (G-02-1f, D-141). */
const MAX_DIFF_ROWS = 200

/**
 * The pane rows of a line diff (G-02-1f, D-141): `+ <line>` for an added line and `- <line>` for a removed one, in text
 * order, each line cleaned and capped as a report cell is (reportText); past MAX_DIFF_ROWS rows the first ones, then
 * `... <n> more changed lines`.
 */
export function diffLines(diff: LineDiff): string[] {
  const kept = diff.rows.slice(0, MAX_DIFF_ROWS)
  const lines = kept.map(row => `${row.kind === 'added' ? '+' : '-'} ${reportText(row.line)}`)
  const rest = diff.rows.length - kept.length
  if (rest === 0) return lines

  return [...lines, tn('ui.diff.more', rest, { count: rest })]
}
