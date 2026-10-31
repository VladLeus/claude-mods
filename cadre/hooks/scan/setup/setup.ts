/**
 * The user-setup scan entry, a layer 3 module: scanSetup reads every setup source through the port and projects it at
 * once to names, counts and booleans, through the settings, skills, MCP, agent, CLAUDE.md and memory scans beside it
 * (SCAN-02, D-57, D-58). It imports core, paths, those scans and the types, so gather scans the user's setup here.
 */
import type { InitIo, SetupScan } from '../../../types'
import { sortedUnique } from '../../core/text'
import { t } from '../../locales/t'
import { userDirOf } from '../../paths'
import { agentNames } from './agents'
import { claudeMdChain, isGlobalClaudeMdThere } from './claude-md'
import { mergeMcp, projectMcpScan, sessionMcpScan, userConfigMcpScan } from './mcp'
import { memoryFileNames } from './memory'
import type { SetupContext } from './read'
import { hookNameWarnings, installedPluginKeys, projectSettings, readSettings, settingsNameWarnings } from './settings'
import { commandRefs } from './skills'

/** The warning when there is neither a CLAUDE_CONFIG_DIR nor a home folder to find the user-level sources in. */
const NO_USER_DIR_WARNING = t('scan.setup.setup.noUserDirWarning')

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
  const userDir = userDirOf(ctx, [ctx.root], warnings)
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
