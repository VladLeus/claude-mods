/**
 * Hand-written stand-in for the engine's generated 'claude-code/testing' types. It is used only by
 * `npm run typecheck:cadre` (cadre/tsconfig.strict.json) and is typed only as far as the cadre tests use it:
 * `describe`, `test`, `expect` and the matchers below. A test that uses a new matcher must add it here.
 */
declare module 'claude-code/testing' {
  type CadreShimMatchers = {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toMatch(expected: RegExp | string): void
    toBeNull(): void
    toBeUndefined(): void
    toHaveLength(length: number): void
  }

  export function describe(name: string, body: () => void): void
  export function test(name: string, body: () => void): void
  export function expect(actual: unknown): CadreShimMatchers & { readonly not: CadreShimMatchers }
}
