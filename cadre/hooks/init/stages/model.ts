/**
 * The model and effort stage of init (D-52, D-86, A4, D-136), a layer 10 module: the first model question, one answer
 * for every role or one per role (the answer modes, which the framework stage reads too), each model and effort
 * question with every family and effort on its second line, and modelStep, which asks them and gives each role a
 * family alias and an effort; and teamContextLine, the team's role ids as the context line of the framework, model,
 * assignment, memory and env questions. Pure: it asks through the InitIo port it is given, imports core, init/answers,
 * init/stages/duration, roles and ui/ask, and never imports init.ts, which imports it, or init/run.
 */
import type { InitIo, RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { EFFORTS, MODEL_ALIASES } from '../../roles/validate'
import { accepted, ASK_HEADERS, askChoice, choiceResult, quotedLabels, withContext } from '../../ui/ask'
import type { AskResult, StepResult } from '../../ui/ask'
import { MODEL_EFFORT_OPTIONS, modelEffortRefusal, parseModelEffort, PER_ROLE, SAME_FOR_ALL } from '../answers'
import { idsOf } from './duration'

/** The context line of the framework questions and of the first model question (D-136): the team's role ids. */
export function teamContextLine(roles: readonly RoleSpec[]): string {
  return `Roles: ${idsOf(roles)}.`
}

/** How the framework or the model question is answered: once for every role, or role by role (D-86). */
type AnswerMode = 'same' | 'each'

/** The answers to the first framework or model question, `Same for all roles` first (D-86). */
const ANSWER_MODES: readonly Labelled<AnswerMode>[] = Object.freeze([
  { label: SAME_FOR_ALL, value: 'same' },
  { label: PER_ROLE, value: 'each' },
])

/** The buttons of the first framework or model question. */
export const ANSWER_MODE_OPTIONS: readonly string[] = Object.freeze(ANSWER_MODES.map(entry => entry.label))

/** The answer to the first framework or model question, or null when it names neither, so it is asked again. */
export function parseAnswerMode(answer: string): AnswerMode | null {
  return labelled(ANSWER_MODES, answer)
}

/** The first model question: one answer for every role or one per role, `Same for all roles` first (D-52, D-86). */
export const MODEL_MODE_QUESTION = 'Model and effort: same for all roles, or per role?'

/** The one model question after `Same for all roles` (D-86). */
const MODEL_ALL_QUESTION = 'Model and effort for all roles?'

/** The context line of each model and effort question (D-136): every model family and effort a role may use. */
export const MODEL_EFFORT_CONTEXT = `Models: ${MODEL_ALIASES.join(', ')}; efforts: ${EFFORTS.join(', ')}.`

/**
 * The model question for one role after `Per role` (D-52): its title and its id, since the id tells apart roles with
 * the same title (A6).
 */
function modelRoleQuestion(role: Pick<RoleSpec, 'id' | 'title'>): string {
  return `Model and effort for ${role.title} (${role.id})?`
}

/** Why init cancels when a model and effort question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
export const MODEL_DISMISSED_REASON = 'A model and effort question was dismissed or not answered.'

/** The role with its model family alias and its effort set. */
function withModel(role: RoleSpec, choice: Pick<RoleSpec, 'model' | 'effort'>): RoleSpec {
  return { ...role, model: choice.model, effort: choice.effort }
}

/**
 * Asks one model and effort question at most MAX_ASKS times (D-52, A4, D-136), with MODEL_EFFORT_CONTEXT on the line
 * after the question: askChoice with modelEffortRefusal, cleaned as a report cell, as its refusal. A dismissal gives
 * `dismissed` at once and an answer parseModelEffort reads is the choice; after MAX_ASKS refused answers it gives
 * `exhausted`, so a cap is never a choice (A1).
 */
async function askModelEffort(io: InitIo, question: string): Promise<AskResult<Pick<RoleSpec, 'model' | 'effort'>>> {
  return askChoice(io, {
    question: withContext(question, MODEL_EFFORT_CONTEXT),
    spec: { options: MODEL_EFFORT_OPTIONS, header: ASK_HEADERS.model },
    parse: parseModelEffort,
    accepts: quotedLabels(MODEL_EFFORT_OPTIONS),
    refuse: answer => reportText(modelEffortRefusal(answer)),
  })
}

/**
 * The model and effort step (D-52, D-86): `Same for all roles` or `Per role`, then `opus + medium`, `sonnet + medium`
 * or `sonnet + high`, or a pair typed under "Other", once for every role or for each role in role order. The first
 * question carries the team's role ids (teamContextLine) and each model question MODEL_EFFORT_CONTEXT on its second
 * line (D-136). Each role stores opus, sonnet, haiku or fable, never a pinned model id, and an effort
 * (parseModelEffort, A4); a typed pair it cannot read puts modelEffortRefusal on top of the next ask (askModelEffort).
 * Only an answer to every question gives roles: a dismissal gives the cancel reason MODEL_DISMISSED_REASON, and
 * MAX_ASKS answers it cannot read at one question NO_USABLE_ANSWER_REASON, so no role keeps a model the person did not
 * finish choosing (A1). The roles it is given never change.
 */
export async function modelStep(io: InitIo, roles: readonly RoleSpec[]): Promise<StepResult<readonly RoleSpec[]>> {
  const modeAsk = {
    question: withContext(MODEL_MODE_QUESTION, teamContextLine(roles)),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.model },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
  }
  const mode = choiceResult(await askChoice(io, modeAsk), MODEL_DISMISSED_REASON)
  if (mode.kind === 'cancelled') return mode
  if (mode.value === 'same') {
    const choice = choiceResult(await askModelEffort(io, MODEL_ALL_QUESTION), MODEL_DISMISSED_REASON)
    if (choice.kind === 'cancelled') return choice

    return accepted(roles.map(role => withModel(role, choice.value)))
  }

  const modelled: RoleSpec[] = []
  for (const role of roles) {
    const choice = choiceResult(await askModelEffort(io, modelRoleQuestion(role)), MODEL_DISMISSED_REASON)
    if (choice.kind === 'cancelled') return choice
    modelled.push(withModel(role, choice.value))
  }

  return accepted(modelled)
}
