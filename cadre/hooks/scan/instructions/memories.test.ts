import { describe, expect, test } from 'claude-code/testing'

import { sha256Hex } from '../../core/hash'
import { BIDI_OVERRIDE, entry, link, memIo, MEMORY, memWorld } from '../../testkit'
import type { MemWorld } from '../../testkit'
import {
  isMemoryIndexName,
  MEMORY_UNLISTED_WARNING,
  memoryIndex,
  memoryOverSizeWarning,
  NO_MEMORY_SUMMARY,
  readMemories,
} from './memories'
import { readInstructionFiles } from './read'
import type { InstructionSources } from './read'

/** The auto-memory folder of the fixture repo as given through a link, /link/repo. */
const GIVEN_MEMORY = '/home/u/.claude/projects/-link-repo/memory'

/**
 * Where the reader reads in the fixtures: the repo /repo, the home /home/u, no CLAUDE_CONFIG_DIR, this chain, no rule
 * file, no AGENTS.md and no memory folder.
 */
function sourcesOf(chain: readonly string[] = []): InstructionSources {
  return { root: '/repo', home: '/home/u', configDir: null, chain, rules: [], hasAgentsMd: false, memoryFolders: [] }
}

/** A world of the fixture user with these files; `over` changes the other fields it names. */
function filesWorld(files: Readonly<Record<string, string>>, over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ files, ...over })
}

/** The MEMORY.md of the memory cases: an index line for a.md and one for c.md, and a line that is not one. */
const MEMORY_INDEX_TEXT =
  '# Memory\n- [A](a.md) \u2014 the a memory\n- [C](c.md) - the c memory\nSENTINEL_SECRET_VALUE\n'

describe('memoryIndex', () => {
  test('an index line gives its file the summary after an em dash or a hyphen', () => {
    const index = memoryIndex(
      [
        '# Memory index',
        '- [Squad unsigned commits](squad.md) \u2014 squad worktree: unsigned commits on per-phase branches',
        '- [Workflow](workflow.md) - more than 4 sub-agents go through the Workflow tool',
      ].join('\r\n'),
    )
    expect([...index.entries()]).toEqual([
      ['squad.md', 'squad worktree: unsigned commits on per-phase branches'],
      ['workflow.md', 'more than 4 sub-agents go through the Workflow tool'],
    ])
  })

  test('a link line with no summary after it gives its title; any other line is ignored', () => {
    const index = memoryIndex(
      [
        '- [Just a title](title.md)',
        '- [Blank summary](blank.md) \u2014   ',
        'Text with [a link](x.md) \u2014 not an index line',
        '* [Star](star.md) \u2014 another list mark',
        '  - [Nested](nested.md) \u2014 indented',
        '- [](empty.md)',
      ].join('\n'),
    )
    expect([...index.entries()]).toEqual([
      ['title.md', 'Just a title'],
      ['blank.md', 'Blank summary'],
    ])
  })

  test('a summary is cleaned and cut to 160 code points; a file named twice keeps its first line', () => {
    const long = `- [A](a.md) \u2014 Sec${BIDI_OVERRIDE}ret ${'s'.repeat(200)}`
    const index = memoryIndex(`${long}\n- [A again](a.md) - second`)
    expect(index.get('a.md')).toBe(`Secret ${'s'.repeat(152)}\u2026`)
    expect(index.size).toBe(1)
  })
})

