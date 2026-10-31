/**
 * The replies of init (D-36, D-45, D-65, Pitfall 10), a layer 10 module: the refusals of a session root init cannot
 * read or will not run in, worded for init (INIT_ROOT_UNKNOWN_REPLY, INIT_HOME_ROOT_REPLY,
 * INIT_FILE_SYSTEM_ROOT_REPLY), the reply of a cancelled run (INIT_CANCELLED, cancelledReply) and the note of the
 * Ignore all git policy (IGNORE_ALL_NOTE); Wave E moves these texts into locales/en.ts. The three refusals are private:
 * no module reads them, and the specs pin their text through the guard and the builders they are made of (#119). It
 * is pure and imports core and guards; init.ts reads it.
 */
import { reportText } from '../core/text'
import { fileSystemRootReply, homeRootReply } from '../guards/refusals'
import { rootUnknownReply } from '../guards/repo'
import { t } from '../locales/t'

/** The reply when the session root cannot be read: init stops before it reads anything. */
const INIT_ROOT_UNKNOWN_REPLY = rootUnknownReply('init')

/** The home-folder refusal as init words it (D-36, Pitfall 10). */
const INIT_HOME_ROOT_REPLY = homeRootReply('init')

/** The file-system-root refusal as init words it (D-36, Pitfall 10). */
const INIT_FILE_SYSTEM_ROOT_REPLY = fileSystemRootReply('init')

/**
 * The start of the reply when a dialog is dismissed or never answered with a listed choice: nothing was written
 * (D-45); cancelledReply adds the reason.
 */
export const INIT_CANCELLED = t('init.replies.initCancelled')

/**
 * The reply of a cancelled init (D-45, batch-1 review S1): INIT_CANCELLED, a colon and the step's reason cleaned as a
 * report cell, so every surface shows why init stopped.
 */
export function cancelledReply(reason: string): string {
  return t('init.replies.cancelledReply', { initCancelled: INIT_CANCELLED, reason: reportText(reason) })
}

/** The line added when the person ignores all of `.cadre/`: a linked worktree would not have the definitions (D-65). */
export const IGNORE_ALL_NOTE = t('init.replies.ignoreAllNote')
