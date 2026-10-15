import type {
  Detection,
  Facts,
  FrameworkAdapter,
  Gate,
  KickoffContext,
  PluginFlag,
  PluginVersion,
  RepoEntry,
} from '../types'
import { cleanKickoffTextOr, MAX_ROLE_CHARS, MAX_SPEC_PATH_CHARS, UNNAMED_ROLE } from './kickoff'

/**
 * Superpowers' detection from the normalised Facts. A `docs/superpowers/` directory or a `.superpowers` entry at the
 * repo root means superpowers is in use, and in use beats installed (D-01). An install is an `enabledPlugins` key that
 * starts with `superpowers@` and is set to true. The match is by prefix, never one exact key, so a malformed key still
 * counts. The version comes from the installed_plugins entry for the first enabled key. The keys are already cleaned
 * and capped by facts.ts, and the evidence is built from fixed templates.
 */
export function detectSuperpowers(facts: Facts): Detection {
  const inUseLines = [
    ...(hasDirOrLink(facts.docsEntries, 'superpowers') ? ['docs/superpowers/'] : []),
    ...(hasDirOrLink(facts.repoEntries, '.superpowers') ? ['.superpowers/'] : []),
  ]
  const enabled = facts.enabledPlugins.filter(isEnabledSuperpowers)
  const installedLines = enabled.map(installedEvidence)
  const version = enabled.length > 0 ? versionOf(enabled[0].key, facts.superpowersVersions) : null

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
    evidence: ['no docs/superpowers/ or .superpowers/', 'no enabled superpowers@ plugin'],
  }
}

/** Whether the entries hold a directory or a symlink with exactly this name. A plain file never counts. */
function hasDirOrLink(entries: RepoEntry[], name: string): boolean {
  return entries.some(entry => entry.name === name && (entry.kind === 'dir' || entry.isLink))
}

/** Whether a flag is an enabled superpowers@ key: the prefix matches and the value is true. */
function isEnabledSuperpowers(flag: PluginFlag): boolean {
  return flag.key.startsWith('superpowers@') && flag.value === true
}

/** The evidence for one enabled key: the key, its value and the settings file it came from. */
function installedEvidence(flag: PluginFlag): string {
  return `enabledPlugins["${flag.key}"]=true (${flag.source})`
}

/** The installed version recorded for one key, or null when installed_plugins has no entry for that key. */
function versionOf(key: string, versions: PluginVersion[]): string | null {
  const match = versions.find(entry => entry.key === key)

  return match === undefined ? null : match.version
}

/**
 * The places a superpowers role stops for a decision. Each kickoff says how the role answers the gate, or sends it on,
 * so the kickoff text can state it up front. Chat gates end a turn with no tool call, so each one is pre-answered or
 * owned (D-14, D-16). Merge, push, release and accepting a risk are always queued for the human (D-13, T-01-23).
 */
export const SUPERPOWERS_GATES: readonly Gate[] = [
  {
    id: 'brainstorm-hard-gate',
    where: 'superpowers:brainstorming hard gate',
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff:
      'With a TL-approved spec, start at superpowers:writing-plans; the spec is the standing approval. ' +
      'A new design question goes to TL as an Arch decision.',
  },
  {
    id: 'execution-method',
    where: 'superpowers:writing-plans execution choice',
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff: 'The execution method is already chosen: subagent-driven.',
  },
  {
    id: 'finish-branch-menu',
    where: 'superpowers:finishing-a-development-branch menu',
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff: 'Choose "keep as-is". TL owns merge and PR; merge and push are always queued for the human.',
  },
  {
    id: 'sdd-hard-stop-security',
    where: 'superpowers:subagent-driven-development security-sensitive stop',
    kind: 'chat',
    decisionType: 'Security',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      'Stop the step and send it to Security as a Security decision; ' +
      'accepting a risk is always queued for the human.',
  },
  {
    id: 'sdd-hard-stop-irreversible',
    where: 'superpowers:subagent-driven-development irreversible or outward stop',
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      'Stop the step and send it to TL as an Arch decision; ' +
      'irreversible or outward actions are always queued for the human.',
  },
  {
    id: 'worktree-consent',
    where: 'superpowers:using-git-worktrees consent',
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: 'You are already in your epic worktree: do not create another worktree.',
  },
  {
    id: 'main-branch-consent',
    where: 'superpowers:subagent-driven-development main-branch consent',
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: 'Work on the current epic branch; never implement on main or master.',
  },
  {
    id: 'clarifying-questions',
    where: 'superpowers:brainstorming clarifying questions',
    kind: 'chat',
    decisionType: 'Product',
    needsHuman: false,
    handling: 'escalate',
    kickoff: 'Send scope or acceptance questions as a Product decision to PM.',
  },
]

