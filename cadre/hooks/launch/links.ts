/**
 * The launch links, a layer 9 module: the person a role launches for (LaunchUser), the symlinks a launch plans in the
 * role's runtime folder for the global CLAUDE.md and the memory files with the names it refuses, the CLAUDE.md files a
 * role excludes, and a role's instruction plan (D-100, P11, G-02-1f). It imports core, paths and the types, so the
 * other launch/ modules, /cadre start, init and regen read it here.
 */
import type { RoleSpec } from '../../types'
import { compareText, isChangedByClean, shown, sortedUnique } from '../core/text'
import { t } from '../locales/t'
import { memoryFolderOf } from '../paths'

/**
 * The facts about the launching user that the launch half needs (D-98). Phase 3 gathers them at launch and passes them
 * in; this module reads nothing from disk and nothing here is ever committed (PLAN-05). Every path is absolute.
 */
export type LaunchUser = {
  /** The git top level, as a realpath. */
  readonly root: string
  /** The git top level as the session gave it, before the realpath; equal to `root` when no link is in the way. */
  readonly givenRoot: string
  readonly home: string
  /** CLAUDE_CONFIG_DIR when it is set, else `<home>/.claude`. */
  readonly userDir: string
  /** The git common dir, as a realpath. */
  readonly gitCommonDir: string
  /** Lowercase hex SHA-256 of `gitCommonDir`; the caller computes it with `sha256Hex`. */
  readonly commonDirHash: string
  readonly autoCompactWindow: number | null
  /** The `statusLine` of the user's settings as read; null when it is unset. */
  readonly statusLine: unknown
  /** The `env` block of the user's settings. Only the names a role carries are ever rendered from it. */
  readonly env: Readonly<Record<string, string>>
  /**
   * The user's hooks: the event, the script basename, the whole command, which may hold absolute paths, the matcher of
   * the settings group the hook is in (null when the group has none) and its timeout in seconds (null when unset).
   */
  readonly hooks: readonly {
    readonly event: string
    readonly script: string
    readonly command: string
    readonly matcher: string | null
    readonly timeout: number | null
  }[]
  /** The CLAUDE.md files the engine loads for the root: the root's, `.claude/CLAUDE.md` and every ancestor's. */
  readonly claudeMd: readonly string[]
  /** The rule files the engine loads for the root: `<root>/.claude/rules/<name>.md`, files and links (G-02-1f). */
  readonly rules: readonly string[]
  /**
   * The built role files of the repo: `<root>/.cadre/<id>/CLAUDE.md` of every folder there that has one, the folders
   * of roles no longer on the team included (G-02-1f).
   */
  readonly roleClaudeMds: readonly string[]
  /** `<userDir>/CLAUDE.md` first, then the files it imports as the caller resolved them; empty with no global file. */
  readonly globalClaudeMd: readonly string[]
  /** File names in the auto-memory folder of `root`. */
  readonly memoryFiles: readonly string[]
  /** File names in the auto-memory folder of `givenRoot`. */
  readonly givenMemoryFiles: readonly string[]
  /** Folder names in `<userDir>/skills`. */
  readonly userSkills: readonly string[]
  /** File names without `.md` in `<userDir>/agents`. */
  readonly userAgents: readonly string[]
  /** The top-level code dirs to deny with exact patterns; Phase 3 passes the repo scan's at launch. */
  readonly codeDirs: readonly string[]
  /**
   * The absolute link paths in the role memory folder of the memories /cadre start links for the role (G-02-1f, D-140
   * q3-a), from its hand-out record; empty for a whole-files role and for a role given no memory. The role's settings
   * deny Edit and Write on each of them (linkedMemoryDeny).
   */
  readonly linkedMemories: readonly string[]
  /**
   * The main checkout of a linked worktree nested in it (gatherLaunchUser, mainCheckoutOf; D-157), whose worktree is
   * `root`: its exact code-dir denies and its memory folder's deny are added too, and its memories link (RESEARCH
   * Pitfall 2, 03.1-W3 M1). Absent for the main checkout.
   */
  readonly mainRoot?: string
}

/** One symlink the launch plans: `path` is where Phase 3 creates it, `target` is what it points at. Both absolute. */
export type OverlayLink = {
  readonly path: string
  readonly target: string
}

/** The CLAUDE.md files a role must not load, and the links that deliver the instruction and memory files it gets. */
export type InstructionPlan = {
  readonly claudeMdExcludes: readonly string[]
  readonly links: readonly OverlayLink[]
}

/** Symlinks to create, and what to tell the person about the names that were not linked. */
export type LinkSet = {
  readonly links: readonly OverlayLink[]
  readonly warnings: readonly string[]
}

/** A group that plans no link and no warning. */
const NO_LINKS: LinkSet = Object.freeze({ links: Object.freeze([]), warnings: Object.freeze([]) })

/** The most code points a file name may have to be linked. */
const MAX_NAME_CHARS = 255

/** The folder that holds everything the launch creates for a role: `<root>/.cadre/<id>/.runtime`. */
export function runtimeDir(user: LaunchUser, id: string): string {
  return `${user.root}/.cadre/${id}/.runtime`
}

/** The links in the order of their paths, as a new array. */
export function sortedLinks(links: readonly OverlayLink[]): OverlayLink[] {
  return [...links].sort((a, b) => compareText(a.path, b.path))
}

/** Whether a name is worth showing and linking: not empty, and with no hidden character and not too long. */
function isCleanName(name: string): boolean {
  return name !== '' && !isChangedByClean(name, MAX_NAME_CHARS)
}

