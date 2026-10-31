/**
 * The apply side of init (D-67, D-105, D-106, D-230), a layer 10 module, its pure parts: initReplyText, the reply of
 * a finished init or --dry-run, and what Confirm's apply runs with (HUNK_TIMEOUT_MS, CONFLICT_DISMISSED_REASON,
 * CONFLICT_CONTEXT); init/run runs the apply itself (applyConfirmed), which asks and writes. Pure: it imports apply,
 * plan, init/replies and the launch and policy stages, and never imports init/machine or init/run.
 */
import type { GitPolicy, LaunchStart, Plan } from '../../types'
import { appliedLines } from '../apply/run'
import type { ApplyOutcome } from '../apply/run'
import { t } from '../locales/t'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { IGNORE_ALL_NOTE } from './replies'
import { launchLine } from './stages/launch'
import { policyLine } from './stages/policy'

/**
 * The reply of a finished init (PLAN-01, PLAN-02, D-105): what was asked for, the file plan as renderPlan prints it
 * (with its warnings, so none is printed twice), the git policy, where the launchers start (A2), the worktree line of
 * the ignore policy, `confirmLines` (what Confirm writes outside the repo and the improver line, which a --dry-run
 * reply names, 02-GAPS-B3 S4; none by default), and last the dry-run note when `applied` is null (--dry-run, nothing
 * was written), else the lines of what the apply did (appliedLines). Plain init and --dry-run differ only in the first
 * line, the confirm lines and that ending.
 */
export function initReplyText(
  plan: Plan,
  policy: GitPolicy,
  start: LaunchStart,
  applied: ApplyOutcome | null,
  confirmLines: readonly string[] = [],
): string {
  return [
    applied === null ? t('init.reply.dryRunHead') : t('init.reply.head'),
    ...renderPlan(plan),
    policyLine(policy),
    launchLine(start),
    ...(policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...confirmLines,
    ...(applied === null ? [DRY_RUN_NOTE] : appliedLines(applied)),
  ].join('\n')
}

/** How long one accepted framework command may run at apply before it is given up (D-106, T-03-19). */
export const HUNK_TIMEOUT_MS = 30_000

/** Why init cancels when a Keep mine or Take new question is dismissed or not answered (D-67, A1). */
export const CONFLICT_DISMISSED_REASON = t('init.conflict.dismissed')

/** The context line of each Keep mine or Take new question (D-136): what each answer does with the edited file. */
export const CONFLICT_CONTEXT = t('init.conflict.context')
