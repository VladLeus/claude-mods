import type { AdapterFact, Detection, Facts, Gate, GsdFact, RepoEntry, SettingProposal } from '../types'

/**
 * The GSD hooks a role cares about, in the order the report lists them, each with the note that says what it does to
 * the role. A hook is listed only when settings register it (D-05).
 */
export const GSD_HOOK_NOTES: readonly AdapterFact[] = [
  { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
  { name: 'gsd-secret-read-guard', note: 'useful for Security' },
  {
    name: 'gsd-validate-commit',
    note: 'rejects non-Conventional commit messages when enabled (this repo uses (type): Subject)',
  },
  { name: 'gsd-workflow-guard', note: 'advisory nag when enabled' },
]

/** The script extensions a GSD hook file may carry. A hook is matched by its name without one of them. */
const HOOK_EXTENSIONS: readonly string[] = ['.js', '.sh', '.cjs']

/**
 * GSD's detection from the normalised Facts. A `.planning/` directory or symlink at the repo root means GSD is in use,
 * and in use beats installed. An install counts only when its identity is `proven`; `unknown` and `absent` never make
 * GSD installed (T-01-22). The version comes from the first proven install. The evidence is built from fixed templates,
 * and the version and dir are values that normalizeFacts has already validated.
 */
export function detectGsd(facts: Facts): Detection {
  const planning = facts.repoEntries.find(isPlanningEntry)
  const proven = facts.gsd.filter(fact => fact.identity === 'proven')
  const installEvidenceLines = proven.map(installEvidence)
  const version = proven.length > 0 ? proven[0].version : null

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
    evidence: ['no .planning/', 'no gsd-core install proven'],
  }
}

/** The `.planning/` entry that marks GSD in use: a directory or a symlink, never a plain file. */
function isPlanningEntry(entry: RepoEntry): boolean {
  return entry.name === '.planning' && (entry.kind === 'dir' || entry.isLink)
}

/** The evidence for the `.planning/` entry. A symlink is named as one, whatever it points at. */
function planningEvidence(entry: RepoEntry): string {
  return entry.isLink ? '.planning/ (symlink)' : '.planning/ (dir)'
}

/** The evidence for one proven install: its version when one could be read, then its display dir. */
function installEvidence(fact: GsdFact): string {
  const label = fact.version === null ? 'gsd-core (version unknown)' : `gsd-core ${fact.version}`

  return `${label} at ${fact.dir}`
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
export function gsdHookFacts(facts: Facts): AdapterFact[] {
  const registered = new Set(facts.hookScripts.map(hook => hookNameOf(hook.script)))

  return GSD_HOOK_NOTES.filter(hook => registered.has(hook.name)).map(hook => ({ ...hook }))
}

/**
 * The places a GSD role stops for a decision (D-14). `needsHuman` is true when no pre-supplied answer can replace the
 * person. Each kickoff says how the role answers the gate, or sends it on, so the kickoff text can state it up front.
 */
export const GSD_GATES: readonly Gate[] = [
  {
    id: 'auq-menus',
    where: 'AskUserQuestion menus inside GSD workflows',
    kind: 'auq',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'autopilot-denies',
    kickoff:
      'Autopilot answers GSD menus with "decide yourself": ' +
      'take the recommended option and log it in decisions.md.',
  },
  {
    id: 'text-mode',
    where: '.planning/config.json workflow.text_mode',
    kind: 'plaintext',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'config-required',
    kickoff: 'Needs workflow.text_mode false (an autonomy setting); with it true the role is attended.',
  },
  {
    id: 'verify-work-uat',
    where: '/gsd-verify-work',
    kind: 'uat',
    decisionType: 'QA',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      'Do not run /gsd-verify-work. Send human UAT as a QA decision to TL, ' +
      'which queues it for the human.',
  },
  {
    id: 'secure-phase-accept-risk',
    where: '/gsd-secure-phase',
    kind: 'auq',
    decisionType: 'Security',
    needsHuman: true,
    handling: 'preapprove',
    kickoff:
      'Answer "Verify all open threats"; never accept a risk: ' +
      'accepting risk is always queued for the human.',
  },
  {
    id: 'needs-human-blocker',
    where: 'STATE.md "Needs Human" blocker',
    kind: 'plaintext',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'escalate',
    kickoff:
      'Route the blocker by its content, by default as an Arch decision to TL; ' +
      'TL decides reversible calls and queues the rest for the human.',
  },
  {
    id: 'ship-merge-pr',
    where: '/gsd-ship, branch finish, merge or PR',
    kind: 'auq',
    decisionType: 'Arch',
    needsHuman: true,
    handling: 'escalate',
    kickoff:
      'Never merge, push or release. Hand the finished branch to TL as an Arch decision; ' +
      'merge, push and release are always queued for the human.',
  },
  {
    id: 'scope-acceptance',
    where: 'scope or acceptance questions in discuss and plan',
    kind: 'chat',
    decisionType: 'Product',
    needsHuman: false,
    handling: 'escalate',
    kickoff: 'Send scope or acceptance questions as a Product decision to PM.',
  },
]

/**
 * The GSD settings an autonomous role needs, as proposals only: Phase 1 describes them and nothing runs them. Each
 * write goes through GSD's own writer, `gsd-tools config-set`, and `isRequired` is true when autonomy cannot work
 * without the change (T-01-21).
 */
export const GSD_AUTONOMY: readonly SettingProposal[] = [
  {
    kind: 'command',
    key: 'mode',
    read: ['gsd-tools', 'config-get', 'mode'],
    write: ['gsd-tools', 'config-set', 'mode', 'yolo'],
    to: 'yolo',
    why: 'interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended',
    isRequired: true,
  },
  {
    kind: 'command',
    key: 'workflow.text_mode',
    read: ['gsd-tools', 'config-get', 'workflow.text_mode'],
    write: ['gsd-tools', 'config-set', 'workflow.text_mode', 'false'],
    to: 'false',
    why: 'text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall',
    isRequired: true,
  },
  {
    kind: 'command',
    key: 'hooks.context_warnings',
    read: ['gsd-tools', 'config-get', 'hooks.context_warnings'],
    write: ['gsd-tools', 'config-set', 'hooks.context_warnings', 'false'],
    to: 'false',
    why:
      'only when gsd-statusline is the statusline: ' +
      'gsd-context-monitor warnings conflict with the autopilot handoff',
    isRequired: false,
  },
]
