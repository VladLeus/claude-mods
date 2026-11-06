import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPartRecord } from '../../types'
import { unreadableWarning } from '../scan/instructions/memories'
import { DEFAULT_LOCATIONS, emptySetupScan, memIo, memWorld, SHA_A, templateRole } from '../testkit'
import { privateSideRead, recordPlacesOf, repoSideRead } from './side-read'

/** A part record of `file` under `heading`; the hash only has to be a hash-like text here. */
function partRecordAt(file: string, heading: string): InstructionPartRecord {
  return { file, heading, hash: SHA_A }
}

describe('side-read loops', () => {
  test('repoSideRead reads each recorded file once, in record order, and keeps the parts in that order', async () => {
    const files = { '/repo/notes/b.md': '# B\nThe b part.\n', '/repo/CLAUDE.md': '# Rules\nRun the tests.\n' }
    const role = templateRole('be', {
      instructionParts: [partRecordAt('notes/b.md', 'B'), partRecordAt('CLAUDE.md', 'Rules')],
      instructionPartsNotGiven: [partRecordAt('notes/b.md', 'Other')],
    })
    const run = memIo(memWorld({ files }), {})
    const side = await repoSideRead(run.io, '/repo', role)

    expect(run.reads).toEqual(['/repo/notes/b.md', '/repo/CLAUDE.md'])
    expect(side.kind === 'read' ? side.side.current.parts.map(part => part.file) : []).toEqual([
      'notes/b.md',
      'CLAUDE.md',
    ])
  })

  test('recordPlacesOf: a relative or inside-repo CLAUDE_CONFIG_DIR gives <home>/.claude (D-238)', () => {
    for (const configDir of ['.claude-alt', '/repo/.claude-alt']) {
      const places = recordPlacesOf({ ...DEFAULT_LOCATIONS, configDir }, emptySetupScan())

      const memory = ['/home/u/.claude/projects/-repo/memory']
      expect([places.userDir, places.memoryFolders]).toEqual(['/home/u/.claude', memory])
    }
  })

  test('privateSideRead keeps the side as it is, with its warning, when a recorded file cannot be read', async () => {
    const record = { parts: [partRecordAt('~/.claude/CLAUDE.md', 'Security')], partsNotGiven: [], memories: [] }
    const run = memIo(memWorld({ unknownPaths: ['/home/u/.claude/CLAUDE.md'] }), {})
    const places = recordPlacesOf(DEFAULT_LOCATIONS, emptySetupScan())

    expect(await privateSideRead(run.io, record, places, 'security')).toEqual({
      kind: 'kept',
      warnings: [unreadableWarning('~/.claude/CLAUDE.md')],
    })
  })
})
