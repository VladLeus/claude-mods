import type {
  AskSpec,
  FrameworkId,
  HunkOp,
  PortRead,
  Recommendation,
  RepoScan,
  RoleSpec,
  SettingProposal,
  SetupScan,
  TemplateRoleId,
  ToolCommand,
} from '../types'
import { isSecurityReviewSkill } from './assign'
import { clean, displayPath, isObject, isSafeConfigDir, parseJsonValue, trimSlash } from './facts'
import { reportText } from './render'

/** The before text of a key the config does not set: GSD then uses its own default (D-70). */
export const NOT_SET_TEXT = 'not set (GSD default)'

/** The before text when `.planning/config.json` cannot be read or is not a JSON object: the value is not known. */
export const UNKNOWN_CONFIG_TEXT = 'unknown (could not read .planning/config.json)'

/** Code points of a config value that a hunk shows; a longer value is cut with an ellipsis (T-02-22). */
const MAX_VALUE_CHARS = 80

/** The settings key whose hunk is optional: it is offered only when gsd-statusline is the statusline (D-70). */
const CONTEXT_WARNINGS_KEY = 'hooks.context_warnings'

/** A config key's value as the text a hunk shows: set, with its text, or not set. */
type ConfigValue = { readonly state: 'set'; readonly text: string } | { readonly state: 'not-set' }

/** A config key's raw parsed value: set, with the value, or not set. */
type RawValue = { readonly state: 'set'; readonly value: unknown } | { readonly state: 'not-set' }

/**
 * A config value as hunk text: a number or boolean as its digits or word, anything else as JSON, so a string shows in
 * quotes and the string "false" never reads like the boolean false (A2). The text is cleaned and capped.
 */
function valueText(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return clean(JSON.stringify(value), MAX_VALUE_CHARS)
}

/**
 * The raw value at a dotted key path in a parsed config. A key counts only when the object has it as its own, so an
 * inherited name is never a value, and a step that is not a plain object ends the walk as not set.
 */
function rawValue(config: unknown, key: string): RawValue {
  let current: unknown = config
  for (const segment of key.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return { state: 'not-set' }
    current = current[segment]
  }

  return { state: 'set', value: current }
}

/**
 * The value at a dotted key path, such as `workflow.text_mode`, in a parsed config, as the text a hunk shows. A key
 * counts only when the object has it as its own, so an inherited name is never a value, and a step that is not a plain
 * object ends the walk as not set. A string is shown JSON-quoted, cleaned and capped at 80 code points, so a repo file
 * cannot add a line to a question (T-02-22). `config` is parsed JSON.
 */
export function configValue(config: unknown, key: string): ConfigValue {
  const found = rawValue(config, key)
  if (found.state === 'not-set') return { state: 'not-set' }

  return { state: 'set', text: valueText(found.value) }
}

/** What the config file gives a lookup: its object, no file, or a file whose value cannot be known. */
type ConfigSource =
  | { readonly kind: 'object'; readonly value: Record<string, unknown> }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown' }

/**
 * The config read as a lookup source. A file that is absent is a missing config, but a read that failed, a file over
 * the cap, text that is not JSON and JSON that is not an object are all unknown: never taken for a config that sets
 * nothing.
 */
function configSource(config: PortRead): ConfigSource {
  if (config.state === 'absent') return { kind: 'absent' }
  if (config.state !== 'text') return { kind: 'unknown' }
  const parsed = parseJsonValue(config.text)
  if (parsed === null) return { kind: 'unknown' }
  const { value } = parsed
  if (!isObject(value)) return { kind: 'unknown' }

  return { kind: 'object', value }
}

/** The text a hunk shows as the current value of a key: the key's text, the not-set text, or the unknown text. */
function beforeText(source: ConfigSource, key: string): string {
  if (source.kind === 'absent') return NOT_SET_TEXT
  if (source.kind === 'unknown') return UNKNOWN_CONFIG_TEXT
  const found = configValue(source.value, key)

  return found.state === 'set' ? found.text : NOT_SET_TEXT
}

/** One change to offer: the proposal, and the value `.planning/config.json` holds for its key now, as text. */
export type HunkCandidate = {
  readonly proposal: SettingProposal
  readonly before: string
}

/** Whether a proposal is asked: autonomy requires it, or it is the optional context_warnings under gsd-statusline. */
function isOffered(proposal: SettingProposal, isGsdStatusline: boolean): boolean {
  if (proposal.isRequired) return true

  return proposal.key === CONTEXT_WARNINGS_KEY && isGsdStatusline
}

/**
 * Whether the config already holds the target of a proposal: the key is set and its raw value, as JSON, equals the
 * target parsed as JSON (the target text itself when it is not JSON). Cleaned text is never compared, so the string
 * "false" is not the boolean false (A2). An absent or unknown config never holds a target (fail closed).
 */
