import { HarnessError } from '../lib/errors.ts'
import type { RowKind, Tier } from '../lib/summary.ts'

export type CassetteSpec = {
  readonly inputs: readonly string[]
  readonly ttlDays?: number
}

export type PartialPart = {
  readonly part: string
  readonly reason: string
}

export type RowEntry = {
  readonly id: string
  readonly half?: 'a' | 'b'
  readonly title: string
  readonly tier: Tier
  readonly fixture: readonly string[]
  readonly kind: RowKind
  readonly file: string
  readonly mac?: string
  readonly net?: boolean
  readonly clipboard?: boolean
  readonly cassette?: CassetteSpec
  readonly partial?: readonly PartialPart[]
}

export const ROWS: readonly RowEntry[] = [
  {
    id: '03#57',
    title: 'Launcher freshness check: whole-second `-nt` (#5 item, decision #37)',
    tier: 'offline',
    fixture: [],
    kind: 'recorded',
    file: 'offline/03-57.test.ts',
  },
]

export function rowEntry(id: string, half?: 'a' | 'b'): RowEntry {
  const entry = ROWS.find(row => row.id === id && row.half === half)
  if (!entry) throw new HarnessError(`no registry entry for ${id}${half ?? ''}`)

  return entry
}
