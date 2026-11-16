import { isRecord, isStringList } from './filter.ts'

export type DenyCover = {
  readonly deny: number
  readonly edit: number
}

const FOLDER_RULE_RE = /^Edit\(\/(\/[^()]*)\/\*\*\)$/

function escaped(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

function coversFolder(path: string, target: string): boolean {
  return new RegExp(`^${path.split('*').map(escaped).join('[^/]*')}(?:/|$)`).test(target)
}

// The rule form cadre writes, `Edit(//<absolute path>/**)`, whose path may hold a `*` inside one folder name.
export function denyCoverOf(text: string, folder: string): DenyCover | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const permissions = isRecord(value) ? value.permissions : undefined
  const deny = isRecord(permissions) ? permissions.deny : undefined
  if (!isStringList(deny)) return null
  const target = folder.replace(/\/+$/, '')
  let edit = 0
  for (const rule of deny) {
    const [, path] = FOLDER_RULE_RE.exec(rule) ?? []
    if (path === undefined) continue
    if (coversFolder(path, target)) edit += 1
  }

  return { deny: deny.length, edit }
}
