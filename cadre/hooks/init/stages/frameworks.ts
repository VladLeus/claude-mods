/**
 * The framework stage of init (DET-03, D-07, D-17, D-73, D-86, D-136, D-230), a layer 10 module: the framework labels
 * and questions, why each question is asked (frameworkReason), and frameworksStage, the pure stage that asks nothing
 * when exactly one framework is in use, else asks once for every role or per role, with the team's role ids on the
 * question's second line, and gives each role the framework it picked (withFramework). Before that it asks the GSD
 * check when a user-level GSD is found but not proven (D-243, ASKED #20), only when the check can run and its answer
 * can change something (isGsdCheckUseful, D-269). Pure: it gives states and never performs an
 * effect, imports core, detect, framework, ui/ask, init/state and init/stages/model (the answer modes and
 * teamContextLine), and never imports init/machine or init/run.
 */
import type { AskContext, Choice, ContextRow, Facts, FrameworkId, GsdFact, RoleSpec } from '../../../types'
import { SUPPORTED_IDS } from '../../core/framework-id'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { redactedText } from '../../core/redact'
import { choiceLine } from '../../detect/report'
import { chooseFramework } from '../../framework/contract'
import { needsGsdCheck, withGsdIdentity } from '../../framework/gsd/identity'
import { detectAll } from '../../framework/registry'
import { t } from '../../locales/t'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { detectionContext, screenFacts } from '../../ui/blocks/context'
import { askedWithContext, stageCancelled, stageDone, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, EachCursor, InitState, IoResult, StageDef } from '../state'
import { ANSWER_MODE_OPTIONS, parseAnswerMode, teamContextLine } from './model'
import type { AnswerMode } from './model'

/** The framework names the framework questions show; none of them is marked as a default (D-07). */
export const FRAMEWORK_LABELS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: t('init.frameworks.frameworkLabelsNone'),
})

/** The start of DET-03's framework question; the reason it is asked follows in brackets (D-73). */
export const FRAMEWORK_QUESTION_PREFIX = t('init.frameworks.frameworkQuestionPrefix')

/** The one follow-up question after `Same for all roles` (D-86). */
export const FRAMEWORK_ALL_QUESTION = t('init.frameworks.frameworkAllQuestion')

/**
 * The framework question for one role after `Per role` (D-73): its title, its secret-like spans hidden (redactedText,
 * E1, #163), and its id, since the id tells apart roles with the same title (A6).
 */
export function frameworkRoleQuestion(role: Pick<RoleSpec, 'id' | 'title'>): string {
  return t('init.frameworks.frameworkRoleQuestion', { title: redactedText(role.title), id: role.id })
}

/**
 * Why init asks which framework the roles use (D-73): more than one framework is in use, or none is but some are
 * installed for the user (D-29). For a choice init asks nothing about, the text says what the choice found.
 */
export function frameworkReason(choice: Choice): string {
  switch (choice.kind) {
    case 'ambiguous':
      return t('init.frameworks.reasonMany')
    case 'installed-only':
      return t('init.frameworks.reasonInstalled')
    case 'chosen':
      return choice.reason
    case 'unsupported':
      return t('init.frameworks.reasonUnsupported')
    case 'none':
      return t('init.frameworks.reasonNone')
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
export const FRAMEWORK_DISMISSED_REASON = t('init.frameworks.frameworkDismissedReason')

/** Each framework as the refusal of a framework question names it: the word a person may type for it (D-136). */
const FRAMEWORK_WORDS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'none',
})

/** A choice the framework questions are asked for: more than one framework in use, or only installed ones (D-73). */
type AskedChoice = Extract<Choice, { readonly kind: 'ambiguous' | 'installed-only' }>

/**
 * A framework question as the stage asks it: a ChoiceAsk with the reason a dismissal cancels with, and the sentence and
 * context line its question is made of, from which the stage builds what a pane surface asks (D-255).
 */
type FrameworkAsk<T> = ChoiceAsk<T> & {
  readonly dismissedReason: string
  readonly sentence: string
  readonly contextLine: string
}

/**
 * DET-03's mode question (D-73, D-86): the reason it is asked, with the team's role ids (teamContextLine) on its second
 * line, then `Same for all roles` or `Per role`.
 */
