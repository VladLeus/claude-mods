import type { CompiledScope, RoleSpec } from '../types'
import { settingsDeny } from './launch/deny'
import { instructionPlan, sortedLinks } from './launch/links'
import type { LaunchUser, OverlayLink } from './launch/links'
import { overlayLinks } from './launch/overlay'
import { settingsFor } from './launch/settings'

/**
 * The launch half of D-66, for one role: the rendered runtime settings, every symlink to create under
 * `.cadre/<id>/.runtime/`, and the warnings to show. Phase 3 writes it out; Phase 2 never does.
 */
export type LaunchPlan = {
  readonly settings: Readonly<Record<string, unknown>>
  readonly links: readonly OverlayLink[]
  readonly warnings: readonly string[]
}

/**
 * The launch half of D-66 for one role (D-98): from the role, its compiled scope and the launching user's facts it
 * returns the runtime settings, the symlinks to create (the instruction and memory links and the overlay links, sorted
 * by path, all under `<root>/.cadre/<id>/.runtime/`) and the warnings to show, in the order of the steps: denies,
 * instructions, overlay. It is pure: it reads nothing, writes nothing and keeps nothing between calls, so Phase 3 only
 * gathers the facts and writes the result under `.cadre/<id>/.runtime/`.
 */
export function launchPlan(role: RoleSpec, scope: CompiledScope, user: LaunchUser): LaunchPlan {
  const deny = settingsDeny(role, scope, user)
  const instructions = instructionPlan(role, user)
  const overlay = overlayLinks(role.id, scope.overlay, user)

  return {
    settings: settingsFor(role, scope, user, instructions.claudeMdExcludes, deny.deny),
    links: sortedLinks([...instructions.links, ...overlay.links]),
    warnings: [...deny.warnings, ...instructions.warnings, ...overlay.warnings],
  }
}
