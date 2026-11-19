/**
 * The size of a ticket, a layer 7 module: the four-score vector, its size and class against the repo threshold, the
 * planning modes a repo's frameworks offer, and the framework or GSD path a size maps to in each mode.
 */
import type { FrameworkId, GsdPath, PlanningMode, ProductScores, SizeClass, SizeVector, Sizing } from '../../types'
import { SUPPORTED_IDS } from '../core/framework-id'
import { isObject } from '../core/json'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { DEFAULT_SIZE_THRESHOLD, SIZING_RUBRIC_PATH } from '../paths'

/** Where a superpowers worker writes its plan file, `<role>-<ticket key>.md`. */
export const SP_PLAN_DIR = 'docs/superpowers/plans'

/** The one way a superpowers worker executes its plan. */
export const SP_METHOD = 'superpowers:subagent-driven-development'

export const PLANNING_MODES: readonly PlanningMode[] = Object.freeze(['gsd-epic', 'ticket'])

export const GSD_PATHS: readonly GsdPath[] = Object.freeze(['quick', 'phase'])

const SCORE_MIN = 0.1
const SCORE_MAX = 1

/** The framework a size maps to in one planning mode and, on gsd, its GSD path. */
export type SizePick = {
  readonly framework: FrameworkId
  readonly gsdPath: GsdPath | null
}

/** A score as given: a finite number from 0.1 to 1.0; null for anything else. */
export function parseScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < SCORE_MIN || value > SCORE_MAX) return null

  return value
}

/** The four scores in the order scope, complexity, risk, effort; null when one is missing or bad. Other keys go. */
export function parseVector(value: unknown): SizeVector | null {
  if (!isObject(value)) return null
  const scope = parseScore(value.scope)
  const complexity = parseScore(value.complexity)
  const risk = parseScore(value.risk)
  const effort = parseScore(value.effort)
  if (scope === null || complexity === null || risk === null || effort === null) return null

  return { scope, complexity, risk, effort }
}

/**
 * The PM's scores of a ticket, scope then risk; null when one is missing or bad, or when complexity or effort is given,
 * since the role that plans the ticket scores those.
 */
export function parseProductScores(value: unknown): ProductScores | null {
  if (!isObject(value)) return null
  if (value.complexity !== undefined || value.effort !== undefined) return null
  const scope = parseScore(value.scope)
  const risk = parseScore(value.risk)
  if (scope === null || risk === null) return null

  return { scope, risk }
}

export function sizeOf(vector: SizeVector): number {
  return Math.max(vector.scope, vector.complexity, vector.risk, vector.effort)
}

export function isLarge(vector: SizeVector, threshold: number): boolean {
  return sizeOf(vector) >= threshold
}

/** GSD epic and ticket by ticket with both GSD and superpowers; ticket by ticket with one of them; else no mode. */
export function modesOffered(frameworks: readonly FrameworkId[]): readonly PlanningMode[] {
  if (frameworks.includes('gsd') && frameworks.includes('superpowers')) return PLANNING_MODES

  return SUPPORTED_IDS.some(id => frameworks.includes(id)) ? ['ticket'] : []
}

/** The sizing of a repo with no sizing block: threshold 0.5, the rubric path, and a mapping from its frameworks. */
export function defaultSizing(frameworks: readonly FrameworkId[]): Sizing {
  const sizing = (small: FrameworkId, large: FrameworkId): Sizing => ({
    threshold: DEFAULT_SIZE_THRESHOLD,
    mapping: { small, large },
    rubric: SIZING_RUBRIC_PATH,
  })
  const hasGsd = frameworks.includes('gsd')
  const hasSuperpowers = frameworks.includes('superpowers')
  if (hasGsd && hasSuperpowers) return sizing('superpowers', 'gsd')
  if (hasGsd) return sizing('gsd', 'gsd')
  if (hasSuperpowers) return sizing('superpowers', 'superpowers')

  return sizing('none', 'none')
}

/**
 * What a ticket of this size runs on in the mode: gsd in GSD epic mode, else the mapping by size; on gsd a phase when
 * large and /gsd-quick when small.
 */
export function pickFor(isLargeTicket: boolean, mode: PlanningMode, sizing: Sizing): SizePick {
  const gsdPath: GsdPath = isLargeTicket ? 'phase' : 'quick'
  if (mode === 'gsd-epic') return { framework: 'gsd', gsdPath }
  const framework = isLargeTicket ? sizing.mapping.large : sizing.mapping.small

  return { framework, gsdPath: framework === 'gsd' ? gsdPath : null }
}

/** The size computed from a vector, if any, the class, and the pin that set the class instead of the threshold. */
export type SizeVerdict = {
  readonly size: number | null
  readonly large: boolean
  readonly pinned: SizeClass | null
}

/** A pin sets the class whatever the vector; with no pin the vector's size sets it at the threshold; else null. */
export function sizeClassOf(vector: SizeVector | null, threshold: number, pin: SizeClass | null): SizeVerdict | null {
  if (pin !== null) return { size: vector === null ? null : sizeOf(vector), large: pin === 'large', pinned: pin }
  if (vector === null) return null

  return { size: sizeOf(vector), large: isLarge(vector, threshold), pinned: null }
}

/** A verdict with no size always comes from a pin, since with no pin the size sets the class. */
function sizeLine(verdict: SizeVerdict, threshold: number): string {
  const sizeClass = verdict.large ? 'large' : 'small'
  const { size } = verdict
  if (size === null) return fill(PROMPTS.inboxSizePinnedOnly, { sizeClass })
  if (verdict.pinned !== null) return fill(PROMPTS.inboxSizePinned, { sizeClass, size })

  return fill(PROMPTS.inboxSize, { size, sizeClass, threshold })
}

/** The verdict's size and class, then the pick in each mode given, as the repo offers them. */
export function sizeText(verdict: SizeVerdict, sizing: Sizing, modes: readonly PlanningMode[]): string {
  const picks = modes.map(mode => {
    const { framework, gsdPath } = pickFor(verdict.large, mode, sizing)
    if (gsdPath === null) return fill(PROMPTS.inboxSizePick, { mode, framework })

    return fill(PROMPTS.inboxSizePickGsd, { mode, gsdPath })
  })

  return [sizeLine(verdict, sizing.threshold), ...picks].join(' ')
}
