/**
 * The launcher check of /cadre start (LNCH-04, T-03-28), a layer 10 module: launcherRead gives the text of a role's
 * launcher `.cadre/bin/<id>` once its manifest entry vouches for it, or the refusal (START_NO_MANIFEST,
 * launcherMissingReply, launcherChangedReply); launcherDrift warns when that launcher is not the one this cadre writes
 * today (#54 A3); and renderFailedReply is the reply of a render step that failed (LNCH-03). It reads through the
 * InitIo port only; it imports core, paths, plan/classify, scan, state and a team type, and the start command, the
 * role render and epic read it.
 */
import type { DesiredFile, InitIo } from '../../types'
import { sha256Hex } from '../core/hash'
import { reportText } from '../core/text'
import { t } from '../locales/t'
import { launcherPath } from '../paths'
import { MANIFEST_PATH } from '../plan/classify'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { readRepoFile } from '../scan/port-read'
import { parseManifest } from '../state/cadre-files'
import type { RegenRead } from '../team'

/**
 * The refusal when `.cadre/manifest.json` is missing, cannot be read or is not a valid manifest: without it the
 * launcher cannot be checked (LNCH-04).
 */
export const START_NO_MANIFEST = t('start.launcherCheck.startNoManifest')

/** The refusal when a role's launcher is missing, or the manifest holds no entry for it (LNCH-04). */
export function launcherMissingReply(id: string): string {
  const role = reportText(id)

  return t('start.launcherCheck.launcherMissingReply', { role })
}

/**
 * The refusal when a role's launcher is not the file cadre wrote (LNCH-04, T-03-28): its sha256 differs from its
 * manifest entry, or it cannot be read as a regular file inside the repo. It names the three ways that work (#72 A3):
 * restore the file; `/cadre init`, whose Take new answer writes the new launcher and its manifest entry; or plain
 * regen, which keeps the changed file and its old manifest entry and writes the new version beside it as
 * `.cadre-new`, so that copy is moved over the launcher, made executable again, and a second regen records it.
 */
export function launcherChangedReply(id: string): string {
  const role = reportText(id)
  const launcher = launcherPath(role)

  return (
    t('start.launcherCheck.launcherChangedReply', {
      launcher,
      role,
    })
  )
}

/**
 * The reply when a step of the render fails (LNCH-03): the render stops at that step, so no stamp is written and the
 * launcher refuses to start. `path` is the step's path below the repo root, shown cleaned.
 */
export function renderFailedReply(id: string, path: string): string {
  const role = reportText(id)

  return (
    t('start.launcherCheck.renderFailedReply', {
      role,
      path: reportText(path),
    })
  )
}

/**
 * The text of the role's launcher on disk once it can be trusted (LNCH-04, T-03-28), or the refusal. It refuses, in
 * this order: a `.cadre/manifest.json` that is missing, cannot be read or is not a valid manifest (START_NO_MANIFEST);
 * a launcher `.cadre/bin/<id>` the manifest holds no entry for, or that is not there (launcherMissingReply); one that
 * cannot be read as a regular file inside the repo, or whose sha256 differs from its entry (launcherChangedReply). Both
 * are read through readRepoFile, so a link out of the repo is never read. /cadre epic reuses it for each role (D-165).
 */
export async function launcherRead(io: InitIo, root: string, id: string): Promise<RegenRead<string>> {
  const manifestRead = await readRepoFile(io, root, MANIFEST_PATH, MAX_READ_BYTES)
  const manifest = manifestRead.state === 'text' ? parseManifest(manifestRead.text) : null
  if (manifest === null) return { kind: 'refuse', text: START_NO_MANIFEST }
  const path = launcherPath(id)
  const entry = manifest.files.find(file => file.path === path)
  if (entry === undefined) return { kind: 'refuse', text: launcherMissingReply(id) }
  const launcher = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (launcher.state === 'absent') return { kind: 'refuse', text: launcherMissingReply(id) }
  if (launcher.state !== 'text') return { kind: 'refuse', text: launcherChangedReply(id) }
  if ((await sha256Hex(launcher.text)) !== entry.sha256) return { kind: 'refuse', text: launcherChangedReply(id) }

  return { kind: 'ok', value: launcher.text }
}

/**
 * The warning when the role's launcher on disk, which matches its manifest entry, is not the text this cadre writes
 * for it today (LNCH-04, #54 A3): an older cadre wrote it, or the setup changed since. It warns and never refuses,
 * since the launcher is still the one cadre wrote. The name is shown cleaned.
 */
function launcherOutdatedWarning(id: string): string {
  const role = reportText(id)

  return (
    t('start.launcherCheck.launcherOutdatedWarning', {
      role,
    })
  )
}

/**
 * The launcher warnings of /cadre start (#54 A3): launcherOutdatedWarning when `desired`, the files desiredFiles gives
 * for the role today, holds a launcher `.cadre/bin/<id>` whose text differs from `onDisk`; none otherwise.
 */
export function launcherDrift(id: string, onDisk: string, desired: readonly DesiredFile[]): string[] {
  const today = desired.find(file => file.path === launcherPath(id))
  if (today === undefined || today.content === onDisk) return []

  return [launcherOutdatedWarning(id)]
}
