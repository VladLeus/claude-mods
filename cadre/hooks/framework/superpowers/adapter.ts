/**
 * The superpowers adapter, a layer 2 module in the superpowers framework folder: its detection, gates and kickoff
 * text, filled into the adapter contract. It imports only core and the types; the registry lists it.
 */
import type {
  Detection,
  Facts,
  FrameworkAdapter,
  Gate,
  KickoffContext,
  PluginFlag,
  PluginVersion,
  RepoEntry,
  SkillRef,
} from '../../../types'
import { freezeRows } from '../../core/freeze'
import { cleanKickoffTextOr, kickoffTitle, MAX_SPEC_PATH_CHARS } from '../../core/kickoff-text'
import { ARTIFACT } from '../../locales/artifact'
import { fill, t } from '../../locales/t'

/**
 * Superpowers' detection from the normalised Facts. A `docs/superpowers/` directory or a `.superpowers` entry at the
 * repo root means superpowers is in use, and in use beats installed (D-01). An install is an `enabledPlugins` key that
 * starts with `superpowers@` and is set to true. The match is by prefix, never one exact key, so a malformed key still
 * counts. The version comes from the first enabled key, in order, that has an installed_plugins entry. The keys are
 * already cleaned and capped by facts.ts, and the evidence is built from fixed templates.
 */
export function detectSuperpowers(facts: Facts): Detection {
  const inUseLines = [
    ...(hasDirOrLink(facts.docsEntries, 'superpowers') ? ['docs/superpowers/'] : []),
    ...(hasDirOrLink(facts.repoEntries, '.superpowers') ? ['.superpowers/'] : []),
  ]
  const enabled = facts.enabledPlugins.filter(isEnabledSuperpowers)
  const installedLines = enabled.map(installedEvidence)
  const version = enabled.map(flag => versionOf(flag.key, facts.superpowersVersions)).find(v => v !== null) ?? null

  if (inUseLines.length > 0) {
    return {
      id: 'superpowers',
      name: 'superpowers',
      status: 'in-use',
      version,
      evidence: [...inUseLines, ...installedLines],
    }
  }
  if (enabled.length > 0) {
    return { id: 'superpowers', name: 'superpowers', status: 'installed', version, evidence: installedLines }
  }

  return {
    id: 'superpowers',
    name: 'superpowers',
    status: 'not-found',
    version: null,
    evidence: [
      t('framework.superpowers.adapter.detectSuperpowers'),
      t('framework.superpowers.adapter.detectSuperpowers2'),
    ],
  }
}

/** Whether the entries hold a directory or a symlink with exactly this name. A plain file never counts. */
function hasDirOrLink(entries: readonly RepoEntry[], name: string): boolean {
  return entries.some(entry => entry.name === name && (entry.kind === 'dir' || entry.isLink))
}

/** Whether a flag is an enabled superpowers@ key: the prefix matches and the value is true. */
function isEnabledSuperpowers(flag: PluginFlag): boolean {
  return flag.key.startsWith('superpowers@') && flag.value === true
}

/** The evidence for one enabled key: the key, its value and the settings file it came from. */
function installedEvidence(flag: PluginFlag): string {
  return t('framework.superpowers.adapter.installedEvidence', { key: flag.key, source: flag.source })
}

/** The installed version recorded for one key, or null when installed_plugins has no entry for that key. */
function versionOf(key: string, versions: readonly PluginVersion[]): string | null {
  const match = versions.find(entry => entry.key === key)

  return match === undefined ? null : match.version
}

/**
 * The places a superpowers role stops for a decision. Each kickoff says how the role answers the gate, or sends it on,
 * so the kickoff text can state it up front. Chat gates end a turn with no tool call, so each one is pre-answered or
 * owned (D-14, D-16). Merge, push, release and accepting a risk are always queued for the human (D-13, T-01-23).
 */
export const SUPERPOWERS_GATES: readonly Gate[] = freezeRows([
  {
    id: 'brainstorm-hard-gate',
    where: ARTIFACT.spGateBrainstormWhere,
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff:
      ARTIFACT.spGateBrainstorm,
  },
  {
    id: 'execution-method',
    where: ARTIFACT.spGatePlansWhere,
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff: ARTIFACT.spGatePlans,
  },
  {
    id: 'finish-branch-menu',
    where: ARTIFACT.spGateFinishWhere,
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff: ARTIFACT.spGateFinish,
  },
  {
    id: 'sdd-hard-stop-security',
    where: ARTIFACT.spGateSecurityWhere,
    kind: 'chat',
    decisionType: 'Security',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      ARTIFACT.spGateSecurity,
  },
  {
    id: 'sdd-hard-stop-irreversible',
    where: ARTIFACT.spGateOutwardWhere,
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      ARTIFACT.spGateOutward,
  },
  {
    id: 'worktree-consent',
    where: ARTIFACT.spGateWorktreeWhere,
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: ARTIFACT.spGateWorktree,
  },
  {
    id: 'main-branch-consent',
    where: ARTIFACT.spGateMainWhere,
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: ARTIFACT.spGateMain,
  },
  {
    id: 'clarifying-questions',
    where: ARTIFACT.spGateQuestionsWhere,
    kind: 'chat',
    decisionType: 'Product',
    needsHuman: false,
    handling: 'escalate',
    kickoff: ARTIFACT.spGateQuestions,
  },
])

