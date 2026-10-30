/**
 * The conflict questions, a layer 9 module: the Keep mine or Take new question init asks after Confirm for each file
 * the person edited outside cadre, its options, its answer parser, its own context, the file's diff (D-236), and the
 * conflicted paths of a plan (D-67, D-105). It imports core, paths, the manifest path of plan/classify, the line diff
 * of ui/diff and the types, so init and the apply steps read it here.
 */
import type { AskContext, Plan } from '../../types'
import { redactSecrets } from '../core/redact'
import { countedNoun, reportText } from '../core/text'
import { BESIDE_SUFFIX } from '../paths'
import { MANIFEST_PATH } from '../plan/classify'
import { diffLines } from '../ui/diff'
import type { LineDiff } from '../ui/diff'

/** Which version of a conflicted file the person keeps: their own (Keep mine) or cadre's new one (Take new, D-67). */
export type ConflictChoice = 'mine' | 'new'

/**
 * The buttons of a conflict question, in this order: the dialog focuses the first option; the order is fixed (D-67). A
 * typed answer of the same words, or of `mine` or `new` alone, counts the same, in any case.
 */
export const CONFLICT_OPTIONS: readonly string[] = Object.freeze(['Keep mine', 'Take new'])

/**
 * The question init asks for one conflicted file after Confirm (D-105, D-67): the file was changed outside cadre, and
 * the person keeps their version or takes the new one, which then overwrites theirs. The path is cleaned and capped
 * as a report cell is.
 */
export function conflictQuestion(path: string): string {
  const shown = reportText(path)

  return `${shown} was changed outside cadre. Keep your version, or take the new one (yours is then overwritten)?`
}

/** The one line of a conflict question's context when the person's version could not be read (D-236). */
const UNREAD_CONFLICT_LINE = 'Your version could not be read, so no diff is shown.'

/**
 * The context of a conflict question (D-236): the file's diff from the person's version to cadre's new one, which Take
 * new writes: how many lines Take new adds and removes, then the changed lines (diffLines) with their secret-like spans
 * hidden (redactSecrets, E1; only the shown lines, never a text on disk); with no diff, because the person's version
 * could not be read, UNREAD_CONFLICT_LINE.
 */
export function conflictContext(path: string, diff: LineDiff | null): AskContext {
  const title = `Conflict: ${reportText(path)}`
  if (diff === null) return { title, lines: [UNREAD_CONFLICT_LINE], kind: 'conflict-diff' }
  const counts = `Take new: ${countedNoun(diff.added, 'line', 'lines')} added, ${diff.removed} removed`
  const changed = diffLines(diff).map(line => redactSecrets(line))

  return { title, lines: [counts, ...changed], kind: 'conflict-diff' }
}

/**
 * The answer to a conflict question: `mine` for Keep mine or mine, `new` for Take new or new, in any case and trimmed;
 * else null, so the question is asked again (D-67).
 */
export function parseConflictAnswer(answer: string): ConflictChoice | null {
  const wanted = answer.trim().toLowerCase()
  if (wanted === 'keep mine' || wanted === 'mine') return 'mine'
  if (wanted === 'take new' || wanted === 'new') return 'new'

  return null
}

/**
 * The files init asks Keep mine or Take new for, in plan order (D-67, D-105): every conflict file op except the
 * manifest, which is never written while it is a conflict (A6), and a `.cadre-new` copy, which only holds a new
 * version for diffing.
 */
export function conflictPaths(plan: Plan): string[] {
  const paths: string[] = []
  for (const op of plan.ops) {
    if (op.kind !== 'conflict' || op.path === MANIFEST_PATH || op.path.endsWith(BESIDE_SUFFIX)) continue
    paths.push(op.path)
  }

  return paths
}
