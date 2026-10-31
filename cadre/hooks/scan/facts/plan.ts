/**
 * The fact read plan, a layer 3 module: the files the host reads before detection, found from the root, the home
 * folder and CLAUDE_CONFIG_DIR, with the user-level GSD folder and the repo's own copy; building the plan reads
 * nothing. It imports GSD's identity, paths and the types, so the facts collector plans its reads here.
 */
import type { GsdReadTarget, ReadPlan } from '../../../types'
import { gsdTarget } from '../../framework/gsd/identity'
import { t } from '../../locales/t'
import { trimSlash, userFolderOf } from '../../paths'
import type { ReadEnv } from '../../paths'

/**
 * The reads the host performs before detection, and nothing else. The user-level GSD folder is CLAUDE_CONFIG_DIR
 * when that is usable, else `<home>/.claude`; the repo's own copy is always listed. Building the plan reads nothing.
 * Trailing slashes on the root, the home folder and CLAUDE_CONFIG_DIR are dropped.
 * The host must realpath the root, the home folder and CLAUDE_CONFIG_DIR
 * first: symlinks and case-insensitive paths cannot be resolved here.
 */
export function factReadPlan(input: ReadEnv): ReadPlan {
  const env = {
    root: trimSlash(input.root),
    home: trimSlash(input.home),
    configDir: trimSlash(input.configDir),
  }
  const warnings: string[] = []
  const userFolder = userFolderOf(env, warnings)
  const gsd: GsdReadTarget[] = []
  if (userFolder !== null) {
    gsd.push(gsdTarget('user', `${userFolder}/gsd-core`, `${userFolder}/gsd-file-manifest.json`))
  }
  gsd.push(gsdTarget('project', `${env.root}/.claude/gsd-core`, `${env.root}/.claude/gsd-file-manifest.json`))

  return {
    installedPluginsPath: userFolder === null ? null : `${userFolder}/plugins/installed_plugins.json`,
    gsd,
    warnings,
  }
}
