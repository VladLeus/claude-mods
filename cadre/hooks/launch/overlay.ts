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
 * The links for one kind of overlay entry, in name order, once each. A name that is not plain, even one the user has,
 * or that the user does not have is not linked: it gets a warning and goes to `unlinked`.
 */
function overlayGroup(
  kind: 'skill' | 'agent',
  names: readonly string[],
  have: readonly string[],
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
    if (!have.includes(name)) {
      warnings.push(t('launch.overlay.overlayGroup2', { kind, name }))
      unlinked.push(name)
      continue
    }
    links.push({ path: `${linkDir}/${name}${extension}`, target: `${targetDir}/${name}${extension}` })
  }

  return { links, warnings, unlinked }
}

/**
 * The links that build the role's overlay: under `--setting-sources project` a user skill or agent loads only when this
 * `--add-dir` overlay links it from the user folder (a `plugin:skill` never gets here: its plugin is enabled instead).
 * `unlinkedSkills` names the skills not linked, in name order.
 */
export function overlayLinks(
  id: string,
  overlay: CompiledScope['overlay'],
  user: LaunchUser,
): LinkSet & { readonly unlinkedSkills: readonly string[] } {
  const base = `${runtimeDir(user, id)}/overlay/.claude`
  const skillsDir = `${user.userDir}/skills`
  const agentsDir = `${user.userDir}/agents`
  const skills = overlayGroup('skill', overlay.skills, user.userSkills, `${base}/skills`, skillsDir, '')
  const agents = overlayGroup('agent', overlay.agents, user.userAgents, `${base}/agents`, agentsDir, '.md')

  return {
    links: sortedLinks([...skills.links, ...agents.links]),
    warnings: [...skills.warnings, ...agents.warnings],
    unlinkedSkills: skills.unlinked,
  }
}
