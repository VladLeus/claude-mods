/**
 * The worktree launcher check of /cadre epic, a layer 11 module: a picked role opens in the epic worktree only when the
 * launcher there is the very text runEpic checked in the main checkout, else its line says why it was not opened. It
 * is pure and imports core, generate/launcher and the types; epic/create reads it.
 */
import type { PortRead } from '../../types'
import { reportText } from '../core/text'
import { hasRuntimeKickoff } from '../generate/launcher'
import { t } from '../locales/t'

/**
 * The role line of a role whose launcher in the epic worktree predates the epic kickoff (D-158): the epic branch holds
 * an older `.cadre/bin/<id>`, which would start the role without its epic kickoff, so the role is not opened. The
 * advice names `.cadre/manifest.json` too, else /cadre start in the worktree refuses the launcher as changed
 * (03.1-W6 S2). The id is shown cleaned.
 */
export function epicWorktreeLauncherLine(id: string): string {
  const role = reportText(id)

  return t('epic.launcher.epicWorktreeLauncherLine', { role })
}

/** The role line of a launcher that differs from the one cadre checked, with a recovery that works on a kept branch. */
export function epicWorktreeLauncherChangedLine(id: string): string {
  const role = reportText(id)

  return t('epic.launcher.epicWorktreeLauncherChangedLine', { role })
}

/** The role line of a launcher cadre could not read in full, so it could not check it. */
export function epicWorktreeLauncherUnreadLine(id: string): string {
  const role = reportText(id)

  return t('epic.launcher.epicWorktreeLauncherUnreadLine', { role })
}

/** Null when the worktree has no launcher or the very text runEpic checked (`verified`), else why it is not opened. */
export function epicWorktreeLauncherCheck(id: string, read: PortRead, verified: string | undefined): string | null {
  if (read.state === 'absent') return null
  if (read.state !== 'text') return epicWorktreeLauncherUnreadLine(id)
  if (!hasRuntimeKickoff(read.text)) return epicWorktreeLauncherLine(id)
  if (read.text === verified) return null

  return epicWorktreeLauncherChangedLine(id)
}
