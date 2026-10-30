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

  test('a secret-like span of a changed line is hidden in the shown diff only; counts and diff stay (E1)', () => {
    const mine = '{\n  "env": {\n    "API_KEY": "sk-FAKE-SECRET-0123456789"\n  }\n}\n'
    const diff = lineDiff(mine, '{\n  "env": {}\n}\n')
    expect(conflictContext('.cadre/be/.claude/settings.json', diff).lines).toEqual([
      'Take new: 1 line added, 3 removed',
      '-   "env": {',
      '-     "API_KEY": [hidden]',
      '-   }',
      '+   "env": {}',
    ])
    expect(diff.rows.map(row => row.line)).toContain('    "API_KEY": "sk-FAKE-SECRET-0123456789"')
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
