/**
 * The replies of init (D-36, D-45, D-65, Pitfall 10), a layer 10 module: the refusals of a session root init cannot
 * read or will not run in, worded for init (INIT_ROOT_UNKNOWN_REPLY, INIT_HOME_ROOT_REPLY,
 * INIT_FILE_SYSTEM_ROOT_REPLY), the reply of a cancelled run (INIT_CANCELLED, cancelledReply) and the note of the
 * Ignore all git policy (IGNORE_ALL_NOTE); Wave E moves these texts into locales/en.ts. It is pure and imports core and
 * guards; init.ts reads it.
 */
import { reportText } from '../core/text'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY } from '../guards/refusals'
import { commandRefusal, rootUnknownReply } from '../guards/repo'

/** The reply when the session root cannot be read: init stops before it reads anything. */
export const INIT_ROOT_UNKNOWN_REPLY = rootUnknownReply('init')

/** The home-folder refusal as init words it (D-36, Pitfall 10). */
export const INIT_HOME_ROOT_REPLY = commandRefusal(HOME_ROOT_REPLY, 'init')

/** The file-system-root refusal as init words it (D-36, Pitfall 10). */
export const INIT_FILE_SYSTEM_ROOT_REPLY = commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'init')

/**
 * The start of the reply when a dialog is dismissed or never answered with a listed choice: nothing was written
 * (D-45); cancelledReply adds the reason.
 */
export const INIT_CANCELLED = 'init cancelled, nothing written'

/**
 * The reply of a cancelled init (D-45, batch-1 review S1): INIT_CANCELLED, a colon and the step's reason cleaned as a
 * report cell, so every surface shows why init stopped.
 */
export function cancelledReply(reason: string): string {
  return `${INIT_CANCELLED}: ${reportText(reason)}`
}

/** The line added when the person ignores all of `.cadre/`: a linked worktree would not have the definitions (D-65). */
export const IGNORE_ALL_NOTE = "role definitions won't exist in new worktrees"
