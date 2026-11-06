/**
 * The launch overlay, a layer 9 module: the symlinks a role's runtime folder gets for the overlay skills and agents of
 * its scope, each to the user folder it lives in, and the warnings for a name that is not plain or that the user does
 * not have (S4 V3, B5). It imports core, the launch links and the types, so the launch plan reads it here.
 */
import type { CompiledScope } from '../../types'
import { shown, sortedUnique } from '../core/text'
import { t } from '../locales/t'
import { runtimeDir, sortedLinks } from './links'
import type { LaunchUser, LinkSet, OverlayLink } from './links'

/** A skill or agent name that may become a link name: a plain name of 1 to 80 characters (T-02-46). */
const SAFE_OVERLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

/**
 * Whether a skill or agent name may become a link name: a plain name (T-02-46). The pattern has no `/` and starts with
 * a letter or digit, so it alone rules out a `..` segment.
 */
function isSafeOverlayName(name: string): boolean {
  return SAFE_OVERLAY_NAME.test(name)
}

/**
 * The links for one kind of overlay entry, in name order, once each. A name that is not a plain name is not linked and
 * is named in a warning, even when the user has it, and so is a name the user does not have. `extension` is added to
 * the name in the link path and in the target (an agent is a `.md` file, a skill is a folder).
 */
function overlayGroup(
  kind: 'skill' | 'agent',
  names: readonly string[],
  have: readonly string[],
  linkDir: string,
  targetDir: string,
  extension: string,
): LinkSet {
  const links: OverlayLink[] = []
  const warnings: string[] = []
  for (const name of sortedUnique(names)) {
    if (!isSafeOverlayName(name)) {
      warnings.push(t('launch.overlay.overlayGroup', { kind, name: shown(name) }))
      continue
    }
    if (!have.includes(name)) {
      warnings.push(t('launch.overlay.overlayGroup2', { kind, name }))
      continue
    }
    links.push({ path: `${linkDir}/${name}${extension}`, target: `${targetDir}/${name}${extension}` })
  }

  return { links, warnings }
}

/**
 * The links that build the role's overlay (spike S4 V3): each overlay skill is linked to `<userDir>/skills/<name>`
 * under `.runtime/overlay/.claude/skills/`, and each overlay agent to `<userDir>/agents/<name>.md` under
 * `.runtime/overlay/.claude/agents/`. Under `--setting-sources project` a user-level skill or agent is absent unless an
 * `--add-dir` overlay links it. A skill named `plugin:skill` never reaches the overlay, as compileScope enables its
 * plugin instead. The links are sorted by path, the warnings list the skills before the agents, and a name that is not
 * found among the user's, or is not a safe name, is not linked.
 */
export function overlayLinks(id: string, overlay: CompiledScope['overlay'], user: LaunchUser): LinkSet {
  const base = `${runtimeDir(user, id)}/overlay/.claude`
  const skillsDir = `${user.userDir}/skills`
  const agentsDir = `${user.userDir}/agents`
  const skills = overlayGroup('skill', overlay.skills, user.userSkills, `${base}/skills`, skillsDir, '')
  const agents = overlayGroup('agent', overlay.agents, user.userAgents, `${base}/agents`, agentsDir, '.md')

  return { links: sortedLinks([...skills.links, ...agents.links]), warnings: [...skills.warnings, ...agents.warnings] }
}
