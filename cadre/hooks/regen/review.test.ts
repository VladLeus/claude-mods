import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart } from '../../types'
import { memory } from '../testkit'
import { regenPartContext } from './review'
import type { RegenAsk } from './review'

/** A part of the repo's CLAUDE.md: the Git section. */
const GIT_PART: InstructionPart = {
  id: 'P2',
  file: 'CLAUDE.md',
  heading: 'Git',
  source: 'repo',
  text: '## Git\nUse signed commits.\n',
  hash: 'b'.repeat(64),
}

describe('regen question context (D-236)', () => {
  test('a regen question carries what changed in that part: where it is, new or changed, the recommendation', () => {
    const changed = { kind: 'part', part: GIT_PART, change: 'changed' } satisfies RegenAsk
    expect(regenPartContext(changed, true, { position: 1, count: 2 })).toEqual({
      title: 'Regen 1 of 2',
      lines: ['CLAUDE.md > Git', 'Changed since init.', 'Recommended: yes'],
      kind: 'regen-part',
    })
    const top = { ...GIT_PART, heading: '' }
    const added = { kind: 'part', part: top, change: 'new' } satisfies RegenAsk
    expect(regenPartContext(added, false, { position: 2, count: 2 }).lines).toEqual([
      'CLAUDE.md > (top of file)',
      'New since init.',
      'Recommended: no',
    ])
  })

  test('a memory names its file and its summary, never its folder or text; a cleaned file name (T-02.1-71)', () => {
    const bidi = String.fromCodePoint(0x202e)
    const squad = memory('M1', `squad${bidi}.md`, 'Unsigned commits.')
    const item = { kind: 'memory', memory: squad, change: 'changed' } satisfies RegenAsk
    const context = regenPartContext(item, false, { position: 1, count: 1 })
    expect(context).toEqual({
      title: 'Regen 1 of 1',
      lines: ['memory squad.md: Unsigned commits.', 'Changed since init.', 'Recommended: no'],
      kind: 'regen-part',
    })
    expect(context.lines.join('\n')).not.toContain(squad.folder)
  })
})