function modeAsk(choice: AskedChoice, roles: readonly RoleSpec[]): FrameworkAsk<AnswerMode> {
  const question = t('init.frameworks.modeAsk', {
    frameworkQuestionPrefix: FRAMEWORK_QUESTION_PREFIX,
    frameworkReason: frameworkReason(choice),
  })
  const contextLine = teamContextLine(roles)

  return {
    question: withContext(question, contextLine),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.framework },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
    dismissedReason: FRAMEWORK_DISMISSED_REASON,
    sentence: question,
    contextLine,
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
  const contextLine = teamContextLine(roles)

  return {
    question: withContext(question, contextLine),
    spec: { options: allowed.map(id => FRAMEWORK_LABELS[id]), header: ASK_HEADERS.framework, acceptsTyped: true },
    parse: (answer: string): FrameworkId | null => parseFramework(answer, allowed),
    accepts: t('init.frameworks.frameworkAskAccepts', { map: allowed.map(id => FRAMEWORK_WORDS[id]).join(', ') }),
    dismissedReason: FRAMEWORK_DISMISSED_REASON,
    sentence: question,
    contextLine,
  }
}

/**
 * The state asking `ask` with the cursor `sub`, the detection evidence of the scan as the question's own context
 * (detectionContext, D-236), whose summary a pane surface asks in place of the context line (D-310); `question` is
 * the ask's text after a refusal.
 */
function asked<T>(state: InitState, sub: InitState['sub'], ask: FrameworkAsk<T>, question: string | null): InitState {
  const { gathered, locations } = state.draft
  if (gathered === undefined || locations === undefined) return stageFailed(state)
  const context = detectionContext(detectAll(screenFacts(gathered.facts.facts, locations.root)))
  const pane = paneQuestionOf(ask.sentence, ask.contextLine, context.summary)

  return askedWithContext(state, sub, ask, question, { ...context, pane })
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

/** The GSD check question (D-243): it names the command it runs, before anything runs. */
export const GSD_CHECK_QUESTION = t('init.frameworks.gsdCheckQuestion')

/** Each GSD check answer with whether it runs the check, the declining one first (D-58, D-243). */
const GSD_CHECK_ANSWERS: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.frameworks.gsdCheckNo'), value: false },
  { label: t('init.frameworks.gsdCheckYes'), value: true },
])

/** Why init cancels when the GSD check question is dismissed or not answered (A1, D-45). */
export const GSD_CHECK_DISMISSED_REASON = t('init.frameworks.gsdCheckDismissedReason')

/**
 * The GSD check as init and detect ask it (D-243): GSD_CHECK_QUESTION, `No, skip the check` first, then `Yes, run the
 * check`, with the GSD check chip, and as its context (kind `detection`) each user-level GSD install found but not
 * proven, by its display path; its summary, which a pane surface asks under the question, is the line of the first of
 * them, so it names the install the check runs (D-310, edge #39), or the context's title when it lists none, so the
 * context always carries what a pane surface asks (D-300); each line is one plain row (D-313). It takes no typed
 * answer.
 */
export function gsdCheckAsk(facts: Facts): ChoiceAsk<boolean> & { readonly dismissedReason: string } {
  const unproven = facts.gsd.filter(fact => fact.location === 'user' && fact.identity === 'unknown')
  const options = GSD_CHECK_ANSWERS.map(answer => answer.label)
  const lines = unproven.map(fact => t('init.frameworks.gsdCheckLine', { dir: fact.dir }))
  const title = t('init.frameworks.gsdCheckTitle')
  const [summary = title] = lines
  const pane = { asked: GSD_CHECK_QUESTION, text: withContext(GSD_CHECK_QUESTION, summary) }
  const rows = lines.map((line): ContextRow => ({ role: 'plain', text: line, indent: 0 }))
  const context: AskContext = { title, lines, kind: 'detection', summary, pane, rows: [{ title: null, rows }] }

  return {
    question: GSD_CHECK_QUESTION,
    spec: { options, header: t('init.frameworks.gsdCheckChip'), context },
    parse: (answer: string): boolean | null => labelled(GSD_CHECK_ANSWERS, answer),
    accepts: quotedLabels(options),
    dismissedReason: GSD_CHECK_DISMISSED_REASON,
  }
}

/**
 * The state with the GSD check's outcome kept in its draft (WF-S2): `declined` after a No, `run` after a Yes, and
 * `skipped` when the check was not asked because its answer could not change the framework choice (D-269, D-295).
 */
export function withGsdCheck(state: InitState, gsdCheck: 'declined' | 'run' | 'skipped'): InitState {
  return { ...state, draft: { ...state.draft, gsdCheck } }
}

/** A framework choice by its kind and the framework ids it chose or found, so two choices can be compared (D-269). */
function choiceIds(choice: Choice): string {
  if (choice.kind === 'none') return choice.kind
  if (choice.kind === 'chosen') return `${choice.kind} ${choice.id}`

  return `${choice.kind} ${choice.ids.join(' ')}`
}

