/**
 * The frameworks a role may run, a layer 5 module: its own default first, then every other supported framework the
 * repo records; a role on none runs none alone. It imports core and the types, so the scope compiler, the card and
 * the lint read it.
 */
import type { FrameworkId, ScopeContext } from '../../types'
import { SUPPORTED_IDS } from '../core/framework-id'

/**
 * The frameworks a role may run: its default first, then each supported framework of `alsoRuns` once, in
 * SUPPORTED_IDS order. A role on none runs only none, and with no `alsoRuns` a role runs its default alone.
 */
export function runnableFrameworks(ctx: Pick<ScopeContext, 'framework' | 'alsoRuns'>): FrameworkId[] {
  if (ctx.framework === 'none') return ['none']
  const recorded = ctx.alsoRuns ?? []

  return [ctx.framework, ...SUPPORTED_IDS.filter(id => id !== ctx.framework && recorded.includes(id))]
}
