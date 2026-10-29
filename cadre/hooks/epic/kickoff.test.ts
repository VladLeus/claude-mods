import { describe, expect, test } from 'claude-code/testing'

import { ROLE_LINE_MAX } from '../generate/kickoff'
import { templateRole } from '../testkit'
import { epicKickoffText } from './kickoff'

/** The quoted role line of a kickoff: what lies between its first and its last double quote. */
function kickoffLine(kickoff: string): string {
  return kickoff.slice(kickoff.indexOf('"') + 1, kickoff.lastIndexOf('"'))
}

describe('the epic kickoff of each role (D-158 to D-160)', () => {
  test('a kickoff line is at most ROLE_LINE_MAX with the whole key, and keeps its end when it fits', () => {
    const key = 'K'.repeat(32)
    const title = 'T'.repeat(200)
    const linesOf = (size: number) => {
      const pm = templateRole('pm', { id: 'p'.repeat(size) })
      const tl = templateRole('tl', { id: 't'.repeat(size), title })
      const input = { key, title, tlId: tl.id }

      return [
        kickoffLine(epicKickoffText({ ...input, role: pm, isPm: true, parent: null })),
        kickoffLine(epicKickoffText({ ...input, role: tl, isPm: false, parent: pm.id })),
      ]
    }
    const [pmLine, tlLine] = linesOf(2)

    for (const line of [...linesOf(2), ...linesOf(24)]) {
      expect(line.length <= ROLE_LINE_MAX).toBe(true)
      expect(line).toContain(key)
    }
    // With 2-character ids each line with no title fits, so the title is cut and the instruction stays whole.
    expect(pmLine?.endsWith('ticket by ticket.')).toBe(true)
    expect(tlLine?.endsWith('what it sends.')).toBe(true)
  })
})