/**
 * Whether GSD's own check can change anything (D-269, edge #36, OC-05-U): some role names gsd as its framework, or the
 * framework choice with every user-level GSD found but not proven counted as proven differs, by its kind and its
 * chosen or found ids, from the choice as found.
 */
export function isGsdCheckUseful(facts: Facts, roles: readonly RoleSpec[]): boolean {
  if (roles.some(role => role.framework === 'gsd')) return true
  const gsd = facts.gsd.map((fact): GsdFact =>
    fact.location === 'user' && fact.identity === 'unknown' ? { ...fact, identity: 'proven' } : fact,
  )
  const found = chooseFramework(detectAll(facts), null)
  const proven = chooseFramework(detectAll({ ...facts, gsd }), null)

  return choiceIds(proven) !== choiceIds(found)
}

/** The GSD check asked `tries` times so far; `question` is its text after a refusal. */
function gsdCheckAsked(state: InitState, facts: Facts, tries: number, question: string | null): InitState {
  const ask = gsdCheckAsk(facts)

  const sub: InitState['sub'] = { kind: 'ask', tries }

  return withEffect({ ...state, sub }, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/**
 * The framework step once the GSD check, if any, is behind it. With exactly one framework in use nothing is asked: the
 * roles keep `framework` absent (an Adjust override stays) and that framework is the repo default. An ambiguous or
 * installed-only choice is asked (frameworkAnswer), so every role stores its framework and there is no repo default.
 * Unsupported and none ask nothing and give the built-in default; unsupported notes what was found.
 */
function frameworkStep(state: InitState): InitState {
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
}

/**
 * The answer to the GSD check (choiceAnswer): No goes on to the framework step with the facts as they are; Yes hands
 * the runner the `gsd-identity` io effect, which runs GSD's own check through io.gsdIdentity. An answer that is not
 * offered is asked again; a dismissal cancels with GSD_CHECK_DISMISSED_REASON (A1).
 */
function gsdCheckAnswer(state: InitState, answer: Answer): InitState {
  const { gathered, locations } = state.draft
  const { sub } = state
  if (answer.kind !== 'answer' || sub.kind !== 'ask' || gathered === undefined || locations === undefined) {
    return stageFailed(state)
  }
  const ask = gsdCheckAsk(gathered.facts.facts)
  const next = choiceAnswer(ask, sub, answer.text)
  if (next.kind === 'again') return gsdCheckAsked(state, gathered.facts.facts, next.sub.tries, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (!next.value) return frameworkStep(withGsdCheck(state, 'declined'))
  const started = withGsdCheck({ ...state, sub: { kind: 'start' } }, 'run')

  return withEffect(started, { kind: 'io', call: { id: 'gsd-identity', locations } })
}

/**
 * The result of GSD's own check, merged into the facts (withGsdIdentity) before the framework step, which then reads
 * the framework choice again from the merged facts, so a GSD install the check proved counts for the framework
 * question (D-243).
 */
function gsdChecked(state: InitState, result: IoResult): InitState {
  const { gathered, locations } = state.draft
  if (result.id !== 'gsd-identity' || gathered === undefined || locations === undefined) return stageFailed(state)
  const facts = withGsdIdentity(gathered.facts, result.result, locations)
  const choice = chooseFramework(detectAll(facts.facts), null)

  return frameworkStep({ ...state, draft: { ...state.draft, gathered: { ...gathered, facts }, choice } })
}

/**
 * The framework stage (DET-03, D-73, D-17, D-230): the GSD check first when the scan found a user-level GSD that is not
 * proven (D-243, ASKED #20) and whose runtime is built (needsGsdCheck, D-269, edge #31), then the framework step
 * (frameworkStep, frameworkAnswer). A check whose answer cannot change anything (isGsdCheckUseful, edge #36) is not
 * asked: the draft keeps `skipped`, which gives the facts, warnings and choice of a No (D-295). The GSD check is asked
 * at most once per run: its answer stays in the draft, so a review go-back goes straight to the framework step (WF-S2).
 */
export const frameworksStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    if (state.draft.gsdCheck !== undefined) return frameworkStep(state)
    const facts = state.draft.gathered?.facts.facts
    if (facts === undefined || !needsGsdCheck(facts)) return frameworkStep(state)
    if (!isGsdCheckUseful(facts, state.draft.roles ?? [])) return frameworkStep(withGsdCheck(state, 'skipped'))

    return gsdCheckAsked(state, facts, 1, null)
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind === 'io') return gsdChecked(state, answer.result)
    if (state.sub.kind === 'ask') return gsdCheckAnswer(state, answer)

    return frameworkAnswer(state, answer)
  },
})
