import type { InitIo, PortEntry, SetupScan, SkillRef } from '../types'
import { isObject } from './core/json'
import { NAME_PATTERN } from './core/names'
import { clean, compareText, sortedUnique } from './core/text'
import {
  displayPath,
  isDirInsideRoot,
  MARKDOWN_EXTENSION,
  markdownFileNames,
  MAX_FILE_NAME_CHARS,
  memoryFolderOf,
  trimSlash,
  userDirOf,
} from './paths'
import { hiddenNameWarnings } from './scan/facts/normalize'
import { missingState } from './scan/port-read'
import { MAX_REF_NAME_CHARS, mergeMcp, projectMcpScan, sessionMcpScan, userConfigMcpScan } from './scan/setup/mcp'
import { isInsideRepo, listFolder, unreadableWarning } from './scan/setup/read'
import type { SetupContext } from './scan/setup/read'
import {
  hookNameWarnings,
  installedPluginKeys,
  projectSettings,
  readSettings,
  settingsNameWarnings,
  stableNames,
} from './scan/setup/settings'

/** Code points a skill's purpose keeps: its one-line description, cleaned and cut to this (D-139). */
const MAX_SKILL_PURPOSE_CHARS = 120
/** The file names the host is asked for in each folder from the file system root down to the repo (D-57). */
const CLAUDE_MD_NAMES: readonly string[] = ['CLAUDE.md', '.claude/CLAUDE.md']
/** Command sources a scan does not name: the host ships its built-in commands, and an MCP server adds its prompts. */
const UNNAMED_SOURCES: readonly string[] = ['builtin', 'mcp']
/** The warning when the host cannot list the commands and skills. */
const COMMANDS_WARNING = 'could not list commands and skills (treated as unknown)'
/** The warning when the host cannot list the CLAUDE.md files above the repo. */
const CHAIN_WARNING = 'could not read the CLAUDE.md chain (treated as unknown)'
/** The warning when there is neither a CLAUDE_CONFIG_DIR nor a home folder to find the user-level sources in. */
const NO_USER_DIR_WARNING = 'HOME is unset: user-level setup was not scanned'

/** Whether a command name, or the plugin that adds a command, is a plain ASCII name of at most 100 characters. */
function isCommandName(value: unknown): value is string {
  return typeof value === 'string' && NAME_PATTERN.test(value)
}

/** The objects of a command list whose source a scan names: user, plugin and any source that is not built in or MCP. */
function skillItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isObject)
    .filter(item => typeof item.source === 'string' && !UNNAMED_SOURCES.includes(item.source))
}

/**
 * A command's description as its skill keeps it (D-139): cleaned and cut to MAX_SKILL_PURPOSE_CHARS code points; null
 * for a description that is missing, not a string, or blank once cleaned.
 */
function purposeOf(description: unknown): string | null {
  const purpose = clean(description, MAX_SKILL_PURPOSE_CHARS)

  return purpose.trim() === '' ? null : purpose
}

/** A skill by its name and plugin, with its purpose only when it has one (D-139). */
function skillOf(name: string, plugin: string | null, purpose: string | null): SkillRef {
  return purpose === null ? { name, plugin } : { name, plugin, purpose }
}

/**
 * One command as a name, the plugin that adds it and its purpose (purposeOf); null when the name, or a plugin that is
 * given, is not a name.
 */
function skillRefOf(item: Record<string, unknown>): SkillRef | null {
  const { name, plugin } = item
  if (!isCommandName(name)) return null
  const purpose = purposeOf(item.description)
  if (item.source !== 'plugin' || plugin === undefined) return skillOf(name, null, purpose)
  if (!isCommandName(plugin)) return null

  return skillOf(name, plugin, purpose)
}

/** Skills in the order of their names, then of their plugins, a command with no plugin first. */
function bySkill(first: SkillRef, second: SkillRef): number {
  return compareText(first.name, second.name) || compareText(first.plugin ?? '', second.plugin ?? '')
}

/**
 * The skills and plugin commands of a `$.command.list()` answer, by name, the plugin that adds each and its purpose
 * (SCAN-02, D-57, D-139). Built-in commands and MCP prompts are dropped, and so is a command whose name, or whose
 * plugin, is not a plain name of at most 100 characters. A string description is kept as the skill's purpose, cleaned
 * and cut to MAX_SKILL_PURPOSE_CHARS code points, in memory only, for the questions and the recommendation call; it is
 * never written (D-139), and a blank or missing one gives no purpose. A hint and every other field is never read, so
 * none can be kept. A name is listed once for each plugin, sorted by name. Anything but a list gives [].
 */
export function projectCommands(value: unknown): SkillRef[] {
  const found = new Map<string, SkillRef>()
  for (const item of skillItems(value)) {
    const ref = skillRefOf(item)
    if (ref !== null) found.set(JSON.stringify([ref.name, ref.plugin]), ref)
  }

  return Array.from(found.values()).sort(bySkill)
}

/** The command and plugin names of a command list as the host gave them, for the hidden-name warnings. */
function skillNames(value: unknown): string[] {
  return skillItems(value)
    .flatMap(item => [item.name, item.plugin])
    .filter((name): name is string => typeof name === 'string')
}

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

/** The skills and plugin commands of the host's command list; a list the host cannot give adds a warning. */
async function commandRefs(io: InitIo, warnings: string[]): Promise<SkillRef[]> {
  const value = await io.commands()
  if (!Array.isArray(value)) {
    warnings.push(COMMANDS_WARNING)

    return []
  }
  warnings.push(...hiddenNameWarnings(skillNames(value), 'command or plugin name', MAX_REF_NAME_CHARS))

  return projectCommands(value)
}

