// mic.js — Sensor acústico analógico
//
// No graba audio. Solo mide propiedades del ambiente cada N segundos:
//   centroid   → "color" del sonido (grave/agudo)
//   dominantHz → la frecuencia que más domina
//   bands      → energía en 4 bandas (sub/bass/mid/high)
//   transients → densidad de cambios rápidos (golpes, voces, pasos)
//   rms        → volumen general del entorno
//
// El audio nunca sale del AnalyserNode — no hay grabación ni almacenamiento.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AcousticSensor {
  constructor() {
    this.ctx      = null;
    this.analyser = null;
    this._stream  = null;
    this.log      = [];   // snapshots a lo largo del día
    this._timer   = null;
  }

  async init() {
    // Crear el AudioContext ANTES del await: en iOS el gesto de usuario expira
    // tras getUserMedia() y el contexto quedaría suspendido para siempre.
    this.ctx      = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume().catch(() => {});
    this._stream  = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    const src     = this.ctx.createMediaStreamSource(this._stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.75;
    src.connect(this.analyser); // no conecta a destination → no se escucha
  }

  // Inicia muestreo periódico (por defecto cada 5 min)
  startLogging(intervalSecs = 300) {
    this.sample(); // muestra inmediata
    this._timer = setInterval(() => this.sample(), intervalSecs * 1000);
  }

  stopLogging() { clearInterval(this._timer); }

  // Toma un snapshot acústico instantáneo
  sample() {
    if (!this.analyser) return null;

    const fSize    = this.analyser.fftSize;
    const nBins    = this.analyser.frequencyBinCount;
    const freqDB   = new Float32Array(nBins);
    const timeDom  = new Float32Array(fSize);
    this.analyser.getFloatFrequencyData(freqDB);
    this.analyser.getFloatTimeDomainData(timeDom);

    const sr       = this.ctx.sampleRate;
    const binW     = sr / fSize;

    // dBFS → lineal (0 = silencio)
    const linear   = Array.from(freqDB).map(db => Math.max(0, Math.pow(10, db / 20)));
    const total    = linear.reduce((a, b) => a + b, 0) || 1;

    // Centroide espectral (hz promedio ponderado por energía)
    const centroid = linear.reduce((acc, v, i) => acc + v * (i * binW), 0) / total;

    // Frecuencia dominante (pico espectral > 50 Hz)
    let peakBin = 0, peakVal = 0;
    const minBin = Math.ceil(50 / binW);
    for (let i = minBin; i < nBins; i++) {
      if (linear[i] > peakVal) { peakVal = linear[i]; peakBin = i; }
    }
    const dominantHz = peakBin * binW;

    // Energía por bandas
    const bands = {
      sub:  bandE(linear, 0,    80,   binW),
      bass: bandE(linear, 80,   320,  binW),
      mid:  bandE(linear, 320,  2500, binW),
      high: bandE(linear, 2500, 8000, binW),
    };

    // Densidad de transientes (cruces por cero en dominio del tiempo)
    let crossings = 0;
    for (let i = 1; i < timeDom.length; i++) {
      if (timeDom[i - 1] * timeDom[i] < 0) crossings++;
    }
    const transients = crossings / timeDom.length;

    // RMS (volumen)
    const rms = Math.sqrt(timeDom.reduce((a, v) => a + v * v, 0) / timeDom.length);

    const snapshot = {
      t: Date.now(),
      centroid:    clamp(centroid, 80, 12000),
      dominantHz:  clamp(dominantHz, 60, 8000),
      bands,
      transients:  clamp(transients, 0, 1),
      rms:         clamp(rms * 40, 0, 1), // normalizado
    };
    this.log.push(snapshot);
    return snapshot;
  }

  // Resumen estadístico del log acumulado
  summarize() {
    if (!this.log.length) return null;
    const avg  = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const sdev = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(v => (v-m)**2))); };
    return {
      centroid:     avg(this.log.map(s => s.centroid)),
      centroidStd:  sdev(this.log.map(s => s.centroid)),
      dominantHz:   avg(this.log.map(s => s.dominantHz)),
      transients:   avg(this.log.map(s => s.transients)),
      rms:          avg(this.log.map(s => s.rms)),
      bands: {
        sub:  avg(this.log.map(s => s.bands.sub)),
        bass: avg(this.log.map(s => s.bands.bass)),
        mid:  avg(this.log.map(s => s.bands.mid)),
        high: avg(this.log.map(s => s.bands.high)),
      },
      samples: this.log.length,
    };
  }

  destroy() {
    this.stopLogging();
    this._stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
  }
}

function bandE(linear, loHz, hiHz, binW) {
  const lo = Math.floor(loHz / binW);
  const hi = Math.ceil(hiHz  / binW);
  const sl = linear.slice(lo, hi);
  return sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : 0;
}

// Elige el contenedor de grabación que el AudioContext podrá decodificar después.
// Safari no decodifica webm/opus con decodeAudioData → allí se prefiere mp4/AAC.
export function pickRecordingMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const isSafari = /apple/i.test(navigator.vendor || '');
  const prefs = isSafari
    ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return prefs.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

// ─── Captura episódica de granos ─────────────────────────────────────────────
// Monitorea el RMS del micrófono y, cuando supera un umbral durante 2s,
// graba un fragmento de audio real. Los fragmentos se devuelven como
// ArrayBuffer para decodificar en el contexto de síntesis.
// El original nunca se almacena — solo el ArrayBuffer comprimido efímero.

export class GrainCapture {
  constructor(stream, analyser) {
    this._stream    = stream;
    this._analyser  = analyser;
    this._recording = false;
    this._lastCapt  = 0;
    this._monitor   = null;
    this._recorder  = null;
    this._blobs     = [];
    this._onCapture = null;
  }

  // onCapture(arrayBuffer) se llama al terminar cada captura
  start({ rmsThreshold = 0.14, duration = 16, cooldown = 90 } = {}, onCapture) {
    this._onCapture = onCapture;
    clearInterval(this._monitor); // evita monitores duplicados si se llama dos veces
    this._monitor = setInterval(() => {
      if (this._recording) return;
      if (Date.now() - this._lastCapt < cooldown * 1000) return;

      const buf = new Float32Array(this._analyser.fftSize);
      this._analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length) * 40;

      if (rms > rmsThreshold) this._record(duration);
    }, 2000);
  }

  _record(duration) {
    this._recording = true;
    this._lastCapt  = Date.now();
    this._blobs     = [];

    const mime = pickRecordingMime();
    try {
      this._recorder = new MediaRecorder(this._stream, mime ? { mimeType: mime } : {});
    } catch (e) {
      console.warn('MediaRecorder:', e);
      this._recording = false;
      return;
    }
    this._recorder.ondataavailable = e => { if (e.data.size > 0) this._blobs.push(e.data); };
    this._recorder.onerror = () => { this._recording = false; };
    this._recorder.onstop = () => {
      const blob = new Blob(this._blobs, { type: mime || 'audio/webm' });
      this._blobs = [];
      blob.arrayBuffer()
        .then(ab => { if (ab.byteLength > 0) this._onCapture?.(ab); })
        .catch(() => {})
        .finally(() => { this._recording = false; });
    };
    try {
      this._recorder.start();
    } catch (e) {
      console.warn('MediaRecorder.start:', e);
      this._recording = false;
      return;
    }
    setTimeout(() => {
      if (this._recorder?.state === 'recording') this._recorder.stop();
    }, duration * 1000);
  }

  stop() {
    clearInterval(this._monitor);
    if (this._recorder?.state === 'recording') this._recorder.stop();
  }
}
