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
import { carryStep } from './stages/carry'
import { durationStep, withDuration } from './stages/duration'
import { hunkStep } from './stages/hunks'
import { instructionsAgain } from './stages/instructions'
import { modelStep } from './stages/model'

/**
 * Goes back to one review item whose stage is not pure yet (D-43, LegacyGoBack) and gives the draft with the new
 * answer: it re-asks that item's step. The duration, model, assignment, memory and env steps run again on the current
 * roles and decide the whole list they ask about (A3), so a narrower answer takes a name away; memory goes back to the
 * instruction hand-out it had (instructionsAgain). Change roles, the git policy and the launcher start go back as stage
 * transitions instead (D-204). A cancelled step ends the review with its reason (A1).
 */
export async function goBack(io: InitIo, draft: Draft, item: LegacyGoBack): Promise<StepResult<Draft>> {
  const { gathered, locations, roles } = draft
  switch (item) {
    case 'duration':
      return mapped(await durationStep(io, roles), duration => ({
        ...draft,
        duration,
        roles: withDuration(roles, duration),
      }))
    case 'model':
      return mapped(await modelStep(io, roles), modelled => ({ ...draft, roles: modelled }))
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
    case 'env':
      return mapped(await carryStep(io, roles, gathered.setup), carried => ({ ...draft, roles: carried }))
    case 'hunks': {
      const hunks = await hunkStep(io, { roles, repoDefault: draft.repoDefault, gathered, locations })

      return mapped(hunks, answered => ({ ...draft, hunks: answered }))
    }
  }
}

/** The history scan as hints for the skill questions: each name with its count; none when the scan was skipped. */
export function historyHints(history: HistoryScan | 'skipped'): ReadonlyMap<string, number> {
  if (history === 'skipped') return new Map()

  return new Map(history.counts.map((entry): [string, number] => [entry.name, entry.count]))
}
