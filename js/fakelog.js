// Perfiles de día — arquetipos con contextos muy distintos
// context: 'urbano' | 'naturaleza' | 'montana' | 'interior' | 'mixto'

const rnd   = (a, b) => a + Math.random() * (b - a);
const lerp  = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function makeLog({ temp, weatherCode, altitude, gpsSpeed, movementCurve, agentRules }) {
  const entries = [];
  const start = 6, end = 23, step = 15;
  const total = ((end - start) * 60) / step;

  for (let i = 0; i <= total; i++) {
    const hour    = start + (i * step) / 60;
    const fracDay = (hour - start) / (end - start);
    const movement = clamp(movementCurve(fracDay) + rnd(-0.04, 0.04), 0, 1);
    const t        = temp + Math.sin(fracDay * Math.PI) * 3 + rnd(-0.8, 0.8);
    const spd      = typeof gpsSpeed === 'function' ? gpsSpeed(fracDay, movement) : gpsSpeed;

    entries.push({
      timestamp:    Date.now() - (total - i) * step * 60 * 1000,
      hour, movement,
      temperature:  Math.round(t * 10) / 10,
      weatherCode,
      altitude:     Math.max(0, altitude + rnd(-15, 15)),
      gpsSpeed:     Math.max(0, spd + rnd(-0.2, 0.2)),
      agentsActive: agentRules(hour, t, movement, spd),
    });
  }
  return entries;
}

// ─── 7 arquetipos con identidad sonora muy diferente ─────────────────────────

