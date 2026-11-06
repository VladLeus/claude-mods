/**
 * The GSD adapter, a layer 2 module in GSD's framework folder: GSD's detection, hooks, gates, autonomy proposals and
 * hunks, and kickoff text, filled into the adapter contract. It imports only core and the types, so the registry and
 * every module above layer 2 can import it with no cycle.
 */
import type {
  AdapterFact,
  AutonomyHunks,
  Detection,
  Facts,
  FrameworkAdapter,
  Gate,
  GsdFact,
  KickoffContext,
  RepoEntry,
  SettingProposal,
  SetupScan,
  SkillRef,
} from '../../../types'
import { freezeRows } from '../../core/freeze'
import { cleanKickoffTextOr, kickoffTitle, MAX_SPEC_PATH_CHARS } from '../../core/kickoff-text'
import { ARTIFACT } from '../../locales/artifact'
import { fill, t } from '../../locales/t'

/**
 * The GSD hooks a role cares about, in the order the report lists them, each with the note that says what it does to
 * the role. A hook is listed only when settings register it (D-05).
 */
export const GSD_HOOK_NOTES: readonly AdapterFact[] = freezeRows([
  { name: 'gsd-context-monitor', note: t('framework.gsd.adapter.gsdHookNotes') },
  { name: 'gsd-secret-read-guard', note: t('framework.gsd.adapter.gsdHookNotes2') },
  {
    name: 'gsd-validate-commit',
    note: t('framework.gsd.adapter.gsdHookNotesNote'),
  },
  { name: 'gsd-workflow-guard', note: t('framework.gsd.adapter.gsdHookNotes3') },
])

/** The script extensions a GSD hook file may carry. A hook is matched by its name without one of them. */
// Keep in step with the hook script pattern in facts.ts.
const HOOK_EXTENSIONS: readonly string[] = ['.js', '.sh', '.cjs']

/**
 * GSD's detection from the normalised Facts. A `.planning/` directory or symlink at the repo root means GSD is in use,
 * and in use beats installed. An install counts only when its identity is `proven`; `unknown` and `absent` never make
 * GSD installed (T-01-22). The version comes from the first proven install that has one. The evidence is built from
 * fixed templates, and the version and dir are values that normalizeFacts has already validated.
 */
export function detectGsd(facts: Facts): Detection {
  const planning = facts.repoEntries.find(isPlanningEntry)
  const proven = facts.gsd.filter(fact => fact.identity === 'proven')
  const installEvidenceLines = proven.map(installEvidence)
  const version = proven.find(fact => fact.version !== null)?.version ?? null

  if (planning !== undefined) {
    return {
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version,
      evidence: [planningEvidence(planning), ...installEvidenceLines],
    }
  }
  if (proven.length > 0) {
    return { id: 'gsd', name: 'GSD', status: 'installed', version, evidence: installEvidenceLines }
  }

  return {
    id: 'gsd',
    name: 'GSD',
    status: 'not-found',
    version: null,
    evidence: [t('framework.gsd.adapter.detectGsd'), t('framework.gsd.adapter.detectGsd2')],
  }
}

/** The `.planning/` entry that marks GSD in use: a directory or a symlink, never a plain file. */
function isPlanningEntry(entry: RepoEntry): boolean {
  return entry.name === '.planning' && (entry.kind === 'dir' || entry.isLink)
}

/** The evidence for the `.planning/` entry. A symlink is named as one, whatever it points at. */
function planningEvidence(entry: RepoEntry): string {
  return entry.isLink ? t('framework.gsd.adapter.planningEvidence') : t('framework.gsd.adapter.planningEvidence2')
}

/** The evidence for one proven install: its version when one could be read, then its display dir. */
function installEvidence(fact: GsdFact): string {
  const label =
    fact.version === null
      ? t('framework.gsd.adapter.installEvidence')
      : t('framework.gsd.adapter.installEvidence2', { version: fact.version })

  return t('framework.gsd.adapter.installEvidence3', { label, dir: fact.dir })
}

/** A hook script's name without its extension, or null when the script has none of the known extensions. */
function hookNameOf(script: string): string | null {
  const extension = HOOK_EXTENSIONS.find(ext => script.endsWith(ext))
  if (extension === undefined) return null

  return script.slice(0, -extension.length)
}

/**
 * The GSD_HOOK_NOTES entries whose hook settings register, in GSD_HOOK_NOTES order and once each, however many events
 * or settings sources register the same hook (D-05).
 */
