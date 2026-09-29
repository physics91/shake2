const SOUND_BASE = `${import.meta.env.BASE_URL}assets/sound/`;
const MUSIC_BASE = `${import.meta.env.BASE_URL}assets/bgm/`;

export interface MusicTrack {
  file: string;
  /** Seconds until the MIDI segment ends; a repeat starts here while the previous tails ring out. */
  loopEnd: number;
}

/**
 * Original WAV effects and pre-rendered music through Web Audio, with the rules of
 * shake.exe's DirectSound/DirectMusic wrapper (original/FIDELITY.md §1-2):
 * one buffer per effect that restarts from the beginning when played again, full
 * volume, no panning; separate on/off switches for effects and music.
 */
export class SoundBank {
  private context: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices = new Map<string, AudioBufferSourceNode>();
  private music: { key: string; sources: AudioBufferSourceNode[]; timer: number } | null = null;
  private musicRequest = 0;
  /** Music asked for before the first user gesture; it starts on unlock. */
  private pendingMusic: { track: MusicTrack; repeats: number } | null = null;
  effects = true;
  musicOn = true;

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    const pending = this.pendingMusic;
    this.pendingMusic = null;
    if (pending) this.playMusic(pending.track, pending.repeats);
  }

  /** `gate` is the option switch the cue obeys: end and endsig follow the music switch. */
  play(name: string, gate: "effects" | "music" = "effects"): void {
    const context = this.context;
    const enabled = () => (gate === "music" ? this.musicOn : this.effects);
    if (!context || !enabled()) return;
    void this.buffer(context, `${SOUND_BASE}${name}.wav`).then((buffer) => {
      if (!buffer || !enabled()) return;
      this.stop(name);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (this.voices.get(name) === source) this.voices.delete(name);
      };
      this.voices.set(name, source);
      source.start();
    });
  }

  stop(name: string): void {
    const source = this.voices.get(name);
    if (!source) return;
    this.voices.delete(name);
    source.onended = null;
    source.stop();
  }

  setEffects(on: boolean): void {
    this.effects = on;
    if (!on) for (const name of [...this.voices.keys()]) this.stop(name);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on) this.stopMusic();
  }

  /**
   * Play `track` from the start, repeating `repeats` more times like DirectMusic's
   * SetRepeats. A call with the track already playing restarts it only when `restart`.
   */
  playMusic(track: MusicTrack, repeats: number, restart = false): void {
    const context = this.context;
    if (!context) {
      this.pendingMusic = { track, repeats };
      return;
    }
    if (!this.musicOn) return;
    if (!restart && this.music?.key === track.file) return;
    this.stopMusic();
    const request = ++this.musicRequest;
    void this.buffer(context, `${MUSIC_BASE}${encodeURIComponent(track.file)}`).then((buffer) => {
      if (!buffer || request !== this.musicRequest || !this.musicOn) return;
      const state = { key: track.file, sources: [] as AudioBufferSourceNode[], timer: 0 };
      this.music = state;
      let startAt = context.currentTime + 0.05;
      let remaining = repeats;
      const schedule = () => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(startAt);
        // The previous repeat may still be ringing out its release tail.
        state.sources = [...state.sources, source].slice(-2);
        if (remaining <= 0 || track.loopEnd <= 0) return;
        remaining -= 1;
        startAt += track.loopEnd;
        const lead = Math.max(0, (startAt - context.currentTime - 1) * 1000);
        state.timer = window.setTimeout(schedule, lead);
      };
      schedule();
    });
  }

  stopMusic(): void {
    this.pendingMusic = null;
    this.musicRequest += 1;
    const music = this.music;
    this.music = null;
    if (!music) return;
    window.clearTimeout(music.timer);
    for (const source of music.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
  }

  private buffer(context: AudioContext, url: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
        .then((data) => context.decodeAudioData(data))
        .catch((error: unknown) => {
          console.warn(`audio ${url} unavailable`, error);
          return null;
        });
      this.buffers.set(url, pending);
    }
    return pending;
  }
}
