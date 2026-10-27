import type { InitIo, SetupScan } from '../types'
import { sortedUnique } from './core/text'
import { markdownFileNames, MAX_FILE_NAME_CHARS, memoryFolderOf, userDirOf } from './paths'
import { hiddenNameWarnings } from './scan/facts/normalize'
import { agentNames } from './scan/setup/agents'
import { claudeMdChain, isGlobalClaudeMdThere } from './scan/setup/claude-md'
import { mergeMcp, projectMcpScan, sessionMcpScan, userConfigMcpScan } from './scan/setup/mcp'
import { listFolder } from './scan/setup/read'
import type { SetupContext } from './scan/setup/read'
import {
  hookNameWarnings,
  installedPluginKeys,
  projectSettings,
  readSettings,
  settingsNameWarnings,
  stableNames,
} from './scan/setup/settings'
import { commandRefs } from './scan/setup/skills'

/** The warning when there is neither a CLAUDE_CONFIG_DIR nor a home folder to find the user-level sources in. */
const NO_USER_DIR_WARNING = 'HOME is unset: user-level setup was not scanned'

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