function isAtTarget(source: ConfigSource, proposal: SettingProposal): boolean {
  if (source.kind !== 'object') return false
  const found = rawValue(source.value, proposal.key)
  if (found.state === 'not-set') return false
  const target = parseJsonValue(proposal.to)?.value ?? proposal.to

  return JSON.stringify(found.value) === JSON.stringify(target)
}

/**
 * The hunks to ask, in the order of the proposals (D-70). A proposal is offered when autonomy requires it, or when it
 * is the optional `hooks.context_warnings` and gsd-statusline is the statusline. One whose raw config value already
 * equals its target, compared as JSON, is a no-op and is not offered: a boolean false equals the target `false`, and
 * the string "false" does not (A2). The before text comes from the config read alone: an unreadable config never
 * equals a target, so every required proposal is offered then (fail closed). No process runs.
 */
export function hunkCandidates(
  proposals: readonly SettingProposal[],
  config: PortRead,
  isGsdStatusline: boolean,
): HunkCandidate[] {
  const source = configSource(config)
  const candidates: HunkCandidate[] = []
  for (const proposal of proposals) {
    if (!isOffered(proposal, isGsdStatusline)) continue
    if (isAtTarget(source, proposal)) continue
    candidates.push({ proposal, before: beforeText(source, proposal.key) })
  }

  return candidates
}

/** The dialog button that accepts a hunk; a typed answer of the same word counts the same, in any case. */
const ACCEPT_OPTION = 'Accept'

/** The dialog button that declines a hunk; a typed answer of the same word counts the same, in any case. */
const DECLINE_OPTION = 'Decline'

/** The buttons of a hunk question, in this order; nothing is preselected. */
const HUNK_OPTIONS: readonly string[] = Object.freeze([ACCEPT_OPTION, DECLINE_OPTION])

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
    `  after:  ${reportText(proposal.to)}`,
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
  const wanted = answer.trim().toLowerCase()
  if (wanted === ACCEPT_OPTION.toLowerCase()) return true
  if (wanted === DECLINE_OPTION.toLowerCase()) return false

  return null
}

/**
 * The plan's op for one asked hunk: the change, what the person answered, and the command in display form.
 * `isAccepted` is exactly the answer, never inferred from `isRequired`. `isRunnable` is true only when the command
 * resolved to an argv; without one (repo-local GSD only) cadre does not run it and the person runs `command` (D-72).
 */
export function hunkOp(
  candidate: HunkCandidate,
  isAccepted: boolean,
  resolved: { readonly argv: readonly string[] | null; readonly display: string },
): HunkOp {
  const { proposal, before } = candidate

  return {
    kind: 'hunk',
    file: proposal.file,
    key: proposal.key,
    before,
    after: proposal.to,
    isRequired: proposal.isRequired,
    isAccepted,
    isRunnable: resolved.argv !== null,
    command: resolved.display,
  }
}

/** What resolveToolCommand needs: the raw user-level GSD dir, and the folders a path is shown relative to. */
export type GsdToolContext = {
  /** The absolute user-level GSD dir, used raw for the argv and never printed; null when there is none (D-72). */
  readonly userDir: string | null
  readonly home: string | null
  readonly root: string
  readonly configDir: string | null
}

/** The script of each logical tool, relative to its GSD dir (D-71): the one table that turns a tool into a path. */
export const TOOL_SCRIPTS: Readonly<Record<ToolCommand['tool'], string>> = Object.freeze({
  'gsd-tools': 'bin/gsd-tools.cjs',
})

/** Where the repo's own GSD copy lives. The command for it is printed for the person and never run (D-28, D-72). */
const REPO_GSD_DIR = '.claude/gsd-core'

/** An argument cadre hands to a tool: letters, digits, dot, underscore and hyphen only, so no shell text gets in. */
const PLAIN_WORD = /^[A-Za-z0-9._-]+$/

/** The display of a command that was refused because an argument is not a plain word. */
const REFUSED_DISPLAY = 'refused: an argument is not a plain word'

/**
 * The real command for a logical tool call (D-71). Only a user-level GSD dir becomes an argv, `node <dir>/<script>
 * <args>` with the raw dir, and its display form shows the dir as `~/...` (or `$CLAUDE_CONFIG_DIR/...`). Without one,
 * or with a dir that is not an absolute path free of empty, `.` and `..` segments, the result has no argv and the
 * display is the repo-local command for the person to run from the repo root: cadre never runs the repo's own GSD copy
 * (T-02-21, D-28, D-72). An argument that is not a plain word refuses the command. Nothing here runs anything.
 */
