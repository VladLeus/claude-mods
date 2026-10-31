/**
 * The question contexts of init, a layer 8 module (D-203, D-236): one builder per question family whose context needs
 * new composition, from the line builders of today's pane blocks, and the lines those blocks share with their stages:
 * the roles proposal, the env heading and the security plugin notes. Every value is cleaned and capped here (D-222).
 * It imports core, paths, the scans, the scope lint's plugin names, the built-file path of generate and the other
 * block modules, so the init stages read it here.
 */
import type {
  AskContext,
  Detection,
  InitLocations,
  InstructionGroup,
  InstructionPart,
  InstructionScan,
  InstructionTopic,
  MemoryItem,
  RoleChange,
  RoleSpec,
  SetupScan,
} from '../../../types'
import { SUPPORTED_IDS } from '../../core/framework-id'
import { redactedText } from '../../core/redact'
import { cardList, idsOrNone, MAX_CARD_LIST, moreLine, pad, reportText, shown } from '../../core/text'
import { builtClaudeMdPath } from '../../generate/launcher'
import { launcherPath } from '../../paths'
import { scanWarnings } from '../../scan/gather'
import type { Gathered } from '../../scan/gather'
import { isMemoryIndexName } from '../../scan/instructions/memories'
import type { InstructionSources } from '../../scan/instructions/read'
import { pluginName } from '../../scope/lint'
import { STATUS_LABEL } from './cards'
import { instructionLines, sourceText, topicParts } from './instructions'
import { scanSummaryLines, scanWarningLines } from './scan'

/** The column, in code points, where a role's purpose starts in the proposal, after its title and id. */
const ROLE_LABEL_WIDTH = 24

/**
 * The roles as the proposal lists them: a heading, then one line per role with its title, id and purpose, the title's
 * and the purpose's secret-like spans hidden (redactedText, E1, #163).
 */
export function roleLines(roles: readonly RoleSpec[]): string[] {
  const rows = roles.map(role => {
    const label = `${redactedText(role.title)} (${role.id})`

    return `  ${pad(label, ROLE_LABEL_WIDTH)}${redactedText(role.purpose)}`
  })

  return ['Proposed roles:', ...rows]
}

/** One scan change: dropped or kept, the role id and the reason, then its evidence paths when there are any. */
function changeLine(change: RoleChange): string {
  const evidence = change.evidence.length === 0 ? '' : ` (${change.evidence.join(', ')})`

  return `  ${change.change} ${change.roleId}: ${change.reason}${evidence}`
}

/**
 * The proposal as init shows it in the side pane before the roles question (ROLE-01, D-133): every role with its title,
 * id and purpose, then every change the scan made to the template with its reason and evidence, or `none` when it made
 * none.
 */
