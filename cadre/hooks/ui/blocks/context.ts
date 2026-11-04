/**
 * The question contexts of init, a layer 8 module (D-203, D-236): one builder per question family whose context needs
 * new composition, from the line builders of today's pane blocks, and the lines those blocks share with their stages:
 * the roles proposal, the env heading and the security plugin notes. Each builder but the Review's gives its lines and
 * the structured rows the pane draws from the same values (D-313, D-323). Every value is cleaned and capped here
 * (D-222). It imports core, paths, the scans, the scope lint's plugin names, the built-file path of generate, the UNCUT
 * rule of ui/pane and the other block modules, so the init stages read it here.
 */
import type {
  AskContext,
  ContextRow,
  ContextSection,
  Detection,
  Facts,
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
import { cardList, clean, idsOrNone, pad, shown } from '../../core/text'
import type { ListWords } from '../../core/text'
import { builtClaudeMdPath } from '../../generate/launcher'
import { keyLabel, SCREEN_LIST_WORDS, t, tn } from '../../locales/t'
import { launcherPath, screenPath } from '../../paths'
import { scanWarnings } from '../../scan/gather'
import type { Gathered } from '../../scan/gather'
import { isMemoryIndexName } from '../../scan/instructions/memories'
import type { InstructionSources } from '../../scan/instructions/read'
import { pluginName } from '../../scope/lint'
import { UNCUT } from '../pane'
import { STATUS_LABEL } from './cards'
import { instructionLines, instructionRows, sourceText, topicParts } from './instructions'
import { scanSummaryLines, scanSummaryRows, scanWarningLines } from './scan'

/** The column, in code points, where a role's purpose starts in the proposal, after its title and id. */
const ROLE_LABEL_WIDTH = 24

/**
 * The roles as the proposal lists them: a heading, then one line per role with its title, id and purpose, the title's
 * and the purpose's secret-like spans hidden (redactedText, E1, #163).
 */
export function roleLines(roles: readonly RoleSpec[]): string[] {
  return [t('ui.context.roleLines2'), ...roles.map(role => `  ${roleText(role)}`)]
}

/** One role as the proposal lists it, after its indent: its title and id padded, then its purpose (roleLines). */
function roleText(role: RoleSpec): string {
  const label = t('ui.context.roleLines', { title: redactedText(role.title), id: role.id })

  return `${pad(label, ROLE_LABEL_WIDTH)}${redactedText(role.purpose)}`
}

/** One scan change: dropped or kept, the role id and the reason, then its evidence paths when there are any. */
function changeLine(change: RoleChange): string {
  const evidence = change.evidence.length === 0 ? '' : t('ui.context.changeLine', {
    evidence: change.evidence.join(', '),
  })

  return t('ui.context.changeLine2', { change: change.change, roleId: change.roleId, reason: change.reason, evidence })
}

/**
 * The proposal as init shows it in the side pane before the roles question (ROLE-01, D-133): every role with its title,
 * id and purpose, then every change the scan made to the template with its reason and evidence, or `none` when it made
 * none.
 */
export function proposalLines(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string[] {
  const changeRows = changes.length === 0 ? [t('ui.context.proposalLines')] : changes.map(changeLine)

  return [...roleLines(roles), t('ui.context.proposalLines2'), ...changeRows]
}

/**
 * The proposal's structured rows (D-313, D-323), one per line of proposalLines: its two headings as heading rows,
 * each role as a plain row at indent 2, each change, or the none line, as one plain row holding its whole line.
 */
function proposalRows(roles: readonly RoleSpec[], changes: readonly RoleChange[]): ContextRow[] {
  const changeLines = changes.length === 0 ? [t('ui.context.proposalLines')] : changes.map(changeLine)

  return [
    headingRow(t('ui.context.roleLines2')),
    ...roles.map((role): ContextRow => ({ role: 'plain', text: roleText(role), indent: 2 })),
    headingRow(t('ui.context.proposalLines2')),
    ...changeLines.map(line => plainRow(line)),
  ]
}

/** The first line of the side-pane block that lists every scanned env name before the env question (D-135). */
export const ENV_PANE_HEADING = t('ui.context.envPaneHeading')

/** What each security plugin does, by the plugin name before its `@`, as the question tells it (decision #39). */
export const SECURITY_PLUGIN_NOTES: ReadonlyMap<string, string> = new Map([
  [
    'claude-security',
    t('ui.context.securityPluginNotes'),
  ],
  ['security-guidance', t('ui.context.securityPluginNotes2')],
])

/** Role ids as a context line lists them, each cleaned: `none` when there are none. */
function roleIdsText(ids: readonly string[]): string {
  return idsOrNone(ids.map(id => shown(id)), SCREEN_LIST_WORDS.none)
}

/** A heading row (D-313): a line that heads the rows after it, at indent 0. */
function headingRow(text: string): ContextRow {
  return { role: 'heading', text, indent: 0 }
}

/** A plain row (D-313): `text` as it is, at `indent`; a line with its own indent in its text is at indent 0. */
function plainRow(text: string, indent = 0): ContextRow {
  return { role: 'plain', text, indent }
}

/** A field row (D-313): `label` and `: `, then `text`, at `indent`. */
function fieldRow(label: string, text: string, indent = 0): ContextRow {
  return { role: 'field', label, text, indent }
}

/** The rows of a context with one untitled section (D-313). */
function oneSection(rows: readonly ContextRow[]): readonly ContextSection[] {
  return [{ title: null, rows }]
}

/**
 * Items as indented rows, each cleaned: the first `words.max`, then a row that counts the rest (D-256: every item on a
 * pane surface, 12 on the TUI default).
 */
function cappedRows(items: readonly string[], words: ListWords): string[] {
  const rows = items.slice(0, words.max).map(item => `  ${shown(item)}`)
  const rest = items.length - rows.length

  return rest > 0 ? [...rows, `  ${words.more(rest)}`] : rows
}

/** The structured rows of cappedRows (D-313): each shown item, then the row that counts the rest, plain at indent 2. */
function cappedItemRows(items: readonly string[], words: ListWords): ContextRow[] {
  const rows = items.slice(0, words.max).map(item => plainRow(shown(item), 2))
  const rest = items.length - rows.length

  return rest > 0 ? [...rows, plainRow(words.more(rest), 2)] : rows
}

/**
 * The context of the history question (D-236): the scan block as the side pane shows it after the scans, the summary
 * lines with the names `words` allows (scanSummaryLines, D-256), then each scan warning (scanWarningLines); its
 * summary counts the plugins, MCP servers and CLAUDE.md files those lines list (D-310).
 */
export function scanContext(locations: InitLocations, gathered: Gathered, words: ListWords): AskContext {
  const { setup } = gathered
  const warnings = scanWarnings(locations, gathered)
  const lines = [...scanSummaryLines(gathered.repo, setup, locations.root, words), ...scanWarningLines(warnings)]
  const rows = [
    ...scanSummaryRows(gathered.repo, setup, locations.root, words),
    ...warnings.map(warning => fieldRow(keyLabel('ui.scan.warning'), warning)),
  ]
  const summary = t('ui.summary.scan', {
    plugins: tn('ui.summary.plugins', setup.plugins.length, { count: setup.plugins.length }),
    servers: tn('ui.summary.servers', setup.mcp.length, { count: setup.mcp.length }),
    files: tn('ui.summary.claudeMdFiles', setup.claudeMd.length, { count: setup.claudeMd.length }),
  })

  return {
    title: t('ui.context.scanContext'),
    lines: lines.map(line => clean(line, UNCUT)),
    kind: 'scan',
    summary,
    rows: oneSection(rows),
  }
}

/**
 * The context of the roles, Adjust, describe, duration and model questions (D-236): the roles with their titles, ids
 * and purposes, then the changes the scan made to the template (proposalLines); its summary counts the roles and
 * names their ids (D-310).
 */
export function rolesContext(roles: readonly RoleSpec[], changes: readonly RoleChange[]): AskContext {
  const lines = proposalLines(roles, changes).map(line => clean(line, UNCUT))
  const ids = roleIdsText(roles.map(role => role.id))

  return {
    title: t('ui.context.rolesContext'),
    lines,
    kind: 'roles',
    summary: tn('ui.summary.roles', roles.length, { count: roles.length, ids }),
    rows: oneSection(proposalRows(roles, changes)),
  }
}

/** One framework's detection as a context line: its name and status, its version when known, then its evidence. */
function detectionLine(detection: Detection): string {
  return clean(t('ui.context.detectionLine2', { name: detection.name, ...detectionSlots(detection) }), UNCUT)
}

/** The slots of a detection line after its name: its status, its version when known, then its evidence. */
function detectionSlots(detection: Detection): {
  readonly statusLabel: string
  readonly version: string
  readonly evidence: string
} {
  const version = detection.version === null ? '' : ` ${detection.version}`
  const evidence = detection.evidence.length === 0 ? '' : t('ui.context.detectionLine', {
    evidence: detection.evidence.join('; '),
  })

  return { statusLabel: STATUS_LABEL[detection.status], version, evidence }
}

/**
 * One framework's detection as a field row (D-313): its name as the label, its status, version and evidence as the
 * value, the slots of its line in their order.
 */
function detectionRow(detection: Detection): ContextRow {
  const { statusLabel, version, evidence } = detectionSlots(detection)

  return fieldRow(detection.name, `${statusLabel}${version}${evidence}`)
}

/**
 * The context of a framework question (D-236): the detection evidence of each framework cadre supports, found or not,
 * then of each framework it does not support that the scan found; one line each with its status, version and evidence.
 * Its summary counts the frameworks the scan found and names their ids, or says none was found (D-310).
 */
export function detectionContext(detections: readonly Detection[]): AskContext {
  const shownDetections = detections.filter(
    detection => detection.status !== 'not-found' || SUPPORTED_IDS.some(id => id === detection.id),
  )
  const found = detections.filter(detection => detection.status !== 'not-found').map(detection => shown(detection.id))
  const summary =
    found.length === 0
      ? t('ui.summary.noFramework')
      : tn('ui.summary.frameworks', found.length, { count: found.length, ids: found.join(', ') })

  return {
    title: t('ui.context.detectionContext'),
    lines: shownDetections.map(detectionLine),
    kind: 'detection',
    summary,
    rows: oneSection(shownDetections.map(detectionRow)),
  }
}

/**
 * The facts a screen draws its detections from (D-226, WF-S5, AUTO-PICK #97): each GSD install's display path as the
 * screen shows it (screenPath), so a repo-local install is named by the repo folder name; everything else as it is.
 * Detection logic, warnings, prompts and the /cadre detect table keep the `<repo>` mask.
 */
export function screenFacts(facts: Facts, root: string): Facts {
  return { ...facts, gsd: facts.gsd.map(fact => ({ ...fact, dir: screenPath(fact.dir, root) })) }
}

/**
 * The context of the security plugins question (D-236): each missing plugin by its key, with what it does; its
 * summary counts the plugins to install and names them (D-310).
 */
export function securityContext(keys: readonly string[]): AskContext {
  const lines = keys.map(key => {
    const note = SECURITY_PLUGIN_NOTES.get(pluginName(key))

    return clean(note === undefined ? key : t('ui.context.securityContext', { key, note }), UNCUT)
  })
  const rows = keys.map(key => {
    const note = SECURITY_PLUGIN_NOTES.get(pluginName(key))

    return note === undefined ? plainRow(key) : fieldRow(key, note)
  })
  const names = keys.map(key => shown(pluginName(key))).join(', ')
  const summary = tn('ui.summary.securityPlugins', keys.length, { count: keys.length, names })

  return { title: t('ui.context.securityContext2'), lines, kind: 'security', summary, rows: oneSection(rows) }
}

/** The display form of the global CLAUDE.md, as the instruction questions name it. */
const GLOBAL_CLAUDE_MD_TEXT = '~/.claude/CLAUDE.md'

/** The rows of a list of found names as `words` caps them, or one `none` row with none (cappedRows, D-256). */
function foundRows(items: readonly string[], words: ListWords): string[] {
  return items.length === 0 ? [t('ui.context.foundRows')] : cappedRows(items, words)
}

/** The structured rows of foundRows (D-313): the none line as one plain row, else cappedItemRows. */
function foundItemRows(items: readonly string[], words: ListWords): ContextRow[] {
  return items.length === 0 ? [plainRow(t('ui.context.foundRows'))] : cappedItemRows(items, words)
}

/**
 * The context of the content consent (D-236): the instruction files and the memories init found, by name only, before
 * anything is read: the global CLAUDE.md, the CLAUDE.md files of the repo chain, the rule files of `.claude/rules` and
 * AGENTS.md, then the memory files, MEMORY.md in any letter case left out, as the hand-out never offers it. A file in
 * the repo is named with the folder name of `root` (screenPath, D-226). Each list shows the names `words` allows
 * (D-256); the summary counts both lists (D-310).
 */
export function instructionsContext(
  setup: Pick<SetupScan, 'hasGlobalClaudeMd' | 'claudeMd' | 'memoryFiles'>,
  repo: Pick<InstructionSources, 'rules' | 'hasAgentsMd'>,
  root: string,
  words: ListWords,
): AskContext {
  const files = [
    ...(setup.hasGlobalClaudeMd ? [GLOBAL_CLAUDE_MD_TEXT] : []),
    ...setup.claudeMd.map(file => screenPath(file, root)),
    ...(repo.rules ?? []).map(rule => `.claude/rules/${rule}`),
    ...(repo.hasAgentsMd ? ['AGENTS.md'] : []),
  ]
  const memories = setup.memoryFiles.filter(name => !isMemoryIndexName(name))
  const lines = [
    t('ui.context.instructionsContext'),
    ...foundRows(files, words),
    t('ui.context.instructionsContext2'),
    ...foundRows(memories, words),
  ]
  const rows = [
    headingRow(t('ui.context.instructionsContext')),
    ...foundItemRows(files, words),
    headingRow(t('ui.context.instructionsContext2')),
    ...foundItemRows(memories, words),
  ]
  const summary = t('ui.summary.instructions', {
    files: tn('ui.summary.files', files.length, { count: files.length }),
    memories: tn('ui.summary.memories', memories.length, { count: memories.length }),
  })

  return { title: t('ui.context.instructionsContext3'), lines, kind: 'instructions', summary, rows: oneSection(rows) }
}

/**
 * The context of the entry question of the instruction hand-out (D-236): the instructions block as the side pane
 * shows it (instructionLines), each line cleaned, not cut (#163); its summary counts the topics, the memories and how
 * many of them `recommended` gives a role (D-310).
 */
export function instructionPartsContext(
  scan: InstructionScan,
  topics: readonly InstructionTopic[],
  recommended: ReadonlyMap<string, readonly string[]>,
): AskContext {
  const ids = [...topics.map(topic => topic.id), ...scan.memories.map(memory => memory.id)]
  const recommendedCount = ids.filter(id => (recommended.get(id) ?? []).length > 0).length
  const summary = t('ui.summary.instructionParts', {
    topics: tn('ui.summary.topics', topics.length, { count: topics.length }),
    memories: tn('ui.summary.memories', scan.memories.length, { count: scan.memories.length }),
    recommended: recommendedCount,
  })

  return {
    title: t('ui.context.instructionPartsContextTitle'),
    lines: instructionLines(scan, topics, recommended).map(line => clean(line, UNCUT)),
    kind: 'instructions',
    summary,
    rows: oneSection(instructionRows(scan, topics, recommended)),
  }
}

/**
 * The context of one topic's question (D-236): that topic only, its title and summary, their secret-like spans hidden
 * (redactedText, E1, #163, PR-S3), the file and heading of each of its parts (never their text) and the roles
 * recommended for it, titled by its place among the topics; its summary is those roles (D-310).
 */
export function topicContext(
  topic: InstructionTopic,
  parts: readonly InstructionPart[],
  recommended: readonly string[],
  position: number,
  count: number,
): AskContext {
  const lines = [
    clean(t('ui.context.topicContext', {
      title: redactedText(topic.title),
      summary: redactedText(topic.summary),
    }), UNCUT),
    ...topicParts(topic, parts).map(part => clean(t('ui.context.topicContext2', { source: sourceText(part) }), UNCUT)),
    t('ui.context.topicContext3', { roleIds: roleIdsText(recommended) }),
  ]
  const rows: ContextRow[] = [
    fieldRow(redactedText(topic.title), redactedText(topic.summary)),
    ...topicParts(topic, parts).map(part => fieldRow(keyLabel('ui.context.topicContext2'), sourceText(part), 2)),
    { role: 'recommended', label: keyLabel('ui.context.topicContext3'), text: roleIdsText(recommended), indent: 2 },
  ]
  const summary = t('ui.summary.recommended', { roleIds: roleIdsText(recommended) })

  return {
    title: t('ui.context.topicContext4', { position, count }),
    lines,
    kind: 'topic',
    summary,
    rows: oneSection(rows),
  }
}

/**
 * The context of one memory's question (D-236): that memory only, its file and summary, the summary's secret-like
 * spans hidden (redactedText, E1, #163), and the roles recommended for it, never its folder or text, titled by its
 * place among the memories; its summary is those roles (D-310).
 */
export function memoryContext(
  memory: MemoryItem,
  recommended: readonly string[],
  position: number,
  count: number,
): AskContext {
  const lines = [
    clean(t('ui.context.memoryContext', { file: memory.file, summary: redactedText(memory.summary) }), UNCUT),
    t('ui.context.memoryContext2', { roleIds: roleIdsText(recommended) }),
  ]
  const rows: ContextRow[] = [
    fieldRow(memory.file, redactedText(memory.summary)),
    { role: 'recommended', label: keyLabel('ui.context.memoryContext2'), text: roleIdsText(recommended), indent: 2 },
  ]
  const summary = t('ui.summary.recommended', { roleIds: roleIdsText(recommended) })

  return {
    title: t('ui.context.memoryContext3', { position, count }),
    lines,
    kind: 'memory',
    summary,
    rows: oneSection(rows),
  }
}

/** The title of each instruction group's whole-file question context (D-236). */
const MEMORY_GROUP_TITLES: Readonly<Record<InstructionGroup, string>> = Object.freeze({
  'global-claude-md': t('ui.context.memoryGroupTitlesGlobalClaudeMd'),
  'auto-memory': t('ui.context.memoryGroupTitlesAutoMemory'),
  'project-claude-md': t('ui.context.memoryGroupTitlesProjectClaudeMd'),
})

/** The global CLAUDE.md as its whole-file question's context names it: with the files it imports. */
const GLOBAL_GROUP_LINE = t('ui.context.globalGroupLine', { globalClaudeMdText: GLOBAL_CLAUDE_MD_TEXT })

/**
 * The context of a whole-file question (D-63, D-236): the files of that group only, by name, the first `words.max`
 * and then how many more (D-256: every file on a pane surface); the global CLAUDE.md, which the scan names by no file
 * list, with the files it imports. Its summary counts the group's files, the global CLAUDE.md as its one file (D-310).
 */
export function memoryGroupContext(group: InstructionGroup, names: readonly string[], words: ListWords): AskContext {
  const shownNames = names.slice(0, words.max).map(name => shown(name))
  const rest = names.length - shownNames.length
  const files = rest > 0 ? [...shownNames, words.more(rest)] : shownNames
  const isGlobal = group === 'global-claude-md'
  const count = isGlobal ? 1 : names.length

  const lines = isGlobal ? [GLOBAL_GROUP_LINE] : files

  return {
    title: MEMORY_GROUP_TITLES[group],
    lines,
    kind: 'memory-group',
    summary: tn('ui.summary.files', count, { count }),
    rows: oneSection(lines.map(line => plainRow(line))),
  }
}

/**
 * The context of the env question (D-236): the env block, its heading and then each scanned name, never a value; its
 * summary counts the names (D-310).
 */
export function envContext(names: readonly string[]): AskContext {
  const lines = [ENV_PANE_HEADING, ...names.map(name => `  ${shown(name)}`)]
  const rows = [headingRow(ENV_PANE_HEADING), ...names.map(name => plainRow(shown(name), 2))]
  const summary = tn('ui.summary.envNames', names.length, { count: names.length })

  return { title: t('ui.context.envContext'), lines, kind: 'env', summary, rows: oneSection(rows) }
}

/**
 * The context of the improver install question (D-236): each role given a built CLAUDE.md, with its path; its summary
 * counts those roles and names their ids (D-310).
 */
export function improverInstallContext(roleIds: readonly string[]): AskContext {
  const rows = roleIds.map(id => t('ui.context.improverInstallContext', {
    id: shown(id),
    builtClaudeMdPath: builtClaudeMdPath(shown(id)),
  }))

  const lines = [t('ui.context.improverInstallContext2'), ...rows]
  const fields = roleIds.map(id => fieldRow(shown(id), builtClaudeMdPath(shown(id)), 2))
  const summary = tn('ui.summary.roles', roleIds.length, { count: roleIds.length, ids: roleIdsText(roleIds) })

  return {
    title: t('ui.context.improverInstallContext3'),
    lines,
    kind: 'improver-install',
    summary,
    rows: oneSection([headingRow(t('ui.context.improverInstallContext2')), ...fields]),
  }
}

/**
 * The context of the launcher start question (D-236): what the git root and the run folder mean as a start, then the
 * launcher of each role (launcherPath), as many as `words` allows and how many more (D-256: all on a pane surface);
 * its summary counts the launchers (D-310).
 */
export function launchContext(roles: readonly RoleSpec[], words: ListWords): AskContext {
  const map = cardList(roles.map(role => launcherPath(shown(role.id))), words)
  const lines = [
    t('ui.context.launchContext'),
    t('ui.context.launchContext2'),
    t('ui.context.launchContext3', { map }),
  ]
  const rows = [
    plainRow(t('ui.context.launchContext')),
    plainRow(t('ui.context.launchContext2')),
    fieldRow(keyLabel('ui.context.launchContext3'), map),
  ]
  const summary = tn('ui.summary.launchers', roles.length, { count: roles.length })

  return { title: t('ui.context.launchContext4'), lines, kind: 'launch', summary, rows: oneSection(rows) }
}

/**
 * The context of the launcher folder question (D-236): the top-level folders the repo scan found code in, as candidate
 * folders, as many as `words` allows and then how many more (D-256: all on a pane surface); with none, a line that
 * says so. Its summary counts the folders (D-310).
 */
export function launchDirContext(codeDirs: readonly string[], words: ListWords): AskContext {
  const dirs = codeDirs.map(dir => `${dir}/`)
  const lines =
    codeDirs.length === 0
      ? [t('ui.context.launchDirContext')]
      : [t('ui.context.launchDirContext2'), ...cappedRows(dirs, words)]
  const rows =
    codeDirs.length === 0
      ? [plainRow(t('ui.context.launchDirContext'))]
      : [headingRow(t('ui.context.launchDirContext2')), ...cappedItemRows(dirs, words)]
  const summary = tn('ui.summary.codeFolders', codeDirs.length, { count: codeDirs.length })

  return { title: t('ui.context.launchDirContext3'), lines, kind: 'launch-dir', summary, rows: oneSection(rows) }
}

/**
 * The context of the review question (D-236): the review block it is asked about, each line cleaned, uncut (#163);
 * its summary counts the `files` the plan writes or keeps and the `roles` it has (D-310).
 */
export function reviewContext(lines: readonly string[], files: number, roles: number): AskContext {
  const summary = t('ui.summary.review', {
    files: tn('ui.summary.files', files, { count: files }),
    roles: tn('ui.summary.roleCount', roles, { count: roles }),
  })

  return {
    title: t('ui.context.reviewContext'),
    lines: lines.map(line => clean(line, UNCUT)),
    kind: 'review',
    summary,
  }
}
