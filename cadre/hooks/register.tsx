import type { Register } from 'claude-code'

/** RED placeholder: every /cadre call gets empty text until the GREEN commit wires the real handler. */
export const register: Register = on => {
  on('command.run', { command: 'cadre' }, async () => ({ text: '' }))
}
