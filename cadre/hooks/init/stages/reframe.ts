/**
 * The review of /cadre frameworks, a layer 10 module: the frameworks flow's plan out as an io effect, a review of the
 * files that change with Confirm and Cancel, then the reply of a dry run or the apply and its reply. Pure: it gives
 * states and never performs an effect, and never imports init/machine or init/run.
 */
import type { Op, Plan } from '../../../types'
import { projectInstallOf } from '../../apply/installs'
import { appliedLines } from '../../apply/run'
import type { ApplyOutcome } from '../../apply/run'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { redactedText } from '../../core/redact'
import { t } from '../../locales/t'
import { DRY_RUN_NOTE, renderPlan } from '../../plan/text'
import { scanWarnings } from '../../scan/gather'
import { resolvedFramework } from '../../team'
import { ASK_HEADERS, choiceAnswer, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk, StepResult } from '../../ui/ask'
import { reviewContext } from '../../ui/blocks/context'
import { scanWarningLines } from '../../ui/blocks/scan'
import type { Draft, PlanResult, ReframeDraft, Reframed } from '../draft'
import { consentedPluginKeys, draftScopes } from '../initplan'
import type { PlanStepInput } from '../initplan'
import { stageCancelled, stageEnded, stageFailed, withEffect } from '../state'
import type { Answer, Applied, InitState, StageDef } from '../state'
import { FRAMEWORK_LABELS } from './frameworks'
import { CONFIRM_LABEL, REVIEW_DISMISSED_REASON, reviewPages } from './review'

/** What an option of the frameworks review stands for. */
type ReframeChoice = 'next' | 'previous' | 'confirm' | 'cancel'

/** The options of the frameworks review in the order a page shows them; Confirm counts only as its exact label. */
const REFRAME_CHOICES: readonly Labelled<ReframeChoice>[] = Object.freeze([
  { label: t('init.review.nextPage'), value: 'next' },
  { label: t('init.review.previousPage'), value: 'previous' },
  { label: CONFIRM_LABEL, value: 'confirm' },
  { label: t('frameworks.review.cancel'), value: 'cancel' },
])

/** The draft of the frameworks flow, or null while a field it needs is not set. */
export function reframeDraft(draft: Partial<Draft>): ReframeDraft | null {
  const { locations, gathered, readUserMcp, installed, roles, repoDefault, hunks, policy, launchStart } = draft
  if (locations === undefined || gathered === undefined || readUserMcp === undefined) return null
  if (installed === undefined || roles === undefined || repoDefault === undefined) return null
  if (hunks === undefined || policy === undefined || launchStart === undefined) return null
  const { frameworkSet, frameworkInstalls } = draft
  const fields = { locations, gathered, readUserMcp, installed, roles, repoDefault, hunks, policy, launchStart }

  return {
    ...fields,
    ...(frameworkSet === undefined ? {} : { frameworkSet }),
    ...(frameworkInstalls === undefined ? {} : { frameworkInstalls }),
  }
}

/** What the plan of the draft is made from, its scopes compiled as Confirm writes them when every install works. */
function reframeInput(draft: ReframeDraft): PlanStepInput {
  const { scopes, recorded } = draftScopes(draft, consentedPluginKeys(draft, []))

  return {
    roles: draft.roles,
    repoDefault: draft.repoDefault,
    policy: draft.policy,
    launchStart: draft.launchStart,
    scopes,
    hunks: draft.hunks,
    repo: draft.gathered.repo,
    locations: draft.locations,
    readUserMcp: draft.readUserMcp,
    ...recorded,
  }
}

/** The plan with its leave ops left out: the files that change and the hunks. */
function changedPlan(plan: Plan): Plan {
  return { ...plan, ops: plan.ops.filter(op => op.kind !== 'leave') }
}

/** Whether the plan changes nothing: no file op but leave, no accepted hunk and no install to run. */
function isNothingToDo(draft: ReframeDraft, plan: Plan): boolean {
  const isIdle = (op: Op): boolean => op.kind === 'leave' || (op.kind === 'hunk' && !op.isAccepted)

  return plan.ops.every(isIdle) && (draft.frameworkInstalls ?? []).length === 0
}

/** The frameworks kept, as the set question names them, then each role with its resolved framework. */
function summaryLines(draft: ReframeDraft): string[] {
  const kept = draft.frameworkSet ?? []
  const names = kept.map(id => FRAMEWORK_LABELS[id]).join(t('init.frameworks.setNamesJoin'))
  const roles = draft.roles.map(role => {
    const framework = FRAMEWORK_LABELS[resolvedFramework(role, draft.repoDefault)]

    return t('frameworks.review.role', { id: role.id, framework })
  })

  return [t('frameworks.review.kept', { names: kept.length === 0 ? FRAMEWORK_LABELS.none : names }), ...roles]
}

/** The review lines: the summary, each consented install, the files that change and the scan warnings, redacted. */
function reviewedLines(draft: ReframeDraft, plan: Plan): string[] {
  const installs = (draft.frameworkInstalls ?? []).flatMap(id => {
    const install = projectInstallOf(id)
    if (install === null) return []

    return [t('init.review.frameworkInstall', { command: install.argv.join(' '), writes: install.writes.join(', ') })]
  })

  return [
    ...summaryLines(draft),
    ...installs,
    ...renderPlan(changedPlan(plan)),
    ...scanWarningLines(scanWarnings(draft.locations, draft.gathered)),
  ].map(line => redactedText(line))
}

/**
 * The reply of /cadre frameworks: its head, the summary and the files that change, then the dry-run note, or what the
 * apply did.
 */
