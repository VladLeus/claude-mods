import { describe, expect, test } from 'claude-code/testing'

import { isRecordedPartFile } from './records'

describe('safety net: isRecordedPartFile (A8)', () => {
  test('isRecordedPartFile: a clean .md path below the root is taken; any other path is not', () => {
    expect(['CLAUDE.md', 'docs/guide.md', '.claude/rules/x.md'].map(isRecordedPartFile)).toEqual([true, true, true])
    const refused = ['/repo/CLAUDE.md', '../CLAUDE.md', 'docs/./a.md', 'a//b.md', '.GIT/x.md', 'notes.txt', 'a.MD']
    expect(refused.map(isRecordedPartFile)).toEqual(refused.map(() => false))
    expect(isRecordedPartFile(`a${String.fromCodePoint(0x202e)}.md`)).toBe(false)
  })
})
