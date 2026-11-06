/**
 * The probe oracle (ISO-01, D-112, D-130), a layer 6 module and a test-only twin of the launcher's sh checks:
 * parseInitEvent reads the init event of a probe run's stream-json output, and probeVerdicts gives the verdict of each
 * probe expectation against it by the rules the sh launcher applies, so the specs hold the two to the same rules. No
 * runtime code reads it; it imports core/json and the types.
 */
import type { ProbeExpectation } from '../../types'
import { isObject, parseJsonValue } from '../core/json'

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