export function reframeReplyText(reframed: Reframed, outcome: ApplyOutcome | null): string {
  const head = outcome === null ? t('frameworks.reply.headDry') : t('frameworks.reply.head')
  const ending = outcome === null ? [DRY_RUN_NOTE] : appliedLines(outcome, t('frameworks.manifestSkippedNote'))

  const lines = [head, ...summaryLines(reframed.draft), ...renderPlan(changedPlan(reframed.planned.plan)), ...ending]

  return lines.join('\n')
}

/** Page `page` of the review, paged to the rows and code points of the state's surface module at its page width. */
function reframeAsk(
  state: InitState,
  draft: ReframeDraft,
  plan: Plan,
  page: number,
): ChoiceAsk<ReframeChoice> & { readonly dismissedReason: string } {
  const { rows, maxChars } = state.surface.reviewPaging
  const pages = reviewPages(reviewedLines(draft, plan), rows, state.pageColumns, maxChars)
  const at = Math.min(Math.max(0, page), pages.length - 1)
  const choices = REFRAME_CHOICES.filter(({ value }) => {
    if (value === 'next') return at < pages.length - 1
    if (value === 'previous') return at > 0

    return true
  })
  const labels = choices.map(choice => choice.label)
  const title =
    pages.length === 1 ? t('init.review.title') : t('init.review.pagedTitle', { number: at + 1, count: pages.length })
  const question = t('frameworks.review.question')
  const files = changedPlan(plan).ops.filter(op => op.kind !== 'hunk').length
  const context = { ...reviewContext(pages[at] ?? [], files, draft.roles.length), title }
  const summarised = withContext(question, context.summary)
  const text = pages.length === 1 ? summarised : `${summarised}\n${title}`
  const parse = (answer: string): ReframeChoice | null => {
    if (answer === CONFIRM_LABEL) return 'confirm'
    const choice = labelled(choices, answer)

    return choice === 'confirm' ? null : choice
  }

  return {
    question,
    spec: { options: labels, header: ASK_HEADERS.review, context: { ...context, pane: { asked: question, text } } },
    parse,
    accepts: quotedLabels(labels),
    dismissedReason: REVIEW_DISMISSED_REASON,
  }
}

/** The review about `planned` asked on page `page`, `tries` times so far; `question` is its text after a refusal. */
function reviewAsked(
  state: InitState,
  planned: PlanResult,
  question: string | null,
  tries: number,
  page: number,
): InitState {
  const draft = reframeDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const ask = reframeAsk(state, draft, planned.plan, page)
  const asking: InitState = { ...state, sub: { kind: 'review', tries, planned, page } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/** The plan of the draft out, an io effect (reframePlan, run by init/run). */
function planning(state: InitState): InitState {
  const draft = reframeDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const planned: InitState = { ...state, sub: { kind: 'start' } }

  return withEffect(planned, { kind: 'io', call: { id: 'reframe-plan', input: reframeInput(draft) } })
}

/** After the plan: the nothing-changes reply when it changes nothing, else the review on its first page. */
function afterPlan(state: InitState, planned: PlanResult): InitState {
  const draft = reframeDraft(state.draft)
  if (draft === null) return stageFailed(state)
  if (isNothingToDo(draft, planned.plan)) return stageEnded(state, t('frameworks.reply.nothing'))

  return reviewAsked(state, planned, null, 1, 0)
}

/** Confirm: a dry run replies with the plan just shown; a plain run has it applied (reframeApplied, by init/run). */
function confirmed(state: InitState, reframed: Reframed): InitState {
  if (state.dryRun) return stageEnded(state, reframeReplyText(reframed, null))
  const applying: InitState = { ...state, sub: { kind: 'applying' } }

  return withEffect(applying, { kind: 'io', call: { id: 'reframe-apply', reframed } })
}

/**
 * The answer to the review: a page move asks that page, Confirm confirms, Cancel cancels with its own reason; any
 * other answer is asked again with why on top, and a dismissal cancels.
 */
function afterReviewAnswer(state: InitState, answer: string | null): InitState {
  const draft = reframeDraft(state.draft)
  if (state.sub.kind !== 'review' || draft === null) return stageFailed(state)
  const { planned, page } = state.sub
  const next = choiceAnswer(reframeAsk(state, draft, planned.plan, page), state.sub, answer)
  if (next.kind === 'again') return reviewAsked(state, planned, next.question, next.sub.tries, page)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.value === 'next') return reviewAsked(state, planned, null, 1, page + 1)
  if (next.value === 'previous') return reviewAsked(state, planned, null, 1, page - 1)
  if (next.value === 'cancel') return stageCancelled(state, t('frameworks.review.cancelledReason'))

  return confirmed(state, { draft, planned })
}

/** Confirm's apply: the reply with the plan as written and what the apply did. */
function afterApply(state: InitState, result: StepResult<Applied> | null): InitState {
  const draft = reframeDraft(state.draft)
  if (result === null || draft === null) return stageFailed(state)
  if (result.kind === 'cancelled') return stageCancelled(state, result.reason)
  const { planned, outcome } = result.value

  return stageEnded(state, reframeReplyText({ draft, planned }, outcome))
}

/** The answer to the effect the review has out: the plan, the review question, or Confirm's apply. */
function reframeAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind === 'answer') return afterReviewAnswer(state, answer.text)
  if (answer.kind !== 'io') return stageFailed(state)
  const { result } = answer
  if (result.id === 'reframe-plan') return afterPlan(state, result.result)
  if (result.id === 'reframe-apply') return afterApply(state, result.result)

  return stageFailed(state)
}

/** The review stage of the frameworks flow: plan, review, then the reply or the apply. */
export const reframeReviewStage: StageDef = Object.freeze({
  enter: planning,
  answer: reframeAnswer,
})
