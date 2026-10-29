/**
 * The tool recommendations, a layer 4 module: the commands printed for the person to run, and the tools a team is
 * recommended: GSD and superpowers, Playwright and DevTools MCP, and the security plugins init offers to install
 * (ROLE-03, D-74, D-96, decision #39). Nothing here runs a command. It imports the framework registry, the role
 * template, the catalog and the types, so init recommends tools and offers the security installs here.
 */
import type { FrameworkId, Recommendation, RepoScan, RoleSpec, SetupScan, TemplateRoleId } from '../../types'
import { adapterOf } from '../framework/registry'
import { CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN, SECURITY_PLUGINS } from './infra'
import { standsFor } from './template'

/**
 * The commands printed for the person to run (D-96 as reworded by decision #39), each defined once and used wherever
 * it is shown. The recommendation lines run none of them (ROLE-03, D-28). Init itself offers to run the two security
 * ones, `claudeSecurity` and `securityGuidance`, after Confirm, and only on an explicit Install (decision #39); each is
 * the argv of pluginInstallArgv for its key, joined with spaces.
 */
export const INSTALL_COMMANDS: Readonly<{
  gsd: string | null
  superpowers: string | null
  playwright: string
  devtools: string
  claudeSecurity: string
  securityGuidance: string
}> = Object.freeze({
  gsd: adapterOf('gsd').install,
  superpowers: adapterOf('superpowers').install,
  playwright: 'claude mcp add playwright -- npx @playwright/mcp@latest',
  devtools: 'claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
  claudeSecurity: 'claude plugin install claude-security@claude-plugins-official',
  securityGuidance: 'claude plugin install security-guidance@claude-plugins-official',
})

/** Why GSD and superpowers are recommended: no role of the team uses a framework (D-17, D-74). */
const NO_FRAMEWORK_WHY = 'no dev framework is in use; roles run the built-in plan, execute, verify loop'

/** An MCP server name that already gives the FE role a browser to check its work in, in any case (D-74). */
const PLAYWRIGHT_NAME = /playwright/i

/** An MCP server name that already lets the FE role inspect the running page, in any case (D-74). */
const DEVTOOLS_NAME = /devtools/i

/** The GSD and superpowers lines: only for a team with roles where none of them uses a framework (D-17, D-74). */
function frameworkRecommendations(frameworks: readonly FrameworkId[]): Recommendation[] {
  if (frameworks.length === 0 || frameworks.some(framework => framework !== 'none')) return []

  return [
    { tool: 'GSD', roleId: null, why: NO_FRAMEWORK_WHY, install: INSTALL_COMMANDS.gsd },
    { tool: 'superpowers', roleId: null, why: NO_FRAMEWORK_WHY, install: INSTALL_COMMANDS.superpowers },
  ]
}

/** One recommendation for each role that stands for `template`, when the tool is missing; none otherwise. */
function forTemplateRole(
  roles: readonly RoleSpec[],
  template: TemplateRoleId,
  isMissing: boolean,
  row: Pick<Recommendation, 'tool' | 'why' | 'install'>,
): Recommendation[] {
  if (!isMissing) return []

  return roles.filter(role => standsFor(role, template)).map(role => ({ ...row, roleId: role.id }))
}

/** Whether the repo scan found an E2E setup. */
function hasE2e(scan: RepoScan): boolean {
  return scan.findings.some(finding => finding.kind === 'e2e')
}

/** Whether the user has an MCP server whose name matches. */
function hasMcp(setup: SetupScan, pattern: RegExp): boolean {
  return setup.mcp.some(server => pattern.test(server.name))
}

/**
 * The tools to recommend for a team (ROLE-03, D-74 as reworded by decision #39), in this order: GSD and superpowers
 * when no role uses a framework; Playwright MCP for each FE role when the scan found no E2E setup and no playwright MCP
 * server exists; DevTools MCP for each FE role when no devtools MCP server exists; claude-security and then
 * security-guidance for each Security role when missingSecurityPlugins names it, so the Security lines name exactly the
 * plugins init offers to install (T-03-46, decision #69 A1), and a scanned security-review skill removes no line. A
 * role is FE or Security by its id or its `basedOn`. `frameworks` is each role's resolved framework, in role order. The
 * result is text for the person to read: nothing here runs a command (T-02-23).
 */
export function recommend(input: {
  readonly roles: readonly RoleSpec[]
  readonly frameworks: readonly FrameworkId[]
  readonly scan: RepoScan
  readonly setup: SetupScan
}): Recommendation[] {
  const { roles, frameworks, scan, setup } = input
  const missing = missingSecurityPlugins(roles, setup)

  return [
    ...frameworkRecommendations(frameworks),
    ...forTemplateRole(roles, 'fe', !hasE2e(scan) && !hasMcp(setup, PLAYWRIGHT_NAME), {
      tool: 'Playwright MCP',
      why: 'the FE role has no E2E setup to check its work in a browser',
      install: INSTALL_COMMANDS.playwright,
    }),
    ...forTemplateRole(roles, 'fe', !hasMcp(setup, DEVTOOLS_NAME), {
      tool: 'DevTools MCP',
      why: 'the FE role cannot inspect the running page',
      install: INSTALL_COMMANDS.devtools,
    }),
    ...forTemplateRole(roles, 'security', missing.includes(CLAUDE_SECURITY_PLUGIN), {
      tool: 'claude-security',
      why: "claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)",
      install: INSTALL_COMMANDS.claudeSecurity,
    }),
    ...forTemplateRole(roles, 'security', missing.includes(SECURITY_GUIDANCE_PLUGIN), {
      tool: 'security-guidance',
      why: 'no hooks warn the Security role about risky edits',
      install: INSTALL_COMMANDS.securityGuidance,
    }),
  ]
}

/**
 * The security plugins init offers to install for a team (decision #39): none when no role stands for Security (by
 * its id or its `basedOn`), else each key of SECURITY_PLUGINS, in that order, that `setup.installedPlugins` does not
 * hold exactly. Only an installed exact `@claude-plugins-official` key counts as present: a key that a settings file
 * enables, the repo's own included, is not an install (decision #69 A1), and a lookalike key of another marketplace is
 * not the plugin cadre installs, so neither hides the offer (T-03-46).
 */
export function missingSecurityPlugins(roles: readonly RoleSpec[], setup: SetupScan): string[] {
  if (!roles.some(role => standsFor(role, 'security'))) return []

  return SECURITY_PLUGINS.filter(key => !setup.installedPlugins.includes(key))
}
