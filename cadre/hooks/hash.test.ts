import { describe, expect, test } from 'claude-code/testing'

import { sha256Hex } from './hash'

describe('sha256Hex', () => {
  test('hashes the empty text to the known SHA-256 of nothing', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  test("hashes 'abc' to the known SHA-256 test vector", async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('hashes a sentence longer than one block of input to its known SHA-256', async () => {
    const hash = await sha256Hex('The quick brown fox jumps over the lazy dog')

    expect(hash).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592')
  })

  test('hashes the UTF-8 bytes of a character, whatever its length in UTF-16 units', async () => {
    // Two bytes, three bytes and four bytes in UTF-8; the last is two UTF-16 units.
    expect(await sha256Hex(String.fromCodePoint(0xe9))).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    )
    expect(await sha256Hex(String.fromCodePoint(0x20ac))).toBe(
      'c4cc90ed3d26f12d4b08a75140970a7904035c31cbb4515a83f19b9003c00d1d',
    )
    expect(await sha256Hex(String.fromCodePoint(0x1f600))).toBe(
      'f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9',
    )
  })

  test('gives 64 lowercase hex characters', async () => {
    expect(await sha256Hex('any text at all')).toMatch(/^[0-9a-f]{64}$/)
  })

  test('gives the same hash for the same text and another for text that differs by one newline', async () => {
    const first = await sha256Hex('{}\n')

    expect(await sha256Hex('{}\n')).toBe(first)
    expect(await sha256Hex('{}')).not.toBe(first)
  })
})
