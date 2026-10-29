/**
 * The isolation probe of a role (ISO-01, D-112, D-130). `<launcher> --probe` starts one print-mode turn with the scope
 * flags of the role and checks the init event of that run in sh against `.cadre/<id>/.runtime/probe-expectations.json`:
 * the sh launcher evaluates the expectations and never runs cadre TypeScript (D-102). This module, at layer 6, renders
 * them from the compiled scope, the value the scope card comes from (D-80); probe/oracle states the same rules in
 * probeVerdicts for the specs.
 */
import type { CompiledScope, ProbeCheck, ProbeCheckKind, ProbeExpectation, ScopeRule } from '../../types'
import { asciiLine } from '../generate/kickoff'

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
