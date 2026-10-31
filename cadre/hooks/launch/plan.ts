/**
 * The launch plan, a layer 9 module: the launch half of D-66 for one role (D-98), the rendered runtime settings, the
 * symlinks to create under `.cadre/<id>/.runtime/` and the warnings to show, in step order; it reads, writes and keeps
 * nothing. It imports the launch denies, links, overlay and settings and the types, so /cadre start renders a role
 * here.
 */
import type { CompiledScope, RoleSpec } from '../../types'
import { settingsDeny } from './deny'
import { instructionPlan, sortedLinks } from './links'
import type { LaunchUser, OverlayLink } from './links'
import { overlayLinks } from './overlay'
import { settingsFor } from './settings'

/**
 * The launch half of D-66, for one role: the rendered runtime settings, every symlink to create under
 * `.cadre/<id>/.runtime/`, and the warnings to show. renderRole writes it out; init never does.
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
 * instructions, overlay. It is pure: it reads nothing, writes nothing and keeps nothing between calls, so renderRole
 * only gathers the facts and writes the result under `.cadre/<id>/.runtime/`.
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
