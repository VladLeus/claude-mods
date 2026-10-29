/**
 * The draft of an init run (D-43, D-45, D-82, D-105), a layer 10 module: Draft, what one run holds in memory while the
 * person reviews the plan, with its parts DraftBase (what the scans fix for the whole run) and Team (what the role
 * steps decide); Reviewed, the confirmed draft with its plan (PlanResult, what planStep gives); and mapped, which turns
 * a step result's value into another. It holds types and one pure helper and imports ui/ask and the types the draft is
 * made of; init.ts reads it.
 */
import type {
  CadreState,
  Choice,
  DesiredFile,
  FrameworkId,
  GitPolicy,
  HunkOp,
  InitLocations,
  InstructionHandout,
  LaunchStart,
  Manifest,
  Plan,
  RoleChange,
  RoleProposal,
  RoleSpec,
} from '../../types'
import type { Gathered } from '../scan/gather'
import { accepted } from '../ui/ask'
import type { StepResult } from '../ui/ask'

/** What planStep gives: the file plan, the repo state it was planned with, and what apply writes it from (D-105). */
export type PlanResult = {
  readonly plan: Plan
  readonly state: CadreState
  /** The files the plan was built from: apply writes the text of each one it plans to write. */
  readonly desired: readonly DesiredFile[]
  /** The manifest the plan records (planWithManifest): the one apply writes last. */
  readonly manifest: Manifest
  /** The merged root `.gitignore` text; null when no block is planned or the block cannot be merged. */
  readonly gitignore: string | null
}

/**
 * What one init run holds in memory while the person reviews the plan (D-43, D-45, D-82): where it runs and what the
 * scans gave, the ~/.claude.json consent answer the scans were gathered with (cadre.json records it, A1), what the
 * roles and framework steps are asked with (the installed frameworks, the framework choice and the template proposal
 * with its scan changes), the history hints the skill questions are asked with (D-59), and every answer so far, the
 * accepted team's scan changes included, so Change roles shows those again (A6), and so are the plugins the person
 * answered Install for (decision #39, D-141). It is never written or kept after the run; a go-back gives a new Draft.
 */
export type Draft = {
  readonly locations: InitLocations
  readonly gathered: Gathered
  readonly readUserMcp: boolean
  readonly installed: readonly FrameworkId[]
  readonly choice: Choice
  readonly proposal: RoleProposal
  /** The command and skill counts of the history scan, empty when it was skipped: hints only (D-59). */
  readonly hints: ReadonlyMap<string, number>
  readonly duration: string
  readonly roles: readonly RoleSpec[]
  /** The scan changes shown with the accepted roles: the template's, or none for a described structure (A6). */
  readonly changes: readonly RoleChange[]
  readonly repoDefault: FrameworkId | null
  readonly hunks: readonly HunkOp[]
  /**
   * The plugin keys the person answered Install for: the security plugins (decision #39), then claude-md-management
   * (D-141); installed only after Confirm, never in --dry-run (applyConfirmed).
   */
  readonly pluginInstalls: readonly string[]
  /**
   * How the instruction files were handed out (G-02-1f): none, the whole-file questions, or the parts with their
   * topics, held in memory for this run; the plan builds each role's CLAUDE.md from its repo parts (repoPartsOf).
   */
  readonly instructions: InstructionHandout
  readonly policy: GitPolicy
  readonly launchStart: LaunchStart
}

/** What the person confirmed in the review (D-43, D-105): the draft the plan was built from, and that plan. */
export type Reviewed = {
  readonly draft: Draft
  readonly planned: PlanResult
}

/**
 * The parts of a Draft that the scans, the consent answer they were gathered with and the history hints fix for the
 * whole run.
 */
export type DraftBase =
  Pick<Draft, 'locations' | 'gathered' | 'readUserMcp' | 'installed' | 'choice' | 'proposal' | 'hints'>

/**
 * What the role steps decide: the duration, the roles with every per-role answer, the scan changes they were accepted
 * with (A6), the repo default, the hunks, the plugins to install after Confirm (decision #39, D-141) and how the
 * instruction files were handed out (G-02-1f).
 */
export type Team =
  Pick<Draft, 'duration' | 'roles' | 'changes' | 'repoDefault' | 'hunks' | 'pluginInstalls' | 'instructions'>

/** A step result with its value turned into another; a cancelled result stays cancelled with its reason (A1). */
export function mapped<T, U>(result: StepResult<T>, apply: (value: T) => U): StepResult<U> {
  return result.kind === 'cancelled' ? result : accepted(apply(result.value))
}
