import { describe, expect, test } from 'claude-code/testing'

import type { FileOp, HunkOp, Op } from '../../../types'
import { projectInstallOf } from '../../apply/installs'
import { appliedLines, NOTHING_APPLIED } from '../../apply/run'
import { REDACTED } from '../../core/redact'
import { t } from '../../locales/t'
import { DRY_RUN_NOTE, renderPlan } from '../../plan/text'
import { DEFAULT_LOCATIONS, driven, stateAt, stateOf, templateRole, wholeDraft, withFramework } from '../../testkit'
import { quotedLabels, refusalLine } from '../../ui/ask'
import type { Draft, PlanResult } from '../draft'
import { consentedPluginKeys, draftScopes } from '../initplan'
import type { Answer, InitState } from '../state'
import { reframeDraft, reframeReplyText, reframeReviewStage } from './reframe'
import { REVIEW_DISMISSED_REASON } from './review'

/** BE on GSD and PM on none: the team the review is about. */
const ROLES = [withFramework(templateRole('be'), 'gsd'), withFramework(templateRole('pm'), 'none')]

/** The draft of the frameworks flow: GSD kept as the default, with its install consented. */
const DRAFT = wholeDraft({ roles: ROLES, repoDefault: 'gsd', frameworkSet: ['gsd'], frameworkInstalls: ['gsd'] })

/** GSD's mode hunk, declined. */
const DECLINED_HUNK: HunkOp = {
  kind: 'hunk',
  file: '.planning/config.json',
  key: 'mode',
  before: 'not set (GSD default)',
  after: '"yolo"',
  isRequired: true,
  isAccepted: false,
  isRunnable: true,
  command: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
}

/** A file op of `kind` at `path`, with no note. */
function op(kind: FileOp['kind'], path: string): FileOp {
  return { kind, path, mode: 'file', note: null }
}

/** A plan result with these ops and no warning. */
function plannedWith(ops: readonly Op[]): PlanResult {
  return {
    plan: { ops, warnings: [] },
    state: stateOf(ROLES, { framework: 'gsd', frameworks: ['gsd'] }),
    desired: [],
    manifest: { schema: 1, cadreVersion: '0.2.0', files: [] },
    gitignore: null,
  }
}

/** BE's ROLE.md changed and PM's left as it was. */
const CHANGED = plannedWith([op('change', '.cadre/be/ROLE.md'), op('leave', '.cadre/pm/ROLE.md')])

/** The rows renderPlan prints for the changed files of CHANGED. */
const CHANGED_ROWS = renderPlan({ ops: [op('change', '.cadre/be/ROLE.md')], warnings: [] })

/** The kept line and the role lines of DRAFT. */
const SUMMARY_LINES = [
  t('frameworks.review.kept', { names: 'GSD' }),
  t('frameworks.review.role', { id: 'be', framework: 'GSD' }),
  t('frameworks.review.role', { id: 'pm', framework: 'none (built-in)' }),
]

/** The review entered over `draft` in the frameworks flow; `over` replaces state fields. */
function entered(draft: Draft = DRAFT, over: Partial<InitState> = {}): InitState {
  return reframeReviewStage.enter(stateAt('reframe-review', draft, { flow: 'frameworks', ...over }))
}

/** The answer to the plan the review has out. */
function planAnswer(planned: PlanResult): Answer {
  return { kind: 'io', result: { id: 'reframe-plan', result: planned } }
}

/** The review asking about `planned` over `draft`. */
function asking(planned: PlanResult = CHANGED, draft: Draft = DRAFT, over: Partial<InitState> = {}): InitState {
  return reframeReviewStage.answer(entered(draft, over), planAnswer(planned))
}

/** An answer picked or typed at the review; null is a dismissal. */
function typed(text: string | null): Answer {
  return { kind: 'answer', text }
}

