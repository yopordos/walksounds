// context.js — Detector analógico de contexto ambiental
//
// Solo señales físicas directas. Sin ML, sin APIs de clasificación.
// Como un termómetro bimetálico: responde lentamente a señales físicas.
//
// Tres sensores:
//   altitud GPS        → discrimina montaña / ciudad / interior
//   velocidad GPS      → discrimina vehículo (urbano) de caminata
//   regularidad IMU    → pavimento urbano (cadencia regular) vs terreno natural (irregular)

export const CONTEXTS = ['interior', 'urbano', 'naturaleza', 'montana'];

export class ContextDetector {
  constructor() {
    this._alt     = 0;    // metros GPS
    this._spd     = 0;    // m/s GPS
    this._mvReg   = 0.5;  // 0=irregular/natural → 1=regular/urbano
    this._mvSamples = []; // ventana deslizante de energía de movimiento

    // Estado con histéresis — el contexto cambia despacio (como un termostato)
    this._score = { interior: 0, urbano: 0, naturaleza: 0, montana: 0 };
    this._current = 'naturaleza';

    this.onChange = null; // callback (nuevoContexto, scores)
  }

  // Llamar cada vez que llega un fix de GPS
  updateGPS(coords) {
    if (!coords) return;
    this._alt = coords.altitude ?? this._alt;
    this._spd = coords.speed    ?? 0;
    this._recompute();
  }

  // Llamar con la magnitud de aceleración (m/s²) de cada frame del IMU
  updateMotion(accelMagnitude) {
    this._mvSamples.push(accelMagnitude);
    if (this._mvSamples.length > 40) this._mvSamples.shift(); // ventana 40 muestras (~8s)
    if (this._mvSamples.length >= 10) {
      const avg = mean(this._mvSamples);
      const cv  = avg > 0 ? stddev(this._mvSamples) / avg : 0; // coeficiente de variación
      // Alta varianza → terreno irregular → naturaleza
      // Baja varianza → cadencia regular → pavimento urbano
      this._mvReg = Math.max(0, Math.min(1, 1 - cv * 1.8));
    }
  }

  // Contexto activo con histéresis de 30 votos (≈1 min si se llama cada 2s)
  _recompute() {
    const raw = this._classify();

    // Decaer todos los scores, subir el actual
    CONTEXTS.forEach(c => {
      this._score[c] = Math.max(0, this._score[c] * 0.92 - 0.5);
    });
    this._score[raw] = Math.min(100, this._score[raw] + 8);

    // Cambiar contexto solo si hay un ganador claro (+20 sobre el segundo)
    const sorted = CONTEXTS.slice().sort((a,b) => this._score[b] - this._score[a]);
    const gap = this._score[sorted[0]] - (this._score[sorted[1]] ?? 0);
    if (gap > 20 && sorted[0] !== this._current) {
      this._current = sorted[0];
      this.onChange?.(this._current, { ...this._score });
    }
  }

  // Clasificación instantánea — reglas físicas directas
  _classify() {
    const alt = this._alt;
    const spd = this._spd; // m/s (GPS)
    const reg = this._mvReg;

    if (alt > 700)                   return 'montana';
    if (spd > 4.2)                   return 'urbano';   // vehículo (>15 km/h)
    if (alt < 100 && reg > 0.70)     return 'urbano';   // pavimento regular a baja altitud
    if (alt < 50  && spd < 0.25)     return 'interior'; // quieto a nivel del mar
    if (alt > 220)                   return 'naturaleza';
    if (reg < 0.35)                  return 'naturaleza'; // terreno muy irregular
    return 'naturaleza';
  }

  get context() { return this._current; }
  get scores()  { return { ...this._score }; }
}

// ─── Paleta sonora por contexto ───────────────────────────────────────────────
// Qué agentes son posibles en cada contexto y su peso relativo de aparición.
// Los agentes naturales y urbanos coexisten según el contexto.

export const PALETTE = {
  montana: {
    pajaro: 0.35, hojas: 0.6, gota: 0.5, grillo: 0.2,
    rama: 0.3,
  },
  naturaleza: {
    pajaro: 0.7, cigarra: 0.4, grillo: 0.55, rana: 0.3,
    hojas: 0.5, gota: 0.2, lechuza: 0.12,
    raton: 0.08,
  },
  urbano: {
    trafico: 0.80, voces: 0.65, bocina: 0.30,
    perro: 0.35, gato: 0.20,
    pajaro: 0.18, grillo: 0.10, // naturales residuales
    hojas: 0.15,
  },
  interior: {
    voces: 0.50, raton: 0.20,
    gato: 0.15, perro: 0.08,
    gota: 0.10, // gotera
  },
};

// ─── Utils ────────────────────────────────────────────────────────────────────
function mean(arr)   { return arr.reduce((a,b)=>a+b,0)/arr.length; }
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length);
}
