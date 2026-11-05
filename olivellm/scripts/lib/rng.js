/** Deterministic PRNG (mulberry32). The same seed always produces the same dataset. */
export function rng(seed) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) => {
      const copy = [...items]
      for (let index = copy.length - 1; index > 0; index--) {
        const target = Math.floor(next() * (index + 1))
        ;[copy[index], copy[target]] = [copy[target], copy[index]]
      }
      return copy
    },
    chance: (probability) => next() < probability,
  }
}

/** Rotates a list so a generator can enumerate combinations without repeating across calls. */
export function cycle(items, index) {
  return items[index % items.length]
}

export function pad(value, width = 4) {
  return String(value).padStart(width, "0")
}
