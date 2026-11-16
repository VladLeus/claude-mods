import { describe, expect, test } from 'claude-code/testing'

import type { HostRun } from '../../types'
import { envFilesOf, TRACKED_ENV_ARGV } from './env-files'

/** A run that exits 0 with these names, each ended by NUL as `ls-files -z` ends it. */
function listed(...names: string[]): HostRun {
  return { exitCode: 0, stdout: names.map(name => `${name}\0`).join(''), stderr: '' }
}

describe('the env files git tracks', () => {
  test('TRACKED_ENV_ARGV lists, NUL-ended, the tracked .env and .env.* files at any depth of the root', () => {
    expect(TRACKED_ENV_ARGV('/r')).toEqual([
      'git',
      '-C',
      '/r',
      'ls-files',
      '-z',
      '--',
      ':(glob)**/.env',
      ':(glob)**/.env.*',
    ])
  })

  test('a rejected run or a run that exits non-zero gives null', () => {
    expect(envFilesOf(null)).toBeNull()
    expect(envFilesOf({ exitCode: 128, stdout: '.env.test\0', stderr: 'fatal' })).toBeNull()
  })

  test('the names git gives, sorted', () => {
    expect(envFilesOf(listed('.env', '.env.test', 'web/.env.local'))).toEqual(['.env', '.env.test', 'web/.env.local'])
    expect(envFilesOf(listed('web/.env.local', '.env.test', '.env'))).toEqual(['.env', '.env.test', 'web/.env.local'])
  })

  test('a name not .env or .env.*, with a glob or control character, or a .. or empty segment is dropped', () => {
    const dropped = [
      '.envrc',
      'x.env',
      'a*/.env',
      '.env.?',
      'web/[x]/.env',
      '{a,b}/.env',
      `.env.${String.fromCharCode(7)}`,
      `web${String.fromCharCode(0x85)}/.env`,
      '../.env',
      'web/../.env',
      'web//.env',
      '/.env',
      '',
    ]

    expect(dropped.map(name => envFilesOf(listed(name)))).toEqual(dropped.map(() => []))
    expect(envFilesOf(listed(...dropped, '.env.test'))).toEqual(['.env.test'])
  })
})
