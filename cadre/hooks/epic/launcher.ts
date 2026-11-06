/**
 * The worktree launcher check of /cadre epic (D-158, 03.1-W4 S1, LNCH-04), a layer 11 module: a picked role opens in
 * the epic worktree only when the launcher there is the very text runEpic checked in the main checkout
 * (epicWorktreeLauncherCheck), else its line says why it was not opened. It is pure and imports core,
 * generate/launcher and the types; epic/create reads it.
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

/**
 * The role line of a role whose launcher in the epic worktree is not the text cadre checked in the main checkout
 * (03.1-W4 S1, LNCH-04): it differs from it, or it could not be read in full, so cadre does not open it or copy its
 * command. The id is shown cleaned.
 */
export function epicWorktreeLauncherChangedLine(id: string): string {
  const role = reportText(id)

  return t('epic.launcher.epicWorktreeLauncherChangedLine', { role })
}

/**
 * Whether a picked role may open its launcher in the epic worktree (D-158, 03.1-W4 S1): null when the worktree has
 * none, as nothing runs then, or when it is the very text runEpic checked in the main checkout with launcherRead
 * (`verified`); epicWorktreeLauncherLine when it is a text without the epic kickoff line; else
 * epicWorktreeLauncherChangedLine, so cadre never opens a launcher it did not check (LNCH-04, T-03-28).
 */
export function epicWorktreeLauncherCheck(id: string, read: PortRead, verified: string | undefined): string | null {
  if (read.state === 'absent') return null
  if (read.state === 'text' && !hasRuntimeKickoff(read.text)) return epicWorktreeLauncherLine(id)
  if (read.state === 'text' && read.text === verified) return null

  return epicWorktreeLauncherChangedLine(id)
}
