/**
 * The framework stage of init (DET-03, D-07, D-17, D-73, D-86, D-136, D-230), a layer 10 module: the framework labels
 * and questions, why each question is asked (frameworkReason), and frameworksStage, the pure stage that asks nothing
 * when exactly one framework is in use, else asks once for every role or per role, with the team's role ids on the
 * question's second line, and gives each role the framework it picked (withFramework). Pure: it gives states and never
 * performs an effect, imports core, detect, ui/ask, init/state and init/stages/model (the answer modes and
 * teamContextLine), and never imports init/machine or init/run.
 */
import type { Choice, FrameworkId, RoleSpec } from '../../../types'
import { SUPPORTED_IDS } from '../../core/framework-id'
import { redactedText } from '../../core/redact'
import { choiceLine } from '../../detect/report'
import { detectAll } from '../../framework/registry'
import { ASK_HEADERS, choiceAnswer, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { detectionContext } from '../../ui/blocks/context'
import { askedWithContext, stageCancelled, stageDone, stageFailed, withOutputs } from '../state'
import type { Answer, EachCursor, InitState, StageDef } from '../state'
import { ANSWER_MODE_OPTIONS, parseAnswerMode, teamContextLine } from './model'
import type { AnswerMode } from './model'

/** The framework names the framework questions show; none of them is marked as a default (D-07). */
export const FRAMEWORK_LABELS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'none (built-in)',
})

/** The start of DET-03's framework question; the reason it is asked follows in brackets (D-73). */
export const FRAMEWORK_QUESTION_PREFIX = 'Which framework do the roles use?'

/** The one follow-up question after `Same for all roles` (D-86). */
export const FRAMEWORK_ALL_QUESTION = 'Framework for all roles?'

/**
 * The framework question for one role after `Per role` (D-73): its title, its secret-like spans hidden (redactedText,
 * E1, #163), and its id, since the id tells apart roles with the same title (A6).
 */
export function frameworkRoleQuestion(role: Pick<RoleSpec, 'id' | 'title'>): string {
  return `Framework for ${redactedText(role.title)} (${role.id})?`
}

/**
 * Why init asks which framework the roles use (D-73): more than one framework is in use, or none is but some are
 * installed for the user (D-29). For a choice init asks nothing about, the text says what the choice found.
 */
export function frameworkReason(choice: Choice): string {
  switch (choice.kind) {
    case 'ambiguous':
      return 'more than one framework is in use'
    case 'installed-only':
      return 'none is in use here, but some are installed for you'
    case 'chosen':
      return choice.reason
    case 'unsupported':
      return 'only frameworks cadre does not support were found'
    case 'none':
      return 'no framework was found'
  }
}

/** The framework an answer names among `allowed`, by its label or its id, trimmed and in any case; else null. */
function parseFramework(answer: string, allowed: readonly FrameworkId[]): FrameworkId | null {
  const wanted = answer.trim().toLowerCase()

  return allowed.find(id => id === wanted || FRAMEWORK_LABELS[id].toLowerCase() === wanted) ?? null
}

/** The role with its framework set. */
function withFramework(role: RoleSpec, framework: FrameworkId): RoleSpec {
  return { ...role, framework }
}

/** Why init cancels when a framework question is dismissed or not answered (A1, D-45). */
export const FRAMEWORK_DISMISSED_REASON = 'A framework question was dismissed or not answered.'

/** Each framework as the refusal of a framework question names it: the word a person may type for it (D-136). */
const FRAMEWORK_WORDS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'none',
})

/** A choice the framework questions are asked for: more than one framework in use, or only installed ones (D-73). */
type AskedChoice = Extract<Choice, { readonly kind: 'ambiguous' | 'installed-only' }>

/** A framework question as the stage asks it: a ChoiceAsk with the reason a dismissal cancels with. */
type FrameworkAsk<T> = ChoiceAsk<T> & { readonly dismissedReason: string }

/**
 * DET-03's mode question (D-73, D-86): the reason it is asked, with the team's role ids (teamContextLine) on its second
 * line, then `Same for all roles` or `Per role`.
 */
function modeAsk(choice: AskedChoice, roles: readonly RoleSpec[]): FrameworkAsk<AnswerMode> {
  const question = `${FRAMEWORK_QUESTION_PREFIX} (asked because ${frameworkReason(choice)})`

  return {
    question: withContext(question, teamContextLine(roles)),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.framework },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
    dismissedReason: FRAMEWORK_DISMISSED_REASON,
  }
}

/**
 * A framework question (D-07, D-86, D-136): `question` with the team's role ids on its second line; the options are the
 * frameworks of the choice in SUPPORTED_IDS order, then `none (built-in)`, none marked as a default; a framework is
 * also taken typed by its id, so it takes a typed answer (D-234, ASKED #141); an answer that names no offered framework
 * is asked again with the words of the offered frameworks and that a role runs one.
 */
