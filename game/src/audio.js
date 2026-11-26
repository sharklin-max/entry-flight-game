// Emberwing Courier — sound. Everything is synthesised live with WebAudio:
// no audio files, no samples, no copied sounds. Engine hum, wind, ring
// chimes, touchdown thuds and alarms are all built from oscillators and
// filtered noise in this file.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;
    this.muted = false;
    this.started = false;
  }

  // Must be called from a user gesture (button click / key press).
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // Engine: two detuned sawtooths through a low-pass filter.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 27.5;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    // Wind: looped white noise through a band-pass filter.
    const len = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSource.start();
    this.started = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  // Called every frame while flying: rpm 0..1, airspeed m/s, inStorm 0..1.
  updateEngine(rpm, airspeed, inStorm) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freq = 42 + rpm * 68;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(freq * 0.5, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(220 + rpm * 900, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.02 + rpm * 0.075, t, 0.1);
    const wind = Math.min(1, airspeed / 85) * 0.12 + inStorm * 0.1;
    this.windGain.gain.setTargetAtTime(wind, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + airspeed * 9, t, 0.15);
  }

  engineOff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, t, 0.2);
    this.windGain.gain.setTargetAtTime(0.02, t, 0.3);
  }

  // One-shot blip: a short sine/triangle tone with an exponential decay.
  blip(freq, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  ringChime(combo) {
    // Rising arpeggio: higher combo, higher and brighter.
    const base = 660 + Math.min(combo, 8) * 40;
    this.blip(base, 0.35, 'sine', 0.22);
    this.blip(base * 1.25, 0.35, 'sine', 0.18, 0.07);
    this.blip(base * 1.5, 0.45, 'sine', 0.16, 0.14);
  }

  ringMiss() {
    this.blip(180, 0.3, 'triangle', 0.18);
    this.blip(140, 0.35, 'triangle', 0.15, 0.08);
  }

  dropThump() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  }

  touchdown(hard) {
    this.dropThump();
    if (hard) {
      this.blip(90, 0.4, 'sawtooth', 0.2);
      this.blip(70, 0.5, 'sawtooth', 0.16, 0.05);
    }
  }

  crash() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(30, t0 + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.85);
    this.blip(55, 0.5, 'sine', 0.3, 0.05);
  }

  alarm() {
    this.blip(880, 0.12, 'square', 0.1);
    this.blip(880, 0.12, 'square', 0.1, 0.18);
  }

  fanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.blip(f, 0.5, 'triangle', 0.2, i * 0.12));
  }

  click() {
    this.blip(1200, 0.05, 'square', 0.08);
  }
}
