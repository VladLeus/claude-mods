import type { AskSpec, FrameworkId, Recommendation, RepoScan, RoleSpec, SetupScan, TemplateRoleId } from '../types'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import { reportText } from './core/text'
import { targetText } from './framework/gsd/hunks'
import type { HunkCandidate } from './framework/gsd/hunks'
import { adapterOf } from './framework/registry'
import { CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN, SECURITY_PLUGINS } from './roles/infra'
import { standsFor } from './roles/template'

/** The dialog button that accepts a hunk; a typed answer of the same word counts the same, in any case. */
const ACCEPT_OPTION = 'Accept'

/** The dialog button that declines a hunk; a typed answer of the same word counts the same, in any case. */
const DECLINE_OPTION = 'Decline'

/** The buttons of a hunk question, in this order: the dialog focuses the first option; the order is fixed. */
const HUNK_OPTIONS: readonly string[] = Object.freeze([ACCEPT_OPTION, DECLINE_OPTION])

/** Each hunk answer with whether it accepts the hunk: only Accept does (ROLE-04). */
const HUNK_ANSWERS: readonly Labelled<boolean>[] = Object.freeze([
  { label: ACCEPT_OPTION, value: true },
  { label: DECLINE_OPTION, value: false },
])

/** The last line of a hunk question for a change autonomy cannot work without. */
const REQUIRED_NOTE = 'Required for unattended GSD roles.'

/** The last line of a hunk question for a change that only helps. */
const OPTIONAL_NOTE = 'Optional.'

/**
 * The dialog for one hunk (ROLE-04): the file and key, the before and after values, why, and whether autonomy requires
 * it, under the header `Hunk <index> of <total>` with the buttons Accept and Decline. `index` counts from 1 in the
 * order of the candidates. GSD has three proposals at most, so the header stays within the 12-character chip a dialog
 * allows. Every value is cleaned and capped as a report cell is, so none can add a line or hide text.
 */
export function hunkQuestion(
  candidate: HunkCandidate,
  index: number,
  total: number,
): { readonly question: string; readonly spec: AskSpec } {
  const { proposal, before } = candidate
  const question = [
    `${reportText(proposal.file)}: ${reportText(proposal.key)}`,
    `  before: ${reportText(before)}`,
    `  after:  ${reportText(targetText(proposal))}`,
    `Why: ${reportText(proposal.why)}`,
    proposal.isRequired ? REQUIRED_NOTE : OPTIONAL_NOTE,
  ].join('\n')

  return { question, spec: { options: HUNK_OPTIONS, header: `Hunk ${index} of ${total}` } }
}

/**
 * The answer to a hunk question: true for Accept, false for Decline, in any case and trimmed, else null. Only the word
 * Accept accepts a hunk (ROLE-04): any other answer is null, so it is asked again and then cancels the run.
 */
export function parseHunkAnswer(answer: string): boolean | null {
  return labelled(HUNK_ANSWERS, answer)
}

/**
 * The commands printed for the person to run (D-96 as reworded by decision #39), each defined once and used wherever
 * it is shown. The recommendation lines run none of them (ROLE-03, D-28). Init itself offers to run the two security
 * ones, `claudeSecurity` and `securityGuidance`, after Confirm, and only on an explicit Install (decision #39); each is
 * the argv of pluginInstallArgv for its key, joined with spaces.
 */
export const INSTALL_COMMANDS: Readonly<{
  gsd: string
  superpowers: string
  playwright: string
  devtools: string
  claudeSecurity: string
  securityGuidance: string
}> = Object.freeze({
  gsd: adapterOf('gsd').install ?? '',
  superpowers: adapterOf('superpowers').install ?? '',
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

/**
 * The heading above the recommendation lines: the lines only print commands, and init asks before it installs any of
 * them, as it does for the security plugins (decision #69 A2).
 */
const RECOMMENDATIONS_HEADING = 'Recommendations (print-only; init asks before it installs any):'

/** The one line printed when there is nothing to recommend. */
const NO_RECOMMENDATIONS = 'Recommendations: none'

/** Who benefits when a recommendation names no role. */
const ALL_ROLES = 'all roles'

/** The title of the role with this id; the id itself when no role has it. */
function roleTitle(roleId: string, roles: readonly RoleSpec[]): string {
  return roles.find(role => role.id === roleId)?.title ?? roleId
}

/**
 * The lines init prints for the recommendations: `Recommendations: none`, or a heading and then two lines for each,
 * `- <tool> for <role title or all roles>: <why>` and `    run: <command>`. Every cell is cleaned and capped as a
 * report cell is, so none can add a line or hide text.
 */
export function recommendationLines(
  recommendations: readonly Recommendation[],
  roles: readonly RoleSpec[],
): string[] {
  if (recommendations.length === 0) return [NO_RECOMMENDATIONS]
  const lines = [RECOMMENDATIONS_HEADING]
  for (const recommendation of recommendations) {
    const who = recommendation.roleId === null ? ALL_ROLES : roleTitle(recommendation.roleId, roles)
    lines.push(`- ${reportText(recommendation.tool)} for ${reportText(who)}: ${reportText(recommendation.why)}`)
    lines.push(`    run: ${reportText(recommendation.install)}`)
  }

  return lines
}
