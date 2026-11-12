export type ScheduledRow = {
  readonly file: string
  readonly roleSession: string | null
}

type Wave = {
  readonly files: string[]
  readonly roles: Set<string>
}

function rolesByFile(rows: readonly ScheduledRow[]): ReadonlyMap<string, ReadonlySet<string>> {
  const byFile = new Map<string, Set<string>>()
  for (const row of rows) {
    const roles = byFile.get(row.file) ?? new Set<string>()
    if (row.roleSession !== null) roles.add(row.roleSession)
    byFile.set(row.file, roles)
  }

  return byFile
}

function newWave(waves: Wave[]): Wave {
  const wave: Wave = { files: [], roles: new Set() }
  waves.push(wave)

  return wave
}

// The test files in the waves they run in: the files of a wave run together, the waves one after another. A file joins
// the first wave that holds no file with a row of one of its role sessions, so those files run one at a time.
export function roleWaves(rows: readonly ScheduledRow[]): readonly (readonly string[])[] {
  const waves: Wave[] = []
  for (const [file, roles] of rolesByFile(rows)) {
    const fits = (wave: Wave): boolean => [...roles].every(role => !wave.roles.has(role))
    const wave = waves.find(fits) ?? newWave(waves)
    wave.files.push(file)
    for (const role of roles) wave.roles.add(role)
  }

  return waves.map(wave => wave.files)
}
