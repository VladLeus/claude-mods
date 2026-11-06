/**
 * The CLAUDE.md part of the setup scan, a layer 3 module: the CLAUDE.md files the host finds from the file system root
 * down to the repo, as absolute paths and in display form, and whether the user folder holds a global CLAUDE.md, told
 * by its stat (D-57). No CLAUDE.md text is read. It imports core, paths, the port reads, the setup readers and the
 * types, so the setup scan and /cadre start find the CLAUDE.md chain here.
 */
import type { InitIo } from '../../../types'
import { isObject } from '../../core/json'
import { t } from '../../locales/t'
import { displayPath, trimSlash } from '../../paths'
import { missingState } from '../port-read'
import { unreadablePathWarning } from './read'
import type { SetupContext } from './read'

/** The file names the host is asked for in each folder from the file system root down to the repo (D-57). */
const CLAUDE_MD_NAMES: readonly string[] = ['CLAUDE.md', '.claude/CLAUDE.md']
/** The warning when the host cannot list the CLAUDE.md files above the repo. */
const CHAIN_WARNING = t('scan.unknown', { what: t('scan.chainUnread') })

/**
 * The CLAUDE.md files of a `$.fs.ancestors` answer as absolute paths, in the order the host gave them (the file system
 * root first). Only the folder and the name an entry carries are read, so the text of the files cannot be kept; a name
 * that was not asked for, such as AGENTS.md, is dropped, and a file is listed once. Anything but a list gives [].
 */
export function claudeMdPathsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const paths = value.flatMap(item => {
    if (!isObject(item) || typeof item.dir !== 'string' || typeof item.name !== 'string') return []
    if (!CLAUDE_MD_NAMES.includes(item.name)) return []

    return [`${trimSlash(item.dir)}/${item.name}`]
  })

  return Array.from(new Set(paths))
}

/**
 * The CLAUDE.md files of a `$.fs.ancestors` answer (claudeMdPathsOf), each as its display form: `<repo>/CLAUDE.md`,
 * `~/work/CLAUDE.md`, or the cleaned path outside both, in the order the host gave them and once each. Anything but a
 * list gives [].
 */
export function projectAncestors(value: unknown, ctx: SetupContext): string[] {
  return Array.from(new Set(claudeMdPathsOf(value).map(path => displayPath(path, ctx.home, ctx.root, ctx.configDir))))
}

/** The CLAUDE.md files above and in the repo, as display forms; a chain the host cannot give adds a warning. */
export async function claudeMdChain(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<string[]> {
  const value = await io.ancestors(CLAUDE_MD_NAMES)
  if (!Array.isArray(value)) {
    warnings.push(CHAIN_WARNING)

    return []
  }

  return projectAncestors(value, ctx)
}

/**
 * Whether the user folder holds a CLAUDE.md file. Its stat answers; its text is never read. A stat that fails on a
 * path that is there (missingState) adds a warning and counts as no file, because unknown is not absent.
 */
export async function isGlobalClaudeMdThere(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<boolean> {
  if (userDir === null) return false
  const path = `${userDir}/CLAUDE.md`
  const stat = await io.stat(path)
  if (stat !== null) return stat.kind === 'file'
  if ((await missingState(io, path)) === 'unknown') warnings.push(unreadablePathWarning(ctx, path))

  return false
}
