/**
 * The isolation probe of a role (ISO-01, D-112, D-130). `<launcher> --probe` starts one print-mode turn with the scope
 * flags of the role and checks the init event of that run in sh against `.cadre/<id>/.runtime/probe-expectations.json`:
 * the sh launcher evaluates the expectations and never runs cadre TypeScript (D-102). This module renders them from the
 * compiled scope, the value the scope card comes from (D-80), and states the same rules in probeVerdicts for the specs.
 */
import type { CompiledScope, ProbeCheck, ProbeCheckKind, ProbeExpectation, ScopeRule } from '../types'
import { isObject, parseJsonValue } from './facts'
import { asciiLine } from './generate'

/** Every kind of probe check, in the order of the ProbeCheckKind type (D-112). */
export const PROBE_CHECK_KINDS: readonly ProbeCheckKind[] = Object.freeze([
  'tool-absent',
  'tool-prefix-absent',
  'tool-present',
  'command-present',
  'skill-present',
  'permission-mode',
  'memory-path',
  'not-visible',
  'note',
])

/** The most characters the text of an expectation has, which the launcher prints after the verdict. */
const PROBE_TEXT_MAX = 300

/**
 * Text as the launcher prints it for an expectation: one line of printable ASCII with no quote or backtick, at most 300
 * characters (asciiLine), and every `|` and `\` written as `/`: the launcher splits an expectation line on `|`, and a
 * backslash would reach its `echo` as `\` through jq but as `\\` through sed, and dash's `echo` reads backslash escapes
 * (decision #49).
 */
export function probeText(text: string): string {
  return asciiLine(text, PROBE_TEXT_MAX).replaceAll('|', '/').replaceAll('\\', '/')
}

/** A token of printable ASCII characters only, at least one. */
const PRINTABLE_TOKEN = /^[\x20-\x7e]+$/

