import { describe, expect, test } from 'claude-code/testing'

import { classifyFile } from './classify'

/** What classifyFile takes for the disk. */
type DiskSeen = Parameters<typeof classifyFile>[2]

const ABSENT: DiskSeen = { state: 'absent' }
const UNKNOWN: DiskSeen = { state: 'unknown' }

function present(hash: string): DiskSeen {
  return { state: 'present', hash }
}

describe('classifyFile', () => {
  test('a file that is not on disk is created, with or without a manifest entry', () => {
    expect(classifyFile('new', null, ABSENT)).toBe('create')
    expect(classifyFile('new', 'old', ABSENT)).toBe('create')
  })

  test('a file that already holds the desired content is left, whatever the manifest says', () => {
    expect(classifyFile('new', null, present('new'))).toBe('leave')
    expect(classifyFile('new', 'old', present('new'))).toBe('leave')
    expect(classifyFile('new', 'new', present('new'))).toBe('leave')
  })

  test('a file that still holds what the manifest recorded, while the desired content differs, is changed', () => {
    expect(classifyFile('new', 'old', present('old'))).toBe('change')
  })

  test('a file that matches neither the desired content nor the manifest is a conflict', () => {
    expect(classifyFile('new', 'old', present('edited'))).toBe('conflict')
  })

  test('a file with no manifest entry whose content differs is a conflict', () => {
    expect(classifyFile('new', null, present('edited'))).toBe('conflict')
  })

  test('a file that could not be read is a conflict, never absent or equal', () => {
    expect(classifyFile('new', null, UNKNOWN)).toBe('conflict')
    expect(classifyFile('new', 'old', UNKNOWN)).toBe('conflict')
    expect(classifyFile('new', 'new', UNKNOWN)).toBe('conflict')
  })
})
