// Procedural sound: every effect is synthesized with WebAudio, so the game ships no
// audio files and makes no network request. The context starts on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let stepPhase = 0;
  let unlocked = false;

  function ensure() {
    // Never create the context before a user gesture: Chrome would start it suspended
    // and log an autoplay warning. Sounds are silent until the player clicks Play.
    if (!unlocked) return false;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration, frequency, type = 'lowpass', gain = 0.5, slideTo = null }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    if (slideTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(t);
    source.stop(t + duration + 0.05);
  }

  function tone({ frequency, duration, type = 'sine', gain = 0.3, slideTo = null }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    unlock() {
      unlocked = true;
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(kind) {
      if (kind === 'sniper') {
        burst({ duration: 0.22, frequency: 2600, slideTo: 300, gain: 0.7 });
        tone({ frequency: 160, duration: 0.16, type: 'sawtooth', gain: 0.25, slideTo: 60 });
      } else if (kind === 'shotgun') {
        burst({ duration: 0.18, frequency: 1400, slideTo: 200, gain: 0.8 });
      } else if (kind === 'pistol') {
        burst({ duration: 0.09, frequency: 3200, slideTo: 500, gain: 0.45 });
      } else {
        burst({ duration: 0.11, frequency: 2200, slideTo: 350, gain: 0.55 });
      }
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.15 });
      setTimeout(() => tone({ frequency: 600, duration: 0.04, type: 'square', gain: 0.15 }), 320);
    },
    hit(head) {
      tone({ frequency: head ? 2200 : 1500, duration: 0.06, type: 'sine', gain: 0.3 });
    },
    hurt() {
      tone({ frequency: 220, duration: 0.12, type: 'sawtooth', gain: 0.2, slideTo: 110 });
    },
    explosion() {
      burst({ duration: 0.7, frequency: 900, slideTo: 60, gain: 0.9 });
      tone({ frequency: 90, duration: 0.6, type: 'sine', gain: 0.5, slideTo: 30 });
    },
    beep(high) {
      tone({ frequency: high ? 1200 : 800, duration: 0.09, type: 'square', gain: 0.2 });
    },
    plant() {
      tone({ frequency: 1000, duration: 0.08, type: 'square', gain: 0.2 });
    },
    roundWin() {
      tone({ frequency: 523, duration: 0.14, type: 'sine', gain: 0.25 });
      setTimeout(() => tone({ frequency: 784, duration: 0.22, type: 'sine', gain: 0.25 }), 140);
    },
    roundLose() {
      tone({ frequency: 392, duration: 0.16, type: 'sine', gain: 0.25 });
      setTimeout(() => tone({ frequency: 262, duration: 0.26, type: 'sine', gain: 0.25 }), 160);
    },
    buy() {
      tone({ frequency: 700, duration: 0.05, type: 'square', gain: 0.15 });
      setTimeout(() => tone({ frequency: 1050, duration: 0.06, type: 'square', gain: 0.15 }), 60);
    },
    footstep() {
      stepPhase += 1;
      burst({ duration: 0.05, frequency: 500 + (stepPhase % 2) * 120, gain: 0.08 });
    },
  };
}
