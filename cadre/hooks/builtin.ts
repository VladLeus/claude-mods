import type { Detection, Facts, FrameworkAdapter, Gate, KickoffContext } from '../types'

/**
 * The built-in fallback's detection. It ignores the repo: the built-in adapter is always available inside cadre and is
 * used when no framework is chosen (D-17). Its evidence is a fixed string, so the facts are not read.
 */
export function detectBuiltin(facts: Facts): Detection {
  return { id: 'none', name: 'built-in', status: 'installed', version: null, evidence: ['built into cadre'] }
}

/**
 * The built-in fallback's gates. It has no framework gates, so these rows are cadre's own: a plan file replaces
 * ExitPlanMode, which waits for a human, and an open question goes to its owner role by decision type (D-10 to D-13).
 */
export const BUILTIN_GATES: readonly Gate[] = [
  {
    id: 'exit-plan-mode',
    where: 'ExitPlanMode',
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: 'Never call ExitPlanMode (it waits for a human); write the plan file instead.',
  },
  {
    id: 'role-questions',
    where: 'any open question',
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'escalate',
    kickoff:
      'Send each question to its owner role by type (Product to PM, Arch and QA to TL, Security to Security); ' +
      'do not ask the human directly.',
  },
]

/** The role name is short and shown once, on the first line. A longer name is cut, counted in code points. */
const MAX_ROLE_CHARS = 40

/**
 * The spec path cap, counted in code points. It is about the Windows MAX_PATH limit, beyond which a legacy Windows
 * path cannot be opened.
 */
const MAX_SPEC_PATH_CHARS = 260

/** The role word used when a role name has nothing left after cleaning and trimming. */
const UNNAMED_ROLE = 'unnamed'

/** Marks text that was cut to its cap. */
const ELLIPSIS = '\u{2026}'

/**
 * Characters that can split a kickoff line or hide text: control, format, surrogate, private-use, and line and
 * paragraph separators. They are removed from any text that comes from outside the adapter.
 */
const UNSAFE_KICKOFF_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu

/**
 * Text from outside the adapter, such as a role name or a repo path, as it may appear in a kickoff. Unsafe characters
 * are removed, so the text cannot start a new kickoff line or hide itself. The rest is cut to maxChars code points, and
 * a cut ends in an ellipsis.
 */
function cleanKickoffText(value: string, maxChars: number): string {
  const stripped = value.replace(UNSAFE_KICKOFF_TEXT, '')
  const points = Array.from(stripped)
  if (points.length <= maxChars) return stripped

  return `${points.slice(0, maxChars - 1).join('')}${ELLIPSIS}`
}

/**
 * The role folder under `.cadre/`: the role name lowercased, cleaned and capped, or `unnamed` when nothing is left once
 * cleaned and trimmed, so the folder is never an empty path segment. A slash in a role name is not checked here; role
 * ids are validated where the role template is built (D-15).
 */
function roleFolder(role: string): string {
  const cleaned = cleanKickoffText(role.toLowerCase(), MAX_ROLE_CHARS)

  return cleaned.trim() === '' ? UNNAMED_ROLE : cleaned
}

/** The Spec line when the role has a spec path that cleans to something; no line when it has none. */
function specLines(specPath: string | null): string[] {
  if (specPath === null) return []
  const cleaned = cleanKickoffText(specPath, MAX_SPEC_PATH_CHARS)
  if (cleaned.trim() === '') return []

  return [`Spec: ${cleaned}`]
}

/** The last line of every built-in kickoff: the DONE.md marker written before the AUTOPILOT_DONE answer (D-17). */
function doneLine(folder: string): string {
  return (
    `Write .cadre/${folder}/.runtime/DONE.md with what you did and how you verified it, ` +
    'then answer with a line that starts with AUTOPILOT_DONE.'
  )
}

/**
 * The kickoff text a built-in role starts from: who the role is, its spec when it has one, the plan it writes before it
 * executes, how it verifies, one line per gate in BUILTIN_GATES order, and the DONE answer last. Lines are joined with
 * newlines and the text has no trailing newline. The role and spec path come from outside the adapter, so they are
 * cleaned before they can add a line.
 */
export function builtinKickoffText(ctx: KickoffContext): string {
  const folder = roleFolder(ctx.role)

  return [
    `You are the ${folder} role. This repo has no dev framework: work in plan, execute, verify steps.`,
    ...specLines(ctx.specPath),
    `Write your plan to .cadre/${folder}/.runtime/plan.md, then execute it with subagents.`,
    "Verify with the project's own test and lint commands and a reviewer subagent.",
    'Human gates:',
    ...BUILTIN_GATES.map(gate => `- ${gate.where}: ${gate.kickoff}`),
    doneLine(folder),
  ].join('\n')
}

/**
 * The built-in adapter: the contract every framework implements, filled for the built-in fallback. It has no framework
 * config, so its autonomy comes from the kickoff text alone. Its done signal is the DONE.md marker in the role's
 * runtime folder, which the kickoff asks for before the AUTOPILOT_DONE answer.
 */
export const BUILTIN_ADAPTER: FrameworkAdapter = {
  id: 'none',
  name: 'built-in',
  detectRule: 'always available inside cadre; used when no framework is chosen',
  detect: detectBuiltin,
  startWork: [
    'write the plan to .cadre/<role>/.runtime/plan.md (never ExitPlanMode)',
    'execute the plan with subagents',
  ],
  locations: {
    spec: ['.cadre/<role>/.runtime/spec.md'],
    plan: ['.cadre/<role>/.runtime/plan.md'],
  },
  verify: ["the project's test and lint commands (from the Phase 2 repo scan)", 'a reviewer subagent'],
  doneSignal: {
    artifact: '.cadre/<role>/.runtime/DONE.md',
    check: 'the file exists and says what was done and how it was verified',
  },
  humanGates: BUILTIN_GATES,
  autonomy: [],
  autonomyNote: 'No framework config: autonomy comes from the kickoff text alone.',
  kickoffText: builtinKickoffText,
}
