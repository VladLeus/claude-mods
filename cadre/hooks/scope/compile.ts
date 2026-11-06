/**
 * The scope compiler, a layer 5 module: the whole scope of one role from one computation, so the settings template,
 * the MCP file, the launcher flags, the skill overlay and the card cannot drift apart (ROLE-05, D-80, D-84): the
 * plugins under the whitelist, the deny list, the overlay and the flags. It imports the scope lint and card, core,
 * paths, the framework registry, the role template, the infra catalog and the types, so team compiles every role's
 * scope here.
 */
import type { CompiledScope, RoleSpec, ScopeContext } from '../../types'
import { sortedUnique } from '../core/text'
import { adapterOf } from '../framework/registry'
import { PRIVATE_INSTRUCTIONS_LINK } from '../paths'
import {
  INFRA_MCP_SERVERS,
  INFRA_PLUGINS,
  INFRA_SKILLS,
  SECURITY_GUIDANCE_PLUGIN,
  SECURITY_PLUGINS,
} from '../roles/infra'
import { standsFor } from '../roles/template'
import { cardFor, mcpToolName, notGivenMcp } from './card'
import type { DenyPlan } from './card'
import {
  isInfraPlugin,
  isSafeDir,
  lintAll,
  ownNames,
  ownRoots,
  pluginName,
  SECRET_READ_DENY,
  skillPlugin,
} from './lint'

/** The enabledPlugins record of these plugin keys, every one on, with the keys inserted in sorted order. */
function enabledRecord(keys: readonly string[]): Readonly<Record<string, boolean>> {
  const entries: [string, boolean][] = sortedUnique(keys).map(key => [key, true])

  return Object.fromEntries(entries)
}

/**
 * The plugins the role session loads under the whitelist: the three infra plugins, every scanned key whose name part
 * is an infra plugin name under any marketplace (isInfraPlugin, D-281), and every scanned key of a plugin that adds a
 * skill of the role or a start skill of its framework (a skill named `plugin:skill` is present only when its plugin is
 * enabled). The superpowers framework also enables every scanned `superpowers@` key. A scanned key of a plugin named in
 * SECURITY_PLUGINS (claude-security, security-guidance) is enabled only when it is that key exactly, never by its
 * plugin name, since the scanned keys include the repo's own settings (T-03-46, T-03-47); every other plugin is
 * matched by its name. A role that stands for Security also gets SECURITY_GUIDANCE_PLUGIN itself when the setup holds
 * that exact key, so its hooks warn that role about risky edits (decision #39); another role enables it only for a
 * `security-guidance:` skill the person gave it (decision #69 B4).
 */
function pluginsFor(role: RoleSpec, ctx: ScopeContext): Readonly<Record<string, boolean>> {
  const adapter = adapterOf(ctx.framework)
  const skills = [...adapter.startSkills, ...role.skills]
  const wanted = new Set(skills.map(skillPlugin).filter((plugin): plugin is string => plugin !== null))
  for (const plugin of adapter.pluginsToEnable) wanted.add(plugin)
  const scanned = ctx.setup.plugins.filter(key => {
    const name = pluginName(key)
    const exact = SECURITY_PLUGINS.find(official => pluginName(official) === name)

    return wanted.has(name) && (exact === undefined || key === exact)
  })
  const isGuidanceOn = standsFor(role, 'security') && ctx.setup.plugins.includes(SECURITY_GUIDANCE_PLUGIN)
  const infra = [...INFRA_PLUGINS, ...ctx.setup.plugins.filter(isInfraPlugin)]

  return enabledRecord([...infra, ...scanned, ...(isGuidanceOn ? [SECURITY_GUIDANCE_PLUGIN] : [])])
}

/**
 * The deny list of a role (ROLE-05, D-80): Bash for a role without it (hard), reads and edits under each scanned code
 * dir for that role (best effort, and `./x/**` matches at any depth, P13), the secret reads for every role, and every
 * scanned MCP server the role was not given, by its engine tool name (A5). A code dir whose name matches a folder of
 * the role's own paths is left out, so those folders stay readable: a top folder of its own paths is never denied, and
 * exact denies for any other such name are rendered at launch (D-98, B7). A dir with an unusual name is left out too,
 * and so is a server whose tool name is that of a server the role has or of an infra server, since denying it would
 * block that server. Every entry must pass the lint, and one that does not is dropped and named (T-02-24).
 */
