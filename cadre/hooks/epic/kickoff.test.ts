import { describe, expect, test } from 'claude-code/testing'

import { KICKOFF_LOAD_TOOLS, ROLE_LINE_MAX } from '../generate/kickoff'
import { TEMPLATE_ROLES, templateRole } from '../testkit'
import { epicKickoffText } from './kickoff'

/** The start of the wait every role but PM is told to make before it reads its inbox. */
const WAIT = 'wait_for reason idle-inbox '

const LOAD_TOOLS_END = ` ${KICKOFF_LOAD_TOOLS}`

/** The quoted role line of a kickoff: what lies between its first and its last double quote. */
function kickoffLine(kickoff: string): string {
  return kickoff.slice(kickoff.indexOf('"') + 1, kickoff.lastIndexOf('"'))
}

/** The part of an epic line kept within ROLE_LINE_MAX: the line without its trailing tool load sentence. */
function budgetedPart(line: string): string {
  if (!line.endsWith(LOAD_TOOLS_END)) return line

  return line.slice(0, -LOAD_TOOLS_END.length)
}

describe('the epic kickoff of each role (D-158 to D-160)', () => {
  test("a line's budgeted part is at most ROLE_LINE_MAX with the whole key, and keeps its end when it fits", () => {
    const key = 'K'.repeat(32)
    const title = 'T'.repeat(200)
    const linesOf = (size: number) => {
      const pm = templateRole('pm', { id: 'p'.repeat(size) })
      const tl = templateRole('tl', { id: 't'.repeat(size), title })
      const be = templateRole('be', { id: 'b'.repeat(size), title })
      const input = { key, title, tlId: tl.id }

      return [
        kickoffLine(epicKickoffText({ ...input, role: pm, isPm: true, parent: null })),
        kickoffLine(epicKickoffText({ ...input, role: tl, isPm: false, parent: pm.id })),
        kickoffLine(epicKickoffText({ ...input, role: be, isPm: false, parent: tl.id })),
      ]
    }
    const [pmLine, tlLine, beLine] = linesOf(2).map(budgetedPart)

    for (const line of [...linesOf(2), ...linesOf(24)]) {
      expect(budgetedPart(line).length <= ROLE_LINE_MAX).toBe(true)
      expect(line).toContain(key)
    }
    // With 2-character ids each line with no title fits, so the title is cut and the instruction stays whole.
    expect(pmLine?.endsWith('ticket by ticket.')).toBe(true)
    expect(tlLine?.endsWith('run the ticket loop in ROLE.md.')).toBe(true)
    expect(beLine?.endsWith('what it sends.')).toBe(true)
  })

  test('PM is told to grill the user, with the grill skill when available, in a line budgeted to ROLE_LINE_MAX', () => {
    const pm = templateRole('pm')
    const { duration, threshold } = pm.autopilot
    const title = 'T'.repeat(300)
    const kickoff = epicKickoffText({ role: pm, key: 'PROJ-1', title, isPm: true, parent: null, tlId: 'tl' })
    const line = kickoffLine(kickoff)

    expect(kickoff).toBe(`/autopilot ${duration} ${threshold} "${line}" --ask-user\n`)
    expect(budgetedPart(line).length <= ROLE_LINE_MAX).toBe(true)
    expect(line).toContain('PROJ-1')
    expect(line).toContain('inbox_read')
    expect(line).toContain('grill the user (mattpocock-skills:grilling when available, else yourself)')
    expect(budgetedPart(line).endsWith('then feed cadre-tl ticket by ticket.')).toBe(true)
  })

  test('a worker waits on the inbox with no timeout and reads it, budgeted to ROLE_LINE_MAX, any title', () => {
    const be = templateRole('be', { title: 'B'.repeat(300) })
    const role = { ...be, autopilot: { ...be.autopilot, askUser: true } }
    const kickoff = epicKickoffText({ role, key: 'PROJ-1', title: 'Epic', isPm: false, parent: 'tl', tlId: 'tl' })
    const line = kickoffLine(kickoff)

    expect(kickoff).not.toContain('--ask-user')
    expect(budgetedPart(line).length <= ROLE_LINE_MAX).toBe(true)
    expect(line).toContain(' on epic PROJ-1. ')
    expect(line).toContain(`${WAIT}from cadre-tl with no timeout, then read your inbox with inbox_read and `)
    expect(line).not.toContain('session-answer')
    expect(budgetedPart(line).endsWith('work what it sends.')).toBe(true)
  })

  test("TL's line waits on the inbox with no timeout from PM, reads it, then names its ROLE.md ticket loop", () => {
    const tl = templateRole('tl')
    const kickoff = epicKickoffText({ role: tl, key: 'PROJ-1', title: 'Epic', isPm: false, parent: 'pm', tlId: 'tl' })
    const line = kickoffLine(kickoff)

    expect(kickoff).not.toContain('--ask-user')
    expect(line).toContain(`${WAIT}from cadre-pm with no timeout, then read your inbox with inbox_read and `)
    expect(line).not.toContain('session-answer')
    expect(budgetedPart(line).endsWith('and run the ticket loop in ROLE.md.')).toBe(true)
  })

  test('every epic line ends with the tool load sentence', () => {
    const input = { key: 'PROJ-1', title: 'Epic', tlId: 'tl' }
    const workers = TEMPLATE_ROLES.filter(role => role.id !== 'pm' && role.id !== 'tl')
    const lines = [
      kickoffLine(epicKickoffText({ ...input, role: templateRole('pm'), isPm: true, parent: null })),
      kickoffLine(epicKickoffText({ ...input, role: templateRole('tl'), isPm: false, parent: 'pm' })),
      ...workers.map(role => kickoffLine(epicKickoffText({ ...input, role, isPm: false, parent: 'tl' }))),
    ]

    expect(lines.filter(line => !line.endsWith(LOAD_TOOLS_END))).toEqual([])
    expect(lines).toHaveLength(TEMPLATE_ROLES.length)
  })
})