describe('the review of /cadre frameworks', () => {
  test('enter has the plan made from the roles as given, their scopes and hunks, with no repo parts', () => {
    const state = entered()
    const call = state.effect.kind === 'io' ? state.effect.call : null
    const input = call?.id === 'reframe-plan' ? call.input : null
    const { scopes } = draftScopes(DRAFT, consentedPluginKeys(DRAFT, []))
    expect([input?.roles, input?.repoDefault, input?.policy, input?.launchStart, input?.hunks]).toEqual([
      ROLES,
      'gsd',
      'definitions',
      { kind: 'git-root' },
      [],
    ])
    expect([input?.scopes, input?.locations, input?.repoParts]).toEqual([scopes, DEFAULT_LOCATIONS, undefined])
  })

  test('a plan of leave ops only, with no install and no accepted hunk, ends saying nothing changes', () => {
    const idle = plannedWith([op('leave', '.cadre/be/ROLE.md'), DECLINED_HUNK])
    const run = driven(entered({ ...DRAFT, frameworkInstalls: [] }), [], [planAnswer(idle)])
    const accepted = plannedWith([op('leave', '.cadre/be/ROLE.md'), { ...DECLINED_HUNK, isAccepted: true }])
    expect([run.state.effect, run.asked]).toEqual([{ kind: 'end', reply: t('frameworks.reply.nothing') }, []])
    expect(asking(idle).openQuestion?.question).toBe(t('frameworks.review.question'))
    expect(asking(accepted, { ...DRAFT, frameworkInstalls: [] }).openQuestion?.question).toBe(
      t('frameworks.review.question'),
    )
  })

  test('a one-page review asks its question with exactly Confirm and Cancel; a paged one adds the page moves', () => {
    const one = asking()
    const many = plannedWith(Array.from({ length: 40 }, (_, at) => op('change', `.cadre/r${at}/ROLE.md`)))
    const first = asking(many)
    const second = reframeReviewStage.answer(first, typed('Next page'))
    expect([one.openQuestion?.question, one.openQuestion?.spec.options]).toEqual([
      t('frameworks.review.question'),
      ['Confirm', 'Cancel'],
    ])
    expect([first.openQuestion?.spec.options, second.openQuestion?.spec.options]).toEqual([
      ['Next page', 'Confirm', 'Cancel'],
      ['Next page', 'Previous page', 'Confirm', 'Cancel'],
    ])
  })

  test('the review lines hold the kept line, the role lines, the install, the changed files, and no leave row', () => {
    const install = projectInstallOf('gsd')
    const command = install?.argv.join(' ') ?? ''
    const writes = install?.writes.join(', ') ?? ''
    expect(asking().openQuestion?.spec.context?.lines).toEqual([
      ...SUMMARY_LINES,
      t('init.review.frameworkInstall', { command, writes }),
      ...CHANGED_ROWS,
    ])
  })

  test('the scan warnings close the review lines, every line with its secret-like spans hidden', () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['a token ghp_FAKEFAKEFAKEFAKEFAKE leaked'] }
    const lines = asking(CHANGED, { ...DRAFT, locations }).openQuestion?.spec.context?.lines ?? []
    expect([JSON.stringify(lines).includes('ghp_FAKE'), lines.at(-1)?.includes(REDACTED)]).toEqual([false, true])
  })

  test("a typed 'confirm' is not Confirm: it is asked again with the refusal on top", () => {
    const run = driven(entered(), ['confirm', 'Cancel'], [planAnswer(CHANGED)])
    expect(run.asked.map(question => question.split('\n')[0])).toEqual([
      t('frameworks.review.question'),
      refusalLine('confirm', quotedLabels(['Confirm', 'Cancel'])),
    ])
  })

  test('Confirm in a dry run replies with its head, the summary, the changed files and the dry-run note', () => {
    const state = reframeReviewStage.answer(asking(), typed('Confirm'))
    const reply = reframeReplyText({ draft: DRAFT, planned: CHANGED }, null)
    expect(state.sub).toEqual({ kind: 'end', reply })
    expect(reply.split('\n')).toEqual([t('frameworks.reply.headDry'), ...SUMMARY_LINES, ...CHANGED_ROWS, DRY_RUN_NOTE])
  })

  test('Confirm in a plain run has the draft and plan applied, and the applied result ends the run', () => {
    const applying = reframeReviewStage.answer(asking(CHANGED, DRAFT, { dryRun: false }), typed('Confirm'))
    const call = applying.effect.kind === 'io' ? applying.effect.call : null
    const outcome = { ...NOTHING_APPLIED, written: ['.cadre/be/ROLE.md'] }
    const value = { planned: CHANGED, outcome }
    const applied: Answer = { kind: 'io', result: { id: 'reframe-apply', result: { kind: 'accepted', value } } }
    const reply = reframeReplyText({ draft: DRAFT, planned: CHANGED }, outcome)
    const reframed = call?.id === 'reframe-apply' ? call.reframed : null
    expect(reframed).toEqual({ draft: reframeDraft(DRAFT), planned: CHANGED })
    expect(reframeReviewStage.answer(applying, applied).sub).toEqual({ kind: 'end', reply })
    expect(reply.split('\n')).toEqual([
      t('frameworks.reply.head'),
      ...SUMMARY_LINES,
      ...CHANGED_ROWS,
      ...appliedLines(outcome, t('frameworks.manifestSkippedNote')),
    ])
  })

  test('Cancel cancels with its own reason, and a dismissal with the review dismissal reason', () => {
    const cancelled = reframeReviewStage.answer(asking(), typed('Cancel'))
    const dismissed = reframeReviewStage.answer(asking(), typed(null))
    expect([cancelled.sub, dismissed.sub]).toEqual([
      { kind: 'cancelled', reason: t('frameworks.review.cancelledReason') },
      { kind: 'cancelled', reason: REVIEW_DISMISSED_REASON },
    ])
  })
})
