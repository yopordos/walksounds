// player.js — Interpreta la partitura generada por composer.js

import { AudioEngine } from './audio.js';

const rnd   = (a, b)    => a + Math.random() * (b - a);
const lerp  = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  constructor() {
    this.audio          = new AudioEngine();
    this._timers        = [];
    this._rafId         = null;
    this._playing       = false;
    this._startAt       = null;
    this.captureBuffers = []; // AudioBuffers de capturas reales del día
    this.onProgress     = null;
    this.onSpecies      = null;
    this.onComplete     = null;
  }

  async init() {
    if (this.audio.ctx) return;
    await this.audio.init();
    // El master arranca en 0 — unmute() lo sube al hacer play
    if (this.audio._n.master) {
      this.audio._n.master.gain.cancelScheduledValues(0);
      this.audio._n.master.gain.setValueAtTime(0, 0);
    }
  }

  play(score) {
    this._stopTimers();
    this._playing = true;
    this._startAt = performance.now();

    // Carácter fundamental del contexto (cambia el sonido de raíz: reverb, densidad, frecuencias)
    this.audio.setContext(score.context);

    // Solo hace fade-in si el master está apagado (primer play o después de pausa)
    const masterGain = this.audio._n?.master?.gain?.value ?? 0;
    if (masterGain < 0.5) this.audio.unmute(0.8);

    // Modulación inicial del mundo (ajuste fino dentro del contexto)
    this.audio.setWorld({
      energy:   score.atmosphere.energy ?? 0.55,
      warmth:   score.atmosphere.warmth,
      altitude: score.atmosphere.altitude,
      hour:     12,
    });

    score.events.forEach(({ time, species }) => {
      const t = setTimeout(() => {
        if (!this._playing) return;
        const energy = this._energyAt(time, score);
        const atmo   = { energy, ...score.atmosphere, _acousticSummary: score.acousticSummary };
        this.audio.play(species, this._paramsFor(species, atmo));
        this.onSpecies?.(species);
      }, time * 1000);
      this._timers.push(t);
    });

    // Fin del fragmento: transición imperceptible al siguiente
    this._timers.push(setTimeout(() => {
      this._playing = false;
      this.onComplete?.();
    }, score.duration * 1000));

    // RAF: progreso + modulación de atmósfera + deriva de textura
    let lastAtmo  = 0;
    let lastDrift = 0;
    const tick = () => {
      if (!this._playing) return;
      const elapsed  = (performance.now() - this._startAt) / 1000;
      const fraction = Math.min(1, elapsed / score.duration);
      this.onProgress?.(fraction);
      const now = performance.now();
      if (now - lastAtmo > 1000) {
        const energy = this._energyAt(elapsed, score);
        this.audio.setWorld({
          energy,
          warmth:   score.atmosphere.warmth,
          altitude: score.atmosphere.altitude,
          hour:     12,
        });
        lastAtmo = now;
      }
      // Deriva del ruido rosa cada 25s — el fondo nunca se queda estático
      if (now - lastDrift > 25000) {
        this.audio.driftTexture?.();
        lastDrift = now;
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // Pausa: fade out inmediato, cancela futuros eventos
  stop() {
    this._playing = false;
    this._stopTimers();
    this.audio.mute(0.35); // apaga el audio
  }

  // Graba la composición desde el inicio y descarga al terminar
  saveAs(score, filename, onRecording) {
    const stream = this.audio.createRecordingStream();
    if (!stream) return;

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(m => MediaRecorder.isTypeSupported(m)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks   = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      this.audio.disconnectRecording();
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      const url  = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
      onRecording?.(false);
    };

    const prev = this.onComplete;
    this.onComplete = () => { recorder.stop(); prev?.(); };

    recorder.start();
    this.play(score);
    onRecording?.(true);
    return recorder;
  }

  // Inyecta eventos granulares inmediatamente cuando llega una nueva captura
  // sin esperar al ciclo de composición siguiente.
  injectGranular(buffer) {
    if (!this._playing || !this.audio.ctx || !buffer) return;
    const count = 3 + Math.floor(Math.random() * 3); // 3-5 eventos
    for (let i = 0; i < count; i++) {
      const delay = 400 + Math.random() * 12000;
      const t = setTimeout(() => {
        if (!this._playing) return;
        const energy = Math.random() * 0.55 + 0.25;
        const pan    = (Math.random() - 0.5) * 1.5;
        this.audio.play('granular', { buffer, energy, pan, continuous: energy < 0.38 });
        this.onSpecies?.('granular');
        this.onGranularFired?.();
      }, delay);
      this._timers.push(t);
    }
  }

  destroy() {
    this.stop();
    this.audio.stop?.();
  }

  _stopTimers() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _energyAt(seconds, score) {
    const frac = Math.min(1, seconds / score.duration);
    return score.curve[Math.floor(frac * 99)] ?? 0.5;
  }

  _paramsFor(species, atmo) {
    const { warmth = 0.5, energy = 0.5, altitude = 0.3 } = atmo;
    const acoustic = atmo._acousticSummary;
    const bright = acoustic
      ? Math.min(1, acoustic.bands.high / (acoustic.bands.bass + acoustic.bands.mid + 0.001))
      : warmth * 0.4;
    const density = acoustic ? acoustic.transients : energy * 0.06;
    const pan = rnd(-0.78, 0.78); // cada evento aparece en un lugar diferente del espacio

    switch (species) {
      case 'resonador':
        return { freq: lerp(70, 240, warmth) * rnd(0.9, 1.1), decay: lerp(1.8, 3.8, 1 - energy), energy, pan };
      case 'pulso_metal':
        return { freq: lerp(400, 1400, bright) * rnd(0.8, 1.2), energy, pan };
      case 'gota_metal':
        return { brightness: lerp(bright, 0.5 + warmth * 0.4, 0.5), pan };
      case 'campana':
        return { freq: lerp(80, 220, warmth) * rnd(0.88, 1.12), energy, pan: pan * 0.5 };
      case 'cuerda':
        return { freq: lerp(40, 130, warmth) * rnd(0.92, 1.08), warmth, pan };
      case 'arco':
        return { warmth, energy: energy * 0.6, pan };
      case 'cristal':
        return { freq: lerp(320, 900, bright) * rnd(0.85, 1.15), warmth, pan };
      case 'aliento':
        return { warmth, energy, pan: pan * 0.5 };
      case 'viento':
        return { warmth, altitude, pan };
      case 'voz_lejana':
        return { density: clamp(density * 12, 0.1, 1), pan };

      case 'granular': {
        const bufs = this.captureBuffers;
        if (!bufs?.length) return {};
        const buffer     = bufs[Math.floor(Math.random() * bufs.length)];
        const continuous = energy < 0.35; // baja energía → capa continua
        return { buffer, energy, pan, continuous };
      }

      default: return {};
    }
  }

  get isPlaying() { return this._playing; }
}
