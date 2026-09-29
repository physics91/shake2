/**
 * MSVC CRT `rand()`: the generator shake.exe seeds with `srand(time)` for hidden brick items.
 * The whole state is one uint32 kept in the match state, so snapshots stay deterministic.
 */
/** MSVC CRT `srand(time(0))`: the seed is the host clock's second (clockMs + the match time). */
export function srandTime(state: { rng: number; clockMs: number }, nowMs: number): void {
  state.rng = Math.floor((state.clockMs + nowMs) / 1000) >>> 0;
}

export function msvcRand(holder: { rng: number }): number {
  holder.rng = (Math.imul(holder.rng, 214013) + 2531011) >>> 0;
  return (holder.rng >>> 16) & 0x7fff;
}
