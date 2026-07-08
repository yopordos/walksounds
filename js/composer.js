// composer.js — Algoritmo de composición
// Toma el log de un día y genera una partitura (score) para el player.
//
// El día NO se reproduce cronológicamente.
// La curva de energía del movimiento define la FORMA de la pieza.
//
// La PALETA SONORA surge de tres factores físicos reales:
//   Factor 1 – Contexto sonoro (micrófono): brightness, density, rms
//   Factor 2 – Clima (weatherCode, temperature): carácter emocional
//   Factor 3 – Movimiento (IMU): densidad y ritmo

const rnd   = (a, b)    => a + Math.random() * (b - a);
const lerp  = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const avg   = arr       => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Detecta el contexto dominante de un log por señales físicas directas
function detectContextFromLog(log) {
  const avgAlt = avg(log.map(e => e.altitude ?? 0));
  const avgSpd = avg(log.map(e => e.gpsSpeed  ?? 0));
  if (avgAlt > 600)                 return 'montana';
  if (avgSpd > 3.0)                 return 'urbano';
  if (avgAlt < 80 && avgSpd > 1.5) return 'urbano';
  if (avgAlt < 50 && avgSpd < 0.3) return 'interior';
  return 'naturaleza';
}

// ─── Paso 1: Resumir el día ───────────────────────────────────────────────────

function summarize(log) {
  const movements    = log.map(e => e.movement);
  const temps        = log.map(e => e.temperature).filter(t => t != null);
  const altitudes    = log.map(e => e.altitude).filter(a => a != null);
  const weatherCodes = log.map(e => e.weatherCode).filter(w => w != null);

  const isRainy  = weatherCodes.some(w => (w >= 51 && w <= 82) || (w >= 61 && w <= 67));
  const isStorm  = weatherCodes.some(w => w >= 95);
  const maxCode  = weatherCodes.length ? Math.max(...weatherCodes) : 0;

  return {
    avgMovement:  avg(movements),
    peakMovement: Math.max(...movements, 0),
    movements,
    avgTemp:      avg(temps),
    isRainy,
    isStorm,
    maxCode,
    avgAltitude:  avg(altitudes),
  };
}

// ─── Paso 2: Curva de energía — forma de la pieza ────────────────────────────

function buildEnergyCurve(movements) {
  const sigma  = 4;
  const smooth = movements.map((_, i) => {
    let sum = 0, weight = 0;
    movements.forEach((v, j) => {
      const w = Math.exp(-0.5 * ((i - j) / sigma) ** 2);
      sum    += v * w;
      weight += w;
    });
    return sum / weight;
  });

  const min = Math.min(...smooth);
  const max = Math.max(...smooth);
  const range = max - min || 1;
  const normalized = smooth.map(v => (v - min) / range);

  return Array.from({ length: 100 }, (_, i) => {
    const pos = (i / 99) * (normalized.length - 1);
    const lo  = Math.floor(pos);
    const hi  = Math.min(lo + 1, normalized.length - 1);
    return lerp(normalized[lo], normalized[hi], pos - lo);
  });
}

// ─── Paso 3: Atmósfera base ───────────────────────────────────────────────────

function buildAtmosphere(summary) {
  const warmth   = clamp((summary.avgTemp - (-5)) / (34 - (-5)), 0, 1);
  const altitude = clamp(summary.avgAltitude / 2500, 0, 1);
  const energy   = summary.isRainy
    ? clamp(0.25 + summary.avgMovement * 0.15, 0.15, 0.45)
    : clamp(0.45 + summary.avgMovement * 0.45, 0.3, 0.95);

  return { warmth, altitude, energy, isRainy: summary.isRainy };
}

// ─── Paso 4: Paleta desde tres factores ──────────────────────────────────────
// Genera { especie: prominence 0-1 } sin presets.
// Cada día/persona produce una mezcla diferente.

