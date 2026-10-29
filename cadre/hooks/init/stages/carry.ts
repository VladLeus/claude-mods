/**
 * The carried settings stage of init (D-60, D-62, D-84, D-103, D-135, D-136), a layer 10 module: the env question,
 * with the team's role ids on its second line (envContextLine), asked after the side pane lists every scanned env name
 * (carriedEnv), and carryStep, which gives every role the same picked names, never a value, the autoCompactWindow and
 * statusLine settings the user sets, and the GSD secret read guard any settings source registers. Pure: it asks
 * through the InitIo port it is given, imports core, framework/gsd, init/answers, ui/ask and init/stages/model, and
 * never imports init.ts, which imports it, or init/run.
 */
import type { InitIo, RoleCarry, RoleSpec, SetupScan } from '../../../types'
import { sortedUnique } from '../../core/text'
import { SECRET_READ_GUARD } from '../../framework/gsd/adapter'
import { accepted, ASK_HEADERS, askChoice, choiceResult, quotedLabels, showBlock, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { ALL_ENV_OPTION, envQuestion, NONE_OPTION, parseEnvNames } from '../answers'
import { teamContextLine } from './model'

/** The buttons of the env question: no name or every scanned name; names are typed under "Other" (D-60). */
const ENV_OPTIONS: readonly string[] = Object.freeze([NONE_OPTION, ALL_ENV_OPTION])

/** What the env question takes, as its refusal lists it: a button or scanned names (D-60, D-136). */
const ENV_ACCEPTS = `${quotedLabels(ENV_OPTIONS)}, or names from the list, typed exactly`

/** The context line of the env question (D-136): the team's role ids, and that every role carries the same names. */
export function envContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} Every role carries the same names; values are filled in at launch.`
}

/** Why init cancels when the env variables question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
export const ENV_DISMISSED_REASON = 'The env variables question was dismissed or not answered.'

/** The first line of the side-pane block that lists every scanned env name before the env question (D-135). */
const ENV_PANE_HEADING = 'Env variable names in your settings (values are never read):'

/**
 * The env variable names roles carry (D-60): none when the scan found no name, and then nothing is shown or asked. Else
 * the side pane first lists every scanned name, one per row (D-135), since the question shows only the first five
 * (envQuestion), so All of them never covers a name the person cannot see; then the one env question, with the team's
 * role ids on its second line (envContextLine, D-136), is answered with None, All of them or typed names that were
 * scanned (parseEnvNames), and any other answer is asked again with why on top. A dismissal is cancelled with
 * ENV_DISMISSED_REASON and MAX_ASKS answers that name no scanned variable with NO_USABLE_ANSWER_REASON (A1).
 */
async function carriedEnv(
  io: InitIo,
  names: readonly string[],
  roles: readonly RoleSpec[],
): Promise<StepResult<readonly string[]>> {
  if (names.length === 0) return accepted([])
  const parse = (answer: string): readonly string[] | null => parseEnvNames(answer, names)
  await showBlock(io, 'env', [ENV_PANE_HEADING, ...names.map(name => `  ${name}`)])
  const spec = { options: ENV_OPTIONS, header: ASK_HEADERS.env }
  const ask = { question: withContext(envQuestion(names), envContextLine(roles)), spec, parse, accepts: ENV_ACCEPTS }

  return choiceResult(await askChoice(io, ask), ENV_DISMISSED_REASON)
}

/**
 * The carried settings step (D-60, D-62, D-84). When the user settings define env variables, the side pane lists their
 * names and one question asks which ones roles carry (carriedEnv, D-135); with none, nothing is shown or asked. Every
 * role carries the same: the picked names, never a value; `autoCompactWindow` and `statusLine` when the user settings
 * set them; and the GSD secret read guard, the one hook carried, when any settings source registers it: launch renders
 * it from the user, project and local settings (D-103). Hooks registered in project settings load in roles that start
 * at the git root, and the card lists them as loaded by project settings (D-122). A dismissal gives the cancel reason
 * ENV_DISMISSED_REASON, and MAX_ASKS answers that name no scanned variable NO_USABLE_ANSWER_REASON (A1, D-136). No env
 * or settings value is read, stored or printed (T-02-34); the roles it is given never change.
 */
export async function carryStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
): Promise<StepResult<readonly RoleSpec[]>> {
  const env = await carriedEnv(io, setup.carry.envNames, roles)
  if (env.kind === 'cancelled') return env
  const guards = setup.hooks.map(hook => hook.script).filter(script => SECRET_READ_GUARD.test(script))
  const carry: RoleCarry = {
    autoCompactWindow: setup.carry.autoCompactWindow !== null,
    statusLine: setup.carry.hasStatusLine,
    env: env.value,
    hooks: sortedUnique(guards),
  }

  return accepted(roles.map(role => ({ ...role, carry })))
}