/**
 * Whether a file name may become a link name as it is: it is clean, has no `/`, and does not start with `.`, so it
 * cannot hold a `..` segment or leave its folder. The name of a memory file becomes the name of its link (T-02-46), in
 * `.runtime/instructions/memory/` for a whole-files role and in the role memory folder for a parts-flow role.
 */
export function isSafeFileName(name: string): boolean {
  return isCleanName(name) && !name.includes('/') && !name.startsWith('.')
}

/** The warning for a memory file whose name may not become a link name: it is not linked (T-02-46). */
export function unsafeMemoryNameWarning(name: string): string {
  return t('launch.links.unsafeMemoryNameWarning', { name: shown(name) })
}

/**
 * The links for the global CLAUDE.md and the files it imports, in the order given: each is `<nn>-<name>`, where the
 * number is the 1-based position in the list, so the order is kept and two files with the same name do not clash. A
 * file with an empty or hidden-character name is not linked and is named in a warning; the numbers of the others stay.
 */
function globalLinks(id: string, user: LaunchUser): LinkSet {
  const links: OverlayLink[] = []
  const warnings: string[] = []
  for (const [index, target] of user.globalClaudeMd.entries()) {
    const name = target.slice(target.lastIndexOf('/') + 1)
    if (!isCleanName(name)) {
      warnings.push(t('launch.links.globalLinks', { name: shown(name) }))
      continue
    }
    const number = String(index + 1).padStart(2, '0')
    links.push({ path: `${runtimeDir(user, id)}/instructions/global/${number}-${name}`, target })
  }

  return { links, warnings }
}

/**
 * The links for the auto-memory files of this repo. The engine keeps them in the user's
 * `projects/<mangled root>/memory` folder, and the scan lists both such folders, that of the root as a realpath and
 * that of the root as given (a checkout opened through a link). Each name is linked to the file in the folder that
 * listed it; a name both folders list is linked once, to the realpath folder, so no link points at a folder that did
 * not list its name. A file with an unsafe name (isSafeFileName) is not linked and is named in one warning. The links
 * come in name order.
 */
function memoryLinks(id: string, user: LaunchUser): LinkSet {
  const sources: readonly (readonly [string, readonly string[]])[] = [
    [memoryFolderOf(user.userDir, user.root), user.memoryFiles],
    [memoryFolderOf(user.userDir, user.givenRoot), user.givenMemoryFiles],
  ]
  const targets = new Map<string, string>()
  for (const [folder, names] of sources) {
    for (const name of names) {
      if (!targets.has(name)) targets.set(name, `${folder}/${name}`)
    }
  }
  const links: OverlayLink[] = []
  const warnings: string[] = []
  for (const [name, target] of [...targets].sort(([a], [b]) => compareText(a, b))) {
    if (!isSafeFileName(name)) {
      warnings.push(unsafeMemoryNameWarning(name))
      continue
    }
    links.push({ path: `${runtimeDir(user, id)}/instructions/memory/${name}`, target })
  }

  return { links, warnings }
}

/**
 * Whether a role is a parts-flow role (G-02-1f): it has no instruction group, as the parts hand-out gives every role,
 * so it loads only its built files, and /cadre start links the memories its hand-out record names into its memory
 * folder. A role with a group is a whole-files role (D-63).
 */
export function isPartsFlowRole(role: Pick<RoleSpec, 'instructions'>): boolean {
  return role.instructions.length === 0
}

/**
 * The CLAUDE.md files a role must not load, sorted and once each (P11, G-02-1f). A parts-flow role (isPartsFlowRole)
 * loads only its built files, so every CLAUDE.md of the loaded chain, every rule file and every other role's built
 * `.cadre/<other>/CLAUDE.md` is excluded, never its own `<root>/.cadre/<id>/CLAUDE.md` (T-02-70). A role with groups
 * keeps the whole-files rule: without 'project-claude-md' every CLAUDE.md of the loaded chain is excluded, and with it
 * none is.
 */
function claudeMdExcludesOf(role: RoleSpec, user: LaunchUser): string[] {
  if (role.instructions.includes('project-claude-md')) return []
  if (!isPartsFlowRole(role)) return sortedUnique(user.claudeMd)
  const own = `${user.root}/.cadre/${role.id}/CLAUDE.md`
  const others = user.roleClaudeMds.filter(path => path !== own)

  return sortedUnique([...user.claudeMd, ...user.rules, ...others])
}

/**
 * What a role gets of the user's instructions and memories, from the D-63 answers (D-98) or the parts flow (G-02-1f).
 * Under `--setting-sources project` the user-level CLAUDE.md never loads, while the project's and every ancestor's
 * does, and so do the rule files (P11): the excludes of claudeMdExcludesOf keep a role to what it was given. The
 * global CLAUDE.md with its imports is linked into `.runtime/instructions/global/` only for 'global-claude-md', and
 * this repo's memory files into `.runtime/instructions/memory/` only for 'auto-memory': a role is narrow by default,
 * whatever exists on disk. Delivering the linked files into the session is Phase 3 wiring (D-100).
 */
export function instructionPlan(
  role: RoleSpec,
  user: LaunchUser,
): InstructionPlan & { readonly warnings: readonly string[] } {
  const globals = role.instructions.includes('global-claude-md') ? globalLinks(role.id, user) : NO_LINKS
  const memories = role.instructions.includes('auto-memory') ? memoryLinks(role.id, user) : NO_LINKS

  return {
    claudeMdExcludes: claudeMdExcludesOf(role, user),
    links: sortedLinks([...globals.links, ...memories.links]),
    warnings: [...globals.warnings, ...memories.warnings],
  }
}
