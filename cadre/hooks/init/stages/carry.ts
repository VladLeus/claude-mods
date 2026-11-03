/**
 * The carried settings stage of init (D-60, D-62, D-84, D-103, D-135, D-136, D-230), a layer 10 module: the env
 * question, with the team's role ids on its second line (envContextLine), asked after the side pane lists every
 * scanned env name, and carryStage, the pure stage that gives every role the same picked names, never a value, the
 * autoCompactWindow and statusLine settings the user sets, and the GSD secret read guard any settings source registers.
 * Pure: it gives states and never performs an effect, imports core, framework/gsd, init/answers, init/state, ui/ask
 * and init/stages/model, and never imports init/machine or init/run.
 */
import type { RoleCarry, RoleSpec, SetupScan } from '../../../types'
import { sortedUnique } from '../../core/text'
import type { ListWords } from '../../core/text'
import { SECRET_READ_GUARD } from '../../framework/gsd/adapter'
import { t } from '../../locales/t'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { ENV_PANE_HEADING, envContext } from '../../ui/blocks/context'
import { listWordsOf } from '../../ui/surface'
import { ALL_ENV_OPTION, envPaneQuestion, envQuestion, NONE_OPTION, parseEnvNames } from '../answers'
import { asking, stageCancelled, stageDone, stageFailed, withOutputs } from '../state'
import type { Answer, InitState, StageDef } from '../state'
import { teamContextLine } from './model'

/** The buttons of the env question: no name or every scanned name; names are typed under "Other" (D-60). */
const ENV_OPTIONS: readonly string[] = Object.freeze([NONE_OPTION, ALL_ENV_OPTION])

/** What the env question takes, as its refusal lists it: a button or scanned names (D-60, D-136). */
const ENV_ACCEPTS = t('init.carry.envAccepts', { quotedLabels: quotedLabels(ENV_OPTIONS) })

/** The context line of the env question (D-136): the team's role ids, and that every role carries the same names. */
export function envContextLine(roles: readonly RoleSpec[]): string {
  return t('init.carry.envContextLine', { teamContext: teamContextLine(roles) })
}

/** Why init cancels when the env variables question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
export const ENV_DISMISSED_REASON = t('init.carry.envDismissedReason')

/**
 * The env question as the stage asks it (D-60, D-136): envQuestion for the scanned `names`, capped by `words` (D-256),
 * with the team's role ids on its second line (envContextLine), the buttons None and All of them with the Env chip and
 * the names as its own context (envContext, D-236), which a pane surface asks with its first line in place of that line
 * (D-255) and with envPaneQuestion, which names no env name, in place of the question (D-283), typed names that were
 * scanned (parseEnvNames), so it takes a typed answer (D-234), what its refusal lists, and the reason a dismissal
 * cancels with.
 */
function envAsk(
  names: readonly string[],
  roles: readonly RoleSpec[],
  words: ListWords,
): ChoiceAsk<readonly string[]> & { readonly dismissedReason: string } {
  const context = envContext(names)
  const contextLine = envContextLine(roles)
  const line = context.lines[0] ?? contextLine
  const pane = paneQuestionOf(envQuestion(names, words), contextLine, line, envPaneQuestion())

  return {
    question: pane.asked,
    spec: { options: ENV_OPTIONS, header: ASK_HEADERS.env, context: { ...context, pane }, acceptsTyped: true },
    parse: (answer: string): readonly string[] | null => parseEnvNames(answer, names),
    accepts: ENV_ACCEPTS,
    dismissedReason: ENV_DISMISSED_REASON,
  }
}

/**
 * The stage done with every role carrying the same (D-60, D-62, D-84): the picked names `env`, never a value;
 * `autoCompactWindow` and `statusLine` when the user settings set them; and the GSD secret read guard, the one hook
 * carried, when any settings source registers it: launch renders it from the user, project and local settings
 * (D-103). Hooks registered in project settings load in roles that start at the git root, and the card lists them as
 * loaded by project settings (D-122).
 */
function carriedDone(
  state: InitState,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  env: readonly string[],
): InitState {
  const guards = setup.hooks.map(hook => hook.script).filter(script => SECRET_READ_GUARD.test(script))
  const carry: RoleCarry = {
    autoCompactWindow: setup.carry.autoCompactWindow !== null,
    statusLine: setup.carry.hasStatusLine,
    env,
    hooks: sortedUnique(guards),
  }

  return stageDone({ ...state, draft: { ...state.draft, roles: roles.map(role => ({ ...role, carry })) } })
}

/** The answer to the env question (choiceAnswer): None, All of them or typed names that were scanned. */
function carryAnswer(state: InitState, answer: Answer): InitState {
  const { roles, gathered } = state.draft
  const isOpen = answer.kind === 'answer' && state.sub.kind === 'ask'
  if (!isOpen || roles === undefined || gathered === undefined) return stageFailed(state)
  const { setup } = gathered
  const ask = envAsk(setup.carry.envNames, roles, listWordsOf(state.surface))
  const next = choiceAnswer(ask, state.sub, answer.text)
  if (next.kind === 'again') return asking(state, next.question, ask.spec, next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

  return carriedDone(state, roles, setup, next.value)
}

/**
 * The carried settings stage (D-60, D-62, D-84, D-230). When the user settings define env variables, the side pane
 * first lists every scanned name, one per row (D-135), since the question shows only the first five (envQuestion), so
 * All of them never covers a name the person cannot see; then the one env question asks which ones roles carry
 * (envAsk), and any other answer is asked again with why on top. With none, nothing is shown or asked. Every role
 * carries the same (carriedDone). A dismissal is cancelled with ENV_DISMISSED_REASON and MAX_ASKS answers that name no
 * scanned variable with NO_USABLE_ANSWER_REASON (A1, D-136). No env or settings value is read, stored or printed
 * (T-02-34).
 */
export const carryStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, gathered } = state.draft
    if (roles === undefined || gathered === undefined) return stageFailed(state)
    const { setup } = gathered
    const names = setup.carry.envNames
    if (names.length === 0) return carriedDone(state, roles, setup, [])
    const lines = [ENV_PANE_HEADING, ...names.map(name => `  ${name}`)]
    const shown = withOutputs(state, [{ kind: 'show', block: { key: 'env', lines } }])
    const ask = envAsk(names, roles, listWordsOf(state.surface))

    return asking(shown, ask.question, ask.spec, 1)
  },
  answer: carryAnswer,
})
