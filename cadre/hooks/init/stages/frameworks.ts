/**
 * The framework stage of init (DET-03, D-07, D-17, D-73, D-86, D-136), a layer 10 module: the framework labels and
 * questions, why each question is asked (frameworkReason), and frameworkStep, which asks nothing when exactly one
 * framework is in use, else asks once for every role or per role, with the team's role ids on the question's second
 * line, and gives each role the framework it picked (withFramework). Pure: it asks through the InitIo port it is
 * given, imports core, detect, ui/ask and init/stages/model (the answer modes and teamContextLine), and never imports
 * init.ts, which imports it, or init/run.
 */
import type { Choice, FrameworkId, InitIo, RoleSpec } from '../../../types'
import { SUPPORTED_IDS } from '../../core/framework-id'
import { choiceLine } from '../../detect/report'
import { accepted, ASK_HEADERS, askChoice, choiceResult, noteLine, quotedLabels, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { ANSWER_MODE_OPTIONS, parseAnswerMode, teamContextLine } from './model'

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
 * The framework question for one role after `Per role` (D-73): its title and its id, since the id tells apart roles
 * with the same title (A6).
 */
export function frameworkRoleQuestion(role: Pick<RoleSpec, 'id' | 'title'>): string {
  return `Framework for ${role.title} (${role.id})?`
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

/** What the framework step decided: the roles, each with its framework when it was asked, and the repo default. */
export type Framed = {
  readonly roles: readonly RoleSpec[]
  readonly repoDefault: FrameworkId | null
}

/** Why init cancels when a framework question is dismissed or not answered (A1, D-45). */
export const FRAMEWORK_DISMISSED_REASON = 'A framework question was dismissed or not answered.'

/** Each framework as the refusal of a framework question names it: the word a person may type for it (D-136). */
const FRAMEWORK_WORDS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'none',
})

/**
 * DET-03's question for an ambiguous or installed-only choice (D-73, D-86): the reason, then `Same for all roles` or
 * `Per role`, then the framework once for every role or for each role in role order. The options are the frameworks
 * of the choice in SUPPORTED_IDS order, then `none (built-in)`: the dialog focuses the first option; the order is
 * fixed (D-07). Each of these questions carries the team's role ids (teamContextLine) on its second line, and an
 * answer that names no offered framework is asked again with why on top: the words of the offered frameworks and that
 * a role runs one framework (D-136). Every role stores its answer and there is no repo default. A dismissed question
 * is cancelled with FRAMEWORK_DISMISSED_REASON and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON, never
 * a choice (A1, D-45).
 */
async function askFrameworks(
  io: InitIo,
  choice: Extract<Choice, { readonly kind: 'ambiguous' | 'installed-only' }>,
  roles: readonly RoleSpec[],
): Promise<StepResult<Framed>> {
  const allowed: readonly FrameworkId[] = [...SUPPORTED_IDS.filter(id => choice.ids.includes(id)), 'none']
  const spec = { options: allowed.map(id => FRAMEWORK_LABELS[id]), header: ASK_HEADERS.framework }
  const parse = (answer: string): FrameworkId | null => parseFramework(answer, allowed)
  const accepts = `${allowed.map(id => FRAMEWORK_WORDS[id]).join(', ')} - a role runs one framework`
  const context = teamContextLine(roles)
  const modeAsk = {
    question: withContext(`${FRAMEWORK_QUESTION_PREFIX} (asked because ${frameworkReason(choice)})`, context),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.framework },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
  }
  const mode = choiceResult(await askChoice(io, modeAsk), FRAMEWORK_DISMISSED_REASON)
  if (mode.kind === 'cancelled') return mode
  if (mode.value === 'same') {
    const allAsk = { question: withContext(FRAMEWORK_ALL_QUESTION, context), spec, parse, accepts }
    const framework = choiceResult(await askChoice(io, allAsk), FRAMEWORK_DISMISSED_REASON)
    if (framework.kind === 'cancelled') return framework

    return accepted({ roles: roles.map(role => withFramework(role, framework.value)), repoDefault: null })
  }

  const framed: RoleSpec[] = []
  for (const role of roles) {
    const roleAsk = { question: withContext(frameworkRoleQuestion(role), context), spec, parse, accepts }
    const framework = choiceResult(await askChoice(io, roleAsk), FRAMEWORK_DISMISSED_REASON)
    if (framework.kind === 'cancelled') return framework
    framed.push(withFramework(role, framework.value))
  }

  return accepted({ roles: framed, repoDefault: null })
}

/**
 * The framework step (DET-03, D-73, D-17). With exactly one framework in use nothing is asked: the roles keep
 * `framework` absent (an Adjust override stays) and that framework is the repo default. An ambiguous or installed-only
 * choice is asked (askFrameworks), so every role stores its framework and there is no repo default. Unsupported and
 * none ask nothing and give the built-in default; unsupported prints what was found. A dismissed question gives the
 * cancel reason FRAMEWORK_DISMISSED_REASON, and MAX_ASKS answers it cannot read NO_USABLE_ANSWER_REASON (A1, D-136).
 */
export async function frameworkStep(
  io: InitIo,
  choice: Choice,
  roles: readonly RoleSpec[],
): Promise<StepResult<Framed>> {
  switch (choice.kind) {
    case 'chosen':
      return accepted({ roles, repoDefault: choice.id })
    case 'ambiguous':
    case 'installed-only':
      return askFrameworks(io, choice, roles)
    case 'unsupported':
      await noteLine(io, choiceLine(choice))

      return accepted({ roles, repoDefault: 'none' })
    case 'none':
      return accepted({ roles, repoDefault: 'none' })
  }
}
