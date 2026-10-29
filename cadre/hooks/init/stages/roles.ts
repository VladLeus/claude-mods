/**
 * The roles stage of init (ROLE-01, ROLE-02, D-40, D-46, D-47, D-83, A1, A6), a layer 10 module: the roles question
 * with the proposal and its scan changes (proposalLines, rolesContextLine), the Adjust loop over the frameworks
 * installed for the repo (adjustLoop, installedFrameworks), the Describe question that has the model propose roles
 * (describeStep), and rolesStep, which runs the states of RolesState until the person answers Use these roles. Pure:
 * it asks and calls the model through the InitIo port it is given, imports core, roles, suggest, ui/ask and the
 * duration and frameworks stages, and never imports init.ts, which imports it, or init/run.
 */
import type { Detection, FrameworkId, InitIo, RoleChange, RoleProposal, RoleSpec } from '../../../types'
import { SUPPORTED_IDS } from '../../core/framework-id'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { pad, reportText } from '../../core/text'
import { applyAdjust, parseAdjust } from '../../roles/adjust'
import { proposeFromText } from '../../suggest/propose'
import type { Proposed } from '../../suggest/propose'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  askedText,
  askOnce,
  cancelled,
  choiceResult,
  noteLine,
  quotedLabels,
  showBlock,
  withContext,
} from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
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
export const DESCRIBE_QUESTION = 'Describe your role structure in your own words (type it in the text field).'

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
  'Adjust the roles: type one change, for example add docs "Docs writer", drop fe, rename be api "API", ' +
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

/** The column, in code points, where a role's purpose starts in the proposal, after its title and id. */
const ROLE_LABEL_WIDTH = 24

/** The roles as the proposal lists them: a heading, then one line per role with its title, id and purpose. */
function roleLines(roles: readonly RoleSpec[]): string[] {
  const rows = roles.map(role => `  ${pad(`${role.title} (${role.id})`, ROLE_LABEL_WIDTH)}${role.purpose}`)

  return ['Proposed roles:', ...rows]
}

/** One scan change: dropped or kept, the role id and the reason, then its evidence paths when there are any. */
function changeLine(change: RoleChange): string {
  const evidence = change.evidence.length === 0 ? '' : ` (${change.evidence.join(', ')})`

  return `  ${change.change} ${change.roleId}: ${change.reason}${evidence}`
}

/**
 * The proposal as init shows it in the side pane before the roles question (ROLE-01, D-133): every role with its title,
 * id and purpose, then every change the scan made to the template with its reason and evidence, or `none` when it made
 * none.
 */