export function gsdHookFacts(facts: Facts): readonly AdapterFact[] {
  const registered = new Set(facts.hookScripts.map(hook => hookNameOf(hook.script)))

  return GSD_HOOK_NOTES.filter(hook => registered.has(hook.name)).map(hook => ({ ...hook }))
}

/**
 * The places a GSD role stops for a decision (D-14). `needsHuman` is true when no pre-supplied answer can replace the
 * person. Each kickoff says how the role answers the gate, or sends it on, so the kickoff text can state it up front.
 */
export const GSD_GATES: readonly Gate[] = freezeRows([
  {
    id: 'auq-menus',
    where: ARTIFACT.gsdGateMenusWhere,
    kind: 'auq',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'autopilot-denies',
    kickoff:
      ARTIFACT.gsdGateMenus,
  },
  {
    id: 'text-mode',
    where: ARTIFACT.gsdGateTextModeWhere,
    kind: 'plaintext',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'config-required',
    kickoff: ARTIFACT.gsdGateTextMode,
  },
  {
    id: 'verify-work-uat',
    where: '/gsd-verify-work',
    kind: 'uat',
    decisionType: 'QA',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      ARTIFACT.gsdGateUat,
  },
  {
    id: 'secure-phase-accept-risk',
    where: '/gsd-secure-phase',
    kind: 'auq',
    decisionType: 'Security',
    needsHuman: true,
    handling: 'preapprove',
    kickoff:
      ARTIFACT.gsdGateThreats,
  },
  {
    id: 'needs-human-blocker',
    where: ARTIFACT.gsdGateBlockerWhere,
    kind: 'plaintext',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'escalate',
    kickoff:
      ARTIFACT.gsdGateBlocker,
  },
  {
    id: 'ship-merge-pr',
    where: ARTIFACT.gsdGateShipWhere,
    kind: 'auq',
    decisionType: 'Arch',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      ARTIFACT.gsdGateShip,
  },
  {
    id: 'scope-acceptance',
    where: ARTIFACT.gsdGateScopeWhere,
    kind: 'chat',
    decisionType: 'Product',
    needsHuman: false,
    handling: 'escalate',
    kickoff: ARTIFACT.gsdGateScope,
  },
])

/** The repo-relative GSD config whose values are read statically (D-70); every GSD autonomy proposal changes it. */
export const GSD_CONFIG_FILE = '.planning/config.json'

/**
 * The GSD settings an autonomous role needs, as proposals only: Phase 2 shows each as a hunk and nothing runs it. Every
 * key lives in GSD_CONFIG_FILE, where its before value is read statically (D-70). Each write goes through GSD's
 * own writer, `gsd-tools config-set`, as a logical `{ tool, args }` that cadre resolves to a real argv from facts
 * (D-71); the args are fixed constants. `isRequired` is true when autonomy cannot work without the change (T-01-21).
 */
export const GSD_AUTONOMY: readonly SettingProposal[] = freezeRows([
  {
    kind: 'command',
    key: 'mode',
    file: GSD_CONFIG_FILE,
    write: Object.freeze({
      tool: 'gsd-tools',
      args: Object.freeze(['config-set', 'mode', 'yolo']),
    }),
    to: 'yolo',
    why: t('framework.gsd.adapter.gsdAutonomyWhy'),
    isRequired: true,
  },
  {
    kind: 'command',
    key: 'workflow.text_mode',
    file: GSD_CONFIG_FILE,
    write: Object.freeze({
      tool: 'gsd-tools',
      args: Object.freeze(['config-set', 'workflow.text_mode', 'false']),
    }),
    to: 'false',
    why: t('framework.gsd.adapter.gsdAutonomyWhy2'),
    isRequired: true,
  },
  {
    kind: 'command',
    key: 'hooks.context_warnings',
    file: GSD_CONFIG_FILE,
    write: Object.freeze({
      tool: 'gsd-tools',
      args: Object.freeze(['config-set', 'hooks.context_warnings', 'false']),
    }),
    to: 'false',
    why:
      t('framework.gsd.adapter.gsdAutonomy'),
    isRequired: false,
  },
])

/** The settings key whose GSD proposal is optional: it is offered only when gsd-statusline is the statusline (D-70). */
const CONTEXT_WARNINGS_KEY = 'hooks.context_warnings'

/**
 * The GSD autonomy hunks for one user setup (A5, D-70): GSD_CONFIG_FILE, and the GSD_AUTONOMY proposals to offer in
 * their order. Every required proposal is offered; the optional `hooks.context_warnings` only when gsd-statusline is
 * the statusline, since only then do the gsd-context-monitor warnings conflict with the autopilot handoff.
 */
