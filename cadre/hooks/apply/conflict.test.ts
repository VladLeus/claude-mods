import { describe, expect, test } from 'claude-code/testing'

import { lineDiff } from '../ui/diff'
import { conflictContext } from './conflict'

describe('conflict question context (D-236)', () => {
  test("a conflict question carries the diff of that file: Take new's line counts, then the changed lines", () => {
    expect(conflictContext('.cadre/be/ROLE.md', lineDiff('edited by hand\n', 'new text\nmore\n'))).toEqual({
      title: 'Conflict: .cadre/be/ROLE.md',
      lines: ['Take new: 2 lines added, 1 removed', '- edited by hand', '+ new text', '+ more'],
      kind: 'conflict-diff',
    })
  })

  test('a file cadre could not read says so; the path is cleaned (T-02.1-71)', () => {
    const bidi = String.fromCodePoint(0x202e)
    expect(conflictContext(`.cadre/be/RO${bidi}LE.md`, null)).toEqual({
      title: 'Conflict: .cadre/be/ROLE.md',
      lines: ['Your version could not be read, so no diff is shown.'],
      kind: 'conflict-diff',
    })
  })
})
