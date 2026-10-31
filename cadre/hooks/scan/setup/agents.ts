/**
 * The agents part of the setup scan, a layer 3 module: the agent names of the user folder's `agents` and of the repo's
 * `.claude/agents`, the `.md` file names without the extension, the repo folder listed only when its stat shows a
 * folder inside the repo (D-57, WR-02). No agent file is read. It imports core, paths, the facts name warnings, the
 * MCP scan's name cap, the setup readers and settings, and the types, so the setup scan lists the agents here.
 */
import type { InitIo, PortEntry } from '../../../types'
import { sortedUnique } from '../../core/text'
import { t } from '../../locales/t'
import { isDirInsideRoot, MARKDOWN_EXTENSION, markdownFileNames } from '../../paths'
import { hiddenNameWarnings } from '../facts/normalize'
import { MAX_REF_NAME_CHARS } from './mcp'
import { isInsideRepo, listFolder } from './read'
import type { SetupContext } from './read'
import { stableNames } from './settings'

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
export async function agentNames(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  const userEntries = userDir === null ? [] : await listFolder(io, ctx, `${userDir}/agents`, warnings)
  const entries = [...userEntries, ...(await repoAgentEntries(io, ctx, warnings))]
  const names = markdownFileNames(entries).map(name => name.slice(0, -MARKDOWN_EXTENSION.length))
  warnings.push(...hiddenNameWarnings(names, t('scan.setup.agents.agentNames'), MAX_REF_NAME_CHARS))

  return sortedUnique(stableNames(names, MAX_REF_NAME_CHARS))
}
