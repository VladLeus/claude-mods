/**
 * The legacy go-backs of the review (D-43, D-204, A3), a layer 10 module: goBack, which re-asks one review item whose
 * stage is not pure yet (LegacyGoBack, in init/state) and gives the draft with the new answer; and historyHints, the
 * history scan as hints for the skill questions. Pure: it asks through the InitIo port it is given, imports scan, ui,
 * init/draft, init/state and the init/stages steps, and never imports init/machine or init/run.
 */
import type { InitIo } from '../../types'
import type { HistoryScan } from '../scan/history'
import type { StepResult } from '../ui/ask'
import { mapped } from './draft'
import type { Draft } from './draft'
import type { LegacyGoBack } from './state'
import { assignmentStep } from './stages/assign'
import { instructionsAgain } from './stages/instructions'

/**
 * Goes back to one review item whose stage is not pure yet (D-43, LegacyGoBack) and gives the draft with the new
 * answer: it re-asks that item's step. The assignment and memory steps run again on the current roles and decide the
 * whole list they ask about (A3), so a narrower answer takes a name away; memory goes back to the instruction hand-out
 * it had (instructionsAgain). Every other item goes back as a stage transition instead (D-204). A cancelled step ends
 * the review with its reason (A1).
 */
export async function goBack(io: InitIo, draft: Draft, item: LegacyGoBack): Promise<StepResult<Draft>> {
  const { gathered, roles } = draft
  switch (item) {
    case 'assignments':
      return mapped(await assignmentStep(io, roles, gathered.setup, draft.hints), assigned => ({
        ...draft,
        roles: assigned,
      }))
    case 'memory':
      return mapped(await instructionsAgain(io, roles, gathered.setup, draft.instructions), (instructed): Draft => ({
        ...draft,
        ...instructed,
      }))
  }
}

/** The history scan as hints for the skill questions: each name with its count; none when the scan was skipped. */
export function historyHints(history: HistoryScan | 'skipped'): ReadonlyMap<string, number> {
  if (history === 'skipped') return new Map()

  return new Map(history.counts.map((entry): [string, number] => [entry.name, entry.count]))
}
