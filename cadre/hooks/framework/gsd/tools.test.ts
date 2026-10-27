import { describe, expect, test } from 'claude-code/testing'
import type { ToolCommand } from '../../../types'
import { GSD_AUTONOMY } from './adapter'
import { resolveToolCommand, TOOL_SCRIPTS } from './tools'
import type { GsdToolContext } from './tools'

/** A user-level GSD under the home folder, as init resolves it. */
const USER_GSD: GsdToolContext = {
  userDir: '/home/u/.claude/gsd-core',
  home: '/home/u',
  root: '/repo',
  configDir: null,
}

/** The mode write as a logical command. */
const MODE_COMMAND: ToolCommand = { tool: 'gsd-tools', args: ['config-set', 'mode', 'yolo'] }

const MODE_USER_ARGV = ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo']
const MODE_USER_DISPLAY = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'
const MODE_REPO_DISPLAY = 'node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'
const REFUSED = { argv: null, display: 'refused: an argument is not a plain word' }

describe('tool commands and attended', () => {
  test('a user-level GSD gives the argv from the raw dir and shows the command in display form', () => {
    expect(resolveToolCommand(MODE_COMMAND, USER_GSD)).toEqual({ argv: MODE_USER_ARGV, display: MODE_USER_DISPLAY })
  })

  test('with no user-level GSD there is no argv, and the display is the repo-local command for the person', () => {
    expect(resolveToolCommand(MODE_COMMAND, { ...USER_GSD, userDir: null })).toEqual({
      argv: null,
      display: MODE_REPO_DISPLAY,
    })
  })

  test('an argument that is not a plain word refuses the command, with a user-level GSD or without one', () => {
    const args = ['yolo; rm -rf', 'a b', '$(id)', '`id`', 'x\ny', '', "it's", 'a|b', 'a&b', 'a/b', '--flag=$HOME']

    for (const arg of args) {
      const command: ToolCommand = { tool: 'gsd-tools', args: ['config-set', 'mode', arg] }

      expect(resolveToolCommand(command, USER_GSD)).toEqual(REFUSED)
      expect(resolveToolCommand(command, { ...USER_GSD, userDir: null })).toEqual(REFUSED)
    }
  })

  test('letters, digits, dots, underscores and hyphens are plain words', () => {
    const command: ToolCommand = { tool: 'gsd-tools', args: ['config-set', 'workflow.text_mode', 'v1-2_3'] }

    expect(resolveToolCommand(command, USER_GSD).argv).toEqual([
      'node',
      '/home/u/.claude/gsd-core/bin/gsd-tools.cjs',
      'config-set',
      'workflow.text_mode',
      'v1-2_3',
    ])
  })

  test('a command with no arguments resolves to the bare script', () => {
    expect(resolveToolCommand({ tool: 'gsd-tools', args: [] }, USER_GSD)).toEqual({
      argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs'],
      display: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs',
    })
    expect(resolveToolCommand({ tool: 'gsd-tools', args: [] }, { ...USER_GSD, userDir: null })).toEqual({
      argv: null,
      display: 'node .claude/gsd-core/bin/gsd-tools.cjs',
    })
  })

  test('trailing slashes on the user dir do not reach the argv', () => {
    const resolved = resolveToolCommand(MODE_COMMAND, { ...USER_GSD, userDir: '/home/u/.claude/gsd-core//' })

    expect(resolved).toEqual({ argv: MODE_USER_ARGV, display: MODE_USER_DISPLAY })
  })

  test('the display names a dir under CLAUDE_CONFIG_DIR by that name, and any other dir as it is', () => {
    const underConfig = { userDir: '/cfg/gsd-core', home: '/home/u', root: '/repo', configDir: '/cfg' }
    const elsewhere = { userDir: '/opt/gsd', home: '/home/u', root: '/repo', configDir: null }
    const noHome = { ...USER_GSD, home: null }

    expect(resolveToolCommand(MODE_COMMAND, underConfig)).toEqual({
      argv: ['node', '/cfg/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
      display: 'node $CLAUDE_CONFIG_DIR/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    })
    expect(resolveToolCommand(MODE_COMMAND, elsewhere).display).toBe(
      'node /opt/gsd/bin/gsd-tools.cjs config-set mode yolo',
    )
    expect(resolveToolCommand(MODE_COMMAND, noHome).display).toBe(
      'node /home/u/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    )
  })

  test('a user dir that is not an absolute path without empty, dot or dot-dot segments is no user-level GSD', () => {
    const dirs = ['', '/', 'gsd-core', './gsd-core', '/home/u/../x', '/home//u', '/home/u/./gsd-core']

    for (const userDir of dirs) {
      expect(resolveToolCommand(MODE_COMMAND, { ...USER_GSD, userDir })).toEqual({
        argv: null,
        display: MODE_REPO_DISPLAY,
      })
    }
  })

  test('every GSD_AUTONOMY write resolves to a runnable user-level command, so its arguments are plain words', () => {
    for (const proposal of GSD_AUTONOMY) {
      expect(resolveToolCommand(proposal.write, USER_GSD)).toEqual({
        argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', proposal.key, proposal.to],
        display: `node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set ${proposal.key} ${proposal.to}`,
      })
    }
  })

  test('repo-local GSD is never an argv: every GSD_AUTONOMY write gives none, only the command to run', () => {
    for (const proposal of GSD_AUTONOMY) {
      const resolved = resolveToolCommand(proposal.write, { ...USER_GSD, userDir: null })

      expect(resolved.argv).toBeNull()
      expect(resolved.display).toBe(`node .claude/gsd-core/bin/gsd-tools.cjs config-set ${proposal.key} ${proposal.to}`)
    }
  })

  test('TOOL_SCRIPTS names the one script of gsd-tools and is frozen', () => {
    expect(TOOL_SCRIPTS).toEqual({ 'gsd-tools': 'bin/gsd-tools.cjs' })
    expect(Object.isFrozen(TOOL_SCRIPTS)).toBe(true)
  })
})
