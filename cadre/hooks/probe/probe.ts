/**
 * The isolation probe of a role (ISO-01, D-112, D-130). `<launcher> --probe` starts one print-mode turn with the scope
 * flags of the role and checks the init event of that run in sh against `.cadre/<id>/.runtime/probe-expectations.json`:
 * the sh launcher evaluates the expectations and never runs cadre TypeScript (D-102). This module, at layer 6, renders
 * them from the compiled scope, the value the scope card comes from (D-80); probe/oracle states the same rules in
 * probeVerdicts for the specs.
 */
import type { CompiledScope, ProbeCheck, ProbeCheckKind, ProbeExpectation, ScopeRule } from '../../types'
import { asciiLine } from '../generate/kickoff'
import { CONTRACTS } from '../locales/contracts'
import { fill } from '../locales/t'
import { INFRA_SKILLS } from '../roles/infra'
import { callDeniedLines, SKILLS_RULE_ENFORCEMENT } from '../scope/card'

/** Every kind of probe check, in the order of the ProbeCheckKind type (D-112). */
export const PROBE_CHECK_KINDS: readonly ProbeCheckKind[] = Object.freeze([
  'tool-absent',
  'tool-prefix-absent',
  'tool-present',
  'command-present',
  'skill-present',
  'skill-absent',
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
const UNUSUAL_SUFFIX = CONTRACTS.probeUnusual

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
  if (kind === 'tool-absent') return fill(CONTRACTS.probeToolAbsent, { token })
  if (kind === 'tool-prefix-absent') return fill(CONTRACTS.probeToolsAbsent, { token })
  if (kind === 'tool-present') return fill(CONTRACTS.probeToolPresent, { token })
  if (kind === 'command-present') return fill(CONTRACTS.probeCommandPresent, { token })
  if (kind === 'skill-present') return fill(CONTRACTS.probeSkillPresent, { token })
  if (kind === 'skill-absent') return fill(CONTRACTS.probeSkillAbsent, { token })

  return fill(CONTRACTS.probePermissionMode, { token })
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
      text: probeText(fill(CONTRACTS.probeChecked, { text, label: checkLabel(check) })),
      token: check.token,
    }),
  )
}

/** The skill names of the `Skill(<name>)` entries of a deny list, in order. */
export function deniedSkillNames(entries: readonly string[]): string[] {
  return entries.flatMap(entry => {
    const match = /^Skill\((.+)\)$/.exec(entry)

    return match?.[1] === undefined ? [] : [match[1]]
  })
}

/** One expectation of a single skill with the Skills rule's enforcement, written as a card rule's check is. */
function skillExpectation(kind: 'skill-present' | 'skill-absent', text: string, token: string): ProbeExpectation {
  const checked = fill(CONTRACTS.probeChecked, { text, label: checkLabel({ kind, token }) })

  return written({ check: kind, enforcement: SKILLS_RULE_ENFORCEMENT, text: probeText(checked), token })
}

/**
 * The per-skill expectations: skill-present for each given skill but the handoff skills the infra rule checks,
 * skill-absent for each not-given skill of a plugin the role does not enable, then one best-effort summary per plugin
 * of the skills denied at call time, which the init listing still shows.
 */
function skillExpectations(scope: CompiledScope, deniedSkills: readonly string[]): ProbeExpectation[] {
  const granted = scope.card.skills.filter(name => !INFRA_SKILLS.includes(name))
  const callDenied = callDeniedLines(deniedSkills).map(
    (text): ProbeExpectation => ({
      check: 'not-visible',
      enforcement: SKILLS_RULE_ENFORCEMENT,
      text: probeText(text),
      token: '',
    }),
  )

  return [
    ...granted.map(name => skillExpectation('skill-present', CONTRACTS.probeSkillGranted, name)),
    ...scope.card.notGiven.pluginSkills.map(name => skillExpectation('skill-absent', CONTRACTS.probeSkillDenied, name)),
    ...callDenied,
  ]
}

/** What the launch did with the role's skills: denied per skill at call time, plugins switched off, not linked. */
export type LaunchSkills = {
  readonly deniedSkills: readonly string[]
  readonly offPlugins: readonly string[]
  readonly unlinkedSkills: readonly string[]
}

export const NO_LAUNCH_SKILLS: LaunchSkills = Object.freeze({ deniedSkills: [], offPlugins: [], unlinkedSkills: [] })

/**
 * The expectations of a role's probe: one per check of each card rule in order (a rule with no check gives one
 * not-visible line, or a note when it is labelled none), the per-skill lines, then the role's memory folder. A token
 * that fails isProbeToken is never compared: its line is not-visible, with the token '' and marked not checked.
 */
export function expectationsFor(
  scope: CompiledScope,
  memoryDir: string,
  launch: LaunchSkills = NO_LAUNCH_SKILLS,
): ProbeExpectation[] {
  const memory = written({
    check: 'memory-path',
    enforcement: 'hard',
    text: probeText(fill(CONTRACTS.probeMemoryFolder, { dir: memoryDir })),
    token: memoryDir,
  })

  return [...scope.card.rules.flatMap(ruleExpectations), ...skillExpectations(scope, launch.deniedSkills), memory]
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
