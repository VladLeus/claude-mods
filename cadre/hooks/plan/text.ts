/**
 * The plan as text, a layer 5 module: the file plan as the lines init prints, one row per op with its note and detail
 * rows under it, then any warnings and the summary line that counts each kind and the hunks (PLAN-01, PLAN-03,
 * D-136). Every value from outside is cleaned as a report cell. It imports core and the types, so init prints the plan
 * here.
 */
import type { FileOp, FileOpKind, HunkOp, Plan } from '../../types'
import { pad, reportText } from '../core/text'

/** Code points the kind column of the plan table takes; a hunk row uses the same column. */
const KIND_WIDTH = 10

/** The indent of a line that belongs to the row above it, so the text lines up under the path. */
const DETAIL_INDENT = ' '.repeat(2 + KIND_WIDTH)

/**
 * The rows of one file op: the kind and path, `(executable)` for a launcher, the note under the path, then one row per
 * detail line (the `.gitignore` block, PLAN-03), each indented like the note and cleaned as a report cell.
 */
function fileRows(op: FileOp): string[] {
  const flag = op.mode === 'exec' ? ' (executable)' : ''
  const rows = [`  ${pad(op.kind, KIND_WIDTH)}${reportText(op.path)}${flag}`]
  const note = op.note === null ? '' : reportText(op.note)
  if (note !== '') rows.push(`${DETAIL_INDENT}${note}`)
  const detail = op.detail ?? []

  return [...rows, ...detail.map(line => `${DETAIL_INDENT}${reportText(line)}`)]
}

/** The rows of one hunk: the file, the key before and after with its flags, and the command under it. */
function hunkRows(op: HunkOp): string[] {
  const change = `${reportText(op.key)}: ${reportText(op.before)} -> ${reportText(op.after)}`
  const flags = `${op.isRequired ? 'required' : 'optional'}, ${op.isAccepted ? 'accepted' : 'declined'}`

  return [
    `  ${pad('hunk', KIND_WIDTH)}${reportText(op.file)}  ${change}  (${flags})`,
    `${DETAIL_INDENT}run: ${reportText(op.command)}`,
  ]
}

/**
 * The summary line of a plan (PLAN-01, D-136): `Summary: `, how many file ops of each kind it holds, then its hunks
 * with how many were accepted. renderPlan ends with it, and the review question carries it in its context line.
 */
export function planSummary(plan: Plan): string {
  const counts: Record<FileOpKind, number> = { create: 0, change: 0, leave: 0, conflict: 0 }
  let hunks = 0
  let accepted = 0
  for (const op of plan.ops) {
    if (op.kind === 'hunk') {
      hunks += 1
      accepted += op.isAccepted ? 1 : 0
      continue
    }
    counts[op.kind] += 1
  }
  const hunkCount = hunks === 0 ? '0 hunks' : `${hunks} hunks (${accepted} accepted)`
  const kinds = `${counts.create} create, ${counts.change} change, ${counts.leave} leave, ${counts.conflict} conflict`

  return `Summary: ${kinds}, ${hunkCount}`
}

/**
 * The plan as the lines init prints (PLAN-01): `File plan:`, one row per op in plan order with the kind padded to a
 * column and its note and detail rows under it (the `.gitignore` block, PLAN-03), any warnings, and last its summary
 * (planSummary), which counts each kind and the hunks with their accepted ones. Every value that comes from outside is
 * cleaned and capped as reportText does, so a hostile path or note cannot add a line.
 */
export function renderPlan(plan: Plan): string[] {
  const rows = plan.ops.flatMap(op => (op.kind === 'hunk' ? hunkRows(op) : fileRows(op)))
  const warnings = plan.warnings.map(warning => `warning: ${reportText(warning)}`)

  return ['File plan:', ...rows, ...warnings, planSummary(plan)]
}
