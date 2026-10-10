// Unlock throttling: after each failure the next attempt must wait 2^(n-1) seconds, up to 15 minutes.
// The first two failures cost 1 s and 2 s; ten failures in a row cost ~8.5 minutes.
export const MAX_DELAY_MS = 15 * 60 * 1000;

export class UnlockLimiter {
  #failures = 0;
  #nextAllowedAt = 0;
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  // ms the caller must still wait (0 = allowed)
  retryAfterMs() {
    return Math.max(0, this.#nextAllowedAt - this.#now());
  }

  get failures() { return this.#failures; }

  fail() {
    this.#failures++;
    const delay = Math.min(1000 * 2 ** (this.#failures - 1), MAX_DELAY_MS);
    this.#nextAllowedAt = this.#now() + delay;
    return delay;
  }

  succeed() {
    this.#failures = 0;
    this.#nextAllowedAt = 0;
  }
}
