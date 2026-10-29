import { describe, expect, test } from 'claude-code/testing'

import type { SetupScan } from '../../../types'
import { BIDI_OVERRIDE, CTX, memWorld, runOf } from '../../testkit'
import type { MemWorld } from '../../testkit'
import type { SetupContext } from './read'
import { projectCommands } from './skills'

/** A scan of `world` as the person at `ctx` gets it. */
async function scanOf(world: MemWorld, isClaudeJsonAllowed = false, ctx: SetupContext = CTX): Promise<SetupScan> {
  return (await runOf(world, isClaudeJsonAllowed, ctx)).scan
}

describe('skill purpose (D-139)', () => {
  test('projectCommands keeps a string description as the purpose of its skill, user and plugin alike', () => {
    const found = projectCommands([
      { name: 'my-skill', source: 'user', description: 'Write the release notes for a deploy.' },
      { name: 'codex:rescue', source: 'plugin', plugin: 'codex', description: 'Hand a stuck task to Codex.' },
    ])
    expect(found).toEqual([
      { name: 'codex:rescue', plugin: 'codex', purpose: 'Hand a stuck task to Codex.' },
      { name: 'my-skill', plugin: null, purpose: 'Write the release notes for a deploy.' },
    ])
  })

  test('a purpose is cleaned: line breaks, control and bidi characters are removed', () => {
    const bell = String.fromCharCode(7)
    const description = `One line\nand more${BIDI_OVERRIDE}${bell}.`
    expect(projectCommands([{ name: 'a', source: 'user', description }])).toEqual([
      { name: 'a', plugin: null, purpose: 'One lineand more.' },
    ])
  })

  test('a purpose is cut to 120 code points, the ellipsis included; one of 120 is kept whole', () => {
    const smile = String.fromCodePoint(0x1f600)
    const found = projectCommands([
      { name: 'exact', source: 'user', description: 'x'.repeat(120) },
      { name: 'long', source: 'user', description: 'y'.repeat(121) },
      { name: 'wide', source: 'user', description: smile.repeat(121) },
    ])
    expect(found.map(skill => skill.purpose)).toEqual([
      'x'.repeat(120),
      `${'y'.repeat(119)}…`,
      `${smile.repeat(119)}…`,
    ])
  })

  test('a missing, non-string or blank description gives no purpose field', () => {
    const found = projectCommands([
      { name: 'a', source: 'user' },
      { name: 'b', source: 'user', description: 5 },
      { name: 'c', source: 'user', description: '' },
      { name: 'd', source: 'user', description: '   ' },
      { name: 'e', source: 'user', description: String.fromCharCode(7) },
    ])
    expect(found).toEqual(['a', 'b', 'c', 'd', 'e'].map(name => ({ name, plugin: null })))
    expect(found.filter(skill => Object.hasOwn(skill, 'purpose'))).toEqual([])
  })

  test('the setup scan keeps each skill purpose in memory, as projectCommands gives it', async () => {
    const commands = [{ name: 'my-skill', source: 'user', description: 'UNIQUE-PURPOSE-7f3a' }]
    const scan = await scanOf(memWorld({ commands }))
    expect(scan.skills).toEqual([{ name: 'my-skill', plugin: null, purpose: 'UNIQUE-PURPOSE-7f3a' }])
  })
})
