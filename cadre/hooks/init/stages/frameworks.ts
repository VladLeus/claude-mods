/**
 * The framework stage of init (DET-03, D-07, D-17, D-73, D-86, D-136, D-230), a layer 10 module: the framework labels
 * and questions, why each question is asked (frameworkReason), and frameworksStage, the pure stage that asks which
 * frameworks the team keeps whenever one is found (the set question, frameworkSetAsk; adding a missing one asks its
 * install question first), makes one kept framework the repo default, and with two asks once for every role or per
 * role, with the team's role ids on the question's second line, giving each role the framework it picked
 * (withFramework). Before that it asks the GSD
 * check when a user-level GSD is found but not proven (D-243, ASKED #20), only when the check can run and its answer
 * can change something (isGsdCheckUseful, D-269); its result reads again the choice and the frameworks installed for
 * the repo (installedFrameworks), which the roles stage's Adjust loop offers (withGsdIdentityChecked, edge #30). The
 * install question offers a framework the repo does not have (frameworkInstallAsk). Pure: it gives states and never
 * performs an effect, imports apply/installs, core, detect, framework, ui/ask, init/state and init/stages/model (the
 * answer modes and teamContextLine), and never imports init/machine or init/run.
 */
import type { AskContext, Choice, ContextRow, Detection, Facts, FrameworkId, GsdFact, RoleSpec } from '../../../types'
import { projectInstallOf } from '../../apply/installs'
import { FRAMEWORK_IDS, SUPPORTED_IDS } from '../../core/framework-id'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { redactedText } from '../../core/redact'
import { choiceLine } from '../../detect/report'
import { chooseFramework } from '../../framework/contract'
import { needsGsdCheck, withGsdIdentity } from '../../framework/gsd/identity'
import { detectAll } from '../../framework/registry'
import { t } from '../../locales/t'
import {
  ASK_HEADERS,
  choiceAnswer,
  NO_USABLE_ANSWER_REASON,
  paneQuestionOf,
  quotedLabels,
  withContext,
} from '../../ui/ask'
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

/** The frameworks a choice names as in use or installed; none for an unsupported choice or none. */
function namedIds(choice: Choice): readonly FrameworkId[] {
  if (choice.kind === 'chosen') return [choice.id]
  if (choice.kind === 'ambiguous' || choice.kind === 'installed-only') return choice.ids

  return []
}

/**
 * The supported frameworks found for the repo, in SUPPORTED_IDS order: those the choice names and those installed, a
 * framework an Adjust consented to install included; and the supported ones missing.
 */
function foundOf(choice: Choice, installed: readonly FrameworkId[]): { found: FrameworkId[]; missing: FrameworkId[] } {
  const found = SUPPORTED_IDS.filter(id => namedIds(choice).includes(id) || installed.includes(id))

  return { found, missing: SUPPORTED_IDS.filter(id => !found.includes(id)) }
}

/** Framework labels as the set question names them: `GSD and superpowers`. */
function namesOf(ids: readonly FrameworkId[]): string {
  return ids.map(id => FRAMEWORK_LABELS[id]).join(t('init.frameworks.setNamesJoin'))
}

/** Whether a typed word names the framework: its id or its label, in any case. */
function isWordOf(word: string, id: FrameworkId): boolean {
  return word === id || word === FRAMEWORK_LABELS[id].toLowerCase()
}

/**
 * The frameworks a typed answer names, its words split on spaces and commas and read by id or label in any case, in
 * SUPPORTED_IDS order (none names no framework); null when a word names no framework or nothing is typed.
 */
function typedFrameworks(answer: string): FrameworkId[] | null {
  const words = answer.trim().toLowerCase().split(/[\s,]+/).filter(word => word !== '')
  const isKnown = (word: string): boolean => FRAMEWORK_IDS.some(id => isWordOf(word, id))
  if (words.length === 0 || !words.every(isKnown)) return null

  return SUPPORTED_IDS.filter(id => words.some(word => isWordOf(word, id)))
}

/**
 * The set question: which frameworks the team keeps, naming those found and that adding one installs it at project
 * scope after Confirm, with the team's role ids on its second line. Keep the found ones (recommended) comes first,
 * then Add for each missing one, then None; the frameworks may also be typed by name (typedFrameworks), and an answer
 * it cannot read is refused with the answers and the names it takes.
 */
