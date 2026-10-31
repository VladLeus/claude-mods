/**
 * The plugin installs, a layer 9 module: the argvs of a plugin install, the Python check and the marketplace add, the
 * reply lines of an install that ran, failed or could not run, and the setup the plan is made again from after the
 * installs (decision #39, D-141). It imports core, roles/infra and the types, so the apply runner and init read it
 * here.
 */
import type { HostRun, SetupScan } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { t, tn } from '../locales/t'
import { CLAUDE_SECURITY_PLUGIN } from '../roles/infra'

/**
 * The argv that installs a plugin by its exact key (decision #39). Init runs it only after Confirm, through the host
 * port, with the home folder as cwd.
 */
export function pluginInstallArgv(key: string): readonly string[] {
  return ['claude', 'plugin', 'install', key]
}

/**
 * The argv of the Python check init runs right before the claude-security install (decision #39): claude-security's
 * README asks for Python 3.9 or newer on PATH. Like every install run it has the home folder as cwd, so no repo-level
 * settings or marketplace definitions take part (T-03-46).
 */
export const PYTHON_VERSION_ARGV: readonly string[] = Object.freeze(['python3', '--version'])

/**
 * The argv that adds Anthropic's official marketplace (decision #39): init runs it once per apply, after the first
 * install that fails, and then tries that install once more. It has the home folder as cwd, never the repo, so no
 * repo-level settings or marketplace definitions take part (T-03-46).
 */
export const MARKETPLACE_ADD_ARGV: readonly string[] = Object.freeze([
  'claude',
  'plugin',
  'marketplace',
  'add',
  'anthropics/claude-plugins-official',
])

/**
 * The text init prints for a plugin it could not install (decision #39): the command to run by hand, and, when the
 * marketplace add failed too, that add as a first step only for a missing marketplace, since the add also fails when
 * the marketplace is there already (decision #69 A3). The key is cleaned and capped as a report cell is.
 */
export function installFailureText(key: string, isMarketplaceFailed: boolean): string {
  const shown = reportText(key)
  const install = pluginInstallArgv(shown).join(' ')
  const add = t('apply.installs.installFailureText2', { marketplaceAddArgv: MARKETPLACE_ADD_ARGV.join(' ') })

  return t('apply.installs.installFailureText3', { shown, install, value: isMarketplaceFailed ? add : '' })
}

/**
 * The line init prints once plugins were installed (decision #39): their keys, and that /reload-plugins loads them in
 * the session that ran init. Each key is cleaned and capped as a report cell is.
 */
export function installedLine(keys: readonly string[]): string {
  const names = keys.map(reportText).join(t('apply.installs.namesJoin'))

  return tn('apply.installs.installed', keys.length, { names })
}

/** The version line python3 prints, `Python <major>.<minor>...`, with the major and minor version (decision #39). */
const PYTHON_VERSION_LINE = /^Python (\d+)\.(\d+)/

/**
 * Why claude-security is not to be installed, or null when Python is fine for it (decision #39): claude-security's
 * README asks for Python 3.9 or newer on PATH. A run of PYTHON_VERSION_ARGV the host rejected, or that did not exit 0,
 * means python3 was not found. Otherwise the first line with text of stdout, else of stderr (an older python3 prints
 * its version there), must be a PYTHON_VERSION_LINE of 3.9 or newer; any other line is named, cleaned and capped as a
 * report cell is (T-03-45), and output with no text says nothing. The text ends with the command to run once Python is
 * there.
 */
export function pythonProblem(run: HostRun | null): string | null {
  const needs = (why: string): string =>
    t('apply.installs.pythonProblem', { why, command: pluginInstallArgv(CLAUDE_SECURITY_PLUGIN).join(' ') })
  if (run === null || run.exitCode !== 0) return needs(t('apply.installs.pythonProblem2'))
  const firstLine = (text: string): string | undefined => text.split(/\r?\n/).find(line => line.trim() !== '')
  const line = firstLine(run.stdout) ?? firstLine(run.stderr)
  if (line === undefined) return needs(t('apply.installs.pythonProblem3'))
  const match = PYTHON_VERSION_LINE.exec(line)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (major > 3 || (major === 3 && minor >= 9)) return null

  return needs(t('apply.installs.pythonProblem4', { line: reportText(line) }))
}

/**
 * The text init prints for each plugin to install when no home folder is known to run the installs from (decision
 * #39): nothing is run then, since a run from the repo would let its settings and marketplace definitions take part
 * (T-03-46). The key is cleaned and capped as a report cell is.
 */
export function noHomeInstallText(key: string): string {
  const shown = reportText(key)

  return (
    t('apply.installs.noHomeInstallText', {
      shown,
      command: pluginInstallArgv(shown).join(' '),
    })
  )
}

/**
 * The setup scan the plan is made again from after the installs (decision #39): the setup with each installed plugin
 * key added to its plugins and to its installed plugins, sorted and once each, as the next scan lists them, so a
 * Security role's settings enable claude-security once it is installed. The review plans from it too, with the keys
 * answered Install, so the cards and the plan it shows are those Confirm writes when every install works (decision #69
 * A4). The setup given is not changed.
 */
export function setupAfterInstalls(setup: SetupScan, installed: readonly string[]): SetupScan {
  return {
    ...setup,
    plugins: sortedUnique([...setup.plugins, ...installed]),
    installedPlugins: sortedUnique([...setup.installedPlugins, ...installed]),
  }
}