export function proposalLines(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string[] {
  const changeRows = changes.length === 0 ? ['  none'] : changes.map(changeLine)

  return [...roleLines(roles), 'Changes from the scan:', ...changeRows]
}

/** The first line of the side-pane block that lists every scanned env name before the env question (D-135). */
export const ENV_PANE_HEADING = 'Env variable names in your settings (values are never read):'

/** What each security plugin does, by the plugin name before its `@`, as the question tells it (decision #39). */
export const SECURITY_PLUGIN_NOTES: ReadonlyMap<string, string> = new Map([
  [
    'claude-security',
    'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and ' +
      'writes CLAUDE-SECURITY-<time>/ report folders into the repo.',
  ],
  ['security-guidance', 'security-guidance adds hooks that warn about risky edits.'],
])

/** Role ids as a context line lists them, each cleaned: `none` when there are none. */
function roleIdsText(ids: readonly string[]): string {
  return idsOrNone(ids.map(id => shown(id)))
}

/** Items as indented rows, each cleaned: the first MAX_CARD_LIST, then a row that counts the rest. */
function cappedRows(items: readonly string[]): string[] {
  const rows = items.slice(0, MAX_CARD_LIST).map(item => `  ${shown(item)}`)
  const rest = items.length - rows.length

  return rest > 0 ? [...rows, `  ${moreLine(rest)}`] : rows
}

/**
 * The context of the history question (D-236): the scan block as the side pane shows it after the scans, the summary
 * lines (scanSummaryLines), then each scan warning (scanWarningLines).
 */
export function scanContext(locations: InitLocations, gathered: Gathered): AskContext {
  const lines = [
    ...scanSummaryLines(gathered.repo, gathered.setup),
    ...scanWarningLines(scanWarnings(locations, gathered)),
  ]

  return { title: 'Scan', lines: lines.map(reportText), kind: 'scan' }
}

/**
 * The context of the roles, Adjust, describe, duration and model questions (D-236): the roles with their titles, ids
 * and purposes, then the changes the scan made to the template (proposalLines).
 */
export function rolesContext(roles: readonly RoleSpec[], changes: readonly RoleChange[]): AskContext {
  return { title: 'Roles', lines: proposalLines(roles, changes).map(reportText), kind: 'roles' }
}

/** One framework's detection as a context line: its name and status, its version when known, then its evidence. */
function detectionLine(detection: Detection): string {
  const version = detection.version === null ? '' : ` ${detection.version}`
  const evidence = detection.evidence.length === 0 ? '' : ` (${detection.evidence.join('; ')})`

  return reportText(`${detection.name}: ${STATUS_LABEL[detection.status]}${version}${evidence}`)
}

/**
 * The context of a framework question (D-236): the detection evidence of each framework cadre supports, found or not,
 * then of each framework it does not support that the scan found; one line each with its status, version and evidence.
 */
export function detectionContext(detections: readonly Detection[]): AskContext {
  const shownDetections = detections.filter(
    detection => detection.status !== 'not-found' || SUPPORTED_IDS.some(id => id === detection.id),
  )

  return { title: 'Frameworks', lines: shownDetections.map(detectionLine), kind: 'detection' }
}

/** The context of the security plugins question (D-236): each missing plugin by its key, with what it does. */
export function securityContext(keys: readonly string[]): AskContext {
  const lines = keys.map(key => {
    const note = SECURITY_PLUGIN_NOTES.get(pluginName(key))

    return reportText(note === undefined ? key : `${key}: ${note}`)
  })

  return { title: 'Security plugins', lines, kind: 'security' }
}

/** The display form of the global CLAUDE.md, as the instruction questions name it. */
const GLOBAL_CLAUDE_MD_TEXT = '~/.claude/CLAUDE.md'

/** The rows of a list of found names, or one `none` row with none (cappedRows). */
function foundRows(items: readonly string[]): string[] {
  return items.length === 0 ? ['  none'] : cappedRows(items)
}

/**
 * The context of the content consent (D-236): the instruction files and the memories init found, by name only, before
 * anything is read: the global CLAUDE.md, the CLAUDE.md files of the repo chain, the rule files of `.claude/rules` and
 * AGENTS.md, then the memory files, MEMORY.md in any letter case left out, as the hand-out never offers it.
 */
export function instructionsContext(
  setup: Pick<SetupScan, 'hasGlobalClaudeMd' | 'claudeMd' | 'memoryFiles'>,
  repo: Pick<InstructionSources, 'rules' | 'hasAgentsMd'>,
): AskContext {
  const files = [
    ...(setup.hasGlobalClaudeMd ? [GLOBAL_CLAUDE_MD_TEXT] : []),
    ...setup.claudeMd,
    ...(repo.rules ?? []).map(rule => `.claude/rules/${rule}`),
    ...(repo.hasAgentsMd ? ['AGENTS.md'] : []),
  ]
  const memories = setup.memoryFiles.filter(name => !isMemoryIndexName(name))
  const lines = [
    'Files found by name (nothing is read before a yes):',
    ...foundRows(files),
    'Memories:',
    ...foundRows(memories),
  ]

  return { title: 'Instruction files', lines, kind: 'instructions' }
}

/**
 * The context of the entry question of the instruction hand-out (D-236): the instructions block as the side pane
 * shows it (instructionLines), each line cleaned as a report cell.
 */
export function instructionPartsContext(
  scan: InstructionScan,
  topics: readonly InstructionTopic[],
  recommended: ReadonlyMap<string, readonly string[]>,
): AskContext {
  return {
    title: 'Instruction parts',
    lines: instructionLines(scan, topics, recommended).map(reportText),
    kind: 'instructions',
  }
}

/**
 * The context of one topic's question (D-236): that topic only, its title and summary, the summary's secret-like spans
 * hidden (redactedText, E1, #163), the file and heading of each of its parts (never their text) and the roles
 * recommended for it, titled by its place among the topics.
 */
export function topicContext(
  topic: InstructionTopic,
  parts: readonly InstructionPart[],
  recommended: readonly string[],
  position: number,
  count: number,
): AskContext {
  const lines = [
    reportText(`${topic.title}: ${redactedText(topic.summary)}`),
    ...topicParts(topic, parts).map(part => reportText(`  from: ${sourceText(part)}`)),
    `  recommended: ${roleIdsText(recommended)}`,
  ]

  return { title: `Topic ${position} of ${count}`, lines, kind: 'topic' }
}

/**
 * The context of one memory's question (D-236): that memory only, its file and summary, the summary's secret-like
 * spans hidden (redactedText, E1, #163), and the roles recommended for it, never its folder or text, titled by its
 * place among the memories.
 */
export function memoryContext(
  memory: MemoryItem,
  recommended: readonly string[],
  position: number,
  count: number,
): AskContext {
  const lines = [
    reportText(`${memory.file}: ${redactedText(memory.summary)}`),
    `  recommended: ${roleIdsText(recommended)}`,
  ]

  return { title: `Memory ${position} of ${count}`, lines, kind: 'memory' }
}

/** The title of each instruction group's whole-file question context (D-236). */
const MEMORY_GROUP_TITLES: Readonly<Record<InstructionGroup, string>> = Object.freeze({
  'global-claude-md': 'Global CLAUDE.md',
  'auto-memory': 'Auto-memories',
  'project-claude-md': 'Project CLAUDE.md',
})

/** The global CLAUDE.md as its whole-file question's context names it: with the files it imports. */
const GLOBAL_GROUP_LINE = `${GLOBAL_CLAUDE_MD_TEXT} and the files it imports`

/**
 * The context of a whole-file question (D-63, D-236): the files of that group only, by name, the first MAX_CARD_LIST
 * and then how many more; the global CLAUDE.md, which the scan names by no file list, with the files it imports.
 */
export function memoryGroupContext(group: InstructionGroup, names: readonly string[]): AskContext {
  const shownNames = names.slice(0, MAX_CARD_LIST).map(name => shown(name))
  const rest = names.length - shownNames.length
  const files = rest > 0 ? [...shownNames, moreLine(rest)] : shownNames
  const lines = group === 'global-claude-md' ? [GLOBAL_GROUP_LINE] : files

  return { title: MEMORY_GROUP_TITLES[group], lines, kind: 'memory-group' }
}

/** The context of the env question (D-236): the env block, its heading and then each scanned name, never a value. */
export function envContext(names: readonly string[]): AskContext {
  return { title: 'Env variables', lines: [ENV_PANE_HEADING, ...names.map(name => `  ${shown(name)}`)], kind: 'env' }
}

/** The context of the improver install question (D-236): each role given a built CLAUDE.md, with its path. */
export function improverInstallContext(roleIds: readonly string[]): AskContext {
  const rows = roleIds.map(id => `  ${shown(id)}: ${builtClaudeMdPath(shown(id))}`)

  const lines = ['Built CLAUDE.md files it would tidy:', ...rows]

  return { title: 'Improver install', lines, kind: 'improver-install' }
}

/**
 * The context of the launcher start question (D-236): what the git root and the run folder mean as a start, then the
 * launcher of each role (launcherPath), 12 of them and how many more.
 */
export function launchContext(roles: readonly RoleSpec[]): AskContext {
  const lines = [
    'Git root: the top of this repo, the same for every launcher.',
    'Run folder: wherever you run a launcher from.',
    `Launchers: ${cardList(roles.map(role => launcherPath(shown(role.id))))}`,
  ]

  return { title: 'Launch', lines, kind: 'launch' }
}

/**
 * The context of the launcher folder question (D-236): the top-level folders the repo scan found code in, as candidate
 * folders, 12 and then how many more; with none, a line that says so.
 */
export function launchDirContext(codeDirs: readonly string[]): AskContext {
  const lines =
    codeDirs.length === 0
      ? ['No folder with code was found in this repo.']
      : ['Folders with code in this repo:', ...cappedRows(codeDirs.map(dir => `${dir}/`))]

  return { title: 'Launch folder', lines, kind: 'launch-dir' }
}

/**
 * The context of the review question (D-236): the review block it is asked about, each line cleaned as a report cell.
 */
export function reviewContext(lines: readonly string[]): AskContext {
  return { title: 'Review', lines: lines.map(reportText), kind: 'review' }
}
