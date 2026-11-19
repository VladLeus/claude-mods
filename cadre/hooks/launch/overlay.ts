/**
 * The launch overlay, a layer 9 module: the symlinks a role's runtime folder gets for the overlay skills and agents of
 * its scope. A name the user has is linked from the user folder, a name the launch root provides is left to the engine,
 * and any other name, or one that is not plain, warns. It imports core, the launch links and the types.
 */
import type { CompiledScope } from '../../types'
import { shown, sortedUnique } from '../core/text'
import { t } from '../locales/t'
import { runtimeDir, sortedLinks } from './links'
import type { LaunchUser, LinkSet, OverlayLink } from './links'

/** A skill or agent name that may become a link name: a plain name of 1 to 80 characters. */
const SAFE_OVERLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

/**
 * Whether a skill or agent name may become a link name: a plain name. The pattern has no `/` and starts with a letter
 * or digit, so it alone rules out a `..` segment.
 */
function isSafeOverlayName(name: string): boolean {
  return SAFE_OVERLAY_NAME.test(name)
}

/**
 * The links for one kind of overlay entry, in name order, once each. A name that is not plain, or that neither the
 * user has nor the launch root provides, warns and goes to `unlinked`.
 */
function overlayGroup(
  kind: 'skill' | 'agent',
  names: readonly string[],
  have: readonly string[],
  provided: readonly string[],
  linkDir: string,
  targetDir: string,
  extension: string,
): LinkSet & { readonly unlinked: string[] } {
  const links: OverlayLink[] = []
  const warnings: string[] = []
  const unlinked: string[] = []
  for (const name of sortedUnique(names)) {
    if (!isSafeOverlayName(name)) {
      warnings.push(t('launch.overlay.overlayGroup', { kind, name: shown(name) }))
      unlinked.push(name)
      continue
    }
    if (have.includes(name)) {
      links.push({ path: `${linkDir}/${name}${extension}`, target: `${targetDir}/${name}${extension}` })
      continue
    }
    if (provided.includes(name)) continue
    warnings.push(t('launch.overlay.overlayGroup2', { kind, name }))
    unlinked.push(name)
  }

  return { links, warnings, unlinked }
}

/**
 * The links that build the role's overlay: under `--setting-sources project` a user skill or agent loads only when this
 * `--add-dir` overlay links it from the user folder, while the engine loads the launch root's own (a `plugin:skill`
 * never gets here: its plugin is enabled instead). `unlinkedSkills` names the skills the role does not get, in order.
 */
export function overlayLinks(
  id: string,
  overlay: CompiledScope['overlay'],
  user: LaunchUser,
): LinkSet & { readonly unlinkedSkills: readonly string[] } {
  const base = `${runtimeDir(user, id)}/overlay/.claude`
  const skillsDir = `${user.userDir}/skills`
  const agentsDir = `${user.userDir}/agents`
  const repoSkills = user.repoSkills ?? []
  const repoAgents = user.repoAgents ?? []
  const skills = overlayGroup('skill', overlay.skills, user.userSkills, repoSkills, `${base}/skills`, skillsDir, '')
  const agents = overlayGroup('agent', overlay.agents, user.userAgents, repoAgents, `${base}/agents`, agentsDir, '.md')

  return {
    links: sortedLinks([...skills.links, ...agents.links]),
    warnings: [...skills.warnings, ...agents.warnings],
    unlinkedSkills: skills.unlinked,
  }
}
