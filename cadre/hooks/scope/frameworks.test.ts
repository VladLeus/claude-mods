import { describe, expect, test } from 'claude-code/testing'

import { runnableFrameworks } from './frameworks'

describe('runnableFrameworks', () => {
  test('a role not on none runs its default first, then every other supported framework the repo records', () => {
    expect(runnableFrameworks({ framework: 'gsd', alsoRuns: ['gsd', 'superpowers', 'none'] })).toEqual([
      'gsd',
      'superpowers',
    ])
    expect(runnableFrameworks({ framework: 'superpowers', alsoRuns: ['gsd', 'superpowers'] })).toEqual([
      'superpowers',
      'gsd',
    ])
  })

  test('a role on none stays on none alone, whatever the repo records', () => {
    expect(runnableFrameworks({ framework: 'none', alsoRuns: ['gsd', 'superpowers'] })).toEqual(['none'])
  })

  test('with nothing recorded a role runs only its own framework, once', () => {
    expect(runnableFrameworks({ framework: 'gsd' })).toEqual(['gsd'])
    expect(runnableFrameworks({ framework: 'gsd', alsoRuns: [] })).toEqual(['gsd'])
    expect(runnableFrameworks({ framework: 'gsd', alsoRuns: ['gsd', 'gsd'] })).toEqual(['gsd'])
  })
})