function frameworkSetAsk(
  found: readonly FrameworkId[],
  missing: readonly FrameworkId[],
  roles: readonly RoleSpec[],
): FrameworkAsk<readonly FrameworkId[]> {
  const choices: readonly Labelled<readonly FrameworkId[]>[] = [
    { label: t('init.frameworks.setKeep', { names: namesOf(found) }), value: found },
    ...missing.map(id => {
      const label = t('init.frameworks.setAdd', { name: FRAMEWORK_LABELS[id] })

      return { label, value: [...found, id] }
    }),
    { label: t('init.frameworks.setNone'), value: [] },
  ]
  const options = choices.map(choice => choice.label)
  const sentence = t('init.frameworks.setQuestion', { found: namesOf(found) })
  const contextLine = teamContextLine(roles)
  const words = FRAMEWORK_IDS.map(id => FRAMEWORK_WORDS[id]).join(', ')

  return {
    question: withContext(sentence, contextLine),
    spec: { options, header: ASK_HEADERS.framework, acceptsTyped: true },
    parse: (answer: string): readonly FrameworkId[] | null => labelled(choices, answer) ?? typedFrameworks(answer),
    accepts: t('init.frameworks.setAccepts', { labels: quotedLabels(options), words }),
    dismissedReason: FRAMEWORK_DISMISSED_REASON,
    sentence,
    contextLine,
  }
}

/** The set question of the draft and the frameworks it found; null while the draft lacks the choice or the roles. */
function setAskOf(state: InitState): { ask: FrameworkAsk<readonly FrameworkId[]>; found: FrameworkId[] } | null {
  const { choice, roles, installed = [] } = state.draft
  if (choice === undefined || roles === undefined) return null
  const { found, missing } = foundOf(choice, installed)

  return { ask: frameworkSetAsk(found, missing, roles), found }
}

/** Whether `set` holds every framework the person consented to install in this run. */
function keepsConsented(draft: InitState['draft'], set: readonly FrameworkId[]): boolean {
  return (draft.frameworkInstalls ?? []).every(id => set.includes(id))
}

/**
 * The set cadre.json stores for the repo, kept without asking while every framework in it is still installed and it
 * holds every framework consented in this run; null when none is stored or it fails either.
 */
function storedSet(state: InitState): readonly FrameworkId[] | null {
  const stored = state.draft.gathered?.repo.cadre.state?.frameworks
  const { installed } = state.draft
  if (stored === undefined || installed === undefined) return null
  if (!keepsConsented(state.draft, stored)) return null

  return stored.every(id => installed.includes(id)) ? stored : null
}

/** The set question asked `tries` times so far; `question` is its text after a refusal. */
function setAsked(state: InitState, tries: number, question: string | null): InitState {
  const set = setAskOf(state)
  if (set === null) return stageFailed(state)

  return asked(state, { kind: 'set', tries }, set.ask, question)
}

/**
 * The framework step for a set of frameworks: none frames every role on none, one is the repo default, and two ask
 * the mode question as two frameworks in use do.
 */
function framedSet(state: InitState, set: readonly FrameworkId[]): InitState {
  const { roles } = state.draft
  if (roles === undefined) return stageFailed(state)
  const [only = 'none'] = set
  if (set.length < 2) return framedDone(state, roles, only)

  return asked(state, { kind: 'mode', tries: 1 }, modeAsk({ kind: 'ambiguous', ids: set }, roles), null)
}

/** The set answered: kept in the draft in SUPPORTED_IDS order, then framed (framedSet). */
function setChosen(state: InitState, set: readonly FrameworkId[]): InitState {
  const frameworkSet = SUPPORTED_IDS.filter(id => set.includes(id))

  return framedSet({ ...state, draft: { ...state.draft, frameworkSet } }, frameworkSet)
}

/** Where the install question a set answer asked is: the question out, with its framework and the set so far. */
type SetInstall = Extract<InitState['sub'], { readonly kind: 'set-install' }>

/**
 * The install question of `framework` asked for a set answer (frameworkInstallAsk), asked `tries` times so far, with
 * the set so far and the frameworks still to ask about; `question` is its text after a refusal.
 */