/** The last line of every superpowers kickoff: the done answer autopilot waits for once every task is complete. */
const DONE_LINE =
  'When every task in .superpowers/sdd/<plan workspace>/progress.md has a "Task <N>: complete" line, ' +
  'answer with a line that starts with AUTOPILOT_DONE.'

/** The start line for a role with a standing spec: writing-plans with that spec. */
const SPEC_START_LINE = 'Start: superpowers:writing-plans with that spec.'

/** The start line for a role with no spec yet: brainstorming, or writing-plans once TL gives a spec. */
const NO_SPEC_START_LINE =
  'Start: superpowers:brainstorming (TL/PM), or superpowers:writing-plans <spec path> once TL gives you a spec.'

/** The role as the kickoff names it: cleaned and capped, or `unnamed` when nothing is left once cleaned and trimmed. */
function roleName(role: string): string {
  return cleanKickoffTextOr(role, MAX_ROLE_CHARS, UNNAMED_ROLE)
}

/**
 * The Approved spec line, which is the standing approval for a spec TL wrote or approved (D-16). A role with no spec,
 * or a spec path that cleans to nothing, gets no line, so a blank path can never approve work.
 */
function approvedSpecLines(specPath: string | null): string[] {
  if (specPath === null) return []
  const cleaned = cleanKickoffTextOr(specPath, MAX_SPEC_PATH_CHARS, null)
  if (cleaned === null) return []

  return [`Approved spec (standing approval from TL): ${cleaned}`]
}

/**
 * The kickoff text a superpowers role starts from: who the role is, the standing approval when it has a spec, the start
 * command, the execution method, the rule against chat questions, one line per gate in SUPERPOWERS_GATES order, and the
 * done answer last. Lines are joined with newlines and the text has no trailing newline. The role and spec path come
 * from outside the adapter, so they are cleaned before they can add a line.
 */
export function superpowersKickoffText(ctx: KickoffContext): string {
  const approved = approvedSpecLines(ctx.specPath)
  const start = approved.length > 0 ? SPEC_START_LINE : NO_SPEC_START_LINE

  return [
    `You are the ${roleName(ctx.role)} role. This repo uses superpowers: follow its skills.`,
    ...approved,
    start,
    'Execution method: subagent-driven.',
    'Never end a turn with a question in chat: autopilot pauses after 2 turns with no tool call. ' +
      'Send questions to their owner role instead.',
    'Human gates:',
    ...SUPERPOWERS_GATES.map(gate => `- ${gate.where}: ${gate.kickoff}`),
    DONE_LINE,
  ].join('\n')
}

/**
 * The superpowers adapter: the contract every framework implements, filled for superpowers. Its gate table and kickoff
 * are the ones the role kickoff names, so the two stay in step. It declares no autonomy settings, and its note says
 * why.
 */
export const SUPERPOWERS_ADAPTER: FrameworkAdapter = {
  id: 'superpowers',
  name: 'superpowers',
  detectRule:
    'in use: docs/superpowers/ or .superpowers/ at the repo root; ' +
    'installed: an enabledPlugins key starting superpowers@ set to true',
  detect: detectSuperpowers,
  startWork: ['superpowers:writing-plans <spec path> (BE/FE with a TL spec)', 'superpowers:brainstorming (TL/PM)'],
  locations: {
    spec: ['docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md'],
    plan: ['docs/superpowers/plans/YYYY-MM-DD-<feature>.md'],
  },
  verify: [
    'superpowers:requesting-code-review',
    'superpowers:verification-before-completion',
    "the project's test command",
  ],
  doneSignal: {
    artifact: '.superpowers/sdd/<plan workspace>/progress.md',
    check: 'every task has a "Task <N>: complete" line',
  },
  humanGates: SUPERPOWERS_GATES,
  autonomy: [],
  autonomyNote:
    'No config file: autonomy comes only from the kickoff text. ' +
    'Chat gates end a turn with no tool call, and autopilot pauses after 2 such turns, ' +
    'so the kickoff pre-answers every gate.',
  kickoffText: superpowersKickoffText,
}
