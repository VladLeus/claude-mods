/**
 * The memory part of the setup scan, a layer 3 module: the `.md` file names of this repo's auto-memory folders, of the
 * root as resolved and as given, once each (D-57). No memory text is read. It imports core, paths, the facts name
 * warnings, the setup readers and settings, and the types, so the setup scan lists the memory files here.
 */
import type { InitIo } from '../../../types'
import { sortedUnique } from '../../core/text'
import { markdownFileNames, MAX_FILE_NAME_CHARS, memoryFolderOf } from '../../paths'
import { hiddenNameWarnings } from '../facts/normalize'
import { listFolder } from './read'
import type { SetupContext } from './read'
import { stableNames } from './settings'

/**
 * The `.md` file names in the auto-memory folders of this repo, with their extension; their text is never read. The
 * folder of the root as resolved and the one of the root as given are both listed, once each when they are the same,
 * as `~/.claude.json` is matched by both root forms.
 */
export async function memoryFileNames(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  if (userDir === null) return []
  const folders = new Set([ctx.root, ctx.givenRoot].map(root => memoryFolderOf(userDir, root)))
  const names: string[] = []
  for (const folder of folders) names.push(...markdownFileNames(await listFolder(io, ctx, folder, warnings)))
  warnings.push(...hiddenNameWarnings(names, 'memoryFileName', MAX_FILE_NAME_CHARS))

  return sortedUnique(stableNames(names, MAX_FILE_NAME_CHARS))
}
