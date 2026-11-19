import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logShim } from '../../lib/shims.ts'

// fail exits 1, noop exits 0, and stage-gsd leaves what proves a GSD install to cadre in the folder it runs in.
export type NpxMode = 'fail' | 'noop' | 'stage-gsd'

const GSD_DIR = '.claude/gsd-core'
const GSD_VERSION = '0.0.0-e2e'
const GSD_IDENTITY_LINES: readonly string[] = [
  'const packageName = "@opengsd/gsd-core";',
  'module.exports = { packageName };',
]

function quoted(text: string): string {
  return `'${text}'`
}

const NPX_BEHAVIOUR: Readonly<Record<NpxMode, readonly string[]>> = {
  fail: ['exit 1'],
  noop: ['exit 0'],
  'stage-gsd': [
    `mkdir -p ${GSD_DIR}/bin/lib || exit 1`,
    `printf '%s\\n' ${quoted(GSD_VERSION)} > ${GSD_DIR}/VERSION || exit 1`,
    `printf '%s\\n' ${GSD_IDENTITY_LINES.map(quoted).join(' ')} > ${GSD_DIR}/bin/lib/package-identity.cjs || exit 1`,
    'exit 0',
  ],
}

// An npx first on the PATH of the root claude: it logs each call like logShim, then does what `mode` says.
export async function npxShim(dir: string, mode: NpxMode, logFile: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const behaviour = join(dir, `npx-${mode}`)
  await writeFile(behaviour, ['#!/bin/sh', ...NPX_BEHAVIOUR[mode], ''].join('\n'))
  await chmod(behaviour, 0o755)

  return logShim(dir, 'npx', behaviour, logFile, [])
}
