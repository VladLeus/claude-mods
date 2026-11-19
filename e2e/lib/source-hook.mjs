import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXPLICIT_EXTENSION_RE = /\.[cm]?[jt]sx?$|\.json$/

// Plugin sources import siblings without an extension, which Node does not resolve: try `.ts`, then `/index.ts`.
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (!isRelative || EXPLICIT_EXTENSION_RE.test(specifier)) return nextResolve(specifier, context)
  if (!context.parentURL?.startsWith('file:')) return nextResolve(specifier, context)
  const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)
  const found = [`${base}.ts`, `${base}/index.ts`].find(candidate => existsSync(candidate))
  if (!found) return nextResolve(specifier, context)

  return nextResolve(pathToFileURL(found).href, context)
}