/** The characters no token may hold: the double quote, the backslash, the pipe, the backtick and the dollar. */
const UNSAFE_TOKEN_CHAR = /["\\|`$]/

/**
 * Whether a token can be written as a check (T-03-10): it is not empty, every character is printable ASCII, and it
 * holds no `"`, `\`, `|`, backtick or `$`, so JSON writes it as itself and the launcher's jq, sed and case read it back
 * as it is.
 */
export function isProbeToken(token: string): boolean {
  return PRINTABLE_TOKEN.test(token) && !UNSAFE_TOKEN_CHAR.test(token)
}

/** What the text of an expectation ends with when its token is not compared (T-03-10). */
const UNUSUAL_SUFFIX = ' (not checked: unusual characters)'

/**
 * An expectation as the file holds it: as it is when its token can be compared (isProbeToken), else not-visible with
 * the token '' and its text marked as not checked, so an unusual token never reaches the launcher (T-03-10).
 */
function written(expectation: ProbeExpectation): ProbeExpectation {
  if (isProbeToken(expectation.token)) return expectation
  const { enforcement, text } = expectation

  return { check: 'not-visible', enforcement, text: `${text}${UNUSUAL_SUFFIX}`, token: '' }
}

/** What the probe prints after the text of a rule for one of its checks. */
function checkLabel(check: ProbeCheck): string {
  const { kind, token } = check
  if (kind === 'tool-absent') return `tool ${token} absent`
  if (kind === 'tool-prefix-absent') return `tools of ${token} absent`
  if (kind === 'tool-present') return `tool ${token} present`
  if (kind === 'command-present') return `command ${token} present`
  if (kind === 'skill-present') return `skill ${token} present`

  return `permission mode ${token}`
}

/**
 * The expectations of one card rule: one per check, with the rule's label and the rule's text followed by the check;
 * for a rule with no check, one not-visible expectation when it is hard or best effort, or one note when it is labelled
 * none, both with the token ''.
 */
function ruleExpectations(rule: ScopeRule): ProbeExpectation[] {
  const { enforcement, text } = rule
  const checks: readonly ProbeCheck[] = rule.checks ?? []
  if (checks.length === 0) {
    return [{ check: enforcement === 'none' ? 'note' : 'not-visible', enforcement, text: probeText(text), token: '' }]
  }

  return checks.map(check =>
    written({
      check: check.kind,
      enforcement,
      text: probeText(`${text} [${checkLabel(check)}]`),
      token: check.token,
    }),
  )
}

/**
 * The expectations of a role's probe (D-112, D-130), in card rule order: one per check of a rule, as
 * `<rule text> [<check>]` with the rule's label, or for a rule with no check one not-visible expectation (hard or best
 * effort), which the launcher reports best-effort, or one note (none). The last one is the role's memory folder, which
 * the init event shows as `memory_paths.auto` (ISO-03). A check or memory token that fails isProbeToken is never
 * written as a check: that expectation is not-visible, its token '' and its text ends with
 * ` (not checked: unusual characters)` (T-03-10).
 */
export function expectationsFor(scope: CompiledScope, memoryDir: string): ProbeExpectation[] {
  const memory = written({
    check: 'memory-path',
    enforcement: 'hard',
    text: probeText(`Memory folder: ${memoryDir} (autoMemoryDirectory)`),
    token: memoryDir,
  })

  return [...scope.card.rules.flatMap(ruleExpectations), memory]
}

/**
 * The text of `.cadre/<id>/.runtime/probe-expectations.json` (D-130): `{"schema":1,"rules":[`, then one compact JSON
 * object per line with the keys check, enforcement, text and token in that order and a comma after every line but the
 * last, then `]}`. The whole text is JSON for jq, and one rule per line is what the launcher's sed reads without jq.
 */
export function probeExpectationsText(expectations: readonly ProbeExpectation[]): string {
  const lines = expectations.map(({ check, enforcement, text, token }) =>
    JSON.stringify({ check, enforcement, text, token }),
  )

  return `{"schema":1,"rules":[\n${lines.join(',\n')}\n]}\n`
}

/**
 * What the init event of a print-mode start shows (D-112): the names it lists as tools, slash commands and skills, its
 * permission mode, and its auto memory folder; null where it shows none. parseInitEvent reads it from the stream-json
 * output of a probe run.
 */
export type InitInventory = {
  readonly tools: readonly string[]
  readonly slashCommands: readonly string[]
  readonly skills: readonly string[]
  readonly permissionMode: string | null
  readonly memoryAuto: string | null
}

/** The init lists the launcher reads; each must appear on the raw init line exactly once (decision #48). */
const INIT_LIST_KEYS: readonly string[] = Object.freeze(['tools', 'skills', 'slash_commands'])

/** Whether the raw line holds `"<key>":[` exactly once, as the launcher's cadre_once reads it. */
function holdsListOnce(line: string, key: string): boolean {
  return line.split(`"${key}":[`).length === 2
}

/**
 * Whether the launcher's sed reads a name of an init list whole (#72 A1): the name holds no `]`, where that read of the
 * list stops, and its JSON text holds no `\`, the escape JSON writes for a `"`, a `\` or a control character. The
 * launcher refuses a list that holds a `\` or an odd number of `"`; for an init line written as JSON.stringify writes
 * it, that is exactly a list with a string name this function rejects.
 */
function isReadableName(name: string): boolean {
  return !name.includes(']') && !JSON.stringify(name).includes('\\')
}

/**
 * The startup inventory in the stream-json output of a probe run (ISO-01, D-112), or null. The init event is the first
 * line that holds `"subtype":"init"` and parses to an object of type `system` and subtype `init`; no other line is
 * read, and it need not be line 1, since hook and title events can come before it (RESEARCH 2.4). Tools, slash commands
 * and skills keep their string entries; the permission mode and `memory_paths.auto` are strings or null. Every
 * malformed shape gives null, and nothing throws: output with no init event (the launcher refuses with exit 1 then), a
 * truncated line, a JSON array, an init event whose `tools`, `slash_commands` or `skills` is not an array, and a line
 * that does not hold each of `"tools":[`, `"skills":[` and `"slash_commands":[` exactly once, nested or not (the
 * launcher's cadre_once check, decision #49), and a list with a string name the launcher cannot read whole
 * (isReadableName, #72 A1), so no verdict is ever computed from a guessed or cut inventory (T-03-39).
 * `mcp_servers` is never read: a denied server's tools leave `tools` under the tool deny, whether or not
 * deniedMcpServers also disconnects it, so a check on a server is a check on tools. It is the TypeScript twin of the
 * sh reads of the launcher's `--probe` branch.
 */
export function parseInitEvent(output: string): InitInventory | null {
  const names = (list: unknown): string[] =>
    Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : []

  for (const line of output.split('\n')) {
    if (!line.includes('"subtype":"init"')) continue
    const event = parseJsonValue(line)?.value
    if (!isObject(event) || event.type !== 'system' || event.subtype !== 'init') continue
    if (!Array.isArray(event.tools) || !Array.isArray(event.slash_commands) || !Array.isArray(event.skills)) return null
    if (!INIT_LIST_KEYS.every(key => holdsListOnce(line, key))) return null
    const lists = [event.tools, event.slash_commands, event.skills]
    if (!lists.every(list => names(list).every(isReadableName))) return null

    const memory = event.memory_paths
    const auto = isObject(memory) ? memory.auto : null

    return {
      tools: names(event.tools),
      slashCommands: names(event.slash_commands),
      skills: names(event.skills),
      permissionMode: typeof event.permissionMode === 'string' ? event.permissionMode : null,
      memoryAuto: typeof auto === 'string' ? auto : null,
    }
  }

  return null
}

/** The verdict on one expectation: the three of ISO-01, and note for a rule labelled none, which is not enforced. */
export type ProbeVerdict = 'enforced' | 'best-effort' | 'violated' | 'note'

/**
 * Whether the inventory shows what an expectation needs, as the launcher's case arm for its check decides: a name in
 * or out of its own list (a prefix for tool-prefix-absent), the permission mode, or the memory folder with or without a
 * trailing `/`. Null for not-visible, which has no arm, so the launcher reports it best-effort.
 */
function holds(inventory: InitInventory, expectation: ProbeExpectation): boolean | null {
  const { check, token } = expectation
  if (check === 'tool-absent') return !inventory.tools.includes(token)
  if (check === 'tool-prefix-absent') return !inventory.tools.some(tool => tool.startsWith(token))
  if (check === 'tool-present') return inventory.tools.includes(token)
  if (check === 'command-present') return inventory.slashCommands.includes(token)
  if (check === 'skill-present') return inventory.skills.includes(token)
  if (check === 'permission-mode') return inventory.permissionMode === token
  if (check === 'memory-path') return inventory.memoryAuto === token || inventory.memoryAuto === `${token}/`

  return null
}

/**
 * The verdict on one expectation, as the launcher's sh decides it: note for a note; violated when its check fails;
 * best-effort when the init event cannot show it, or when the check holds but the rule is not hard; enforced when the
 * check of a hard rule holds.
 */
function verdictOf(inventory: InitInventory, expectation: ProbeExpectation): ProbeVerdict {
  if (expectation.check === 'note') return 'note'
  const isHeld = holds(inventory, expectation)
  if (isHeld === false) return 'violated'
  if (isHeld === null || expectation.enforcement !== 'hard') return 'best-effort'

  return 'enforced'
}

/**
 * The verdicts of `<launcher> --probe` on the expectations, one per expectation and in their order (ISO-01): the
 * TypeScript statement of the launcher's sh rules (D-130), which the specs run on InitInventory values.
 */
export function probeVerdicts(
  inventory: InitInventory,
  expectations: readonly ProbeExpectation[],
): { readonly verdict: ProbeVerdict; readonly text: string }[] {
  return expectations.map(expectation => ({ verdict: verdictOf(inventory, expectation), text: expectation.text }))
}