/**
 * The `.md` files of the repo's `.claude/agents`, listed only when its stat shows a folder whose real path is inside
 * the repo (isDirInsideRoot, the rule `.mcp.json` follows), so a link out of the repo is never listed and adds a
 * warning, and so does a failed stat; a folder that is not there is quiet.
 */
async function repoAgentEntries(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<readonly PortEntry[]> {
  const path = `${ctx.root}/.claude/agents`
  if (!(await isInsideRepo(io, ctx, path, isDirInsideRoot, warnings))) return []

  return listFolder(io, ctx, path, warnings)
}

/** The agents in the user folder and in the repo's `.claude/agents`: the `.md` files, by name without the extension. */
async function agentNames(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  const userEntries = userDir === null ? [] : await listFolder(io, ctx, `${userDir}/agents`, warnings)
  const entries = [...userEntries, ...(await repoAgentEntries(io, ctx, warnings))]
  const names = markdownFileNames(entries).map(name => name.slice(0, -MARKDOWN_EXTENSION.length))
  warnings.push(...hiddenNameWarnings(names, 'agent name', MAX_REF_NAME_CHARS))

  return sortedUnique(stableNames(names, MAX_REF_NAME_CHARS))
}

/** The CLAUDE.md files above and in the repo, as display forms; a chain the host cannot give adds a warning. */
async function claudeMdChain(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<string[]> {
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
async function isGlobalClaudeMdThere(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<boolean> {
  if (userDir === null) return false
  const path = `${userDir}/CLAUDE.md`
  const stat = await io.stat(path)
  if (stat !== null) return stat.kind === 'file'
  if ((await missingState(io, path)) === 'unknown') warnings.push(unreadableWarning(ctx, path))

  return false
}

/**
 * The `.md` file names in the auto-memory folders of this repo, with their extension; their text is never read. The
 * folder of the root as resolved and the one of the root as given are both listed, once each when they are the same,
 * as `~/.claude.json` is matched by both root forms.
 */
async function memoryFileNames(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  if (userDir === null) return []
  const folders = new Set([ctx.root, ctx.givenRoot].map(root => memoryFolderOf(userDir, root)))
  const names: string[] = []
  for (const folder of folders) names.push(...markdownFileNames(await listFolder(io, ctx, folder, warnings)))
  warnings.push(...hiddenNameWarnings(names, 'memory file name', MAX_FILE_NAME_CHARS))

  return sortedUnique(stableNames(names, MAX_FILE_NAME_CHARS))
}

/**
 * The user-setup scan (SCAN-02, D-57): every source is read through the port and projected at once to names, counts and
 * booleans, so no value, command, token or file content can reach a later module. The sources are the three settings
 * files, the installed and enabled plugins, the commands and skills, the MCP servers of the repo's `.mcp.json`, of the
 * session, desktop app connectors left out with one warning (R2), and, only when `isClaudeJsonAllowed` is true, of
 * `~/.claude.json` (D-58), the claude.ai connectors of its `claudeAiMcpEverConnected` list included (R2), the agent
 * files, the CLAUDE.md chain, the global CLAUDE.md and the auto-memory file names. A source the port cannot read adds a
 * warning and is treated as unknown, never as empty; one that is not there is quiet. With neither CLAUDE_CONFIG_DIR nor
 * a home folder, the user-level sources are skipped. `isMcpPartial` is true when an MCP server name was dropped from
 * any source, a left-out desktop app connector aside, or `~/.claude.json` was not read (A4). `plugins` holds the
 * enabled and the installed keys, `installedPlugins` the installed keys alone, so no settings file can make a plugin
 * look installed (decision #69 A1).
 */
export async function scanSetup(io: InitIo, ctx: SetupContext, isClaudeJsonAllowed: boolean): Promise<SetupScan> {
  const warnings: string[] = []
  const userDir = userDirOf(ctx)
  if (userDir === null) warnings.push(NO_USER_DIR_WARNING)
  const sources = await readSettings(io, warnings)
  const settings = projectSettings(sources)
  warnings.push(...settingsNameWarnings(sources), ...hookNameWarnings(sources))
  const installed = await installedPluginKeys(io, ctx, userDir, warnings)
  const skills = await commandRefs(io, warnings)
  const projectServers = await projectMcpScan(io, ctx, warnings)
  const sessionServers = await sessionMcpScan(io, warnings)
  const userServers = await userConfigMcpScan(io, ctx, isClaudeJsonAllowed, warnings)
  const servers = [projectServers, sessionServers, userServers]
  const agents = await agentNames(io, ctx, userDir, warnings)
  const claudeMd = await claudeMdChain(io, ctx, warnings)
  const hasGlobalClaudeMd = await isGlobalClaudeMdThere(io, ctx, userDir, warnings)
  const memoryFiles = await memoryFileNames(io, ctx, userDir, warnings)

  return {
    plugins: sortedUnique([...settings.enabled, ...installed]),
    installedPlugins: sortedUnique(installed),
    skills,
    mcp: mergeMcp(servers.map(found => found.refs)),
    isMcpPartial: servers.some(found => found.isPartial),
    agents,
    claudeMd,
    hasGlobalClaudeMd,
    memoryFiles,
    settingsKeys: settings.settingsKeys,
    hooks: settings.hooks,
    carry: settings.carry,
    warnings,
  }
}
