// === [AUDIO: SYNTH SFX] ===
// Synthesized WebAudio soundscape, plus one recorded rifle shot shipped as
// public/sfx/gunshot.wav (Godot TPS demo, CC-BY 3.0 — see README credits);
// if the sample cannot load, shot() falls back to the synthesized layer.
// The context is created lazily on the first user gesture (autoplay
// policy), then ambient loops (wind, river) start and one-shot voices
// fire on demand. Day/night and river proximity are fed in via
// setAmbience() from the world loop.

let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;
let ambience = { water: 0, day: 1, night: 0 };
let windGain = null;
let riverGain = null;
let schedulerOn = false;
let gunBuffer = null; // decoded recorded gunshot (null = synth fallback)
let gunLoadTried = false;

function loadGunSample() {
  if (gunLoadTried || !ctx) return;
  gunLoadTried = true;
  const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
  fetch(base + "sfx/gunshot.wav")
    .then((r) => { if (!r.ok) throw new Error("gunshot " + r.status); return r.arrayBuffer(); })
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => { gunBuffer = decoded; })
    .catch(() => { gunBuffer = null; });
}

function ensure() {
  return ctx && ctx.state !== "closed" ? ctx : null;
}

function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

function adsrGain(t0, peak, attack, decay, dest) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(dest || master);
  return g;
}

function noiseBurst({ t0, dur, type = "lowpass", from, to, q = 0.8, peak = 0.5, dest }) {
  const src = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t0);
  if (to) filter.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  const g = adsrGain(t0, peak, 0.004, dur, dest);
  src.connect(filter).connect(g);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + dur + 0.05);
}

function tone({ t0, dur, type = "sine", from, to, peak = 0.2, dest }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  const g = adsrGain(t0, peak, 0.006, dur, dest);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// ---------- ambient life (birds by day, crickets by night, leaf gusts) ----
function birdPhrase() {
  if (!ensure()) return;
  const t0 = ctx.currentTime + 0.02;
  const base = 2300 + Math.random() * 1600;
  const chirps = 2 + Math.floor(Math.random() * 4);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const dest = pan || master;
  if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(master); }
  for (let i = 0; i < chirps; i++) {
    const ct = t0 + i * (0.09 + Math.random() * 0.07);
    tone({ t0: ct, dur: 0.07, type: "sine", from: base * (0.92 + Math.random() * 0.25), to: base * (1.15 + Math.random() * 0.2), peak: 0.045, dest });
  }
}
function cricketPhrase() {
  if (!ensure()) return;
  const t0 = ctx.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    tone({ t0: t0 + i * 0.075, dur: 0.045, type: "sine", from: 4200 + Math.random() * 250, peak: 0.016 });
  }
}
function leafGust() {
  if (!ensure()) return;
  const t0 = ctx.currentTime;
  const src = noiseSource();
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = 2600; f.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.04, t0 + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random());
  src.stop(t0 + 1.4);
}
function startScheduler() {
  if (schedulerOn) return;
  schedulerOn = true;
  setInterval(() => {
    if (!ensure() || muted) return;
    if (ambience.day > 0.55 && Math.random() < 0.32) birdPhrase();
    if (ambience.night > 0.5 && Math.random() < 0.5) cricketPhrase();
    if (Math.random() < 0.2) leafGust();
  }, 800);
}

function startLoops() {
  // wind: looped noise -> lowpass, slow LFO on gain
  const wind = noiseSource();
  const wf = ctx.createBiquadFilter();
  wf.type = "lowpass"; wf.frequency.value = 380;
  windGain = ctx.createGain(); windGain.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.028;
  lfo.connect(lfoAmt).connect(windGain.gain);
  wind.connect(wf).connect(windGain).connect(master);
  wind.start(); lfo.start();
  // river: looped noise -> bandpass babble, gain set by proximity
  const river = noiseSource();
  const rf = ctx.createBiquadFilter();
  rf.type = "bandpass"; rf.frequency.value = 740; rf.Q.value = 0.45;
  const rf2 = ctx.createBiquadFilter();
  rf2.type = "lowpass"; rf2.frequency.value = 2400;
  riverGain = ctx.createGain(); riverGain.gain.value = 0;
  const babble = ctx.createOscillator(); babble.frequency.value = 0.9;
  const babbleAmt = ctx.createGain(); babbleAmt.gain.value = 140;
  babble.connect(babbleAmt).connect(rf.frequency);
  river.connect(rf).connect(rf2).connect(riverGain).connect(master);
  river.start(); babble.start();
  startScheduler();
}