function denyFor(role: RoleSpec, ctx: ScopeContext): DenyPlan {
  const dirs = role.hasBash ? [] : sortedUnique(ctx.codeDirs)
  const usable = dirs.filter(isSafeDir)
  const own = ownNames(role.id)
  const roots = ownRoots(role.id)
  const covered = usable.filter(dir => !own.has(dir.toLowerCase()))
  const skipped = usable.filter(dir => own.has(dir.toLowerCase()))
  const notGiven = notGivenMcp(role, ctx)
  const had = new Set([...role.mcp, ...INFRA_MCP_SERVERS].map(mcpToolName))
  const named = notGiven.filter(name => !had.has(mcpToolName(name)))
  const { kept, refused } = lintAll([
    ...(role.hasBash ? [] : ['Bash']),
    ...covered.flatMap(dir => [`Read(./${dir}/**)`, `Edit(./${dir}/**)`]),
    ...SECRET_READ_DENY,
    ...named.map(mcpToolName),
  ])

  return {
    entries: kept,
    dirs: covered.filter(dir => kept.includes(`Read(./${dir}/**)`) && kept.includes(`Edit(./${dir}/**)`)),
    ownDirs: skipped.filter(dir => roots.has(dir.toLowerCase())),
    skippedDirs: skipped.filter(dir => !roots.has(dir.toLowerCase())),
    unusualDirs: dirs.filter(dir => !isSafeDir(dir)),
    mcp: named.filter(name => kept.includes(mcpToolName(name))),
    unusualMcp: notGiven.filter(name => had.has(mcpToolName(name))),
    refused,
  }
}

/**
 * The skills and agents linked into the overlay at launch (spike S4 V3): the handoff skills, the start skills of the
 * framework and the skills of the role, and for GSD the `gsd-*` agents of the setup. Under `--setting-sources project`
 * a user-level skill is absent unless the overlay links it. A skill named `plugin:skill` is not linked: its plugin is
 * enabled instead.
 */
function overlayFor(role: RoleSpec, ctx: ScopeContext): CompiledScope['overlay'] {
  const adapter = adapterOf(ctx.framework)
  const names = [...INFRA_SKILLS, ...adapter.startSkills, ...role.skills]
  const skills = sortedUnique(names.filter(name => skillPlugin(name) === null))
  const prefix = adapter.agentPrefix
  const agents = prefix === null ? [] : sortedUnique(ctx.setup.agents.filter(name => name.startsWith(prefix)))

  return { skills, agents }
}

/**
 * The launcher flags as argv tokens, a flag and its value each their own token, so a launcher can quote every token
 * (D-50, D-78, S1, S4). The paths are repo-relative: the launcher starts in the git top level. Beside the overlay, the
 * role folder and the private instructions link in `.runtime` are added directories, so the engine loads the role's
 * built `.cadre/<id>/CLAUDE.md` and its private CLAUDE.md as CLAUDE.md files when the exec line sets
 * CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD (D-140 q1-b); ROLE.md stays the appended system prompt. The MCP route
 * is a parameter, and the flag that turns off slash commands is never added, because it would turn off the handoff
 * skills. The role id is a validated slug (validateRoleId), so it is safe in a path and in a token.
 */
function flagsFor(role: RoleSpec, ctx: ScopeContext): string[] {
  const runtime = `.cadre/${role.id}/.runtime`
  const flags = [
    '--setting-sources',
    'project',
    '--settings',
    `${runtime}/settings.json`,
    '--append-system-prompt-file',
    `.cadre/${role.id}/ROLE.md`,
    '--name',
    `cadre-${role.id}`,
    '--model',
    role.model,
    '--effort',
    role.effort,
    '--permission-mode',
    role.permissionMode,
    '--add-dir',
    `${runtime}/overlay`,
    '--add-dir',
    `.cadre/${role.id}`,
    '--add-dir',
    `${runtime}/${PRIVATE_INSTRUCTIONS_LINK}`,
    '--mcp-config',
    `${runtime}/mcp.json`,
  ]

  return ctx.mcpRoute === 'strict' ? [...flags, '--strict-mcp-config'] : flags
}

/**
 * Compiles the whole scope of one role from one computation (D-80): the committed settings template, the MCP file,
 * the launcher flags, the skill overlay and the card cannot drift apart, and the probe checks against the same
 * value. The settings hold only the portable keys `enabledPlugins`, `permissions` and `sandbox` (D-84); every
 * per-user value is rendered at launch. Every deny entry passes lintDenyPattern, and one that does not is dropped and
 * named on the card. Every list is sorted and without repeats, so the template hashes stably, and nothing is kept
 * between calls.
 */
export function compileScope(role: RoleSpec, ctx: ScopeContext): CompiledScope {
  const enabledPlugins = pluginsFor(role, ctx)
  const deny = denyFor(role, ctx)

  return {
    settings: {
      enabledPlugins,
      permissions: { defaultMode: role.permissionMode, deny: deny.entries },
      sandbox: { enabled: role.hasBash },
    },
    mcp: { schema: 1, servers: sortedUnique(role.mcp) },
    flags: flagsFor(role, ctx),
    overlay: overlayFor(role, ctx),
    card: cardFor(role, ctx, Object.keys(enabledPlugins), deny),
  }
}
