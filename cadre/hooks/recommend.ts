import type { AskSpec, HunkOp, PortRead, SettingProposal, ToolCommand } from '../types'
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

/** A config value as hunk text: a string cleaned, a number or boolean as its digits or word, anything else as JSON. */
function valueText(value: unknown): string {
  if (typeof value === 'string') return clean(value, MAX_VALUE_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return clean(JSON.stringify(value), MAX_VALUE_CHARS)
}

/**
 * The value at a dotted key path, such as `workflow.text_mode`, in a parsed config, as the text a hunk shows. A key
 * counts only when the object has it as its own, so an inherited name is never a value, and a step that is not a plain
 * object ends the walk as not set. A string is cleaned and capped at 80 code points, so a repo file cannot add a line
 * to a question (T-02-22). `config` is parsed JSON.
 */
export function configValue(config: unknown, key: string): ConfigValue {
  let current: unknown = config
  for (const segment of key.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return { state: 'not-set' }
    current = current[segment]
  }

  return { state: 'set', text: valueText(current) }
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
 * The hunks to ask, in the order of the proposals (D-70). A proposal is offered when autonomy requires it, or when it
 * is the optional `hooks.context_warnings` and gsd-statusline is the statusline. One whose current value already equals
 * its target is a no-op and is not offered, so a boolean false read from the config equals the target `false`. The
 * before text comes from the config read alone: an unreadable config never equals a target, so every required proposal
 * is offered then (fail closed). No process runs.
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
    const before = beforeText(source, proposal.key)
    if (before === proposal.to) continue
    candidates.push({ proposal, before })
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