export function resolveToolCommand(
  command: ToolCommand,
  gsd: GsdToolContext,
): { readonly argv: readonly string[] | null; readonly display: string } {
  if (!command.args.every(arg => PLAIN_WORD.test(arg))) return { argv: null, display: REFUSED_DISPLAY }
  const script = TOOL_SCRIPTS[command.tool]
  const userDir = trimSlash(gsd.userDir)
  if (userDir === null || !isSafeConfigDir(userDir)) {
    return { argv: null, display: ['node', `${REPO_GSD_DIR}/${script}`, ...command.args].join(' ') }
  }
  const path = `${userDir}/${script}`
  const shown = displayPath(path, gsd.home, gsd.root, gsd.configDir)

  return { argv: ['node', path, ...command.args], display: ['node', shown, ...command.args].join(' ') }
}

/**
 * Whether the answered hunks leave the GSD roles attended (ROLE-04): a required hunk that was declined, or that cadre
 * cannot run (repo-local GSD only), means a person is still needed. An optional hunk never does, and no hunks do not.
 */
export function isGsdAttended(hunks: readonly HunkOp[]): boolean {
  return hunks.some(hunk => hunk.isRequired && (!hunk.isAccepted || !hunk.isRunnable))
}

/**
 * Whether the GSD roles are attended by the current config alone, without asking (regen, D-70, D-72): a required
 * proposal is still offered, that is, not yet at its target. A config that cannot be read never equals a target, so it
 * attends the roles too (fail closed). With no required proposal, as for superpowers and the built-in fallback, nothing
 * is attended.
 */
export function isGsdAttendedFromConfig(
  proposals: readonly SettingProposal[],
  config: PortRead,
  isGsdStatusline: boolean,
): boolean {
  return hunkCandidates(proposals, config, isGsdStatusline).some(candidate => candidate.proposal.isRequired)
}

/** Names joined for a sentence: `a`, `a and b`, `a, b and c`. */
function listText(names: readonly string[]): string {
  const head = names.slice(0, -1)
  const last = names.slice(-1).join('')
  if (head.length === 0) return last

  return `${head.join(', ')} and ${last}`
}

/**
 * The line that says why GSD roles are attended and what ends it: the settings that must be set as proposed. The keys
 * are cleaned like any report cell. With no key the line names no setting.
 */
export function attendedNote(keys: readonly string[]): string {
  const shown = keys.map(reportText)
  const what = shown.length === 0 ? 'its settings' : listText(shown)

  return `attended: GSD needs a person until ${what} ${shown.length === 1 ? 'is' : 'are'} set as proposed`
}

/**
 * The commands printed for the person to run (D-96, approved word for word). cadre runs none of them (ROLE-03, D-28).
 * `securityReview` is not a command: that skill is built into Claude Code and is added to the Security role's
 * `role.json`, with `<id>` left as literal text. It is defined once and used wherever it is shown.
 */
export const INSTALL_COMMANDS: Readonly<{
  gsd: string
  superpowers: string
  playwright: string
  devtools: string
  securityReview: string
}> = Object.freeze({
  gsd: 'npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global',
  superpowers: 'claude plugin install superpowers@claude-plugins-official',
  playwright: 'claude mcp add playwright -- npx @playwright/mcp@latest',
  devtools: 'claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
  securityReview:
    "built into Claude Code as /security-review; add it to the Security role's skills in .cadre/<id>/role.json",
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

/** Whether a role stands for a template role: it has that id, or it is based on that role. */
function standsFor(role: RoleSpec, template: TemplateRoleId): boolean {
  return role.id === template || role.basedOn === template
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
 * The tools to recommend for a team (ROLE-03, D-74), in this order: GSD and superpowers when no role uses a framework;
 * Playwright MCP for each FE role when the scan found no E2E setup and no playwright MCP server exists; DevTools MCP
 * for each FE role when no devtools MCP server exists; security-review for each Security role when no such skill
 * exists. A role is FE or Security by its id or its `basedOn`. `frameworks` is each role's resolved framework, in role
 * order. The result is text for the person to read: nothing here runs a command (T-02-23).
 */
export function recommend(input: {
  readonly roles: readonly RoleSpec[]
  readonly frameworks: readonly FrameworkId[]
  readonly scan: RepoScan
  readonly setup: SetupScan
}): Recommendation[] {
  const { roles, frameworks, scan, setup } = input

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
    ...forTemplateRole(roles, 'security', !setup.skills.some(skill => isSecurityReviewSkill(skill.name)), {
      tool: 'security-review',
      why: 'the Security role has no security-review skill',
      install: INSTALL_COMMANDS.securityReview,
    }),
  ]
}

/** The heading above the recommendation lines. */
const RECOMMENDATIONS_HEADING = 'Recommendations (print-only; nothing is installed):'

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
