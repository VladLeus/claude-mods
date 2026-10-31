/**
 * The built-in fallback's adapter, a layer 2 module in the folder of its framework id `none`: its detection, gates and
 * kickoff text, filled into the adapter contract. It imports only core and the types; the registry lists it.
 */
import type { Detection, Facts, FrameworkAdapter, Gate, KickoffContext } from '../../../types'
import { freezeRows } from '../../core/freeze'
import { cleanKickoffTextOr, kickoffTitle, MAX_SPEC_PATH_CHARS, UNNAMED_ROLE } from '../../core/kickoff-text'
import { isRoleId } from '../../core/role-id'
import { ARTIFACT } from '../../locales/artifact'
import { PROMPTS } from '../../locales/prompts'
import { fill, t } from '../../locales/t'

/**
 * The built-in fallback's detection. It ignores the repo: the built-in adapter is always available inside cadre and is
 * used when no framework is chosen (D-17). Its evidence is a fixed string, so the facts are taken only to fit the
 * adapter contract and are never read.
 */
export function detectBuiltin(_facts: Facts): Detection {
  const evidence = [t('framework.none.adapter.detectBuiltin')]

  return { id: 'none', name: 'built-in', status: 'installed', version: null, evidence }
}

/**
 * The built-in fallback's gates. It has no framework gates, so these rows are cadre's own: a plan file replaces
 * ExitPlanMode, which waits for a human, and an open question goes to its owner role by decision type (D-10 to D-13).
 */
export const BUILTIN_GATES: readonly Gate[] = freezeRows([
  {
    id: 'exit-plan-mode',
    where: ARTIFACT.builtinGateExitWhere,
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: ARTIFACT.builtinGateExit,
  },
  {
    id: 'role-questions',
    where: ARTIFACT.builtinGateQuestionWhere,
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'escalate',
    kickoff:
      ARTIFACT.builtinGateQuestion,
  },
])

/**
 * The role folder under `.cadre/`: the role id when it is a usable role id (isRoleId, D-48), else `unnamed`. The id is
 * checked here, not trusted, so a separator, a dot segment, an uppercase or blank id, a line break, an id over 24
 * characters or a reserved id such as `bin` can never put a path segment into a kickoff path (D-38). The folder is the
 * id itself, never the title.
 */
function roleFolder(roleId: string): string {
  if (!isRoleId(roleId)) return UNNAMED_ROLE

  return roleId
}

/** The Spec line when the role has a spec path that cleans to something; no line when it has none. */
function specLines(specPath: string | null): string[] {
  if (specPath === null) return []
  const cleaned = cleanKickoffTextOr(specPath, MAX_SPEC_PATH_CHARS, null)
  if (cleaned === null) return []

  return [fill(ARTIFACT.builtinSpec, { cleaned })]
}

/** The last line of every built-in kickoff: the DONE.md marker written before the AUTOPILOT_DONE answer (D-17). */
function doneLine(folder: string): string {
  return fill(ARTIFACT.builtinDoneLine, { folder })
}

/**
 * The kickoff text a built-in role starts from: who the role is, its spec when it has one, the plan it writes before it
 * executes, how it verifies, one line per gate in BUILTIN_GATES order, and the DONE answer last. Lines are joined with
 * newlines and the text has no trailing newline. The sentence names the role by its display title, as given, cleaned
 * and capped; every path uses the role id, which is the folder only when it is a slug (D-48). The title and spec path
 * come from outside the adapter, so they are cleaned before they can add a line.
 */
export function builtinKickoffText(ctx: KickoffContext): string {
  const title = kickoffTitle(ctx)
  const folder = roleFolder(ctx.roleId)

  return [
    fill(ARTIFACT.builtinKickoffIntro, { title }),
    ...specLines(ctx.specPath),
    fill(ARTIFACT.builtinKickoffPlan, { folder }),
    ARTIFACT.builtinKickoffVerify,
    ARTIFACT.builtinHumanGates,
    ...BUILTIN_GATES.map(gate => fill(ARTIFACT.builtinGateLine, { where: gate.where, kickoff: gate.kickoff })),
    doneLine(folder),
  ].join('\n')
}

/**
 * The built-in adapter: the contract every framework implements, filled for the built-in fallback. It has no framework
 * config, so its autonomy comes from the kickoff text alone. Its done signal is the DONE.md marker in the role's
 * runtime folder, which the kickoff asks for before the AUTOPILOT_DONE answer.
 */
export const BUILTIN_ADAPTER: FrameworkAdapter = Object.freeze({
  id: 'none',
  name: 'built-in',
  detectRule: t('framework.none.adapter.builtinAdapterDetectRule'),
  detect: detectBuiltin,
  startWork: Object.freeze([
    t('framework.none.adapter.builtinAdapter'),
    t('framework.none.adapter.builtinAdapter2'),
  ]),
  locations: Object.freeze({
    spec: Object.freeze(['.cadre/<role>/.runtime/spec.md']),
    plan: Object.freeze(['.cadre/<role>/.runtime/plan.md']),
  }),
  verify: Object.freeze([t('framework.none.adapter.builtinAdapter3'), t('framework.none.adapter.builtinAdapter4')]),
  doneSignal: Object.freeze({
    artifact: '.cadre/<role>/.runtime/DONE.md',
    check: t('framework.none.adapter.builtinAdapterCheck'),
  }),
  humanGates: BUILTIN_GATES,
  autonomy: Object.freeze([]),
  autonomyNote: t('framework.none.adapter.builtinAdapterAutonomyNote'),
  /** The built-in fallback has no config file to change, so it offers no autonomy hunks (A5). */
  autonomyHunks: () => null,
  kickoffText: builtinKickoffText,
  /** The built-in fallback starts from the kickoff text alone, so it has no start skill and owns no skill. */
  startSkills: Object.freeze([]),
  ownsSkill: () => false,
  pluginsToEnable: Object.freeze([]),
  agentPrefix: null,
  needsBash: false,
  /** The role's plan file, which the built-in kickoff asks the role to write first. */
  roleStart: (roleId: string) => fill(PROMPTS.builtinRoleStart, { roleId }),
  install: null,
  factsHeading: null,
})
