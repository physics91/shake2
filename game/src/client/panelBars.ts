// The right panel's two bars (0x40f9a0). Bar A is the frames a player's screen drew in the last
// second, bar B its round trip to the host; each goes to the others in the player's state packet
// (+0x24, +0x28) every 300 ms. Here the server stands for the host, so every player measures B.

/** The frame count's window (0x405dc7: `now - [0x492afc] >= 1000`). */
export const FPS_WINDOW_MS = 1000;

/** A guest's ping record goes out every 5 s in play (0x40c663: 0x1388). */
export const PING_INTERVAL_MS = 5000;

/** Bar A (0x4432e0): a negative value draws one block, 0 none; 30 is the top; one block per 5. */
export function fpsBlocks(fps: number): { count: number; yellow: boolean } {
  const value = fps < 0 ? 1 : Math.min(fps, 30);
  const count = Math.ceil(value / 5);
  return { count, yellow: count >= 3 };
}

/** Bar B (0x4433c0): green by 50 ms steps to 300, one block to 400, then red by 100 ms steps. */
export function pingBlocks(ping: number): { count: number; green: boolean } {
  if (ping < 0) return { count: 0, green: true };
  const green = [100, 150, 200, 250, 300, 400].findIndex((limit) => ping <= limit);
  if (green >= 0) return { count: 6 - green, green: true };
  const red = [500, 600, 700, 800, 900].findIndex((limit) => ping <= limit);
  return { count: red >= 0 ? red + 1 : 6, green: false };
}

/**
 * [0x492af4]: frames counted each pass and read out once a second (0x405db7-0x405df0). The
 * original counts its own 30 Hz frames; a screen here draws the server's frames, so a pass counts
 * only when it draws a new one. It reads 30 until the first second is up, as the value carried
 * over from the scenes before would.
 */
export class FrameRate {
  value = 30;
  private frames = 0;
  private since: number | null = null;
  private lastTick: number | null = null;

  draw(tick: number, now: number): void {
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      this.frames += 1;
    }
    this.since ??= now;
    if (now - this.since < FPS_WINDOW_MS) return;
    this.since = now;
    this.value = this.frames;
    this.frames = 0;
  }
}

/** The own entry of [0x48be58]: a ping every 5 s, each answer averaged with the last (0x44497c). */
export class PingMeter {
  value = 0;
  private sentAt = Number.NEGATIVE_INFINITY;

  /** True when a record is due now, which stamps it ([0x48c318]). */
  due(now: number): boolean {
    if (now - this.sentAt < PING_INTERVAL_MS) return false;
    this.sentAt = now;
    return true;
  }

  /** The answer: the first trip is taken as it is, later ones halve the sum (idiv rounds to zero). */
  answered(at: number, now: number): void {
    const trip = now - at;
    this.value = this.value ? Math.trunc((this.value + trip) / 2) : trip;
  }

  /** A world load clears the table (0x44ef7b); the 5 s timer runs on. */
  reset(): void {
    this.value = 0;
  }
}
