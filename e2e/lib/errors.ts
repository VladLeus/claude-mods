export class HarnessError extends Error {
  name = 'HarnessError'
}

export class LeakError extends Error {
  name = 'LeakError'
  lines: readonly number[]

  constructor(message: string, lines: readonly number[]) {
    super(message)
    this.lines = lines
  }
}