export const DAYS = {

  // ① VERANO ACTIVO — pájaros + cigarras, cálido, mucho movimiento
  'verano': {
    label: 'Verano activo',
    description: '34°C · despejado · pájaros + cigarras · mucho movimiento',
    atmoHint: 'cálido, brillante, lleno',
    log: () => makeLog({
      temp: 34, weatherCode: 0, altitude: 65, gpsSpeed: 1.2,
      movementCurve: t =>
        t < 0.30 ? lerp(0.15, 0.90, t / 0.30) :
        t < 0.55 ? lerp(0.90, 0.50, (t - 0.30) / 0.25) :
                   lerp(0.50, 0.72, (t - 0.55) / 0.45),
      agentRules: (h, temp, mv) => {
        const a = [];
        if (h >= 6  && h <= 10) { a.push('pajaro'); if (h <= 8) a.push('pajaro'); }
        if (h >= 10 && h <= 20 && temp > 26) { a.push('cigarra'); if (temp > 30) a.push('cigarra'); }
        if (mv > 0.20) a.push('hojas');
        if (h >= 20) { a.push('grillo'); a.push('rana'); }
        if (h >= 22) a.push('lechuza');
        return a;
      },
    }),
  },

  // ② TORMENTA NOCTURNA — solo gotas + lechuza, quieto, reverb máximo
  'tormenta': {
    label: 'Tormenta nocturna',
    description: '7°C · lluvia intensa · solo agua y lechuza · sin movimiento',
    atmoHint: 'frío, húmedo, oscuro, reverb máximo',
    log: () => makeLog({
      temp: 7, weatherCode: 65, altitude: 40, gpsSpeed: 0,
      movementCurve: _t => rnd(0.01, 0.08),
      agentRules: (h) => {
        const a = ['gota', 'gota', 'gota'];
        if (h >= 20 || h <= 6) { a.push('lechuza'); a.push('gota'); }
        return a;
      },
    }),
  },

  // ③ AMANECER EN BOSQUE — solo pájaros, movimiento mínimo, espacioso
  'amanecer': {
    label: 'Amanecer en bosque',
    description: '13°C · despejado · coro de pájaros · quieto',
    atmoHint: 'fresco, suave, espacioso',
    log: () => makeLog({
      temp: 13, weatherCode: 1, altitude: 280, gpsSpeed: 0.4,
      movementCurve: t => lerp(0, 0.18, Math.sin(t * Math.PI * 1.5)),
      agentRules: (h) => {
        const a = [];
        if (h >= 6  && h <= 8)  { a.push('pajaro', 'pajaro', 'pajaro'); }
        else if (h >= 8  && h <= 11) { a.push('pajaro', 'pajaro'); }
        else if (h >= 11 && h <= 15) { a.push('pajaro'); }
        else if (h >= 16 && h <= 19) { a.push('pajaro'); }
        if (h >= 20) { a.push('grillo'); }
        if (h >= 21) { a.push('lechuza'); }
        return a;
      },
    }),
  },

  // ④ TREKKING EN MONTAÑA — altura, frío, ramas, muy escaso
  'montana': {
    label: 'Trekking de montaña',
    description: '3°C · nublado · 2200m · movimiento sostenido · escaso',
    atmoHint: 'altura, reverb enorme, silencio profundo',
    log: () => makeLog({
      temp: 3, weatherCode: 2, altitude: 2200, gpsSpeed: 1.4,
      movementCurve: t =>
        t < 0.45 ? lerp(0.25, 0.88, t / 0.45) :
                   lerp(0.88, 0.18, (t - 0.45) / 0.55),
      agentRules: (h, temp, mv) => {
        const a = [];
        if (h >= 7 && h <= 9) a.push('pajaro');
        if (mv > 0.30) a.push('hojas');
        if (mv > 0.55) a.push('rama');
        if (temp < 6)  a.push('gota');
        if (h >= 19)   a.push('grillo');
        return a;
      },
    }),
  },

  // ⑤ TARDE TROPICAL — ciclo: cigarras → lluvia → ranas, húmedo y denso
  'tropical': {
    label: 'Tarde tropical',
    description: '29°C · chubascos · cigarras → lluvia → ranas',
    atmoHint: 'húmedo, denso, caluroso',
    log: () => makeLog({
      temp: 29, weatherCode: 80, altitude: 30, gpsSpeed: 0.8,
      movementCurve: t =>
        t < 0.20 ? lerp(0.10, 0.60, t / 0.20) :
        t < 0.45 ? lerp(0.60, 0.80, (t - 0.20) / 0.25) :
        t < 0.65 ? lerp(0.80, 0.25, (t - 0.45) / 0.20) : // pausa de lluvia
                   lerp(0.25, 0.45, (t - 0.65) / 0.35),
      agentRules: (h, _, mv) => {
        const a = [];
        if (h >= 8  && h <= 12) a.push('pajaro');
        if (h >= 11 && h <= 16) { a.push('cigarra', 'cigarra'); }
        if (h >= 14 && h <= 17) { a.push('gota', 'gota'); }
        if (h >= 17 && h <= 23) { a.push('rana', 'rana', 'grillo'); }
        if (mv > 0.12)          a.push('hojas');
        return a;
      },
    }),
  },

  // ⑥ DÍA URBANO — tráfico + voces + bocinas + perros + gatos
  'urbano': {
    label: 'Jornada urbana',
    description: '20°C · ciudad · tráfico, voces, bocinas, perros',
    atmoHint: 'ruidoso, denso, sin silencio',
    log: () => makeLog({
      temp: 20, weatherCode: 3, altitude: 42,
      gpsSpeed: (fracDay, mv) => {
        // Velocidad variable: caminando + ratos en bus/metro
        if (fracDay > 0.15 && fracDay < 0.22) return rnd(4.5, 8); // commute mañana
        if (fracDay > 0.65 && fracDay < 0.72) return rnd(4.5, 8); // commute tarde
        return mv * 1.6;
      },
      movementCurve: t =>
        t < 0.15 ? lerp(0.1, 0.7, t / 0.15) :
        t < 0.22 ? 0.85 : // commute mañana
        t < 0.65 ? 0.45 + Math.sin(t * 10) * 0.15 : // día de trabajo
        t < 0.72 ? 0.85 : // commute tarde
                   lerp(0.7, 0.2, (t - 0.72) / 0.28),
      agentRules: (h, _, mv, spd) => {
        const a = [];
        if (spd > 3.5) {
          a.push('trafico', 'trafico'); // en vehículo
        } else {
          a.push('trafico');
          if (h >= 8 && h <= 21) { a.push('voces'); if (mv > 0.4) a.push('voces'); }
          if (Math.random() < 0.25) a.push('bocina');
          if (Math.random() < 0.20) a.push('perro');
          if (Math.random() < 0.10) a.push('gato');
        }
        if (h >= 7 && h <= 9) a.push('pajaro'); // pájaros urbanos
        return a;
      },
    }),
  },

  // ⑦ MIXTO — naturaleza en la mañana, ciudad en la tarde
  'mixto': {
    label: 'Mañana en parque → tarde en ciudad',
    description: '18°C · parque al amanecer → ciudad → noche en casa',
    atmoHint: 'contraste: naturaleza → urbano → interior',
    log: () => makeLog({
      temp: 18, weatherCode: 1, altitude: 55,
      gpsSpeed: (fracDay, mv) =>
        fracDay > 0.45 && fracDay < 0.52 ? rnd(5, 9) : mv * 1.2,
      movementCurve: t =>
        t < 0.35 ? lerp(0.15, 0.60, t / 0.35) : // parque mañana
        t < 0.45 ? lerp(0.60, 0.80, (t - 0.35) / 0.10) : // hacia ciudad
        t < 0.52 ? 0.90 :  // commute
        t < 0.78 ? 0.50 :  // trabajo
                   lerp(0.50, 0.05, (t - 0.78) / 0.22), // casa noche
      agentRules: (h, temp, mv, spd) => {
        const a = [];
        // Mañana: parque natural
        if (h >= 6 && h <= 13) {
          if (h <= 10) a.push('pajaro', 'pajaro');
          if (h > 10) a.push('pajaro');
          if (mv > 0.2) a.push('hojas');
          a.push('raton');
        }
        // Tarde: ciudad
        if (h >= 13 && h <= 20) {
          a.push('trafico', 'voces');
          if (spd > 3.5) a.push('trafico');
          if (Math.random() < 0.3) a.push('bocina');
          if (Math.random() < 0.25) a.push('perro');
          if (Math.random() < 0.12) a.push('gato');
        }
        // Noche: interior
        if (h >= 20) {
          a.push('voces'); // televisión, conversación
          if (Math.random() < 0.15) a.push('raton');
          if (Math.random() < 0.10) a.push('gato');
        }
        return a;
      },
    }),
  },
};

