/**
 * The repo checks /cadre init, regen, start, status and epic run before they read anything, a layer 3 module: a
 * readable session root that is not the home folder or the file system root, a git repo above it whose top level it
 * is, and for init and regen no autopilot run live in the session, each refusal worded for its command. It imports
 * core, facts, git, paths, scan's autopilot readers and the types, so start, status and epic guard here, not in init.
 */
import type { InitIo, InitLocations } from '../../types'
import { clean } from '../core/text'
import { detectRefusal, MAX_READ_BYTES } from '../facts'
import { findGitTop } from '../git/checkout'
import { trimSlash } from '../paths'
import { autopilotReply, autopilotRunState, autopilotStatusPath } from '../scan'

/** Code points of the git top level a refusal shows. */
const MAX_TOP_CHARS = 240

/** The cadre commands a refusal is worded for. */
export type CommandWord = 'init' | 'regen' | 'start' | 'status' | 'epic'

/**
 * The refusal when the session root is not the git top level, naming the top level, else null (D-56). Trailing
 * slashes are ignored when the two are compared, and the top level is shown cleaned and capped at 240 code points.
 */
export function gitRootRefusal(root: string, top: string, command: CommandWord): string | null {
  if (trimSlash(root) === trimSlash(top)) return null

  return `run /cadre ${command} from the repo root: ${clean(top, MAX_TOP_CHARS)}`
}

/** The refusal when no git repo is above the session root, with the wording D-97 fixes. */
export function notGitRepoReply(command: CommandWord): string {
  return `cadre ${command} needs a git repo: run git init first`
}

/** The reply when init runs where no one can be asked: `claude -p`, or a host that cannot say (fail closed, D-42). */
export const NOT_INTERACTIVE_REPLY =
  'cadre init needs an interactive session to ask its questions. ' +
  'Run /cadre init in a terminal session, not with claude -p.'

/** The reply when the session root cannot be read, worded for its command: it stops before it reads anything. */
export function rootUnknownReply(command: CommandWord): string {
  return `cadre ${command} could not read the session root, so it stopped before reading anything.`
}

/**
 * The text of a `/cadre detect` refusal with every `cadre detect` named for `command` instead, so the refusal reads
 * right for init, regen, start or status while detect keeps its own constants byte for byte (Pitfall 10).
 */
export function commandRefusal(refusal: string, command: CommandWord): string {
  return refusal.replaceAll('cadre detect', `cadre ${command}`)
}

/** What the guard decided: refuse with this text, or go on with the session's locations. */
export type GuardResult =
  | { readonly kind: 'refuse'; readonly text: string }
  | { readonly kind: 'ok'; readonly locations: InitLocations }

/** A refusal with its text. */
function refuse(text: string): GuardResult {
  return { kind: 'refuse', text }
}

/**
 * The refusal when the session root is not the git top level, or no git repo is above it at all (D-56, D-97b); null
 * when the root is the top level. The walk only stats `.git` and runs no process.
 */
async function gitTopRefusal(io: InitIo, root: string, command: CommandWord): Promise<string | null> {
  const found = await findGitTop(io, root)
  if (found.state === 'none') return notGitRepoReply(command)

  return gitRootRefusal(root, found.top, command)
}

/**
 * The refusal when autopilot runs in this session, or when that cannot be told (SCAN-04, D-42), else null. It fails
 * closed: no session id, no clock, no HOME as given, or no usable status path is the unknown reply, before anything is
 * read; then the one status file is read and judged by autopilotRunState.
 */
async function autopilotRefusal(
  io: InitIo,
  givenHome: string | null,
  command: 'init' | 'regen',
): Promise<string | null> {
  const unknown = autopilotReply('unknown', command)
  const sessionId = await io.sessionId()
  if (sessionId === null) return unknown
  const now = await io.now()
  if (now === null) return unknown
  if (givenHome === null) return unknown
  const path = autopilotStatusPath(givenHome, sessionId)
  if (path === null) return unknown
  const read = await io.read(path, MAX_READ_BYTES)

  return autopilotReply(autopilotRunState(read, now), command)
}

/**
 * The repo checks a cadre command runs before it reads anything (D-36, D-56, D-97b). It refuses, in this order: an
 * unreadable session root, the home folder or the file system root, a root with no git repo above it, and a root that
 * is not the git top level. Each refusal is worded for `command`, and no check after a refusal runs. It asks no
 * question and does not look for an autopilot run: initGuard adds those checks for init and regen.
 */
export async function repoGuard(io: InitIo, command: CommandWord): Promise<GuardResult> {
  const locations = await io.locations()
  if (locations === null) return refuse(rootUnknownReply(command))

  const rootRefusal = detectRefusal([locations.givenRoot, locations.root], [locations.givenHome, locations.home])
  if (rootRefusal !== null) return refuse(commandRefusal(rootRefusal, command))

  const gitRefusal = await gitTopRefusal(io, locations.root, command)
  if (gitRefusal !== null) return refuse(gitRefusal)

  return { kind: 'ok', locations }
}

/**
 * The guard `/cadre init` and `/cadre regen` run before they scan anything (SCAN-04, D-42, D-56). It refuses, in this
 * order: (init only) a session nobody can be asked in; the repo checks of repoGuard (an unreadable session root, the
 * home folder or the file system root, a root with no git repo above it, a root that is not the git top level); an
 * active autopilot run in this session, and an autopilot state that cannot be read. Regen runs in `claude -p` (D-99),
 * so its guard never asks whether anyone is there. Each refusal is worded for its command, and no check after a
 * refusal runs.
 */
export async function initGuard(io: InitIo, command: 'init' | 'regen'): Promise<GuardResult> {
  if (command === 'init' && (await io.isInteractive()) !== true) return refuse(NOT_INTERACTIVE_REPLY)

  const guard = await repoGuard(io, command)
  if (guard.kind === 'refuse') return guard

  const runRefusal = await autopilotRefusal(io, guard.locations.givenHome, command)
  if (runRefusal !== null) return refuse(runRefusal)

  return guard
}
