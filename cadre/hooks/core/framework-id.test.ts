import { describe, expect, test } from 'claude-code/testing'

import { repoFrameworks } from './framework-id'

describe('repoFrameworks', () => {
  test('the recorded frameworks when cadre.json lists them, whatever the stored single framework', () => {
    expect(repoFrameworks({ framework: 'gsd', frameworks: ['gsd', 'superpowers'] })).toEqual(['gsd', 'superpowers'])
    expect(repoFrameworks({ framework: null, frameworks: [] })).toEqual([])
  })

  test('with none recorded, the stored single framework when it is a supported one, else none', () => {
    expect(repoFrameworks({ framework: 'gsd' })).toEqual(['gsd'])
    expect(repoFrameworks({ framework: 'superpowers' })).toEqual(['superpowers'])
    expect([repoFrameworks({ framework: null }), repoFrameworks({ framework: 'none' })]).toEqual([[], []])
  })
})
