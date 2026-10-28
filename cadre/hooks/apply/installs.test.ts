import { describe, expect, test } from 'claude-code/testing'

import type { HostRun } from '../../types'
import { BIDI_OVERRIDE, emptySetupScan } from '../testkit'
import {
  installedLine,
  installFailureText,
  MARKETPLACE_ADD_ARGV,
  noHomeInstallText,
  pluginInstallArgv,
  PYTHON_VERSION_ARGV,
  pythonProblem,
  setupAfterInstalls,
} from './installs'

/** The plugin key of claude-security in Anthropic's official marketplace (decision #39). */
const SECURITY_KEY = 'claude-security@claude-plugins-official'

/** The plugin key of security-guidance in Anthropic's official marketplace (decision #39). */
const GUIDANCE_KEY = 'security-guidance@claude-plugins-official'

/** The text of a Python problem: claude-security was not installed, and why (decision #39). */
function pythonNeeds(why: string): string {
  return (
    `claude-security was not installed: it needs Python 3.9 or newer on PATH (${why}): install it, then run: ` +
    `claude plugin install ${SECURITY_KEY}`
  )
}

/** A python3 run that exited 0 with this output. */
function pythonRun(stdout: string, stderr = ''): HostRun {
  return { exitCode: 0, stdout, stderr }
}

describe('install runs (decision #39)', () => {
  test('the argvs of a plugin install, the Python check and the marketplace add are fixed, the last two frozen', () => {
    expect(pluginInstallArgv(SECURITY_KEY)).toEqual(['claude', 'plugin', 'install', SECURITY_KEY])
    expect(PYTHON_VERSION_ARGV).toEqual(['python3', '--version'])
    expect(Object.isFrozen(PYTHON_VERSION_ARGV)).toBe(true)
    expect(MARKETPLACE_ADD_ARGV).toEqual([
      'claude',
      'plugin',
      'marketplace',
      'add',
      'anthropics/claude-plugins-official',
    ])
    expect(Object.isFrozen(MARKETPLACE_ADD_ARGV)).toBe(true)
  })

  test('pythonProblem: none for Python 3.9 or newer on the first line of stdout, else of stderr', () => {
    for (const line of ['Python 3.9.0', 'Python 3.10.2', 'Python 3.12.1', 'Python 4.0']) {
      expect([line, pythonProblem(pythonRun(`${line}\n`))]).toEqual([line, null])
    }
    expect(pythonProblem(pythonRun('', 'Python 3.10.2\n'))).toBeNull()
    expect(pythonProblem(pythonRun('\n', 'Python 3.10.2\n'))).toBeNull()
    expect(pythonProblem(pythonRun('\nPython 3.11.4\r\n'))).toBeNull()
  })

  test('pythonProblem: python3 was not found when the run was rejected or exited non-zero', () => {
    expect(pythonProblem(null)).toBe(pythonNeeds('python3 was not found'))
    expect(pythonProblem({ exitCode: 127, stdout: 'Python 3.12.1\n', stderr: '' })).toBe(
      pythonNeeds('python3 was not found'),
    )
  })

  test('pythonProblem: an old or unreadable version names the first line python3 printed, cleaned, or nothing', () => {
    expect(pythonProblem(pythonRun('Python 3.8.10\n'))).toBe(pythonNeeds('python3 --version says Python 3.8.10'))
    expect(pythonProblem(pythonRun('Python 2.7.18\n'))).toBe(pythonNeeds('python3 --version says Python 2.7.18'))
    expect(pythonProblem(pythonRun('', 'Python 3.8.10\n'))).toBe(pythonNeeds('python3 --version says Python 3.8.10'))
    expect(pythonProblem(pythonRun('not a version\n'))).toBe(pythonNeeds('python3 --version says not a version'))
    // The line is matched as python3 printed it, and only shown cleaned (T-03-45).
    expect(pythonProblem(pythonRun(`Py${BIDI_OVERRIDE}thon 3.12.1\n`))).toBe(
      pythonNeeds('python3 --version says Python 3.12.1'),
    )
    expect(pythonProblem(pythonRun(''))).toBe(pythonNeeds('python3 --version says nothing'))
    expect(pythonProblem(pythonRun('\n  \n', '\n'))).toBe(pythonNeeds('python3 --version says nothing'))
  })

  test('noHomeInstallText says no home folder is known and gives the command, with the key cleaned', () => {
    expect(noHomeInstallText(SECURITY_KEY)).toBe(
      `could not install ${SECURITY_KEY}: no home folder is known to run it from: ` +
        `run it yourself: claude plugin install ${SECURITY_KEY}`,
    )
    expect(noHomeInstallText(`x${BIDI_OVERRIDE}@m`)).toBe(
      'could not install x@m: no home folder is known to run it from: run it yourself: claude plugin install x@m',
    )
  })

  test('setupAfterInstalls adds the installed keys to both plugin lists, sorted and once each; the setup stays', () => {
    const official = 'superpowers@claude-plugins-official'
    const setup = emptySetupScan({ plugins: [official, 'z@m'], installedPlugins: [official] })
    const before = JSON.stringify(setup)
    const after = setupAfterInstalls(setup, [SECURITY_KEY])

    expect(after).toEqual({
      ...setup,
      plugins: [SECURITY_KEY, official, 'z@m'],
      installedPlugins: [SECURITY_KEY, official],
    })
    expect(setupAfterInstalls(after, [SECURITY_KEY])).toEqual(after)
    expect(setupAfterInstalls(setup, [])).toEqual(setup)
    expect(JSON.stringify(setup)).toBe(before)
  })

  test('installFailureText: the install command, and after a failed add the add for a missing marketplace', () => {
    expect(installFailureText(SECURITY_KEY, false)).toBe(
      `could not install ${SECURITY_KEY}: run it yourself: claude plugin install ${SECURITY_KEY}`,
    )
    // The add may have failed because the marketplace is there already, so it is named as a condition (#69 A3).
    expect(installFailureText(GUIDANCE_KEY, true)).toBe(
      `could not install ${GUIDANCE_KEY}: run it yourself: claude plugin install ${GUIDANCE_KEY} ` +
        '(if the claude-plugins-official marketplace is missing, first run: ' +
        'claude plugin marketplace add anthropics/claude-plugins-official)',
    )
    expect(installFailureText(`x${BIDI_OVERRIDE}@m`, false)).toBe(
      'could not install x@m: run it yourself: claude plugin install x@m',
    )
  })

  test('installedLine names the keys and says to load it, or them, with /reload-plugins', () => {
    expect(installedLine([SECURITY_KEY])).toBe(
      `Installed ${SECURITY_KEY}: run /reload-plugins to load it in this session.`,
    )
    expect(installedLine([SECURITY_KEY, GUIDANCE_KEY])).toBe(
      `Installed ${SECURITY_KEY} and ${GUIDANCE_KEY}: run /reload-plugins to load them in this session.`,
    )
  })
})
