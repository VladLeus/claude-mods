import { describe, expect, test } from 'claude-code/testing'

import type { HostRun } from '../../types'
import { envFilesOf, TRACKED_ENV_ARGV } from './env-files'

/** The object id `ls-files -s` prints for each entry here. */
const OBJECT = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'

/** A run that exits 0 with one `ls-files -z -s` entry of `mode` for each path, at stage 0, each ended by NUL. */
function listed(mode: string, ...paths: string[]): HostRun {
  return { exitCode: 0, stdout: paths.map(path => `${mode} ${OBJECT} 0\t${path}\0`).join(''), stderr: '' }
}

/** A run that exits 0 with these raw entries, each ended by NUL. */
function raw(...entries: string[]): HostRun {
  return { exitCode: 0, stdout: entries.map(entry => `${entry}\0`).join(''), stderr: '' }
}

describe('the env files git tracks', () => {
  test('TRACKED_ENV_ARGV lists, NUL-ended with mode and stage, the tracked .env and .env.* files at any depth', () => {
    expect(TRACKED_ENV_ARGV('/r')).toEqual([
      'git',
      '-C',
      '/r',
      'ls-files',
      '-z',
      '-s',
      '--',
      ':(glob)**/.env',
      ':(glob)**/.env.*',
    ])
  })

  test('a rejected run or a run that exits non-zero gives null', () => {
    expect(envFilesOf(null)).toBeNull()
    expect(envFilesOf({ exitCode: 128, stdout: listed('100644', '.env.test').stdout, stderr: 'fatal' })).toBeNull()
  })

  test('the regular files of mode 100644 or 100755 git gives, by path, sorted and once each', () => {
    const plain = listed('100644', 'web/.env.local', '.env.test', '.env', '.env.test')
    const both: HostRun = { ...plain, stdout: `${plain.stdout}${listed('100755', '.env.ci').stdout}` }

    expect(envFilesOf(plain)).toEqual(['.env', '.env.test', 'web/.env.local'])
    expect(envFilesOf(both)).toEqual(['.env', '.env.ci', '.env.test', 'web/.env.local'])
    expect(envFilesOf(raw(`100644 ${OBJECT} 2\t.env.test`, `100644 ${OBJECT} 3\t.env.test`))).toEqual(['.env.test'])
  })

  test('a tracked link (120000) or a submodule (160000) is dropped', () => {
    expect(envFilesOf(listed('120000', '.env.test', 'web/.env'))).toEqual([])
    expect(envFilesOf(listed('160000', '.env.test'))).toEqual([])
  })

  test('an entry that is not mode, object, stage, tab and path is dropped', () => {
    const malformed = [
      '.env.test',
      `100644 ${OBJECT} 0 .env.test`,
      `100644 ${OBJECT}\t.env.test`,
      `100644 xyz 0\t.env.test`,
      `100644 ${OBJECT} 4\t.env.test`,
      `10064 ${OBJECT} 0\t.env.test`,
      `100644 ${OBJECT} 0\t`,
      '',
    ]

    expect(malformed.map(entry => envFilesOf(raw(entry)))).toEqual(malformed.map(() => []))
  })

  test('a path whose last segment is neither .env nor starts with .env. is dropped', () => {
    expect(envFilesOf(listed('100644', '.envrc', 'x.env', '.env-local', 'web/.envrc', '.env/x'))).toEqual([])
  })

  test('a path with a character outside letters, digits, dot, dash and underscore in any segment is dropped', () => {
    const dropped = [
      '.env.\\l\\o\\c\\a\\l',
      '.env.@(local)',
      '.env.!(x)',
      '.env.a b',
      '.env.~',
      '.env.*',
      '.env.?',
      'web/[x]/.env',
      '{a,b}/.env',
      'web+app/.env',
      `.env.${String.fromCharCode(7)}`,
      `web${String.fromCharCode(0x85)}/.env`,
      `.env.caf${String.fromCharCode(0xe9)}`,
    ]

    expect(dropped.map(path => envFilesOf(listed('100644', path)))).toEqual(dropped.map(() => []))
    expect(envFilesOf(listed('100644', ...dropped, '.env.test'))).toEqual(['.env.test'])
  })

  test('a path with an empty, . or .. segment, or a leading /, is dropped', () => {
    const dropped = ['../.env', 'web/../.env', './.env', 'web/./.env', 'web//.env', '/.env', '/web/.env']

    expect(dropped.map(path => envFilesOf(listed('100644', path)))).toEqual(dropped.map(() => []))
  })
})