/** The last line of every superpowers kickoff: the done answer autopilot waits for once every task is complete. */
const DONE_LINE = ARTIFACT.spDoneLine

/** The start line for a role with a standing spec: writing-plans with that spec. */
const SPEC_START_LINE = ARTIFACT.spSpecStart

/** The start line for a role with no spec yet: brainstorming, or writing-plans once TL gives a spec. */
const NO_SPEC_START_LINE = ARTIFACT.spNoSpecStart

/**
 * The Approved spec line, which is the standing approval for a spec TL wrote or approved (D-16). A role with no spec,
 * or a spec path that cleans to nothing, gets no line, so a blank path can never approve work.
 */
function approvedSpecLines(specPath: string | null): string[] {
  if (specPath === null) return []
  const cleaned = cleanKickoffTextOr(specPath, MAX_SPEC_PATH_CHARS, null)
  if (cleaned === null) return []

  return [fill(ARTIFACT.spApprovedSpec, { cleaned })]
}

/**
 * The kickoff text a superpowers role starts from: who the role is, the standing approval when it has a spec, the start
 * command, the execution method, the rule against chat questions, one line per gate in SUPERPOWERS_GATES order, and the
 * done answer last. Lines are joined with newlines and the text has no trailing newline. The title and spec path come
 * from outside the adapter, so they are cleaned before they can add a line.
 */
export function superpowersKickoffText(ctx: KickoffContext): string {
  const approved = approvedSpecLines(ctx.specPath)
  const start = approved.length > 0 ? SPEC_START_LINE : NO_SPEC_START_LINE

  return [
    fill(ARTIFACT.spKickoffIntro, { kickoffTitle: kickoffTitle(ctx) }),
    ...approved,
    start,
    ARTIFACT.spKickoffMethod,
    ARTIFACT.spKickoffNoQuestion,
    ARTIFACT.spHumanGates,
    ...SUPERPOWERS_GATES.map(gate => fill(ARTIFACT.spGateLine, { where: gate.where, kickoff: gate.kickoff })),
    DONE_LINE,
  ].join('\n')
}

/**
 * The superpowers adapter: the contract every framework implements, filled for superpowers. Its gate table and kickoff
 * are the ones the role kickoff names, so the two stay in step. It declares no autonomy settings, and its note says
 * why.
 */
export const SUPERPOWERS_ADAPTER: FrameworkAdapter = Object.freeze({
  id: 'superpowers',
  name: 'superpowers',
  detectRule:
    t('framework.superpowers.adapter.superpowersAdapter'),
  detect: detectSuperpowers,
  startWork: Object.freeze([
    t('framework.superpowers.adapter.superpowersAdapter2'),
    t('framework.superpowers.adapter.superpowersAdapter3'),
  ]),
  locations: Object.freeze({
    spec: Object.freeze(['docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md']),
    plan: Object.freeze(['docs/superpowers/plans/YYYY-MM-DD-<feature>.md']),
  }),
  verify: Object.freeze([
    'superpowers:requesting-code-review',
    'superpowers:verification-before-completion',
    t('framework.superpowers.adapter.superpowersAdapter4'),
  ]),
  doneSignal: Object.freeze({
    artifact: t('framework.superpowers.adapter.superpowersAdapterArtifact'),
    check: t('framework.superpowers.adapter.superpowersAdapterCheck'),
  }),
  humanGates: SUPERPOWERS_GATES,
  autonomy: Object.freeze([]),
  autonomyNote:
    t('framework.superpowers.adapter.superpowersAdapter5'),
  /** superpowers has no config file to change, so it offers no autonomy hunks (A5). */
  autonomyHunks: () => null,
  kickoffText: superpowersKickoffText,
  startSkills: Object.freeze([
    'superpowers:brainstorming',
    'superpowers:writing-plans',
    'superpowers:executing-plans',
    'superpowers:subagent-driven-development',
  ]),
  /** A superpowers skill is named `superpowers:...` or is added by the superpowers plugin. */
  ownsSkill: (skill: SkillRef) => skill.plugin === 'superpowers' || skill.name.startsWith('superpowers:'),
  /** Every scanned `superpowers@` key is enabled, so the start skills are there. */
  pluginsToEnable: Object.freeze(['superpowers']),
  agentPrefix: null,
  needsBash: false,
  roleStart: () => 'superpowers:brainstorming',
  install: 'claude plugin install superpowers@claude-plugins-official',
  factsHeading: null,
})
