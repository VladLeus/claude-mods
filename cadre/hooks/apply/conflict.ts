/**
 * The conflict questions, a layer 9 module: the Keep mine or Take new question init asks after Confirm for each file
 * the person edited outside cadre, its options, its answer parser and the conflicted paths of a plan (D-67, D-105).
 * It imports core, paths, the manifest path of plan/classify and the types, so init and the apply steps read it here.
 */
import type { Plan } from '../../types'
import { reportText } from '../core/text'
import { BESIDE_SUFFIX } from '../paths'
import { MANIFEST_PATH } from '../plan/classify'

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
