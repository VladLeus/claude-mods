/**
 * Hand-written stand-in for the two host globals hash.ts uses; read only by `npm run typecheck:cadre`
 * (cadre/tsconfig.strict.json), which loads neither the engine's generated types nor a DOM library. It is typed only as
 * far as hash.ts uses it: `TextEncoder.encode` and `crypto.subtle.digest`. The host provides both when a mod runs.
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare const crypto: {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  }
}
