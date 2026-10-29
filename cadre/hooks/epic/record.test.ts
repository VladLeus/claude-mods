import { describe, expect, test } from 'claude-code/testing'

import type { EpicRecord } from '../../types'
import { epicRecordText, isSafeRelPath, parseEpicRecord } from './record'

/** The branch of that worktree (D-146). */
const BRANCH = 'epic/proj-1-add-retry'

/** The epic record of PROJ-1 Add retry as a new worktree on a branch of `main` writes it. */
const RECORD: EpicRecord = {
  schema: 1,
  key: 'PROJ-1',
  slug: 'proj-1-add-retry',
  title: 'Add retry',
  branch: BRANCH,
  base: 'main',
  createdAt: 1_000_000,
  links: [],
  copies: [],
}

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
