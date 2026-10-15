import type { Register } from 'claude-code'

import { helpText, parseCommand } from './command'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cadre',
      description: 'Detect which dev framework this repo uses (read-only)',
      argumentHint: 'detect [--adapters]',
    })

    return next(e)
  })

  on('command.run', { command: 'cadre' }, async (_$, e) => {
    const command = parseCommand(e.args)
    if (command.kind === 'help') return { text: helpText(command.unknown) }

    // Detection lands in a later plan of this phase; until then /cadre detect answers with the help text.
    return { text: helpText(null) }
  })
}