// Devuelve { palette, sparsity }
// sparsity: multiplicador de intervalo entre eventos (>1 = más silencioso)
function buildPaletteFromFactors(summary, acoustic, captureCount = 0) {
  const { avgMovement, avgTemp, avgAltitude, isRainy, isStorm } = summary;

  // ── Derivar dimensiones desde los tres factores ───────────────────────────
  const warmth   = clamp((avgTemp - (-5)) / 39, 0, 1);          // -5°=0  34°=1
  const altitude = clamp(avgAltitude / 2500, 0, 1);
  const isCold   = avgTemp < 8;
  const isHot    = avgTemp > 26;

  // Factor 1 — mic acústico (si hay datos reales, si no: neutro)
  const bright   = acoustic
    ? clamp(acoustic.bands.high / (acoustic.bands.bass + acoustic.bands.mid + 0.001), 0, 1)
    : 0.28;
  const density  = acoustic ? clamp(acoustic.transients, 0, 1) : 0.04;
  const rmsLevel = acoustic ? clamp(acoustic.rms, 0, 1) : 0.30;

  // ── Factor 3: movimiento → densidad + metal en movimiento ────────────────
  const p = {};
  p.resonador   = clamp(avgMovement * 0.80 + density * 0.28, 0.05, 1.0);
  if (avgMovement > 0.28) {
    p.pulso_metal = clamp(lerp(0.10, 0.78, avgMovement), 0, 1);
  }

  // ── Factor 2: clima → carácter emocional ─────────────────────────────────
  if (isStorm) {
    p.gota_metal = 1.0;
    p.viento     = 0.80;
    p.cristal    = isCold ? 0.55 : 0.22;
    p.arco       = 0.35;
  } else if (isRainy) {
    p.gota_metal = 0.85;
    p.aliento    = 0.52;
    p.cuerda     = clamp(0.62 - avgMovement * 0.55, 0.08, 0.72);
    p.cristal    = isCold ? 0.58 : 0.18;
  } else if (isCold) {
    p.cristal    = 0.90;
    p.arco       = clamp(0.72 - avgMovement * 0.85, 0, 0.72);
    p.campana    = 0.48;
    p.cuerda     = 0.38;
  } else if (isHot) {
    p.resonador  = (p.resonador || 0) + 0.22;
    p.viento     = altitude > 0.18 ? lerp(0.18, 0.62, altitude) : 0.12;
    p.campana    = 0.30;
  } else {
    // Templado/claro — mezcla más orgánica
    p.campana    = clamp(0.32 + bright * 0.38 + altitude * 0.22, 0.10, 0.95);
    p.cuerda     = clamp(0.52 - avgMovement * 0.40, 0.05, 0.72);
    p.aliento    = clamp(0.18 + avgMovement * 0.22, 0.08, 0.62);
  }

  // ── Factor 1: mic → timbre base ───────────────────────────────────────────
  // Entorno denso/oscuro → resonadores y voces lejanas
  // Entorno brillante → cristal y campanas
  if (density > 0.055 && bright < 0.30) {
    p.voz_lejana = clamp((density - 0.04) * 9 * (1 - bright), 0, 0.68);
  }
  if (bright > 0.22) {
    p.cristal = (p.cristal  || 0) + clamp(bright * 0.42, 0, 0.42);
    p.campana = (p.campana  || 0) + clamp(bright * 0.28, 0, 0.35);
  }

  // Aliento: siempre presente como hilo conductor (el "aire" del día)
  p.aliento = Math.max(p.aliento || 0, clamp(0.14 + rmsLevel * 0.18, 0.08, 0.52));

  // Arco: solo en días muy quietos
  if (avgMovement < 0.32 && !isStorm) {
    p.arco = Math.max(p.arco || 0, clamp(0.52 - avgMovement * 1.25, 0, 0.58));
  }

  // Aliento siempre presente — es la respiración constante del sistema,
  // lo que hace que nunca haya silencio total y se sienta acompañado.
  p.aliento = Math.max(p.aliento || 0, 0.35);

  // ── Capa granular — las capturas son el protagonista ─────────────────────
  let sparsity = 1.0;

  if (captureCount > 0) {
    p.granular = 0.95;
    Object.keys(p).forEach(k => { if (k !== 'granular') p[k] = (p[k] || 0) * 0.50; });
    sparsity = 0.85;
  } else {
    // Sparsity reducida: quieto ≠ silencioso. Cambia el carácter, no la presencia.
    if (rmsLevel < 0.10) sparsity = 1.8;
    else if (rmsLevel < 0.20) sparsity = 1.3;
    else if (rmsLevel < 0.35) sparsity = 1.05;
  }

  // ── Normalizar: dominante = 1.0, cortar < 12% ────────────────────────────
  const maxVal = Math.max(...Object.values(p).filter(v => v > 0), 0.01);
  const palette = {};
  Object.entries(p).forEach(([k, v]) => {
    if (v / maxVal >= 0.12) palette[k] = v / maxVal;
  });

  return { palette, sparsity };
}

// ─── Paso 5: Programar eventos ────────────────────────────────────────────────

// Modulación 1/f para el scheduling de eventos.
// La teoría 1/f (Voss & Clarke, 1975) muestra que la música real tiene
// distribución 1/f en duración de notas: a veces rachas densas, a veces
// silencios largos — en todas las escalas temporales simultáneamente.
// Aquí se aproxima sumando tres senos a distintas escalas (como Fourier 1/f).
function make1fDensityFn(duration) {
  // Fases aleatorias — distintas cada composición
  const p1 = rnd(0, Math.PI * 2);
  const p2 = rnd(0, Math.PI * 2);
  const p3 = rnd(0, Math.PI * 2);
  return (t) => {
    // Suma de tres ciclos: largo (≈120s), medio (≈35s), corto (≈12s)
    const wave =  0.55 * Math.sin(t * (Math.PI * 2 / 120) + p1)
               +  0.30 * Math.sin(t * (Math.PI * 2 / 35)  + p2)
               +  0.15 * Math.sin(t * (Math.PI * 2 / 12)  + p3);
    // Mapear -1…1 a 0.25…2.0 (factor de intervalo: bajo = racha, alto = silencio)
    return clamp(1.0 + wave * 0.75, 0.25, 2.0);
  };
}