// ─── Log generado desde el momento actual ────────────────────────────────────
// Hemisferio sur (Chile). Cada día del año produce un log base distinto.
// El mic, la aceleración real y la hora modulan el resultado.

// weatherOverride: { temp, weatherCode } opcionales desde la API real
export function generateTodayLog(weatherOverride = null) {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const date  = now.getDate();

  // Semilla por día — misma forma base cada día
  const seed = (now.getFullYear() % 100) * 10000 + month * 100 + date;
  const sr   = n => Math.abs(Math.sin(seed * 9301 + n * 49297 + 233));

  // Clima sintético de respaldo (hemisferio sur)
  const isWinter   = month >= 6 && month <= 8;
  const isSummer   = month >= 12 || month <= 2;
  const isRainyDay = sr(1) < (isWinter ? 0.45 : isSummer ? 0.08 : 0.28);
  const isStorm    = isRainyDay && sr(2) < 0.20;

  const syntheticTemp = isWinter  ? lerp(5,  14, sr(3))
                      : isSummer  ? lerp(22, 34, sr(3))
                      : lerp(12, 22, sr(3));
  const syntheticCode = isStorm    ? 95
                      : isRainyDay ? (isWinter ? 65 : 61)
                      : isSummer   ? 0
                      : clamp(Math.floor(sr(4) * 3), 0, 2);

  // Si hay datos reales de la API, los usamos
  const finalTemp = weatherOverride?.temp        ?? syntheticTemp;
  const finalCode = weatherOverride?.weatherCode ?? syntheticCode;

  const altitude = lerp(30, 180, sr(5));

  const peakFrac = lerp(0.25, 0.60, sr(6));
  const width    = lerp(0.10, 0.22, sr(7));
  const movementCurve = t => {
    const gauss = Math.exp(-((t - peakFrac) ** 2) / (2 * width ** 2));
    return clamp(gauss * lerp(0.55, 1.0, sr(8 + t)) + lerp(0.02, 0.08, sr(9)), 0, 1);
  };

  return makeLog({
    temp: finalTemp,
    weatherCode: finalCode,
    altitude,
    gpsSpeed: lerp(0.3, 1.5, sr(10)),
    movementCurve,
    agentRules: () => [],
  });
}