describe('readMemories', () => {
  test('MEMORY.md first, then each other .md file once, in name order, with its folder, summary and hash', async () => {
    const run = memIo(
      memWorld({
        dirs: {
          [MEMORY]: [entry('b.md'), entry('MEMORY.md'), entry('a.md')],
          [GIVEN_MEMORY]: [entry('a.md'), entry('c.md')],
        },
        files: {
          [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT,
          [`${MEMORY}/a.md`]: 'text of a',
          [`${MEMORY}/b.md`]: 'text of b',
          [`${GIVEN_MEMORY}/a.md`]: 'another a',
          [`${GIVEN_MEMORY}/c.md`]: 'text of c',
        },
      }),
      [],
    )
    const read = await readMemories(run.io, [MEMORY, GIVEN_MEMORY])
    expect(run.reads).toEqual([`${MEMORY}/MEMORY.md`, `${MEMORY}/a.md`, `${MEMORY}/b.md`, `${GIVEN_MEMORY}/c.md`])
    expect(read.memories).toEqual([
      { id: 'M1', file: 'a.md', folder: MEMORY, summary: 'the a memory', hash: await sha256Hex('text of a') },
      { id: 'M2', file: 'b.md', folder: MEMORY, summary: NO_MEMORY_SUMMARY, hash: await sha256Hex('text of b') },
      { id: 'M3', file: 'c.md', folder: GIVEN_MEMORY, summary: 'the c memory', hash: await sha256Hex('text of c') },
    ])
    expect(read.warnings).toEqual([])
  })

  test('MEMORY.md in another letter case is never offered; the index is read from MEMORY.md alone (N2)', async () => {
    const run = memIo(
      memWorld({
        dirs: { [MEMORY]: [entry('MEMORY.md'), entry('Memory.md'), entry('a.md')] },
        files: {
          [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT,
          [`${MEMORY}/Memory.md`]: '- [A](a.md) \u2014 the wrong index',
          [`${MEMORY}/a.md`]: 'text of a',
        },
      }),
      [],
    )
    const read = await readMemories(run.io, [MEMORY])
    expect(run.reads).toEqual([`${MEMORY}/MEMORY.md`, `${MEMORY}/a.md`])
    expect(read.memories.map(found => [found.file, found.summary])).toEqual([['a.md', 'the a memory']])
    expect(['memory.MD', 'MEMORY.md', 'Memory.md'].map(isMemoryIndexName)).toEqual([true, true, true])
    expect(['a.md', 'MEMORY.md.bak', 'MEMORY'].map(isMemoryIndexName)).toEqual([false, false, false])
  })

  test('with no MEMORY.md every memory gets No summary in MEMORY.md.', async () => {
    const world = memWorld({ dirs: { [MEMORY]: [entry('a.md')] }, files: { [`${MEMORY}/a.md`]: 'text of a' } })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => [found.id, found.file, found.summary])).toEqual([
      ['M1', 'a.md', 'No summary in MEMORY.md.'],
    ])
  })

  test('the text of a memory and of MEMORY.md is never kept: only file, folder, summary and hash', async () => {
    const world = memWorld({
      dirs: { [MEMORY]: [entry('MEMORY.md'), entry('a.md')] },
      files: { [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT, [`${MEMORY}/a.md`]: 'sk-FAKE-SECRET-0123456789' },
    })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => Object.keys(found))).toEqual([['id', 'file', 'folder', 'summary', 'hash']])
    expect(JSON.stringify(read)).not.toContain('SECRET')
  })

  test('a folder that cannot be listed gives the memory folder warning once; a missing folder is quiet', async () => {
    const unknown = memIo(memWorld({ unknownPaths: [MEMORY, GIVEN_MEMORY] }), [])
    expect(await readMemories(unknown.io, [MEMORY, GIVEN_MEMORY])).toEqual({
      memories: [],
      warnings: [MEMORY_UNLISTED_WARNING],
    })
    expect(MEMORY_UNLISTED_WARNING).toBe('could not list the memory folder (treated as unknown)')
    expect(await readMemories(memIo(memWorld({}), []).io, [MEMORY])).toEqual({ memories: [], warnings: [] })
  })

  test('a link, a folder, another extension and a name with a hidden character are no memory', async () => {
    const hidden = `hid${BIDI_OVERRIDE}den.md`
    const world = memWorld({
      dirs: { [MEMORY]: [entry('notes.txt'), entry('sub', 'dir'), link('l.md'), entry(hidden), entry('ok.md')] },
      files: { [`${MEMORY}/ok.md`]: 'ok', [`${MEMORY}/${hidden}`]: 'hidden', [`${MEMORY}/notes.txt`]: 'txt' },
    })
    const run = memIo(world, [])
    const read = await readMemories(run.io, [MEMORY])
    expect(read.memories.map(found => found.file)).toEqual(['ok.md'])
    expect(run.reads).toEqual([`${MEMORY}/ok.md`])
  })

  test('a memory the port cannot read, or one over 256 KiB, is not offered and gets its warning', async () => {
    const world = memWorld({
      dirs: { [MEMORY]: [entry('bad.md'), entry('big.md'), entry('good.md')] },
      files: { [`${MEMORY}/big.md`]: 'x'.repeat(300 * 1024), [`${MEMORY}/good.md`]: 'good' },
      unknownPaths: [`${MEMORY}/bad.md`],
    })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => [found.id, found.file])).toEqual([['M1', 'good.md']])
    expect(read.warnings).toEqual(['could not read bad.md: no role gets it', memoryOverSizeWarning('big.md')])
    expect(memoryOverSizeWarning('big.md')).toBe('big.md is over 256 KiB: not offered')
  })

  test('a MEMORY.md over 256 KiB gives no index and its own warning; the memories are offered (N12)', async () => {
    const world = memWorld({
      dirs: { [MEMORY]: [entry('MEMORY.md'), entry('good.md')] },
      files: { [`${MEMORY}/MEMORY.md`]: 'x'.repeat(300 * 1024), [`${MEMORY}/good.md`]: 'good' },
    })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => [found.id, found.file, found.summary])).toEqual([
      ['M1', 'good.md', NO_MEMORY_SUMMARY],
    ])
    expect(read.warnings).toEqual([memoryOverSizeWarning('MEMORY.md')])
  })

  test('readInstructionFiles reads the memories last, after the docs, and its scan holds them', async () => {
    const run = memIo(
      filesWorld(
        { '/repo/CLAUDE.md': '# R\n', [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT, [`${MEMORY}/a.md`]: 'text of a' },
        { dirs: { [MEMORY]: [entry('MEMORY.md'), entry('a.md')] } },
      ),
      [],
    )
    const sources = { ...sourcesOf(['<repo>/CLAUDE.md']), memoryFolders: [MEMORY] }
    const scan = await readInstructionFiles(run.io, sources)
    expect(run.reads.slice(-3)).toEqual(['/repo/CLAUDE.md', `${MEMORY}/MEMORY.md`, `${MEMORY}/a.md`])
    expect(scan.memories.map(found => [found.id, found.file, found.summary])).toEqual([['M1', 'a.md', 'the a memory']])
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md'])
  })
})
