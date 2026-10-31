/**
 * The model and effort stage of init (D-52, D-86, A4, D-136, D-230), a layer 10 module: the first model question, one
 * answer for every role or one per role (the answer modes, which the framework stage reads too), each model and effort
 * question with every family and effort on its second line, and modelStage, the pure stage that asks them and gives
 * each role a family alias and an effort; and teamContextLine, the team's role ids as the context line of the
 * framework, model, assignment, memory and env questions. Pure: it gives states and never performs an effect, imports
 * core, init/answers, init/state, init/stages/duration, roles and ui/ask, and never imports init/machine or init/run.
 */
import type { RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { EFFORTS, MODEL_ALIASES } from '../../roles/validate'
import { ASK_HEADERS, choiceAnswer, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { rolesContext } from '../../ui/blocks/context'
import { MODEL_EFFORT_OPTIONS, modelEffortRefusal, parseModelEffort, PER_ROLE, SAME_FOR_ALL } from '../answers'
import { askedWithContext, stageCancelled, stageDone, stageFailed } from '../state'
import type { Answer, EachCursor, InitState, StageDef } from '../state'
import { idsOf } from './duration'

/** The context line of the framework questions and of the first model question (D-136): the team's role ids. */
export function teamContextLine(roles: readonly RoleSpec[]): string {
  return `Roles: ${idsOf(roles)}.`
}

/** How the framework or the model question is answered: once for every role, or role by role (D-86). */
export type AnswerMode = 'same' | 'each'

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

/** A model question as the stage asks it: a ChoiceAsk with the reason a dismissal cancels with. */
type ModelAsk<T> = ChoiceAsk<T> & { readonly dismissedReason: string }

/**
 * The first model question (D-52, D-86, D-136): MODEL_MODE_QUESTION with the team's role ids (teamContextLine) on its
 * second line, then `Same for all roles` or `Per role`.
 */
function modeAsk(roles: readonly RoleSpec[]): ModelAsk<AnswerMode> {
  return {
    question: withContext(MODEL_MODE_QUESTION, teamContextLine(roles)),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.model },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
    dismissedReason: MODEL_DISMISSED_REASON,
  }
}

/**
 * One model and effort question (D-52, A4, D-136), with MODEL_EFFORT_CONTEXT on the line after `question`: an answer
 * parseModelEffort reads is the choice, a typed pair included, so it takes a typed answer (D-234), and one it cannot
 * read puts modelEffortRefusal, cleaned as a report cell, on top of the next ask.
 */
function modelEffortAsk(question: string): ModelAsk<Pick<RoleSpec, 'model' | 'effort'>> {
  return {
    question: withContext(question, MODEL_EFFORT_CONTEXT),
    spec: { options: MODEL_EFFORT_OPTIONS, header: ASK_HEADERS.model, acceptsTyped: true },
    parse: parseModelEffort,
    accepts: quotedLabels(MODEL_EFFORT_OPTIONS),
    refuse: answer => reportText(modelEffortRefusal(answer)),
    dismissedReason: MODEL_DISMISSED_REASON,
  }
}

/** The state asking `ask` with the cursor `sub`; `question` is the ask's text after a refusal. */
function asked<T>(state: InitState, sub: InitState['sub'], ask: ModelAsk<T>, question: string | null): InitState {
  const { roles, changes } = state.draft
  if (roles === undefined) return stageFailed(state)

  return askedWithContext(state, sub, ask, question, rolesContext(roles, changes ?? []))
}

/** The stage done with the roles modelled. */
function modelledDone(state: InitState, roles: readonly RoleSpec[]): InitState {
  return stageDone({ ...state, draft: { ...state.draft, roles } })
}

/** The model question of the role at `index`, asked `tries` times so far, with the roles modelled before it. */
function roleAsked(state: InitState, roles: readonly RoleSpec[], cursor: EachCursor): InitState {
  const role = roles[cursor.index]
  if (role === undefined) return modelledDone(state, cursor.done)

  return asked(state, { kind: 'each', ...cursor }, modelEffortAsk(modelRoleQuestion(role)), null)
}

/**
 * The answer to the open model question (choiceAnswer): the first question goes on to the question for all roles or to
 * the question of each role in role order. An answer it cannot read is asked again with why on top; a dismissal
 * cancels with MODEL_DISMISSED_REASON and MAX_ASKS answers it cannot read at one question with
 * NO_USABLE_ANSWER_REASON, so no role keeps a model the person did not finish choosing (A1).
 */
function modelAnswer(state: InitState, answer: Answer): InitState {
  const { roles } = state.draft
  if (answer.kind !== 'answer' || roles === undefined) return stageFailed(state)
  const { sub } = state
  switch (sub.kind) {
    case 'mode': {
      const ask = modeAsk(roles)
      const next = choiceAnswer(ask, sub, answer.text)
      if (next.kind === 'again') return asked(state, { kind: 'mode', tries: next.sub.tries }, ask, next.question)
      if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
      if (next.value === 'each') return roleAsked(state, roles, { tries: 1, index: 0, done: [] })

      return asked(state, { kind: 'all', tries: 1 }, modelEffortAsk(MODEL_ALL_QUESTION), null)
    }
    case 'all': {
      const ask = modelEffortAsk(MODEL_ALL_QUESTION)
      const next = choiceAnswer(ask, sub, answer.text)
      if (next.kind === 'again') return asked(state, { kind: 'all', tries: next.sub.tries }, ask, next.question)
      if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

      return modelledDone(state, roles.map(role => withModel(role, next.value)))
    }
    case 'each': {
      const role = roles[sub.index]
      if (role === undefined) return stageFailed(state)
      const ask = modelEffortAsk(modelRoleQuestion(role))
      const next = choiceAnswer(ask, sub, answer.text)
      if (next.kind === 'again') return asked(state, { ...sub, tries: next.sub.tries }, ask, next.question)
      if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
      const done = [...sub.done, withModel(role, next.value)]

      return roleAsked(state, roles, { tries: 1, index: sub.index + 1, done })
    }
    default:
      return stageFailed(state)
  }
}

/**
 * The model and effort stage (D-52, D-86, D-230): `Same for all roles` or `Per role`, then `opus + medium`,
 * `sonnet + medium` or `sonnet + high`, or a pair typed under "Other", once for every role or for each role in role
 * order. The first question carries the team's role ids (teamContextLine) and each model question MODEL_EFFORT_CONTEXT
 * on its second line (D-136). Each role stores opus, sonnet, haiku or fable, never a pinned model id, and an effort
 * (parseModelEffort, A4); a typed pair it cannot read puts modelEffortRefusal on top of the next ask (modelEffortAsk).
 * Only an answer to every question gives roles (modelAnswer, A1).
 */
export const modelStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles } = state.draft
    if (roles === undefined) return stageFailed(state)

    return asked(state, { kind: 'mode', tries: 1 }, modeAsk(roles), null)
  },
  answer: modelAnswer,
})
