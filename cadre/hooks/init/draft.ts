/**
 * The draft of an init run (D-43, D-45, D-82, D-105), a layer 10 module: Draft, what one run holds in memory while the
 * person reviews the plan, with its part DraftBase (what the scans fix for the whole run); and Reviewed, the confirmed
 * draft with its plan (PlanResult, what planStep gives). It holds types only and imports the types the draft is made
 * of; init.ts reads it.
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
  /**
   * The answer to GSD's own check question, kept for the run so a review go-back never asks it again (D-243 "one
   * question", WF-S2); never written.
   */
  readonly gsdCheck?: 'declined' | 'run'
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
