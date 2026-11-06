/**
 * The regen part changes, a layer 10 module: how regen tells kept, changed, added and removed instruction parts and
 * memories apart by their hashes, against the records a role holds (G-02-1f Regen, AUTO-PICK #19 Q1). It imports only
 * the types, so the regen side read and hand-out read it here.
 */
import type { InstructionPart, InstructionPartRecord, MemoryItem } from '../../types'

/** A part as a role's records name it (G-02-1f Regen): its file, its heading and the SHA-256 of its text. */
export type PartRecord = InstructionPartRecord

/** A memory as a role's records name it (G-02-1f Regen): its file and the SHA-256 of its text. */
export type MemoryRecord = Pick<MemoryItem, 'file' | 'hash'>

/** Parts and memories as regen reads them again from the files a role's records name (G-02-1f Regen, D-142 rg2-a). */
export type RegenItems = {
  readonly parts: readonly InstructionPart[]
  readonly memories: readonly MemoryItem[]
}

/** The records of a role's parts and memories (G-02-1f Regen). */
export type RegenRecords = {
  readonly parts: readonly PartRecord[]
  readonly memories: readonly MemoryRecord[]
}

/**
 * What changed in a role's parts and memories since they were recorded (G-02-1f Regen): `kept`, `changed` and `added`
 * hold the items as they are now, in the order given; `removed` holds the records no current item matches, in record
 * order.
 */
export type PartChanges = {
  readonly kept: RegenItems
  readonly changed: RegenItems
  readonly added: RegenItems
  readonly removed: RegenRecords
}

/** A part or a memory, or a record of one: what partChanges matches by. */
type Hashed = { readonly file: string; readonly hash: string }

/** One kind of item matched against its records (matchedItems). */
type Matched<T, R> = {
  readonly kept: T[]
  readonly changed: T[]
  readonly added: T[]
  readonly removed: R[]
}

/**
 * Items matched against records (G-02-1f Regen), each record used once: an item with a record that `isSame` names and
 * that has its hash is kept; then, in item order, one with a record `isSame` names and another hash is changed; an item
 * left over whose file a record names is added, and a record left over is removed. Matching the hash first keeps two
 * sections under one heading apart.
 */
function matchedItems<T extends Hashed, R extends Hashed>(
  items: readonly T[],
  records: readonly R[],
  isSame: (record: R, item: T) => boolean,
): Matched<T, R> {
  const unused = [...records]
  const take = (isMatch: (record: R) => boolean): boolean => {
    const at = unused.findIndex(isMatch)
    if (at < 0) return false
    unused.splice(at, 1)

    return true
  }
  // Both passes run in item order and use each record once, so they are kept as flags by index.
  const isKept = items.map(item => take(record => isSame(record, item) && record.hash === item.hash))
  const isChanged = items.map((item, index) => isKept[index] !== true && take(record => isSame(record, item)))
  const isLeft = (index: number): boolean => isKept[index] !== true && isChanged[index] !== true
  const named = new Set(records.map(record => record.file))

  return {
    kept: items.filter((_, index) => isKept[index] === true),
    changed: items.filter((_, index) => isChanged[index] === true),
    added: items.filter((item, index) => isLeft(index) && named.has(item.file)),
    removed: unused,
  }
}

/**
 * How a role's parts and memories changed since they were recorded (G-02-1f Regen; pure). A recorded part whose file
 * and heading match a current part with the same hash is kept; same file and heading with another hash is changed; a
 * current part with no record left to match, in a file the records name, is added; a record no current part matches is
 * removed, so a section moved to another file is removed and, when the records name that file, added. The same for
 * memories by file and hash: a memory is its own file, so one no record names is never added; only /cadre init finds a
 * new file (D-142 rg2-a). Neither input is changed.
 */
export function partChanges(stored: RegenRecords, current: RegenItems): PartChanges {
  const isSamePart = (record: PartRecord, part: InstructionPart): boolean =>
    record.file === part.file && record.heading === part.heading
  const parts = matchedItems(current.parts, stored.parts, isSamePart)
  const memories = matchedItems(current.memories, stored.memories, (record, memory) => record.file === memory.file)

  return {
    kept: { parts: parts.kept, memories: memories.kept },
    changed: { parts: parts.changed, memories: memories.changed },
    added: { parts: parts.added, memories: memories.added },
    removed: { parts: parts.removed, memories: memories.removed },
  }
}
