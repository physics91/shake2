import type { Buttons } from "../sim/types.ts";

const RELEASED: Buttons = { bomb: false, attack: false, evade: false };

/** A peer's action buttons: held state plus presses seen since the last tick, so a tap between two ticks still counts. */
export class PeerButtons {
  private held: Buttons = { ...RELEASED };
  private tapped: Buttons = { ...RELEASED };

  set(next: Buttons): void {
    for (const key of Object.keys(RELEASED) as (keyof Buttons)[]) {
      if (next[key] && !this.held[key]) this.tapped[key] = true;
      this.held[key] = next[key];
    }
  }

  /** The buttons for one tick; forgets the taps. */
  take(): Buttons {
    const out: Buttons = {
      bomb: this.held.bomb || this.tapped.bomb,
      attack: this.held.attack || this.tapped.attack,
      evade: this.held.evade || this.tapped.evade,
    };
    this.tapped = { ...RELEASED };
    return out;
  }

  clear(): void {
    this.held = { ...RELEASED };
    this.tapped = { ...RELEASED };
  }
}
