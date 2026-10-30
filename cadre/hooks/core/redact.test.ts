import { describe, expect, test } from 'claude-code/testing'

import { leaks, SECRET_FIXTURES } from '../testkit'
import { REDACTED, redactSecrets } from './redact'

/** A base64-like run of exactly 40 characters with digits and letters of both cases. */
const BASE64_RUN = 'QWxhZGRpbjpvcGVuIHNlc2FtZQ0123456789abcd'

/** A hex run of exactly 32 characters. */
const HEX_RUN = '0123456789abcdef0123456789ABCDEF'

/** A fake JWT ({"alg":"HS256"}, {}, no real signature), joined at runtime so secret scanners do not flag the source. */
const FAKE_JWT = ['eyJhbGciOiJIUzI1NiJ9', 'e30', 'abc123'].join('.')

/** A fake Anthropic-style key, joined at runtime for the same reason. */
const FAKE_ANT_KEY = ['sk', 'ant', 'api03', 'AbCdEf0123456789xyz'].join('-')

describe('redactSecrets (E1)', () => {
  test('a Bearer token is hidden and the scheme word kept, in any case', () => {
    expect(redactSecrets('Calls Jira with Bearer FAKE-TOKEN-0123 set.')).toBe('Calls Jira with Bearer [hidden] set.')
    const header = `Authorization: bearer ${FAKE_JWT}`
    expect(redactSecrets(header)).toBe('Authorization: bearer [hidden]')
  })

  test('an sk- API key is hidden', () => {
    expect(redactSecrets('Key sk-FAKE-SECRET-0123456789 here')).toBe('Key [hidden] here')
    expect(redactSecrets(FAKE_ANT_KEY)).toBe(REDACTED)
  })

  test('a GitHub token of each kind is hidden', () => {
    const tokens = ['ghp', 'gho', 'ghu', 'ghs', 'ghr'].map(kind => `${kind}_FAKEFAKEFAKEFAKEFAKE`)
    expect(tokens.map(redactSecrets)).toEqual(tokens.map(() => REDACTED))
    expect(redactSecrets('--key ghp_FAKEFAKEFAKEFAKEFAKE')).toBe('--key [hidden]')
  })

  test('a Slack token of each kind is hidden', () => {
    const tokens = ['xoxa', 'xoxb', 'xoxp', 'xoxr', 'xoxs'].map(kind => `${kind}-1234567890-abcdef`)
    expect(tokens.map(redactSecrets)).toEqual(tokens.map(() => REDACTED))
  })

  test('an AWS access key id is hidden', () => {
    expect(redactSecrets('aws AKIAIOSFODNN7EXAMPLE key')).toBe('aws [hidden] key')
  })

  test('a value named as a key, token, secret or password is hidden after = or :, the name kept', () => {
    expect(redactSecrets('API_KEY=abc')).toBe('API_KEY=[hidden]')
    expect(redactSecrets('SECRET=SENTINEL_SECRET_VALUE node guard.js')).toBe('SECRET=[hidden] node guard.js')
    expect(redactSecrets('password: hunter2.')).toBe('password: [hidden].')
    expect(redactSecrets('{"client_secret": "s3cr3t value"}')).toBe('{"client_secret": [hidden]}')
    expect(redactSecrets('x-api-token:abcdefghijklmnop')).toBe('x-api-token:[hidden]')
  })

  test('a hex run of 32 or more characters is hidden; a shorter one is kept', () => {
    expect(redactSecrets(`sha ${HEX_RUN}`)).toBe('sha [hidden]')
    expect(redactSecrets(`commit ${HEX_RUN.slice(1)}`)).toBe(`commit ${HEX_RUN.slice(1)}`)
  })

  test('a base64-like run of 40 or more characters with digits and both cases is hidden; a shorter one is kept', () => {
    expect(redactSecrets(`blob ${BASE64_RUN}== end`)).toBe('blob [hidden] end')
    expect(redactSecrets(`blob ${BASE64_RUN.slice(1)}`)).toBe(`blob ${BASE64_RUN.slice(1)}`)
  })

  test('ordinary skill descriptions are kept as they are', () => {
    const ordinary = [
      'Delegate investigation, an explicit fix request, or follow-up rescue work to the Codex rescue subagent',
      'Use when the user wants to customize keyboard shortcuts, rebind keys, or modify ~/.claude/keybindings.json.',
      'Sends a bearer token from your settings with each call.',
      'Manage your API keys: create, rotate and revoke them; password: never stored.',
      'Summarize docs/superpowers/specs/design/notes/overview/history files and commit 3f2a9c1.',
      'No description.',
    ]
    expect(ordinary.map(redactSecrets)).toEqual(ordinary)
  })

  test('each fake secret of SECRET_FIXTURES is hidden as the fixtures set it, and hiding twice changes nothing', () => {
    const [apiKey, bearer, token, sentinel] = SECRET_FIXTURES
    const hidden = redactSecrets(`${apiKey} ${bearer} --key ${token} SECRET=${sentinel}`)
    expect(hidden).toBe('[hidden] Bearer [hidden] --key [hidden] SECRET=[hidden]')
    expect(leaks(hidden, SECRET_FIXTURES)).toEqual([])
    expect(redactSecrets(hidden)).toBe(hidden)
  })
})
