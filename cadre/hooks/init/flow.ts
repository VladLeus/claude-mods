/**
 * The history hints of init (D-59), a layer 10 module: historyHints, the history scan as hints for the skill
 * questions. Pure: it imports scan types only, and never imports init/machine or init/run. The review's go-backs are
 * stage transitions now (D-204, D-230); 02.1-26 Task 2 moves historyHints to the stage that uses it and removes this
 * module.
 */
import type { HistoryScan } from '../scan/history'

/** The history scan as hints for the skill questions: each name with its count; none when the scan was skipped. */
export function historyHints(history: HistoryScan | 'skipped'): ReadonlyMap<string, number> {
  if (history === 'skipped') return new Map()

  return new Map(history.counts.map((entry): [string, number] => [entry.name, entry.count]))
}
