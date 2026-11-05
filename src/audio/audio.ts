// Drop mp3s in public/sfx/. Missing files stay silent — nothing is synthesized.
//   button.mp3, card-play.mp3, card-capture.mp3,
//   knife-spin.mp3, knife-select.mp3, music.mp3

type OneShot = 'button' | 'cardPlay' | 'cardCapture' | 'knifeSelect';
type LoopCue = 'knifeSpin' | 'music';
type Cue = OneShot | LoopCue;

const CUE_FILES: Record<Cue, string> = {
  button: 'button',
  cardPlay: 'card-play',
  cardCapture: 'card-capture',
  knifeSpin: 'knife-spin',
  knifeSelect: 'knife-select',
  music: 'music',
};

const EXTS = ['mp3'] as const;
const LOOP_CUES = ['knifeSpin', 'music'] as const;

const STORAGE_KEY = 'soundEnabled';

class Sound {
  private enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
  private loaded = false;
  private ready: Promise<void> | null = null;
  private fetchPromise: Promise<void> | null = null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pending = new Map<Cue, ArrayBuffer>();
  private buffers = new Map<Cue, AudioBuffer>();
  private loops = new Map<LoopCue, AudioBufferSourceNode>();
  private loopWanted = new Set<LoopCue>();
  private queued = new Set<OneShot>();
  private toggle: HTMLButtonElement | null = null;

  preload() {
    this.fetchPromise = Promise.all(
      (Object.keys(CUE_FILES) as Cue[]).map(async (cue) => {
        const bytes = await fetchCue(CUE_FILES[cue]);
        if (bytes) this.pending.set(cue, bytes);
      }),
    ).then(() => undefined);
  }

  bindToggle(btn: HTMLButtonElement) {
    this.toggle = btn;
    this.renderToggle();
    btn.addEventListener('click', () => {
      if (this.enabled) {
        this.play('button');
        this.setEnabled(false);
      } else {
        this.setEnabled(true);
        this.play('button');
      }
    });
  }

  /** Resume audio and start background music. Call from a user gesture. */
  unlock() {
    void this.ensureRunning();
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    localStorage.setItem(STORAGE_KEY, String(on));
    this.renderToggle();
    if (!on) {
      this.loopWanted.delete('music');
      this.stopLoopNode('knifeSpin');
      this.stopLoopNode('music');
      this.queued.clear();
      return;
    }
    void this.ensureRunning();
  }

  play(cue: OneShot) {
    if (!this.enabled) return;
    if (this.buffers.has(cue)) this.playNow(cue);
    else if (!this.loaded) this.queued.add(cue);
    void this.ensureRunning();
  }

  startLoop(cue: LoopCue) {
    this.loopWanted.add(cue);
    if (this.loaded && this.enabled) this.sync();
  }

  stopLoop(cue: LoopCue) {
    this.loopWanted.delete(cue);
    this.stopLoopNode(cue);
  }

  private renderToggle() {
    const btn = this.toggle;
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(this.enabled));
    btn.setAttribute('aria-label', this.enabled ? 'sound on' : 'sound off');
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private ensureRunning(): Promise<void> {
    if (!this.ready) this.ready = this.boot();
    return this.ready.then(async () => {
      const ctx = this.ctx;
      if (ctx?.state === 'suspended') await ctx.resume();
      this.sync();
    });
  }

  private async boot() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();
    await this.fetchPromise;
    await Promise.all([...this.pending].map(async ([cue, bytes]) => {
      if (this.buffers.has(cue)) return;
      try {
        this.buffers.set(cue, await ctx.decodeAudioData(bytes.slice(0)));
      } catch {
        // Undecodable or still a placeholder path — leave the cue silent.
      }
    }));
    this.loaded = true;
    this.sync();
  }

  private sync() {
    if (!this.ctx) return;
    if (this.enabled) this.loopWanted.add('music');
    else this.loopWanted.delete('music');

    for (const cue of LOOP_CUES) {
      if (this.enabled && this.loopWanted.has(cue)) this.ensureLoop(cue);
      else this.stopLoopNode(cue);
    }

    if (!this.enabled) {
      this.queued.clear();
      return;
    }
    for (const cue of this.queued) this.playNow(cue);
    this.queued.clear();
  }

  private playNow(cue: OneShot) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const buffer = this.buffers.get(cue);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    src.start();
  }

  private ensureLoop(cue: LoopCue) {
    if (this.loops.has(cue) || !this.ctx || !this.master) return;
    const buffer = this.buffers.get(cue);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.master);
    src.start();
    this.loops.set(cue, src);
    src.onended = () => {
      if (this.loops.get(cue) === src) this.loops.delete(cue);
    };
  }

  private stopLoopNode(cue: LoopCue) {
    const src = this.loops.get(cue);
    if (!src) return;
    this.loops.delete(cue);
    try { src.stop(); } catch { /* already stopped */ }
  }
}

async function fetchCue(name: string): Promise<ArrayBuffer | null> {
  for (const ext of EXTS) {
    try {
      const res = await fetch(`/sfx/${name}.${ext}`);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const head = new TextDecoder().decode(buf.slice(0, 15)).trimStart().toLowerCase();
      if (head.startsWith('<!') || head.startsWith('<html')) continue;
      return buf;
    } catch {
      return null;
    }
  }
  return null;
}

export const audio = new Sound();

export function installButtonSounds() {
  document.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (target instanceof Element && target.closest('#sound-toggle')) return;
    audio.unlock();
  }, { capture: true });

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    audio.unlock();
  }, { capture: true });

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn || btn.id === 'sound-toggle') return;
    audio.play('button');
  }, { capture: true });
}