export const sfx = {
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.32;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 6;
        master.connect(comp).connect(ctx.destination);
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        startLoops();
        loadGunSample();
        document.addEventListener("pointerdown", (e) => {
          const btn = e.target.closest && e.target.closest("button");
          if (btn && !btn.classList.contains("fire-btn")) sfx.click();
        });
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (err) {
      /* audio unavailable — game stays silent, never blocks */
    }
  },
  setMuted(next) {
    muted = next;
    if (master && ensure()) master.gain.setTargetAtTime(muted ? 0 : 0.32, ctx.currentTime, 0.03);
    return muted;
  },
  isMuted: () => muted,
  setAmbience(next) {
    ambience = { ...ambience, ...next };
    if (ensure() && riverGain) {
      riverGain.gain.setTargetAtTime(Math.pow(ambience.water, 1.6) * 0.35, ctx.currentTime, 0.25);
    }
    if (ensure() && windGain) {
      windGain.gain.setTargetAtTime(0.04 + ambience.night * 0.02, ctx.currentTime, 0.5);
    }
  },
  click() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    tone({ t0, dur: 0.045, type: "square", from: 1350, to: 820, peak: 0.07 });
    noiseBurst({ t0, dur: 0.03, type: "highpass", from: 3000, peak: 0.05 });
  },
  whoosh() {
    if (!ensure()) return;
    noiseBurst({ t0: ctx.currentTime, dur: 0.22, type: "bandpass", from: 500, to: 1800, q: 1.1, peak: 0.1 });
  },
  deploy() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    tone({ t0, dur: 0.14, type: "triangle", from: 392, peak: 0.16 });
    tone({ t0: t0 + 0.1, dur: 0.22, type: "triangle", from: 587, peak: 0.16 });
    noiseBurst({ t0, dur: 0.3, type: "bandpass", from: 400, to: 2200, q: 0.8, peak: 0.08 });
  },
  shot() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    if (gunBuffer) {
      // Recorded shot with per-shot pitch/gain jitter (so automatic fire
      // never sounds cloned) over a short sub-bass thump for body.
      const src = ctx.createBufferSource();
      src.buffer = gunBuffer;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const g = ctx.createGain();
      g.gain.value = 0.85 + Math.random() * 0.15;
      src.connect(g).connect(master);
      src.start(t0);
      tone({ t0, dur: 0.09, type: "sine", from: 120, to: 38, peak: 0.28 });
      return;
    }
    noiseBurst({ t0, dur: 0.16, type: "lowpass", from: 3400, to: 280, q: 0.4, peak: 0.85 });
    tone({ t0, dur: 0.11, type: "square", from: 160, to: 42, peak: 0.4 });
    noiseBurst({ t0, dur: 0.04, type: "highpass", from: 4000, peak: 0.25 });
  },
  dry() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    tone({ t0, dur: 0.04, type: "square", from: 900, to: 500, peak: 0.09 });
    noiseBurst({ t0: t0 + 0.02, dur: 0.03, type: "bandpass", from: 2200, q: 2, peak: 0.1 });
  },
  reload() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    noiseBurst({ t0, dur: 0.05, type: "bandpass", from: 1500, q: 2.4, peak: 0.22 });
    noiseBurst({ t0: t0 + 0.13, dur: 0.05, type: "bandpass", from: 1100, q: 2.4, peak: 0.18 });
    noiseBurst({ t0: t0 + 0.3, dur: 0.07, type: "bandpass", from: 2100, q: 2, peak: 0.3 });
    tone({ t0: t0 + 0.3, dur: 0.06, type: "square", from: 300, to: 180, peak: 0.08 });
  },
  heal() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    tone({ t0, dur: 0.12, type: "sine", from: 660, to: 880, peak: 0.12 });
    tone({ t0: t0 + 0.1, dur: 0.16, type: "sine", from: 880, to: 1174, peak: 0.1 });
  },
  droneDown() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    tone({ t0, dur: 0.3, type: "sawtooth", from: 1400, to: 120, peak: 0.18 });
    noiseBurst({ t0: t0 + 0.05, dur: 0.4, type: "lowpass", from: 900, to: 90, q: 0.5, peak: 0.55 });
  },
  step(inWater) {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    if (inWater) {
      noiseBurst({ t0, dur: 0.16, type: "bandpass", from: 800 + Math.random() * 300, to: 420, q: 1, peak: 0.3 });
      tone({ t0: t0 + 0.03, dur: 0.09, type: "sine", from: 700 + Math.random() * 200, to: 300, peak: 0.05 });
    } else {
      // grass / dirt: soft scuff
      noiseBurst({ t0, dur: 0.09, type: "lowpass", from: 520 + Math.random() * 140, peak: 0.16 });
      noiseBurst({ t0, dur: 0.05, type: "bandpass", from: 2800, q: 0.7, peak: 0.035 });
    }
  },
  land() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    noiseBurst({ t0, dur: 0.14, type: "lowpass", from: 420, to: 110, q: 0.6, peak: 0.42 });
    tone({ t0, dur: 0.09, type: "sine", from: 95, to: 45, peak: 0.22 });
  },
  splash() {
    if (!ensure()) return;
    noiseBurst({ t0: ctx.currentTime, dur: 0.35, type: "bandpass", from: 1000, to: 380, q: 0.8, peak: 0.4 });
  },
};
