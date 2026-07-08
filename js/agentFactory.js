// agentFactory.js — Genera agentes únicos a partir del log acústico del día
//
// El principio: lo que escucha el dispositivo durante el día se convierte
// en los parámetros de síntesis de 2-3 agentes únicos.
//
// No es transcripción ni identificación de sonidos.
// Es más análogo a cómo una planta crece hacia la luz:
// el dispositivo "crece" hacia las frecuencias y texturas de tu entorno.
//
// Resultado: definiciones de agente que audio.js puede sintetizar.
// Cada persona en cada día genera agentes distintos.

const lerp  = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createAgentsFromAcoustics(acousticSummary) {
  if (!acousticSummary) return {};

  const { centroid, centroidStd, dominantHz, transients, rms, bands, samples } = acousticSummary;

  // ── Carácter del entorno ──────────────────────────────────────────────────
  const brightness = bands.high / (bands.bass + bands.mid + 0.001); // 0=oscuro, alto=brillante
  const density    = transients;         // 0=silencioso/lento, 1=denso/urbano
  const depth      = bands.sub / (bands.high + 0.001); // 0=fino, alto=profundo/grave
  const variety    = clamp(centroidStd / centroid, 0, 1); // cuánto varió el ambiente

  const agents = {};

  // ── Agente 1: "Resonancia" ────────────────────────────────────────────────
  // Sintonizado a la frecuencia dominante de tu día.
  // Si estuviste toda la jornada en una oficina con el A/C a 220Hz → suena en 220Hz.
  // Si estuviste al aire libre → frecuencias naturales más altas y variables.
  agents['resonancia'] = {
    label: `resonancia ${Math.round(dominantHz)}hz`,
    type:  'gen_fm',
    params: {
      baseFreq:   clamp(dominantHz, 80, 3600),
      modRatio:   lerp(1.0, 4.5, brightness),       // brillo → timbre más armónico
      modDepth:   lerp(0.5, 3.0, variety),           // variedad → más movimiento en el timbre
      dur:        lerp(0.2, 1.2, 1 - density),       // entorno denso → eventos cortos
      vol:        lerp(0.04, 0.11, clamp(rms, 0, 1)),
      eventRate:  lerp(4, 20, density),              // más denso → más frecuente
    },
  };

  // ── Agente 2: "Textura" ───────────────────────────────────────────────────
  // La textura de fondo de tu entorno convertida en ruido filtrado.
  // Un día urbano → textura densa y de banda media.
  // Un día en naturaleza → textura suave y alta.
  // Un día en interior silencioso → muy leve, alta frecuencia.
  agents['textura'] = {
    label: `textura ${centroid > 2000 ? 'aguda' : centroid > 800 ? 'media' : 'grave'}`,
    type:  'gen_noise',
    params: {
      centroid:  clamp(centroid, 100, 8000),
      bandwidth: lerp(0.3, 2.5, variety),            // variedad → banda más ancha
      vol:       lerp(0.02, 0.08, clamp(rms * 0.6, 0, 1)),
      dur:       lerp(0.5, 3.0, 1 - density),
      eventRate: lerp(6, 25, density),
    },
  };

  // ── Agente 3: "Pulso" (solo si hay actividad significativa) ───────────────
  // Si tu día tuvo ritmo (conversaciones, pasos, máquinas), este agente
  // captura esa periodicidad y la convierte en un pulso abstracto.
  if (density > 0.04 && samples >= 3) {
    const pulseFreq = clamp(dominantHz * lerp(0.5, 2.0, brightness), 100, 2000);
    agents['pulso'] = {
      label: `pulso ${density > 0.08 ? 'denso' : 'suave'}`,
      type:  'gen_pulse',
      params: {
        freq:      pulseFreq,
        rate:      lerp(8, 3, density),              // más denso → más rápido
        hardness:  lerp(0.1, 0.85, depth),           // profundo → más suave, brillante → más duro
        vol:       lerp(0.03, 0.09, clamp(rms, 0, 1)),
        dur:       lerp(0.06, 0.25, 1 - density),
      },
    };
  }

  return agents; // { resonancia: {...}, textura: {...}, [pulso: {...}] }
}

// ── Perfil acústico falso para testing sin micrófono ─────────────────────────

export const ACOUSTIC_PRESETS = {
  oficina: {
    centroid: 580, centroidStd: 120,
    dominantHz: 220, transients: 0.04, rms: 0.28,
    bands: { sub: 0.12, bass: 0.45, mid: 0.32, high: 0.08 },
    samples: 18,
  },
  calle_ciudad: {
    centroid: 820, centroidStd: 380,
    dominantHz: 160, transients: 0.12, rms: 0.55,
    bands: { sub: 0.35, bass: 0.40, mid: 0.18, high: 0.06 },
    samples: 20,
  },
  bosque: {
    centroid: 3400, centroidStd: 900,
    dominantHz: 2800, transients: 0.06, rms: 0.18,
    bands: { sub: 0.03, bass: 0.08, mid: 0.25, high: 0.55 },
    samples: 24,
  },
  playa: {
    centroid: 680, centroidStd: 250,
    dominantHz: 320, transients: 0.08, rms: 0.40,
    bands: { sub: 0.30, bass: 0.35, mid: 0.22, high: 0.10 },
    samples: 16,
  },
  casa_silenciosa: {
    centroid: 1200, centroidStd: 60,
    dominantHz: 440, transients: 0.015, rms: 0.08,
    bands: { sub: 0.04, bass: 0.12, mid: 0.10, high: 0.05 },
    samples: 22,
  },
};
