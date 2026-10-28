import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, MemoryItem } from '../../types'
import { sha256Hex } from '../core/hash'
import { NO_MEMORY_SUMMARY } from '../scan/instructions/memories'
import { partChanges } from './part-changes'
import type { MemoryRecord, PartRecord } from './part-changes'

/** The auto-memory folder of the fixture repo for the fixture user. */
const MEMORY = '/home/u/.claude/projects/-repo/memory'

/** The Git section of the root CLAUDE.md as init read it (G-02-1f Regen). */
const GIT_SECTION = '## Git\nUse signed commits.\n'

/** A repo part of the root CLAUDE.md, or of `file`, with the SHA-256 of its text, as the read gives it. */
async function repoPart(id: string, heading: string, text: string, file = 'CLAUDE.md'): Promise<InstructionPart> {
  return { id, file, heading, source: 'repo', text, hash: await sha256Hex(text) }
}

/** A memory of the repo with the SHA-256 of this text, as the read gives it. */
async function hashedMemory(id: string, file: string, text: string): Promise<MemoryItem> {
  return { id, file, folder: MEMORY, summary: NO_MEMORY_SUMMARY, hash: await sha256Hex(text) }
}

/** What a role's records keep of a part: its file, heading and hash (G-02-1f Regen). */
function partRecordOf(found: InstructionPart): PartRecord {
  return { file: found.file, heading: found.heading, hash: found.hash }
}

/** What a role's records keep of a memory: its file and hash (G-02-1f Regen). */
function memoryRecordOf(found: MemoryItem): MemoryRecord {
  return { file: found.file, hash: found.hash }
}

/** No part and no memory. */
const NO_ITEMS = { parts: [], memories: [] }

describe('partChanges (G-02-1f)', () => {
  test('a record of CLAUDE.md > Git with the file unchanged gives kept', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const stored = { parts: [partRecordOf(git), partRecordOf(tests)], memories: [] }

    expect(partChanges(stored, { parts: [git, tests], memories: [] })).toEqual({
      kept: { parts: [git, tests], memories: [] },
      changed: NO_ITEMS,
      added: NO_ITEMS,
      removed: NO_ITEMS,
    })
  })

  test('the Git section edited gives changed, with the part as it is now', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const edited = await repoPart('P1', 'Git', '## Git\nUse signed commits, always.\n')
    const stored = { parts: [partRecordOf(git)], memories: [] }

    expect(partChanges(stored, { parts: [edited], memories: [] })).toEqual({
      kept: NO_ITEMS,
      changed: { parts: [edited], memories: [] },
      added: NO_ITEMS,
      removed: NO_ITEMS,
    })
  })

  test('the Git section deleted gives removed, with the record as it was stored', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const stored = { parts: [partRecordOf(git), partRecordOf(tests)], memories: [] }

    expect(partChanges(stored, { parts: [tests], memories: [] })).toEqual({
      kept: { parts: [tests], memories: [] },
      changed: NO_ITEMS,
      added: NO_ITEMS,
      removed: { parts: [partRecordOf(git)], memories: [] },
    })
    expect(partChanges(stored, NO_ITEMS).removed.parts).toEqual([partRecordOf(git), partRecordOf(tests)])
  })

  test('a part a named file gained is added; a part of a file no record names is not', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const rule = await repoPart('P3', '', 'Keep functions small.\n', '.claude/rules/style.md')
    const stored = { parts: [partRecordOf(git)], memories: [] }
    const changes = partChanges(stored, { parts: [git, tests, rule], memories: [] })

    expect(changes.kept.parts).toEqual([git])
    expect(changes.added.parts).toEqual([tests])
    expect([changes.changed, changes.removed]).toEqual([NO_ITEMS, NO_ITEMS])
  })

  test('a section moved to a file no record names is removed, not kept: file and heading must match too', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const moved = await repoPart('P1', 'Git', GIT_SECTION, 'AGENTS.md')
    const changes = partChanges({ parts: [partRecordOf(git)], memories: [] }, { parts: [moved], memories: [] })

    expect(moved.hash).toBe(git.hash)
    expect(changes).toEqual({
      kept: NO_ITEMS,
      changed: NO_ITEMS,
      added: NO_ITEMS,
      removed: { parts: [partRecordOf(git)], memories: [] },
    })
  })

  test('two sections with one heading are matched by hash first, then in order, each record once', async () => {
    const first = await repoPart('P1', 'Notes', '## Notes\nOne.\n')
    const second = await repoPart('P2', 'Notes', '## Notes\nTwo.\n')
    const firstEdited = await repoPart('P2', 'Notes', '## Notes\nOne, edited.\n')
    const third = await repoPart('P3', 'Notes', '## Notes\nThree.\n')
    const stored = { parts: [partRecordOf(first), partRecordOf(second)], memories: [] }
    const swapped = partChanges(stored, { parts: [second, firstEdited], memories: [] })
    const grown = partChanges(stored, { parts: [first, second, third], memories: [] })

    expect([swapped.kept.parts, swapped.changed.parts, swapped.removed.parts]).toEqual([[second], [firstEdited], []])
    expect([grown.kept.parts, grown.added.parts, grown.removed.parts]).toEqual([[first, second], [third], []])
  })

  test('memories by file and hash: kept, changed and removed; a memory no record names is never added', async () => {
    const squad = await hashedMemory('M1', 'squad.md', 'Unsigned commits on per-phase branches.')
    const flow = await hashedMemory('M2', 'workflow.md', 'Plan, then run.')
    const flowEdited = await hashedMemory('M2', 'workflow.md', 'Plan, run, then verify.')
    const unnamed = await hashedMemory('M3', 'extra.md', 'Not handed out.')
    const gone = { file: 'gone.md', hash: 'c'.repeat(64) }
    const stored = { parts: [], memories: [memoryRecordOf(squad), memoryRecordOf(flow), gone] }

    expect(partChanges(stored, { parts: [], memories: [squad, flowEdited, unnamed] })).toEqual({
      kept: { parts: [], memories: [squad] },
      changed: { parts: [], memories: [flowEdited] },
      added: NO_ITEMS,
      removed: { parts: [], memories: [gone] },
    })
  })

  test('parts and memories are compared in one call, and neither input is changed', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const squad = await hashedMemory('M1', 'squad.md', 'Unsigned commits on per-phase branches.')
    const stored = { parts: [partRecordOf(git)], memories: [memoryRecordOf(squad)] }
    const current = { parts: [tests, git], memories: [squad] }
    const before = JSON.stringify([stored, current])
    const changes = partChanges(stored, current)

    expect(changes.kept).toEqual({ parts: [git], memories: [squad] })
    expect(changes.added).toEqual({ parts: [tests], memories: [] })
    expect(JSON.stringify([stored, current])).toBe(before)
  })
})
