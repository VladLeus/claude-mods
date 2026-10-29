import { describe, expect, test } from 'claude-code/testing'

import { templateRole } from '../testkit'
import { epicParentOf } from './pick'

describe('the epic kickoff of each role (D-158 to D-160)', () => {
  test('TL waits for PM, every other role for TL, or for PM when the team has no TL (D-159)', () => {
    const team = [templateRole('pm'), templateRole('tl'), templateRole('be'), templateRole('qa')]
    const small = [templateRole('pm'), templateRole('be')]
    const led = [templateRole('pm'), templateRole('tl', { id: 'lead' }), templateRole('be')]

    expect(team.map(role => epicParentOf(role, team, 'pm'))).toEqual([null, 'pm', 'tl', 'tl'])
    expect(small.map(role => epicParentOf(role, small, 'pm'))).toEqual([null, 'pm'])
    expect(led.map(role => epicParentOf(role, led, 'pm'))).toEqual([null, 'pm', 'lead'])
  })
})
