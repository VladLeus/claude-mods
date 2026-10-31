/**
 * The scan summary block, a layer 8 module: the side-pane lines of the repo scan and the user setup, with the partial
 * lines of a walk that listed a folder only in part or stopped at its safety cap (SCAN-01, SCAN-02, D-133, D-137), the
 * context line of the history question (G-02-1) and the scan warning lines. It imports scan, core and the types, so
 * init reads it here.
 */
import type { RepoScan, ScanKind, SetupScan } from '../../../types'
import { cardList, idsOrNone, shown } from '../../core/text'
import { t, tn } from '../../locales/t'
import { undecidedFacts } from '../../scan/repo'
import { MAX_FOLDER_ENTRIES, MAX_SCAN_ENTRIES } from '../../scan/walk'

/** How a partial line names a walk that stopped at its overall safety cap (D-137). */
const SAFETY_CAP_TEXT = t('ui.scan.safetyCap', { toLocaleString: MAX_SCAN_ENTRIES.toLocaleString('en-US') })

/**
 * How a partial line ends when the safety cap stopped the walk and no fact is missing: the walk did not reach
 * everything, so nothing is called all found (D-137, batch-1 review N7).
 */
const STOPPED_EARLY_TEXT = t('ui.scan.stoppedEarly')

/**
 * What a partial line says the scan found (D-137): the facts that may be incomplete; with none, STOPPED_EARLY_TEXT
 * when the safety cap stopped the walk (batch-1 review N7), else that all were found.
 */
function partialFactsText(repo: RepoScan): string {
  const facts = undecidedFacts(repo)
  if (facts.length > 0) return t('ui.scan.mayBeIncomplete', { facts: facts.join(', ') })
  if (repo.isOverallCapped) return STOPPED_EARLY_TEXT

  return t('ui.scan.allFound')
}

/** The partial line for the deeper folders listed only in part (D-137); null when no folder was capped. */
function folderCapLine(repo: RepoScan): string | null {
  const count = repo.cappedFolders.length
  if (count === 0) return null
  const listed = tn('ui.scan.folderCap', count, { count, max: MAX_FOLDER_ENTRIES })

  return t('ui.scan.partialFolders', { listed, partialFacts: partialFactsText(repo) })
}

/**
 * The summary line of a scan that did not list everything (G-02-1e, D-137). A walk that stopped at the safety cap is
 * named first, in place of the folder wording: `  partial: the scan stopped at the 20,000-entry safety cap; ...`.
 * Else, with deeper folders listed only in part: `  partial: <n> deeper folder(s) listed only in part (the first 200
 * entries each); ...`. Either way the line ends with the facts that may be incomplete (undecidedFacts); with none, a
 * walk the safety cap stopped ends with STOPPED_EARLY_TEXT and any other with `stack, tests and E2E were all found`
 * (batch-1 review N7). Null when nothing was capped.
 */
export function truncatedLine(repo: RepoScan): string | null {
  if (repo.isOverallCapped) return t('ui.scan.partialCap', {
    safetyCapText: SAFETY_CAP_TEXT,
    partialFacts: partialFactsText(repo),
  })

  return folderCapLine(repo)
}

/**
 * The partial lines of the scan summary (D-137): truncatedLine, then, when the safety cap stopped a walk that had also
 * listed deeper folders only in part, the folder line after it.
 */
function partialLines(repo: RepoScan): string[] {
  const first = truncatedLine(repo)
  if (first === null) return []
  const folders = repo.isOverallCapped ? folderCapLine(repo) : null

  return folders === null ? [first] : [first, folders]
}

/** The labels of the repo findings of one kind, in scan order, or `none`. */
function findingLabels(repo: RepoScan, kind: ScanKind): string {
  return idsOrNone(repo.findings.filter(finding => finding.kind === kind).map(finding => finding.label))
}

/** What an earlier run left in `.cadre/`: `none`, or the folder's state with the state of its manifest. */
function cadreSummary(cadre: RepoScan['cadre']): string {
  if (cadre.dir === 'absent') return t('ui.scan.none')

  return t('ui.scan.cadreSummary', { dir: cadre.dir, manifestState: cadre.manifestState })
}

/** The plugin count, with their names listed as a card lists names when there are any. */
function pluginSummary(plugins: readonly string[]): string {
  if (plugins.length === 0) return '0'

  return t('ui.scan.pluginSummary', { count: plugins.length, map: cardList(plugins.map(plugin => shown(plugin))) })
}

/**
 * The scans as init shows them in the side pane before any role question (SCAN-01, SCAN-02, D-133): the repo part
 * (stack, frontend, backend, tests, E2E, an existing `.cadre/`, and the partial lines when the walk listed a deeper
 * folder only in part or stopped at its safety cap, D-137), then the user setup as names and counts only. Each setup
 * line gives its counts first and its name list last, and a list shows 12 names cleaned and capped, then counts the
 * rest, so a long list never pushes a count past the 240 code points a line keeps (B2). No setting value, file content
 * or warning is part of it.
 */
export function scanSummaryLines(repo: RepoScan, setup: SetupScan): string[] {
  const stack = t('ui.scan.stack', { languages: idsOrNone(repo.languages) })
  const sides = t('ui.scan.sides', {
    findingLabels: findingLabels(repo, 'fe'),
    findingLabelsB: findingLabels(repo, 'be'),
  })
  const mcp = cardList(setup.mcp.map(server => shown(server.name)))
  const globalMd = setup.hasGlobalClaudeMd ? t('ui.scan.yes') : t('ui.scan.no')

  return [
    t('ui.scan.repoHeading'),
    t('ui.scan.stackSides', { stack, sides }),
    t('ui.scan.tests', { findingLabels: findingLabels(repo, 'test'), findingLabelsB: findingLabels(repo, 'e2e') }),
    t('ui.scan.existingCadre', { cadreSummary: cadreSummary(repo.cadre) }),
    ...partialLines(repo),
    t('ui.scan.setupHeading'),
    t('ui.scan.plugins', { pluginSummary: pluginSummary(setup.plugins) }),
    t('ui.scan.setupCounts', { count: setup.skills.length, countB: setup.agents.length, mcp }),
    t('ui.scan.setupFiles', {
      globalMd,
      count: setup.memoryFiles.length,
      map: cardList(setup.claudeMd.map(file => shown(file))),
    }),
  ]
}

/**
 * The context line of the history question (G-02-1, D-136): what the repo scan found, so the question reads on its
 * own: the stack, then the labels of the frontend, backend, test and E2E findings, each `none` when there is none.
 */
export function scanContextLine(repo: RepoScan): string {
  const sides = t('ui.scan.contextSides', {
    findingLabels: findingLabels(repo, 'fe'),
    findingLabelsB: findingLabels(repo, 'be'),
  })
  const checks = t('ui.scan.contextChecks', {
    findingLabels: findingLabels(repo, 'test'),
    findingLabelsB: findingLabels(repo, 'e2e'),
  })

  return t('ui.scan.context', { languages: idsOrNone(repo.languages), sides, checks })
}

/** The scan warnings as init shows them, one `warning: <text>` line each; nothing when there are none. */
export function scanWarningLines(warnings: readonly string[]): string[] {
  return warnings.map(warning => t('ui.scan.warning', { warning }))
}
