import { describe, expect, test } from 'claude-code/testing'

import type { EpicRecord, HostIo } from '../../types'
import { hostWorld, memHost, memIo, memWorld, RECORD } from '../testkit'
import { GIT_DIR_ARGV } from './git'
import { epicRecordPath, epicRecordText, isSafeRelPath, parseEpicRecord, readEpicRecord } from './record'

describe('the epic record (D-164)', () => {
  test('parseEpicRecord reads back what epicRecordText wrote and refuses a bad shape or an unsafe path', () => {
    const record: EpicRecord = { ...RECORD, links: ['node_modules', '.claude/settings.local.json'], copies: ['.envrc'] }
    const bad = (over: Readonly<Record<string, unknown>>) => parseEpicRecord(JSON.stringify({ ...record, ...over }))

    expect(parseEpicRecord(epicRecordText(record))).toEqual(record)
    expect([bad({ title: undefined }), bad({ schema: 2 }), bad({ branch: 'epic/other' })]).toEqual([null, null, null])
    for (const path of ['/etc/x', '', 'a/../b', '..', 'a//b', 'a/']) {
      expect([path, bad({ links: [path] }), bad({ copies: [path] })]).toEqual([path, null, null])
    }
  })
})

describe('safety net: epic helpers (A8)', () => {
  test('isSafeRelPath: a relative path with no empty, . or .. segment; any other path is refused', () => {
    expect(['node_modules', '.cadre/bin/pm', 'a/.b/c..d'].map(isSafeRelPath)).toEqual([true, true, true])
    const refused = ['', '/repo/x', '../x', 'a/../b', 'a/./b', 'a//b', 'a/', '.', '..']
    expect(refused.map(isSafeRelPath)).toEqual(refused.map(() => false))
  })
})

describe('readEpicRecord (SHOULD 3)', () => {
  test('a relative git dir gives null and reads nothing; an absolute one reads the record', async () => {
    const path = '/repo/.claude/worktrees/proj-1'
    const gitDir = '/repo/.git/worktrees/proj-1'
    const world = memWorld({ files: { [epicRecordPath(gitDir)]: epicRecordText(RECORD) } })
    const named = (stdout: string): HostIo =>
      memHost(hostWorld({ runs: [{ argv: GIT_DIR_ARGV(path), result: { exitCode: 0, stdout, stderr: '' } }] })).io
    const relative = memIo(world, {})
    const absolute = memIo(world, {})

    expect(await readEpicRecord(relative.io, named('.git/worktrees/proj-1\n'), path)).toBeNull()
    expect(relative.reads).toEqual([])
    expect(await readEpicRecord(absolute.io, named(`${gitDir}\n`), path)).toEqual(RECORD)
  })
})
