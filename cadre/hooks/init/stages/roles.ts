/**
 * The roles stage of init (ROLE-01, ROLE-02, D-40, D-46, D-47, D-83, D-230, A1, A6), a layer 10 module: the roles
 * question with the proposal and its scan changes (proposalLines, rolesContextLine), the Adjust loop over the
 * frameworks installed for the repo (installedFrameworks), the Describe question whose text the model turns into roles
 * (a describe-roles model effect), and rolesStage, the pure stage whose cursor is the proposal, Adjust or Describe
 * until the person answers Use these roles. Pure: it gives states and never performs an effect, imports core, roles,
 * suggest types, ui/ask, init/state and the duration and frameworks stages, and never imports init/machine or init/run.
 */
import type { Detection, FrameworkId, RoleChange, RoleSpec } from '../../../types'
import { SUPPORTED_IDS } from '../../core/framework-id'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { redactedText } from '../../core/redact'
import { reportText } from '../../core/text'
import { applyAdjust, parseAdjust } from '../../roles/adjust'
import type { Proposed } from '../../suggest/propose'
import { ASK_HEADERS, askedText, choiceAnswer, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { proposalLines, roleLines, rolesContext } from '../../ui/blocks/context'
import { stageCancelled, stageDone, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, InitState, StageDef } from '../state'
import { idsOf } from './duration'
import { FRAMEWORK_LABELS } from './frameworks'

/** The roles question init asks after it shows the proposal (D-46). */
export const ROLES_QUESTION = 'Use these roles?'

/** What the person can do with the roles shown: use them, adjust them, or describe a structure of their own. */
type RolesChoice = 'use' | 'adjust' | 'describe'

/** Each answer to the roles question with what it does, in the order the dialog shows them (D-46). */
const ROLES_CHOICES: readonly Labelled<RolesChoice>[] = Object.freeze([
  { label: 'Use these roles', value: 'use' },
  { label: 'Adjust them', value: 'adjust' },
  { label: 'Describe my own structure', value: 'describe' },
])

/**
 * The answers to the roles question, in the order use, adjust, describe: the dialog focuses the first option; the
 * order is fixed (D-46).
 */
export const ROLES_OPTIONS: readonly string[] = Object.freeze(ROLES_CHOICES.map(entry => entry.label))

/** The free-text question for the person's own role structure (ROLE-02); its answer is all the model sees (D-83). */
export const DESCRIBE_QUESTION = 'Describe your role structure in your own words: type it under Other.'

/** The context line of the describe question (D-136): an example of a structure in a person's own words. */
export const DESCRIBE_CONTEXT = 'For example: a PM, one full-stack developer, and a QA who also covers security.'

/** What a button of the describe question does: back to the template, or end init. */
type DescribeChoice = 'template' | 'cancel'

/** Each button of the describe question with what it does. */
const DESCRIBE_CHOICES: readonly Labelled<DescribeChoice>[] = Object.freeze([
  { label: 'Use the template instead', value: 'template' },
  { label: 'Cancel init', value: 'cancel' },
])

/** The buttons of the describe question; the description itself is typed in the text field. */
export const DESCRIBE_OPTIONS: readonly string[] = Object.freeze(DESCRIBE_CHOICES.map(entry => entry.label))

/** What the describe question takes, as its refusal lists it: a typed description or one of its buttons (D-136). */
const DESCRIBE_ACCEPTS = `a description of your roles, ${quotedLabels(DESCRIBE_OPTIONS)}`

/** The Adjust question (D-47): one typed change per answer, with an example of each of the four changes. */
export const ADJUST_QUESTION =
  'Adjust the roles: type one change under Other, for example add docs "Docs writer", drop fe, rename be api "API", ' +
  'or framework qa gsd.'

/** What a button of the Adjust question does: end the loop, or show the roles as they are now in the side pane. */
type AdjustChoice = 'done' | 'show'

/** Each button of the Adjust question with what it does. */
const ADJUST_CHOICES: readonly Labelled<AdjustChoice>[] = Object.freeze([
  { label: 'Done adjusting', value: 'done' },
  { label: 'Show the roles', value: 'show' },
])

/** The buttons of the Adjust question; a change itself is typed in the text field. */
export const ADJUST_OPTIONS: readonly string[] = Object.freeze(ADJUST_CHOICES.map(entry => entry.label))

/** The context line of the Adjust question (D-136): the ids of the roles as they are now, after the changes so far. */
export function adjustContextLine(roles: readonly RoleSpec[]): string {
  return `Roles now: ${idsOf(roles)}.`
}

/** The most times the roles question is asked; the round after them cancels, so no roles are taken unconfirmed (A1). */
export const MAX_ROLE_ROUNDS = 10

/** The most answers the Adjust loop takes; after them it shows the roles so far and goes back to the roles question. */
export const MAX_ADJUST_ROUNDS = 30

/** Why the roles step cancels once the roles question was asked MAX_ROLE_ROUNDS times (A1). */
export const ROLE_ROUNDS_REASON =
  `The roles question was asked ${MAX_ROLE_ROUNDS} times without "Use these roles": nothing was chosen.`

/** The note the Adjust loop prints at its cap, before it goes back to the roles question with the roles so far (A1). */
export const ADJUST_ROUNDS_NOTE =
  `Adjust took ${MAX_ADJUST_ROUNDS} answers without "Done adjusting": showing the roles as they are now.`

/** Why the roles step cancels when its question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
export const ROLES_DISMISSED_REASON = 'The roles question was dismissed or not answered.'

/** Why the roles step cancels when the Adjust question is dismissed (A1). */
export const ADJUST_DISMISSED_REASON = 'The Adjust question was dismissed.'

/** Why the roles step cancels when the describe question is dismissed or `Cancel init` is chosen there (A1). */
export const DESCRIBE_CANCELLED_REASON = 'The describe question was dismissed or cancelled.'

/**
 * The context line of the roles question (G-02-1, D-136): every role shown by its title, its secret-like spans hidden
 * (redactedText, E1, #163), and id, then, when the scan changed the template, how many changes it made (`1 change`,
 * `<n> changes`).
 */
export function rolesContextLine(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string {
  const proposed = `Proposed: ${roles.map(role => `${redactedText(role.title)} (${role.id})`).join(', ')}`
  if (changes.length === 0) return `${proposed}.`
  const noun = changes.length === 1 ? 'change' : 'changes'

  return `${proposed}; ${changes.length} ${noun} from the scan.`
}

/** An answer to the describe question: one of its buttons, or the typed description. */
type DescribeAnswer =
  | { readonly kind: 'template' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'text'; readonly text: string }

/** The answer to the describe question; null for a blank one, so it is asked again and never sent to the model. */
function parseDescribeAnswer(answer: string): DescribeAnswer | null {
  const choice = labelled(DESCRIBE_CHOICES, answer)
  if (choice === 'template') return { kind: 'template' }
  if (choice === 'cancel') return { kind: 'cancel' }
  const text = answer.trim()
  if (text === '') return null

  return { kind: 'text', text }
}

/** The message for a typed line that is none of the four changes (D-47). */
function unreadChange(answer: string): string {
  return `Could not read that change: ${answer.trim()}. Use add, drop, rename or framework.`
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

/** The message for an Adjust line that sets a role to a framework this repo does not have installed (A5). */
function notInstalledMessage(id: string, framework: FrameworkId, installed: readonly FrameworkId[]): string {
  const names = installed.map(item => FRAMEWORK_LABELS[item]).join(', ')

  return (
    `Cannot set ${id} to ${framework}: it is not installed for this repo (installed: ${names}). ` +
    `${id} keeps its framework.`
  )
}

/**
 * The roles after one typed change, or the exact message why the line cannot be read or the change applied. Setting a
 * role the team has to a framework outside `installed` is refused, so the role keeps its framework (A5).
 */
function adjusted(
  roles: readonly RoleSpec[],
  answer: string,
  installed: readonly FrameworkId[],
): ReturnType<typeof applyAdjust> {
  const op = parseAdjust(answer)
  if (op === null) return { kind: 'error', message: unreadChange(answer) }
  if (op.kind === 'framework' && roles.some(role => role.id === op.id) && !installed.includes(op.framework)) {
    return { kind: 'error', message: notInstalledMessage(op.id, op.framework, installed) }
  }

  return applyAdjust(roles, op)
}

/** The answer to the roles question, or null when it names none of the three, so it is asked again. */
function parseRolesChoice(answer: string): RolesChoice | null {
  return labelled(ROLES_CHOICES, answer)
}

/** A question of the roles stage as it asks it: a ChoiceAsk with the reason a dismissal cancels with. */
type RolesAsk<T> = ChoiceAsk<T> & { readonly dismissedReason: string }

/**
 * The roles question (D-46, D-136): ROLES_QUESTION with rolesContextLine for `roles` and `changes` on its second line,
 * its three answers with the Roles chip and the roles as its own context (rolesContext, D-236), and
 * ROLES_DISMISSED_REASON for a dismissal.
 */
function rolesAsk(roles: readonly RoleSpec[], changes: readonly RoleChange[]): RolesAsk<RolesChoice> {
  return {
    question: withContext(ROLES_QUESTION, rolesContextLine(roles, changes)),
    spec: { options: ROLES_OPTIONS, header: ASK_HEADERS.roles, context: rolesContext(roles, changes) },
    parse: parseRolesChoice,
    accepts: quotedLabels(ROLES_OPTIONS),
    dismissedReason: ROLES_DISMISSED_REASON,
  }
}

/**
 * The describe question (ROLE-02, D-136): DESCRIBE_QUESTION with DESCRIBE_CONTEXT on its second line, its two buttons
 * with the Describe chip, a typed description that is not blank (parseDescribeAnswer), and DESCRIBE_CANCELLED_REASON
 * for a dismissal.
 */
const DESCRIBE_ASK = Object.freeze({
  question: withContext(DESCRIBE_QUESTION, DESCRIBE_CONTEXT),
  spec: Object.freeze({ options: DESCRIBE_OPTIONS, header: ASK_HEADERS.describe }),
  parse: parseDescribeAnswer,
  accepts: DESCRIBE_ACCEPTS,
  dismissedReason: DESCRIBE_CANCELLED_REASON,
})

/** The dialog of the Adjust question: its two buttons with the Adjust chip; a change is typed in the text field. */
const ADJUST_SPEC = Object.freeze({ options: ADJUST_OPTIONS, header: ASK_HEADERS.adjust })

/** The Adjust cursor: the proposal it came from, how many Adjust answers so far, and the roles as adjusted so far. */
type AdjustCursor = {
  readonly rounds: number
  readonly round: number
  readonly roles: readonly RoleSpec[]
  readonly changes: readonly RoleChange[]
}

/**
 * The roles proposed (A1, A6): the proposal block in the side pane (proposalLines), then the roles question about
 * `roles` with their scan `changes`, the `rounds + 1`-th proposal; once MAX_ROLE_ROUNDS proposals were asked, the next
 * one cancels with ROLE_ROUNDS_REASON instead, so no cap ever accepts roles.
 */
function proposed(
  state: InitState,
  roles: readonly RoleSpec[],
  changes: readonly RoleChange[],
  rounds: number,
): InitState {
  if (rounds >= MAX_ROLE_ROUNDS) return stageCancelled(state, ROLE_ROUNDS_REASON)
  const shown = withOutputs(state, [{ kind: 'show', block: { key: 'roles', lines: proposalLines(roles, changes) } }])
  const ask = rolesAsk(roles, changes)
  const sub: InitState['sub'] = { kind: 'roles', tries: 1, rounds: rounds + 1, roles, changes }

  return withEffect({ ...shown, sub }, { kind: 'ask', question: ask.question, spec: ask.spec })
}

/**
 * The Adjust question for the roles of `cursor` (D-47, D-136), with `refusal` on top and the roles as they are now as
 * its own context (rolesContext, D-236).
 */
function adjustAsked(state: InitState, cursor: AdjustCursor, refusal: string | null): InitState {
  const question = askedText(withContext(ADJUST_QUESTION, adjustContextLine(cursor.roles)), refusal)
  const spec = { ...ADJUST_SPEC, context: rolesContext(cursor.roles, cursor.changes) }

  return withEffect({ ...state, sub: { kind: 'adjust', ...cursor } }, { kind: 'ask', question, spec })
}

/**
 * The next Adjust ask with `roles` and `refusal` on top; after MAX_ADJUST_ROUNDS answers, ADJUST_ROUNDS_NOTE and the
 * roles so far proposed again, so a cap is never an acceptance (A1).
 */
function adjustAgain(
  state: InitState,
  cursor: AdjustCursor,
  roles: readonly RoleSpec[],
  refusal: string | null,
): InitState {
  const round = cursor.round + 1
  if (round <= MAX_ADJUST_ROUNDS) return adjustAsked(state, { ...cursor, round, roles }, refusal)
  const noted = withOutputs(state, [{ kind: 'note', line: ADJUST_ROUNDS_NOTE }])

  return proposed(noted, roles, cursor.changes, cursor.rounds)
}

/**
 * The answer to the Adjust question (D-47): `Done adjusting` proposes the roles as adjusted, with the same scan
 * changes; `Show the roles` shows them in the side pane (roleLines) and asks again; a typed change, add, drop, rename
 * or framework, is applied, or its exact message, cleaned as a report cell, goes on top of the next ask (D-136). A
 * framework outside the ones installed for the repo is refused (A5). A dismissal cancels with ADJUST_DISMISSED_REASON.
 */
function afterAdjust(
  state: InitState,
  cursor: AdjustCursor,
  installed: readonly FrameworkId[],
  answer: string | null,
): InitState {
  if (answer === null) return stageCancelled(state, ADJUST_DISMISSED_REASON)
  const choice = labelled(ADJUST_CHOICES, answer)
  if (choice === 'done') return proposed(state, cursor.roles, cursor.changes, cursor.rounds)
  if (choice === 'show') {
    const shown = withOutputs(state, [{ kind: 'show', block: { key: 'roles', lines: roleLines(cursor.roles) } }])

    return adjustAgain(shown, cursor, cursor.roles, null)
  }
  const result = adjusted(cursor.roles, answer, installed)
  if (result.kind === 'error') return adjustAgain(state, cursor, cursor.roles, reportText(result.message))

  return adjustAgain(state, cursor, result.roles, null)
}

/** Where the describe question is: the proposal it came after, with its roles and their scan changes, and its tries. */
type DescribeCursor = Omit<Extract<InitState['sub'], { readonly kind: 'describe' }>, 'kind'>

/**
 * The describe question at `cursor`, with the roles it was asked from as its own context (rolesContext, D-236);
 * `question` is its text once refused.
 */
function describeAsked(state: InitState, cursor: DescribeCursor, question: string | null): InitState {
  const sub: InitState['sub'] = { kind: 'describe', ...cursor }
  const spec = { ...DESCRIBE_ASK.spec, context: rolesContext(cursor.roles, cursor.changes) }

  return withEffect({ ...state, sub }, { kind: 'ask', question: question ?? DESCRIBE_ASK.question, spec })
}

/**
 * The answer to the describe question (ROLE-02, D-83): a blank answer is asked again with why on top and never sent to
 * the model; `Use the template instead` proposes the template again with no model call; `Cancel init`, a dismissal or
 * MAX_ASKS blank answers cancel (A1). A typed description is the describe-roles model effect, and only its text reaches
 * the model.
 */
function afterDescribe(state: InitState, cursor: DescribeCursor, answer: string | null): InitState {
  const { proposal } = state.draft
  if (proposal === undefined) return stageFailed(state)
  const { rounds } = cursor
  const next = choiceAnswer(DESCRIBE_ASK, cursor, answer)
  if (next.kind === 'again') return describeAsked(state, { ...cursor, tries: next.sub.tries }, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const described = next.value
  if (described.kind === 'cancel') return stageCancelled(state, DESCRIBE_CANCELLED_REASON)
  if (described.kind === 'template') return proposed(state, proposal.roles, proposal.changes, rounds)
  const calling: InitState = { ...state, sub: { kind: 'describe-model', rounds } }

  return withEffect(calling, { kind: 'model', call: { id: 'describe-roles', text: described.text } })
}

/**
 * The model's answer for a described structure: its roles are proposed with no scan changes (A6) and decide nothing
 * until the person answers Use these roles; roles it could not give put the fallback line in the notes, and the
 * template is proposed again.
 */
function afterDescribed(state: InitState, rounds: number, described: Proposed): InitState {
  const { proposal } = state.draft
  if (proposal === undefined) return stageFailed(state)
  if (described.kind === 'roles') return proposed(state, described.roles, [], rounds)
  const noted = withOutputs(state, [{ kind: 'note', line: described.message }])

  return proposed(noted, proposal.roles, proposal.changes, rounds)
}

/**
 * Whether `roles` is the team the kept model results were made for, the team in the draft (ASKED #14, #137): the same
 * roles by id, title and purpose, in any order. A Change roles go-back that adds, drops or renames a role, or changes a
 * title or purpose by Adjust or Describe, drops them, so the own skills and the instruction parts are recommended
 * again; an unchanged team keeps them (D-235).
 */
function isKeptTeam(before: readonly RoleSpec[] | undefined, roles: readonly RoleSpec[]): boolean {
  if (before === undefined || before.length !== roles.length) return false
  const byId = new Map(before.map((role): [string, RoleSpec] => [role.id, role]))

  return roles.every(role => {
    const was = byId.get(role.id)

    return was !== undefined && was.title === role.title && was.purpose === role.purpose
  })
}

/**
 * The answer to the roles question (choiceAnswer): only `Use these roles` accepts the roles shown, with the scan
 * changes shown with them (A6), keeping the kept model results only for the same roles by id, title and purpose
 * (isKeptTeam); `Adjust them` asks the Adjust question and `Describe my own structure` the describe question. Any other
 * answer is asked again with why on top; a dismissal cancels with ROLES_DISMISSED_REASON and MAX_ASKS answers that name
 * no choice with NO_USABLE_ANSWER_REASON (A1).
 */
function afterRoles(
  state: InitState,
  sub: Extract<InitState['sub'], { readonly kind: 'roles' }>,
  answer: string | null,
): InitState {
  const { roles, changes, rounds } = sub
  const ask = rolesAsk(roles, changes)
  const next = choiceAnswer(ask, sub, answer)
  if (next.kind === 'again') {
    const again: InitState = { ...state, sub: { ...sub, tries: next.sub.tries } }

    return withEffect(again, { kind: 'ask', question: next.question, spec: ask.spec })
  }
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.value === 'use') {
    const kept = isKeptTeam(state.draft.roles, roles) ? state.kept : null

    return stageDone({ ...state, draft: { ...state.draft, roles, changes }, kept })
  }
  if (next.value === 'adjust') return adjustAsked(state, { rounds, round: 1, roles, changes }, null)

  return describeAsked(state, { rounds, tries: 1, roles, changes }, null)
}

/** The answer to the effect the roles stage has out: the roles, Adjust or describe question, or the model call. */
function rolesAnswer(state: InitState, answer: Answer): InitState {
  const { installed } = state.draft
  const { sub } = state
  const isDescribed = answer.kind === 'model' && answer.result.id === 'describe-roles' && sub.kind === 'describe-model'
  if (isDescribed) return afterDescribed(state, sub.rounds, answer.result.result)
  if (answer.kind !== 'answer' || installed === undefined) return stageFailed(state)
  switch (sub.kind) {
    case 'roles':
      return afterRoles(state, sub, answer.text)
    case 'adjust':
      return afterAdjust(state, sub, installed, answer.text)
    case 'describe':
      return afterDescribe(state, sub, answer.text)
    default:
      return stageFailed(state)
  }
}

/**
 * The roles stage (ROLE-01, ROLE-02, D-40, D-46, D-47, D-83, D-230). It proposes the template proposal, or the current
 * team with the scan changes it was accepted with when the roles are asked again from the review (A6), and asks
 * `Use these roles?` about them (proposed). `Adjust them` runs the Adjust loop on them with the frameworks installed
 * for the repo and `Describe my own structure` the describe question, whose template answer goes back to the proposal
 * itself; either proposes again. Only `Use these roles` ends the stage with roles, with the scan changes shown with
 * them (none for a described structure, A6): a dismissal anywhere cancels with the reason of that question, and the
 * proposal after MAX_ROLE_ROUNDS with ROLE_ROUNDS_REASON, so roles nobody confirmed, such as a model's, are never used
 * (A1).
 */
export const rolesStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { proposal, installed, roles, changes } = state.draft
    if (proposal === undefined || installed === undefined) return stageFailed(state)
    if (roles === undefined) return proposed(state, proposal.roles, proposal.changes, 0)

    return proposed(state, roles, changes ?? [], 0)
  },
  answer: rolesAnswer,
})