function setInstallAsked(
  state: InitState,
  pending: SetInstall['pending'],
  framework: FrameworkId,
  tries: number,
  question: string | null,
): InitState {
  const ask = frameworkInstallAsk(framework)
  const sub: InitState['sub'] = { kind: 'set-install', tries, framework, pending }

  return withEffect({ ...state, sub }, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/** The next missing framework of a set answer asked about, in order; with none left, the set is the answer. */
function setInstallNext(state: InitState, set: readonly FrameworkId[], rest: readonly FrameworkId[]): InitState {
  const [framework] = rest
  if (framework === undefined) return setChosen(state, set)

  return setInstallAsked(state, { set, rest: rest.slice(1) }, framework, 1, null)
}

/**
 * The answer to the set question (choiceAnswer): the frameworks found that it keeps, then each missing one it names
 * asked about (setInstallNext). An answer it cannot read is asked again with why on top; a dismissal cancels with
 * FRAMEWORK_DISMISSED_REASON and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON (A1).
 */
function afterSet(state: InitState, sub: { readonly tries: number }, answer: string | null): InitState {
  const set = setAskOf(state)
  if (set === null) return stageFailed(state)
  const next = choiceAnswer(set.ask, sub, answer)
  if (next.kind === 'again') return setAsked(state, next.sub.tries, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const kept = next.value.filter(id => set.found.includes(id))

  return setInstallNext(state, kept, next.value.filter(id => !set.found.includes(id)))
}

/**
 * The answer to the install question a set answer asked: Yes adds the framework to the set, to the frameworks to
 * install and, before none, to the installed ones; No or a dismissal leaves it out and records no install. An answer
 * that is neither is asked again with why on top.
 */
function afterSetInstall(state: InitState, sub: SetInstall, answer: string | null): InitState {
  const { set, rest } = sub.pending
  if (answer === null) return setInstallNext(state, set, rest)
  // A dismissal declined above, so choiceAnswer cancels only after MAX_ASKS answers it cannot read.
  const ask = { ...frameworkInstallAsk(sub.framework), dismissedReason: NO_USABLE_ANSWER_REASON }
  const next = choiceAnswer(ask, sub, answer)
  if (next.kind === 'again') return setInstallAsked(state, sub.pending, sub.framework, next.sub.tries, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (!next.value) return setInstallNext(state, set, rest)
  const draft = withConsentedInstall(state.draft, sub.framework)

  return setInstallNext({ ...state, draft }, [...set, sub.framework], rest)
}

/** The choice the mode questions ask about: the two or more frameworks the set keeps; null with fewer. */
function askedChoiceOf(state: InitState): AskedChoice | null {
  const { frameworkSet } = state.draft
  if (frameworkSet === undefined || frameworkSet.length < 2) return null

  return { kind: 'ambiguous', ids: frameworkSet }
}

/**
 * The answer to the open framework question (choiceAnswer): the set question and its install questions (afterSet,
 * afterSetInstall); the mode question goes on to the question for all roles or to the question of each role in role
 * order; every role stores the framework it was given and there is no repo default. An answer that is not offered is
 * asked again with why on top; a dismissal cancels with FRAMEWORK_DISMISSED_REASON and MAX_ASKS answers it cannot
 * read with NO_USABLE_ANSWER_REASON, never a choice (A1).
 */
function frameworkAnswer(state: InitState, answer: Answer): InitState {
  const { roles } = state.draft
  const { sub } = state
  if (answer.kind !== 'answer' || roles === undefined) return stageFailed(state)
  if (sub.kind === 'set') return afterSet(state, sub, answer.text)
  if (sub.kind === 'set-install') return afterSetInstall(state, sub, answer.text)
  const choice = askedChoiceOf(state)
  if (choice === null) return stageFailed(state)
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
 * The frameworks an Adjust line may set a role to (A5): each supported framework this repo has in use or installed,
 * in SUPPORTED_IDS order, then `none`, the built-in fallback, which is always there.
 */
export function installedFrameworks(detections: readonly Detection[]): FrameworkId[] {
  const isThere = (id: FrameworkId): boolean =>
    detections.some(found => found.id === id && (found.status === 'in-use' || found.status === 'installed'))

  return [...SUPPORTED_IDS.filter(isThere), 'none']
}

/** The installed frameworks with `fw` among them once: as they are when they hold it, else with it just before none. */
function withInstalled(installed: readonly FrameworkId[], fw: FrameworkId): FrameworkId[] {
  if (installed.includes(fw)) return [...installed]

  return [...installed.filter(id => id !== 'none'), fw, 'none']
}

/** A framework the person consented to install, kept once in the installed ones and once in the installs. */
export function withConsentedInstall(draft: InitState['draft'], fw: FrameworkId): InitState['draft'] {
  const { installed = [], frameworkInstalls = [] } = draft
  const installs = frameworkInstalls.includes(fw) ? frameworkInstalls : [...frameworkInstalls, fw]

  return { ...draft, installed: withInstalled(installed, fw), frameworkInstalls: installs }
}

/** Each answer to a framework install question with whether it installs, the declining one first. */
const FRAMEWORK_INSTALL_ANSWERS: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.frameworks.installNo'), value: false },
  { label: t('init.frameworks.installYes'), value: true },
])

/** Whether an answer to a framework install question installs; null when it names neither answer. */
export function parseFrameworkInstall(answer: string): boolean | null {
  return labelled(FRAMEWORK_INSTALL_ANSWERS, answer)
}

/**
 * The question that offers to install a framework the repo does not have, No first: its context line names the exact
 * command and that it runs from the repo root after Confirm, and its context also lists what the installer writes.
 */
export function frameworkInstallAsk(fw: FrameworkId): ChoiceAsk<boolean> {
  const install = projectInstallOf(fw)
  const name = FRAMEWORK_LABELS[fw]
  const sentence = t('init.frameworks.installQuestion', { name })
  const command = t('init.frameworks.installCommand', { command: (install?.argv ?? []).join(' ') })
  const lines = [command, t('init.frameworks.installWrites', { writes: (install?.writes ?? []).join(', ') })]
  const pane = paneQuestionOf(sentence, command, command)
  const rows = lines.map((line): ContextRow => ({ role: 'plain', text: line, indent: 0 }))
  const title = t('init.frameworks.installTitle', { name })
  const context: AskContext = { title, lines, kind: 'consent', summary: command, pane, rows: [{ title: null, rows }] }
  const options = FRAMEWORK_INSTALL_ANSWERS.map(answer => answer.label)

  return {
    question: pane.asked,
    spec: { options, header: ASK_HEADERS.framework, context },
    parse: parseFrameworkInstall,
    accepts: quotedLabels(options),
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
 * The framework step once the GSD check, if any, is behind it. A set kept in the draft is framed again (framedSet)
 * while it holds every framework consented to install. With any framework found, in use, installed or consented, the
 * set cadre.json stores is kept while all of it is still installed and it holds every consented one (storedSet), else
 * the set question is asked (frameworkAnswer): one framework kept is the repo default and the roles keep `framework`
 * absent (an Adjust override stays); two ask whether one framework serves all roles or each picks its own. None found
 * gives the built-in default; an unsupported scan notes what it found.
 */
function frameworkStep(state: InitState): InitState {
  const { choice, roles, frameworkSet, installed = [] } = state.draft
  if (choice === undefined || roles === undefined) return stageFailed(state)
  if (frameworkSet !== undefined && keepsConsented(state.draft, frameworkSet)) return framedSet(state, frameworkSet)
  const noted =
    choice.kind === 'unsupported' ? withOutputs(state, [{ kind: 'note', line: choiceLine(choice) }]) : state
  if (foundOf(choice, installed).found.length === 0) return framedDone(noted, roles, 'none')
  const stored = storedSet(noted)

  return stored === null ? setAsked(noted, 1, null) : setChosen(noted, stored)
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
 * The state with GSD's own check merged into the facts (withGsdIdentity) and `installed` and `choice` read again from
 * the merged facts, so a GSD install the check proved counts for the framework question and for a later Adjust; the
 * frameworks consented to install stay installed. Null when the result is not a gsd-identity result or the draft has
 * no gathered facts or locations.
 */
export function withGsdIdentityChecked(state: InitState, result: IoResult): InitState | null {
  const { gathered, locations } = state.draft
  if (result.id !== 'gsd-identity' || gathered === undefined || locations === undefined) return null
  const facts = withGsdIdentity(gathered.facts, result.result, locations)
  const detections = detectAll(facts.facts)
  const draft = {
    ...state.draft,
    gathered: { ...gathered, facts },
    installed: (state.draft.frameworkInstalls ?? []).reduce(withInstalled, installedFrameworks(detections)),
    choice: chooseFramework(detections, null),
  }

  return { ...state, draft }
}

/**
 * The result of GSD's own check, merged into the facts with `installed` and `choice` read again
 * (withGsdIdentityChecked) before the framework step, so a GSD install the check proved counts for the framework
 * question (D-243) and for an Adjust after a go-back (D-269, edge #30); a result it cannot take fails the stage.
 */
function gsdChecked(state: InitState, result: IoResult): InitState {
  const checked = withGsdIdentityChecked(state, result)
  if (checked === null) return stageFailed(state)

  return frameworkStep(checked)
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
