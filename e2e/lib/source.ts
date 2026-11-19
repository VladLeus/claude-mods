import { register } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HarnessError } from './errors.ts'

const REPO_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

let isHookRegistered = false

export async function importSource(path: string): Promise<unknown> {
  if (!isHookRegistered) {
    register('./source-hook.mjs', import.meta.url)
    isHookRegistered = true
  }
  try {
    return await import(pathToFileURL(resolve(REPO_DIR, path)).href)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new HarnessError(`cannot import ${path}: ${message}`)
  }
}
