/**
 * The hunk runs, a layer 9 module: the framework command of each accepted hunk, re-resolved from its adapter proposal
 * through a proven user-level GSD only, the hunks after their runs and the reply line of a failed run (D-28, D-72,
 * D-106, D-120). It imports core, the framework registry, the GSD tool resolver and the types, so init and the apply
 * runner read it here.
 */
import type { HunkOp, SettingProposal, SetupScan } from '../../types'
import { reportText } from '../core/text'
import { resolveToolCommand } from '../framework/gsd/tools'
import type { GsdToolContext } from '../framework/gsd/tools'
import { ADAPTERS } from '../framework/registry'
import { t } from '../locales/t'

/** One framework command apply runs for an accepted hunk: the hunk's key and file, the argv, and its display form. */
export type HunkRun = {
  readonly key: string
  readonly file: string
  /** Re-resolved from the adapter proposal (D-106); never printed, since it holds the raw user-level GSD dir. */
  readonly argv: readonly string[]
  /** The command as the person may run it by hand, with the GSD dir shown as `~/...` (D-71). */
  readonly display: string
}

/**
 * The adapter proposal a hunk was asked from (A5): among the adapters whose autonomyHunks(setup) changes the hunk's
 * file, the first proposal they offer for this setup whose key is the hunk's key; null when none does. Only the
 * hunk's file and key are read, never its before, after or displayed command (D-106).
 */
export function hunkProposal(setup: SetupScan, hunk: HunkOp): SettingProposal | null {
  for (const adapter of ADAPTERS) {
    const offered = adapter.autonomyHunks(setup)
    if (offered === null || offered.file !== hunk.file) continue
    const proposal = offered.proposals.find(candidate => candidate.key === hunk.key)
    if (proposal !== undefined) return proposal
  }

  return null
}

/**
 * The framework commands apply runs, before it renders and hashes ROLE.md (D-120): one for each hunk the person
 * accepted and cadre can run, in hunk order. The argv is re-resolved from the hunk's adapter proposal with
 * resolveToolCommand and is never parsed from the command, before or after text the plan displayed (D-106, D-71).
 * Without a proven user-level GSD the command resolves no argv, so a repo-local GSD gives no run and is only printed
 * for the person (D-28, D-72); a hunk no adapter offers gives no run either.
 */
export function hunkRuns(hunks: readonly HunkOp[], setup: SetupScan, gsd: GsdToolContext): HunkRun[] {
  const runs: HunkRun[] = []
  for (const hunk of hunks) {
    if (!hunk.isAccepted || !hunk.isRunnable) continue
    const proposal = hunkProposal(setup, hunk)
    if (proposal === null) continue
    const { argv, display } = resolveToolCommand(proposal.write, gsd)
    if (argv === null) continue
    runs.push({ key: hunk.key, file: hunk.file, argv, display })
  }

  return runs
}

/**
 * The hunks after their runs (D-106, D-120): each hunk whose key is in `failed` is no longer runnable, so isUnmetHunk
 * makes the roles of its framework attended when it is required and the plan re-judges them before ROLE.md is
 * rendered; every other hunk is kept as it was. The hunks given are not changed. A failure is matched by key, which is
 * unique while every hunk targets the one GSD config file; key it by file and key once a second hunk file exists.
 */
export function hunksAfterRuns(hunks: readonly HunkOp[], failed: ReadonlySet<string>): HunkOp[] {
  return hunks.map(hunk => (failed.has(hunk.key) ? { ...hunk, isRunnable: false } : hunk))
}

/**
 * The line init prints for a framework command that failed at apply (D-106): the file and the key it changes, and the
 * command in display form for the person to run themselves. Every value is cleaned and capped as a report cell is.
 */
export function hunkFailureLine(run: HunkRun): string {
  const change = t('apply.hunks.hunkFailureLine', { file: reportText(run.file), key: reportText(run.key) })

  return t('apply.hunks.hunkFailureLine2', { change, display: reportText(run.display) })
}