export function gsdAutonomyHunks(setup: SetupScan): AutonomyHunks {
  const isOffered = (proposal: SettingProposal): boolean =>
    proposal.isRequired || (proposal.key === CONTEXT_WARNINGS_KEY && setup.carry.isGsdStatusline)

  return { file: GSD_CONFIG_FILE, proposals: GSD_AUTONOMY.filter(isOffered) }
}

/** The last line of every GSD kickoff: the done answer autopilot waits for once the phase verifies. */
const DONE_LINE = ARTIFACT.gsdDoneLine

/** The Approved spec line when the role has a spec; no line when it has none yet or the path cleans to empty. */
function approvedSpecLines(specPath: string | null): string[] {
  if (specPath === null) return []
  const cleaned = cleanKickoffTextOr(specPath, MAX_SPEC_PATH_CHARS, null)
  if (cleaned === null) return []

  return [fill(ARTIFACT.gsdApprovedSpec, { cleaned })]
}

/**
 * The kickoff text a GSD role starts from: who the role is, the GSD commands that start, check and verify its work, one
 * line per human gate, and the done answer. Lines are joined with newlines and the text has no trailing newline. The
 * title and the spec path come from outside the adapter, so they are cleaned before they can add a line.
 */
export function gsdKickoffText(ctx: KickoffContext): string {
  const title = kickoffTitle(ctx)

  return [
    fill(ARTIFACT.gsdKickoffIntro, { title }),
    ...approvedSpecLines(ctx.specPath),
    ARTIFACT.gsdKickoffStart,
    ARTIFACT.gsdKickoffSpecs,
    ARTIFACT.gsdKickoffVerify,
    ARTIFACT.gsdHumanGates,
    ...GSD_GATES.map(gate => fill(ARTIFACT.gsdGateLine, { where: gate.where, kickoff: gate.kickoff })),
    DONE_LINE,
  ].join('\n')
}

/**
 * The GSD adapter: the contract every framework implements, filled for GSD. Its start, locate, verify and done entries
 * are the ones the role kickoff names, so the two stay in step.
 */
export const GSD_ADAPTER: FrameworkAdapter = Object.freeze({
  id: 'gsd',
  name: 'GSD',
  detectRule:
    t('framework.gsd.adapter.gsdAdapter'),
  detect: detectGsd,
  startWork: Object.freeze([
    t('framework.gsd.adapter.gsdAdapter2'),
    t('framework.gsd.adapter.gsdAdapter3'),
    t('framework.gsd.adapter.gsdAdapter4'),
  ]),
  locations: Object.freeze({
    spec: Object.freeze([
      '.planning/REQUIREMENTS.md',
      '.planning/ROADMAP.md',
      '.planning/phases/<NN-slug>/*-CONTEXT.md',
    ]),
    plan: Object.freeze(['.planning/phases/<NN-slug>/*-PLAN.md']),
  }),
  verify: Object.freeze([
    t('framework.gsd.adapter.gsdAdapter5'),
    t('framework.gsd.adapter.gsdAdapter6'),
    t('framework.gsd.adapter.gsdAdapter7'),
  ]),
  doneSignal: Object.freeze({
    artifact: '.planning/phases/<NN-slug>/*-VERIFICATION.md',
    check: t('framework.gsd.adapter.gsdAdapterCheck'),
  }),
  humanGates: GSD_GATES,
  autonomy: GSD_AUTONOMY,
  autonomyNote: null,
  autonomyHunks: gsdAutonomyHunks,
  kickoffText: gsdKickoffText,
  roleFacts: gsdHookFacts,
  startSkills: Object.freeze([
    'gsd-autonomous',
    'gsd-discuss-phase',
    'gsd-plan-phase',
    'gsd-execute-phase',
    'gsd-validate-phase',
    'gsd-code-review',
  ]),
  /** A GSD skill is named `gsd-...`. */
  ownsSkill: (skill: SkillRef) => skill.name.startsWith('gsd-'),
  pluginsToEnable: Object.freeze([]),
  agentPrefix: 'gsd-',
  needsBash: true,
  roleStart: () => '/gsd-autonomous',
  install: 'npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global',
  factsHeading: t('framework.gsd.adapter.gsdAdapterFactsHeading'),
})

/** The basename of the GSD secret read guard: the one user hook every role carries when settings register it (D-62). */
export const SECRET_READ_GUARD = /^gsd-secret-read-guard\.(?:js|cjs|sh)$/