function frameworkAsk(choice: AskedChoice, question: string, roles: readonly RoleSpec[]): FrameworkAsk<FrameworkId> {
  const allowed: readonly FrameworkId[] = [...SUPPORTED_IDS.filter(id => choice.ids.includes(id)), 'none']

  return {
    question: withContext(question, teamContextLine(roles)),
    spec: { options: allowed.map(id => FRAMEWORK_LABELS[id]), header: ASK_HEADERS.framework, acceptsTyped: true },
    parse: (answer: string): FrameworkId | null => parseFramework(answer, allowed),
    accepts: `${allowed.map(id => FRAMEWORK_WORDS[id]).join(', ')} - a role runs one framework`,
    dismissedReason: FRAMEWORK_DISMISSED_REASON,
  }
}

/**
 * The state asking `ask` with the cursor `sub`, the detection evidence of the scan as the question's own context
 * (detectionContext, D-236); `question` is the ask's text after a refusal.
 */
function asked<T>(state: InitState, sub: InitState['sub'], ask: FrameworkAsk<T>, question: string | null): InitState {
  const { gathered } = state.draft
  if (gathered === undefined) return stageFailed(state)

  return askedWithContext(state, sub, ask, question, detectionContext(detectAll(gathered.facts.facts)))
}

/** The stage done with the roles framed and the repo default. */
function framedDone(state: InitState, roles: readonly RoleSpec[], repoDefault: FrameworkId | null): InitState {
  return stageDone({ ...state, draft: { ...state.draft, roles, repoDefault } })
}

/** The framework question of the role at `index`, asked `tries` times so far, with the roles framed before it. */
function roleAsked(state: InitState, choice: AskedChoice, roles: readonly RoleSpec[], cursor: EachCursor): InitState {
  const role = roles[cursor.index]
  if (role === undefined) return framedDone(state, cursor.done, null)

  return asked(state, { kind: 'each', ...cursor }, frameworkAsk(choice, frameworkRoleQuestion(role), roles), null)
}

/**
 * The answer to the open framework question (choiceAnswer): the mode question goes on to the question for all roles
 * or to the question of each role in role order; every role stores the framework it was given and there is no repo
 * default. An answer that is not offered is asked again with why on top; a dismissal cancels with
 * FRAMEWORK_DISMISSED_REASON and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON, never a choice (A1).
 */
function frameworkAnswer(state: InitState, answer: Answer): InitState {
  const { choice, roles } = state.draft
  if (answer.kind !== 'answer' || roles === undefined || choice === undefined) return stageFailed(state)
  if (choice.kind !== 'ambiguous' && choice.kind !== 'installed-only') return stageFailed(state)
  const { sub } = state
  switch (sub.kind) {
    case 'mode': {
      const ask = modeAsk(choice, roles)
      const next = choiceAnswer(ask, sub, answer.text)
      if (next.kind === 'again') return asked(state, { kind: 'mode', tries: next.sub.tries }, ask, next.question)
      if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
      if (next.value === 'each') return roleAsked(state, choice, roles, { tries: 1, index: 0, done: [] })
      const all = frameworkAsk(choice, FRAMEWORK_ALL_QUESTION, roles)

      return asked(state, { kind: 'all', tries: 1 }, all, null)
    }
    case 'all': {
      const ask = frameworkAsk(choice, FRAMEWORK_ALL_QUESTION, roles)
      const next = choiceAnswer(ask, sub, answer.text)
      if (next.kind === 'again') return asked(state, { kind: 'all', tries: next.sub.tries }, ask, next.question)
      if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

      return framedDone(state, roles.map(role => withFramework(role, next.value)), null)
    }
    case 'each': {
      const role = roles[sub.index]
      if (role === undefined) return stageFailed(state)
      const ask = frameworkAsk(choice, frameworkRoleQuestion(role), roles)
      const next = choiceAnswer(ask, sub, answer.text)
      if (next.kind === 'again') return asked(state, { ...sub, tries: next.sub.tries }, ask, next.question)
      if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
      const done = [...sub.done, withFramework(role, next.value)]

      return roleAsked(state, choice, roles, { tries: 1, index: sub.index + 1, done })
    }
    default:
      return stageFailed(state)
  }
}

/**
 * The framework stage (DET-03, D-73, D-17, D-230). With exactly one framework in use nothing is asked: the roles keep
 * `framework` absent (an Adjust override stays) and that framework is the repo default. An ambiguous or installed-only
 * choice is asked (frameworkAnswer), so every role stores its framework and there is no repo default. Unsupported and
 * none ask nothing and give the built-in default; unsupported notes what was found.
 */
export const frameworksStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { choice, roles } = state.draft
    if (choice === undefined || roles === undefined) return stageFailed(state)
    switch (choice.kind) {
      case 'chosen':
        return framedDone(state, roles, choice.id)
      case 'ambiguous':
      case 'installed-only':
        return asked(state, { kind: 'mode', tries: 1 }, modeAsk(choice, roles), null)
      case 'unsupported':
        return framedDone(withOutputs(state, [{ kind: 'note', line: choiceLine(choice) }]), roles, 'none')
      case 'none':
        return framedDone(state, roles, 'none')
      default: {
        const unreachable: never = choice
        return unreachable
      }
    }
  },
  answer: frameworkAnswer,
})
