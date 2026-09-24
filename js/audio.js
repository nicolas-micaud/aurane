// Tiny WebAudio synth: every star is a note, so every network is a melody.
const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic

let ctx = null, master = null, muted = false;

try { muted = localStorage.getItem('starnet.muted') === '1'; } catch { /* storage unavailable */ }

function ensure() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    master.connect(ctx.destination);
    master.connect(delay).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Map a vertical world position (0..1000) to a pentatonic note. */
export function noteFor(y) {
  const step = Math.floor((1 - y / 1000) * 12);
  const octave = Math.floor(step / SCALE.length);
  return 220 * 2 ** ((SCALE[step % SCALE.length] + 12 * octave) / 12);
}

export function tone(freq, { at = 0, dur = 0.5, type = 'triangle', vol = 0.5 } = {}) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  select: (y) => tone(noteFor(y), { dur: 0.25, vol: 0.25, type: 'sine' }),
  link: (y) => { tone(noteFor(y), { dur: 0.6, vol: 0.4 }); tone(noteFor(y) * 1.5, { at: 0.06, dur: 0.5, vol: 0.2, type: 'sine' }); },
  remove: () => tone(160, { dur: 0.2, vol: 0.25, type: 'sine' }),
  error: () => { tone(110, { dur: 0.18, vol: 0.3, type: 'sawtooth' }); tone(104, { at: 0.09, dur: 0.18, vol: 0.3, type: 'sawtooth' }); },
  listener: (y) => [0, 0.08, 0.16].forEach((at, i) => tone(noteFor(y) * [1, 1.25, 1.5][i], { at, dur: 0.8, vol: 0.3 })),
};

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('starnet.muted', v ? '1' : '0'); } catch { /* ignore */ }
  if (v && ctx) ctx.suspend();
}
