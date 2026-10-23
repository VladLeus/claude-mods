/**
 * The worlds of the golden suite (D-219), each with the answers its init run is given: test support, not a test
 * itself. Fixtures copied from init.test.ts stay byte-identical to their source spec's, so a golden runs the world that
 * spec runs. Only the golden modules import it.
 */
import { gitWorld, INIT_ANSWERS } from '../testkit'

/**
 * Each golden world by name, with the answers its run is given by question prefix (the longest prefix wins):
 * `nothing` is the git repo /repo where the scan detects nothing (gitWorld), answered with the INIT_ANSWERS defaults.
 */
export const GOLDEN_WORLDS = Object.freeze({
  nothing: { world: gitWorld(), answers: INIT_ANSWERS },
})