export function proposalLines(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string[] {
  const changeRows = changes.length === 0 ? ['  none'] : changes.map(changeLine)

  return [...roleLines(roles), 'Changes from the scan:', ...changeRows]
}

/**
 * The context line of the roles question (G-02-1, D-136): every role shown by its title and id, then, when the scan
 * changed the template, how many changes it made (`1 change`, `<n> changes`).
 */
export function rolesContextLine(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string {
  const proposed = `Proposed: ${roles.map(role => `${role.title} (${role.id})`).join(', ')}`
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

/**
 * What describeStep gives: the described roles, a return to the template, the fallback and why, or a cancel with
 * its reason (A1, D-136).
 */
export type Described =
  | Proposed
  | { readonly kind: 'template' }
  | { readonly kind: 'cancelled'; readonly reason: string }

/**
 * The Describe path (ROLE-02, D-46, D-83): the person types their own structure in the text field of DESCRIBE_QUESTION,
 * which carries DESCRIBE_CONTEXT on its second line (D-136). A blank answer is asked again with why on top and never
 * sent to the model; `Use the template instead` goes back with no model call; `Cancel init` or a dismissed dialog is
 * cancelled with DESCRIBE_CANCELLED_REASON, and MAX_ASKS blank answers with NO_USABLE_ANSWER_REASON (A1). Only the
 * typed text reaches the model, and its roles decide nothing until the person answers the roles question again.
 */
export async function describeStep(io: InitIo): Promise<Described> {
  const ask = {
    question: withContext(DESCRIBE_QUESTION, DESCRIBE_CONTEXT),
    spec: { options: DESCRIBE_OPTIONS, header: ASK_HEADERS.describe },
    parse: parseDescribeAnswer,
    accepts: DESCRIBE_ACCEPTS,
  }
  const answer = choiceResult(await askChoice(io, ask), DESCRIBE_CANCELLED_REASON)
  if (answer.kind === 'cancelled') return answer
  if (answer.value.kind === 'cancel') return { kind: 'cancelled', reason: DESCRIBE_CANCELLED_REASON }
  if (answer.value.kind === 'template') return { kind: 'template' }

  return proposeFromText(io, answer.value.text)
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

/**
 * What the Adjust loop gives (A1): the roles as adjusted, which are no choice yet, since the roles question still has
 * to confirm them, or why the loop was cancelled.
 */
export type AdjustOutcome =
  | { readonly kind: 'adjusted'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'cancelled'; readonly reason: string }

/**
 * The Adjust loop (D-47): one typed change per answer, add, drop, rename or framework, until `Done adjusting`, which
 * gives the roles as adjusted. A line it cannot read, a change applyAdjust refuses, or a framework outside
 * `installed` (A5) puts its exact message, cleaned as a report cell, on top of the next Adjust ask and the loop goes
 * on (D-136); every ask carries the ids of the roles as they are now (adjustContextLine) on the line after the
 * question; `Show the roles` shows the roles as they are now in the side pane. A dismissed dialog cancels with
 * ADJUST_DISMISSED_REASON. After MAX_ADJUST_ROUNDS answers it prints ADJUST_ROUNDS_NOTE and gives the roles adjusted
 * so far, so the roles question asks about them again: a cap is never an acceptance (A1). The roles it is given are
 * never changed. It keeps its own loop, not askChoice: it runs MAX_ADJUST_ROUNDS rounds, a refused change does not end
 * it, and a taken change asks again with the new roles.
 */
export async function adjustLoop(
  io: InitIo,
  roles: readonly RoleSpec[],
  installed: readonly FrameworkId[],
): Promise<AdjustOutcome> {
  const spec = { options: ADJUST_OPTIONS, header: ASK_HEADERS.adjust }
  let current = roles
  let refusal: string | null = null
  for (let round = 0; round < MAX_ADJUST_ROUNDS; round += 1) {
    const question = withContext(ADJUST_QUESTION, adjustContextLine(current))
    const answer = await askOnce(io, askedText(question, refusal), spec)
    if (answer === null) return { kind: 'cancelled', reason: ADJUST_DISMISSED_REASON }
    refusal = null
    const choice = labelled(ADJUST_CHOICES, answer)
    if (choice === 'done') return { kind: 'adjusted', roles: current }
    if (choice === 'show') {
      await showBlock(io, 'roles', roleLines(current))
      continue
    }
    const result = adjusted(current, answer, installed)
    if (result.kind === 'error') {
      refusal = reportText(result.message)
      continue
    }
    current = result.roles
  }
  await noteLine(io, ADJUST_ROUNDS_NOTE)

  return { kind: 'adjusted', roles: current }
}

/** The answer to the roles question, or null when it names none of the three, so it is asked again. */
function parseRolesChoice(answer: string): RolesChoice | null {
  return labelled(ROLES_CHOICES, answer)
}

/**
 * The state of the roles step (A1, D-40, D-83):
 * - `proposed`: the roles, with the scan changes behind them (none for a described structure), are shown and the
 *   roles question is asked.
 * - `adjusting`: the Adjust loop runs on those roles.
 * - `describing`: the person describes a structure of their own.
 * - `accepted`: the person answered `Use these roles` for the roles shown, with the scan changes shown with them (A6);
 *   the only state that holds a choice.
 * - `cancelled`: the step ended with nothing chosen, and `reason` says why.
 */
export type RolesState =
  | { readonly kind: 'proposed'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'adjusting'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'describing' }
  | { readonly kind: 'accepted'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'cancelled'; readonly reason: string }

/** The roles step cancelled with a reason. */
function rolesCancelled(reason: string): RolesState {
  return { kind: 'cancelled', reason }
}

/**
 * After `proposed`: the roles are shown and asked about, with rolesContextLine on the line after the question
 * (D-136); only `Use these roles` accepts them. A dismissal cancels with ROLES_DISMISSED_REASON and MAX_ASKS answers
 * that name no choice with NO_USABLE_ANSWER_REASON (A1).
 */
async function afterProposed(
  io: InitIo,
  state: Extract<RolesState, { readonly kind: 'proposed' }>,
): Promise<RolesState> {
  await showBlock(io, 'roles', proposalLines(state.roles, state.changes))
  const ask = {
    question: withContext(ROLES_QUESTION, rolesContextLine(state.roles, state.changes)),
    spec: { options: ROLES_OPTIONS, header: ASK_HEADERS.roles },
    parse: parseRolesChoice,
    accepts: quotedLabels(ROLES_OPTIONS),
  }
  const picked = choiceResult(await askChoice(io, ask), ROLES_DISMISSED_REASON)
  if (picked.kind === 'cancelled') return rolesCancelled(picked.reason)
  if (picked.value === 'use') return { kind: 'accepted', roles: state.roles, changes: state.changes }
  if (picked.value === 'adjust') return { kind: 'adjusting', roles: state.roles, changes: state.changes }

  return { kind: 'describing' }
}

/** After `adjusting`: the adjusted roles are proposed again with the same scan changes, or the step is cancelled. */
async function afterAdjusting(
  io: InitIo,
  state: Extract<RolesState, { readonly kind: 'adjusting' }>,
  installed: readonly FrameworkId[],
): Promise<RolesState> {
  const outcome = await adjustLoop(io, state.roles, installed)
  if (outcome.kind === 'cancelled') return rolesCancelled(outcome.reason)

  return { kind: 'proposed', roles: outcome.roles, changes: state.changes }
}

/**
 * After `describing`: the described roles are proposed with no scan changes; going back to the template, or roles the
 * model could not give (its reason printed first), proposes the template again; a dismissal, `Cancel init` or
 * MAX_ASKS blank answers cancel with the reason describeStep gives.
 */
async function afterDescribing(io: InitIo, proposal: RoleProposal): Promise<RolesState> {
  const described = await describeStep(io)
  if (described.kind === 'cancelled') return rolesCancelled(described.reason)
  if (described.kind === 'roles') return { kind: 'proposed', roles: described.roles, changes: [] }
  if (described.kind === 'fallback') await noteLine(io, described.message)

  return { kind: 'proposed', roles: proposal.roles, changes: proposal.changes }
}

/** The state after one step of the roles step; an end state stays as it is. */
async function nextState(
  io: InitIo,
  state: RolesState,
  proposal: RoleProposal,
  installed: readonly FrameworkId[],
): Promise<RolesState> {
  switch (state.kind) {
    case 'proposed':
      return afterProposed(io, state)
    case 'adjusting':
      return afterAdjusting(io, state, installed)
    case 'describing':
      return afterDescribing(io, proposal)
    case 'accepted':
    case 'cancelled':
      return state
  }
}

/**
 * The roles step (ROLE-01, ROLE-02, D-40, D-46, D-47, D-83), as the states of RolesState. It starts at `proposed`
 * with `start`, the proposal itself unless the final review passes the current team with the scan changes it was
 * accepted with (A6), and shows those roles and changes under `Use these roles?`. `Adjust them` runs adjustLoop with
 * the frameworks `installed` for the repo and `Describe my own structure` runs describeStep, whose template answer goes
 * back to the proposal itself; either goes back to `proposed`. Only the answer `Use these roles` gives roles, as an
 * accepted StepResult with the scan changes shown with them (none for a described structure, A6): a dismissal anywhere
 * is cancelled with the reason of that question, and the round after MAX_ROLE_ROUNDS proposals with
 * ROLE_ROUNDS_REASON, so roles nobody confirmed, such as a model's, are never used (A1).
 */
export async function rolesStep(
  io: InitIo,
  proposal: RoleProposal,
  installed: readonly FrameworkId[],
  start: RoleProposal = proposal,
): Promise<StepResult<RoleProposal>> {
  let state: RolesState = { kind: 'proposed', roles: start.roles, changes: start.changes }
  let rounds = 0
  for (;;) {
    if (state.kind === 'accepted') return accepted({ roles: state.roles, changes: state.changes })
    if (state.kind === 'cancelled') return state
    const isPastCap = state.kind === 'proposed' && rounds === MAX_ROLE_ROUNDS
    if (isPastCap) return cancelled(ROLE_ROUNDS_REASON)
    if (state.kind === 'proposed') rounds += 1
    state = await nextState(io, state, proposal, installed)
  }
}