// ─── Paso 5: Programar eventos — capas rítmicas 1/f ─────────────────────────
//
// La música 1/f real (Voss & Clarke 1975) tiene correlación a múltiples escalas:
// bursts cortos frecuentes, pausas medias, silencios largos ocasionales.
// Se modela distribuyendo las especies en tres capas de tempo anidadas:
//
//   Capa rápida  (top 1-2): 1.5-5s  → pulso, sensación de presencia constante
//   Capa media   (3-4):     5-14s   → frases, eventos expresivos
//   Capa lenta   (resto):   14-28s  → momentos especiales, rareza
//
// El resultado: nunca hay más de ~5s de silencio en condiciones normales.

function scheduleEvents(palette, curve, duration, sparsity = 1.0) {
  const events    = [];
  const density1f = make1fDensityFn(duration);

  const entries = Object.entries(palette).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return events;

  // Asignar capa rítmica según posición en la paleta ordenada por prominencia
  const layers = entries.map(([species, prominence], i) => ({
    species, prominence,
    minInt: i < 2 ? 2.5 : i < 4 ? 7.0  : 16.0,
    maxInt: i < 2 ? 5.5 : i < 4 ? 14.0 : 28.0,
  }));

  layers.forEach(({ species, prominence, minInt, maxInt }) => {
    const baseInterval = lerp(maxInt, minInt, prominence ** 0.65) * sparsity;
    let t = rnd(0.5, baseInterval * 0.55);

    while (t < duration) {
      const curveFrac = Math.floor((t / duration) * 100);
      const energy    = curve[clamp(curveFrac, 0, 99)];

      // Probabilidad más conservadora — los eventos son presencias, no ruido
      const fireP = lerp(0.42, 0.85, prominence) * lerp(0.72, 1.0, energy);
      if (Math.random() < fireP) {
        events.push({ time: Math.round(t * 100) / 100, species });
      }

      const poisson  = -baseInterval * Math.log(Math.random() + 1e-10);
      const slowdown = lerp(1.8, 1.0, energy);
      t += Math.max(0.5, poisson * slowdown * density1f(t));
    }
  });

  return events.sort((a, b) => a.time - b.time);
}

// ─── Paso 6: Estructura narrativa ────────────────────────────────────────────

function buildStructure(curve, duration) {
  const peakIdx     = curve.indexOf(Math.max(...curve));
  const peakTime    = (peakIdx / 99) * duration;
  const introEnd    = Math.min(peakTime * 0.25, 35);
  const climaxStart = Math.max(peakTime - duration * 0.1, introEnd + 10);
  const climaxEnd   = Math.min(peakTime + duration * 0.1, duration - 25);

  return {
    intro:       { start: 0,           end: introEnd },
    development: { start: introEnd,    end: climaxStart },
    climax:      { start: climaxStart, end: climaxEnd },
    outro:       { start: climaxEnd,   end: duration },
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

// acousticSummary: resultado de AcousticSensor.summarize() — null si no hay mic
export function composeDay(log, acousticSummary = null, captureCount = 0) {
  if (!log?.length) return null;

  const summary    = summarize(log);
  const context    = detectContextFromLog(log);
  const duration   = Math.round(lerp(150, 300, summary.avgMovement));
  const curve      = buildEnergyCurve(summary.movements);
  const atmosphere               = buildAtmosphere(summary);
  const { palette, sparsity }   = buildPaletteFromFactors(summary, acousticSummary, captureCount);
  const events                  = scheduleEvents(palette, curve, duration, sparsity);
  const structure                = buildStructure(curve, duration);

  return {
    duration, curve, atmosphere, events, structure, summary, context,
    palette, sparsity,
    acousticSummary,
  };
}

// ─── Helpers de display ───────────────────────────────────────────────────────

export function describeScore(score) {
  const { summary, duration, events, palette } = score;
  const topPalette = Object.entries(palette || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k)
    .join('  ·  ');

  return {
    duracion:    `${Math.round(duration / 60)}m ${duration % 60}s`,
    temperatura: `${Math.round(summary.avgTemp)}°`,
    movimiento:  summary.avgMovement > 0.75 ? 'muy activo'
               : summary.avgMovement > 0.55 ? 'en movimiento'
               : summary.avgMovement > 0.35 ? 'caminando'
               : summary.avgMovement > 0.15 ? 'tranquilo'
               : 'quieto',
    clima:       summary.isStorm ? 'tormenta' : summary.isRainy ? 'lluvia' : summary.avgAltitude > 700 ? 'altura' : 'despejado',
    palette:     topPalette,
    nEventos:    events.length,
  };
}
