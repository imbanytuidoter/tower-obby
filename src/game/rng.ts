/**
 * Small deterministic generator. Every round is built from its number,
 * so the same round is identical for every player - otherwise leaderboard
 * times would not be comparable.
 */
export function makeRng(seed: number) {
  let state = (seed * 1664525 + 1013904223) >>> 0

  return {
    /** Float in [0, 1). */
    next(): number {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    },
    /** Float in [min, max). */
    range(min: number, max: number): number {
      return min + this.next() * (max - min)
    },
    /** Integer in [min, max]. */
    int(min: number, max: number): number {
      return Math.floor(this.range(min, max + 1))
    }
  }
}

export type Rng = ReturnType<typeof makeRng>
