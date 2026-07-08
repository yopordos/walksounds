// Síntesis de audio por especie — orgánico, sin samples externos

const rnd   = (a, b)    => a + Math.random() * (b - a);
const lerp  = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioEngine {
  constructor() {
    this.ctx  = null;
    this._n   = {};
    this._atmoVol   = 1;
    this._agentsVol = 1;
    this._noiseBuffer = null;
    this._world   = { energy: 0.5, warmth: 0.5, altitude: 0 };
    this._ctxCfg  = null;
    this._context = null;
    this._disturbance = 0;
  }

  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this._noiseBuffer     = this._makeNoiseBuffer(8);     // blanco — ataques percusivos
    this._pinkNoiseBuffer = this._makePinkNoiseBuffer(8); // rosa  — atmósfera
    this._buildAtmosphere();
  }

  // ─── Atmósfera continua (siempre activa) ─────────────────────────────────

  _buildAtmosphere() {
    const ctx = this.ctx;
    const n   = this._n;

    n.atmoOut    = ctx.createGain(); n.atmoOut.gain.value = 0;
    n.atmoVol    = ctx.createGain(); n.atmoVol.gain.value   = this._atmoVol;
    n.agentsOut  = ctx.createGain(); n.agentsOut.gain.value = 1;
    n.agentsVol  = ctx.createGain(); n.agentsVol.gain.value = this._agentsVol;
    n.reverb     = ctx.createConvolver(); n.reverb.buffer = this._makeReverb(6.5);
    n.reverbGain = ctx.createGain(); n.reverbGain.gain.value = 0.55;
    n.dryGain    = ctx.createGain(); n.dryGain.gain.value    = 0.45;
    n.master     = ctx.createGain(); n.master.gain.value     = 0;

    // Fondo: atmoOut → atmoVol → reverb/dry
    n.atmoOut.connect(n.atmoVol);
    n.atmoVol.connect(n.reverb);
    n.atmoVol.connect(n.dryGain);
    // Agentes: agentsOut → agentsVol → reverb/dry
    n.agentsOut.connect(n.agentsVol);
    n.agentsVol.connect(n.reverb);
    n.agentsVol.connect(n.dryGain);

    n.reverb.connect(n.reverbGain);
    n.reverbGain.connect(n.master);
    n.dryGain.connect(n.master);
    n.master.connect(ctx.destination);

    n.atmoBands = [
      { freq: 160,  Q: 1.8, gain: 0.16, lfoRate: 0.019 },
      { freq: 650,  Q: 2.2, gain: 0.11, lfoRate: 0.041 },
      { freq: 2600, Q: 2.8, gain: 0.06, lfoRate: 0.067 },
    ].map(({ freq, Q, gain, lfoRate }) => {
      const src    = this._pinkNoiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = Q;
      const gainN = ctx.createGain(); gainN.gain.value = gain;
      const lfo   = ctx.createOscillator(); lfo.frequency.value = lfoRate;
      const lfoG  = ctx.createGain(); lfoG.gain.value = gain * 0.18; // modulación muy sutil
      lfo.connect(lfoG); lfoG.connect(gainN.gain);
      src.connect(filter); filter.connect(gainN); gainN.connect(n.atmoOut);
      lfo.start(); src.start();
      return { filter, gainN, lfo, lfoG, baseGain: gain, baseFreq: freq, baseQ: Q };
    });

    // Dron de tierra — fundamental + octava baja
    n.ground  = ctx.createOscillator(); n.ground.type  = 'sine'; n.ground.frequency.value  = 46;
    n.groundG = ctx.createGain();       n.groundG.gain.value = 0.06;
    n.ground2 = ctx.createOscillator(); n.ground2.type = 'sine'; n.ground2.frequency.value = 23; // sub
    n.groundG2 = ctx.createGain();      n.groundG2.gain.value = 0.04;
    n.ground.connect(n.groundG);   n.groundG.connect(n.atmoOut);
    n.ground2.connect(n.groundG2); n.groundG2.connect(n.atmoOut);
    n.ground.start(); n.ground2.start();

    // LFO lento para el tono del dron (ciclo ~80s — imperceptible como modulación)
    n.droneLFO  = ctx.createOscillator(); n.droneLFO.frequency.value  = 0.013;
    n.droneLFOG = ctx.createGain();       n.droneLFOG.gain.value = 3.5;
    n.droneLFO.connect(n.droneLFOG); n.droneLFOG.connect(n.ground.frequency);
    n.droneLFO.start();

    // LFO de deriva de atmósfera (ciclo ~140s — fondo va "respirando")
    n.driftLFO  = ctx.createOscillator(); n.driftLFO.frequency.value  = 0.007;
    n.driftLFOG = ctx.createGain();       n.driftLFOG.gain.value = 0.02;
    n.driftLFO.connect(n.driftLFOG); n.driftLFOG.connect(n.atmoOut.gain);
    n.driftLFO.start();

    // Capa de clima — ruido moldeado por temperatura
    // Calor + movimiento → brisa (HP noise, suave)
    // Frío → lluvia (BP noise + LFO rápido de amplitud)
    n.weatherSrc = this._pinkNoiseSource();
    n.weatherHP  = ctx.createBiquadFilter();
    n.weatherHP.type = 'highpass'; n.weatherHP.frequency.value = 2400; n.weatherHP.Q.value = 0.3;
    n.weatherLP  = ctx.createBiquadFilter();
    n.weatherLP.type = 'lowpass';  n.weatherLP.frequency.value = 9000;
    n.weatherG   = ctx.createGain(); n.weatherG.gain.value = 0;
    n.weatherLFO  = ctx.createOscillator(); n.weatherLFO.type = 'sine'; n.weatherLFO.frequency.value = 12;
    n.weatherLFOG = ctx.createGain(); n.weatherLFOG.gain.value = 0;
    n.weatherLFO.connect(n.weatherLFOG); n.weatherLFOG.connect(n.weatherG.gain);
    n.weatherSrc.connect(n.weatherHP); n.weatherHP.connect(n.weatherLP);
    n.weatherLP.connect(n.weatherG); n.weatherG.connect(n.atmoOut);
    n.weatherSrc.start(); n.weatherLFO.start();

    // atmoOut y master arrancan en 0 — setContext() los establece antes de unmute()
    n.atmoOut.gain.setValueAtTime(0, ctx.currentTime);
    n.master.gain.setValueAtTime(0, ctx.currentTime);
  }

  // ─── Control de contexto y atmósfera ─────────────────────────────────────

  setContext(context) {
    const isFirst = !this._ctxCfg;
    this._context = context || 'naturaleza';
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const n   = this._n;
    const tc  = isFirst ? 0.05 : 6;
    const CFGS = {
      urbano:     { bands:[{f:240,g:.28},{f:700,g:.18},{f:1600,g:.06}], atmo:0.42, wet:0.32, drone:{f:58,  g:.055} },
      naturaleza: { bands:[{f:150,g:.20},{f:600,g:.14},{f:3200,g:.08}], atmo:0.30, wet:0.62, drone:{f:44,  g:.022} },
      montana:    { bands:[{f:110,g:.10},{f:400,g:.07},{f:5000,g:.10}], atmo:0.18, wet:0.85, drone:{f:34,  g:.010} },
      interior:   { bands:[{f: 90,g:.07},{f:480,g:.07},{f:6000,g:.03}], atmo:0.14, wet:0.52, drone:{f:60,  g:.032} },
    };
    const cfg = CFGS[this._context] || CFGS.naturaleza;
    this._ctxCfg = cfg;
    n.atmoBands.forEach(({ filter, gainN }, i) => {
      filter.frequency.setTargetAtTime(cfg.bands[i].f, now, tc);
      gainN.gain.setTargetAtTime(cfg.bands[i].g, now, tc);
    });
    n.atmoOut.gain.setTargetAtTime(cfg.atmo, now, tc);
    n.reverbGain.gain.setTargetAtTime(cfg.wet, now, tc);
    n.dryGain.gain.setTargetAtTime(1 - cfg.wet * 0.7, now, tc);
    n.ground.frequency.setTargetAtTime(cfg.drone.f, now, tc);
    n.ground2.frequency.setTargetAtTime(cfg.drone.f * 0.5, now, tc);
    n.groundG.gain.setTargetAtTime(cfg.drone.g, now, tc);
    n.groundG2.gain.setTargetAtTime(cfg.drone.g * 0.7, now, tc);
    n.droneLFOG.gain.setTargetAtTime(cfg.drone.f * 0.07, now, tc);
  }

  setWorld(world) {
    this._world = world;
    if (!this.ctx || !this._ctxCfg) return;
    const now = this.ctx.currentTime;
    const tc  = 5.0;
    const { energy, warmth, altitude } = world;
    const cfg = this._ctxCfg;
    const n   = this._n;

    // Las mismas condiciones que generan la paleta moldean la atmósfera:
    //   Frío  (warmth < 0.35) → bandas altas, Q estrecho → cristalino, fino
    //   Calor (warmth > 0.65) → bandas bajas, Q ancho   → envolvente, denso
    //   Quietud (energy < 0.15) → atmósfera casi a cero  → solo suenan las capturas
    n.atmoBands.forEach(({ filter, gainN, baseFreq, baseGain, baseQ }, i) => {
      const b = cfg.bands[i];

      // Temperatura → redistribuye energía entre graves y agudos
      // Banda baja [0]: más fuerte con calor, más débil con frío
      // Banda alta [2]: más fuerte con frío (como cristal), más débil con calor
      const tempBias = i === 0 ? lerp(0.45, 1.55, warmth)
                     : i === 2 ? lerp(1.55, 0.45, warmth)
                     : 1.0;

      // Q: frío → estrecho (agudo, fino) / calor → ancho (cálido, difuso)
      const qMod  = lerp(1.6, 0.55, warmth);

      // Frecuencia: frío desplaza bandas hacia arriba, calor hacia abajo
      const fMod  = lerp(0.78, 1.22, warmth);

      // Movimiento → ganancia general de la atmósfera
      // Muy quieto (< 0.15): la atmósfera se hace casi inaudible
      const eMod  = energy < 0.15
        ? lerp(0.05, 0.55, energy / 0.15)
        : lerp(0.55, 1.45, energy);

      filter.frequency.setTargetAtTime(b.f * fMod, now, tc);
      filter.Q.setTargetAtTime(baseQ * qMod, now, tc);
      gainN.gain.setTargetAtTime(b.g * eMod * tempBias, now, tc);
    });

    // Reverb: altitud + quietud amplían el espacio
    const wetFinal = Math.min(0.95, cfg.wet * lerp(0.80, 1.20, altitude * 0.5 + (1 - energy) * 0.4));
    n.reverbGain.gain.setTargetAtTime(wetFinal, now, tc);
    n.dryGain.gain.setTargetAtTime(1 - wetFinal * 0.7, now, tc);

    // Dron: temperatura afecta su tono (frío = más grave, calor = más agudo)
    const dFreq = cfg.drone.f * lerp(0.90, 1.10, warmth);
    const dGain = cfg.drone.g * lerp(0.6, 1.5, 1 - energy * 0.45) * (energy < 0.12 ? 0.1 : 1);
    n.ground.frequency.setTargetAtTime(dFreq, now, tc);
    n.ground2.frequency.setTargetAtTime(dFreq * 0.5, now, tc);
    n.groundG.gain.setTargetAtTime(dGain, now, tc);
    n.groundG2.gain.setTargetAtTime(dGain * 0.7, now, tc);

    // Capa clima: warmth → brisa (calor) o lluvia (frío)
    if (n.weatherG) {
      const hot  = clamp((warmth - 0.62) / 0.28, 0, 1); // 0.62-0.90 = brisa
      const cold = clamp((0.32 - warmth) / 0.22, 0, 1); // 0.10-0.32 = lluvia
      const level     = hot * energy * 0.048 + cold * 0.034;
      const filterF   = hot > 0.05 ? lerp(1800, 3400, hot) : lerp(280, 900, cold);
      const lfoDepth  = cold * 0.020; // lluvia: modulación rápida de amplitud
      const lfoRate   = cold > 0.05 ? lerp(9, 20, cold) : lerp(0.15, 0.40, hot);
      n.weatherG.gain.setTargetAtTime(level, now, tc);
      n.weatherHP.frequency.setTargetAtTime(filterF, now, tc);
      n.weatherLFO.frequency.setTargetAtTime(lfoRate, now, 2);
      n.weatherLFOG.gain.setTargetAtTime(lfoDepth, now, tc);
    }
  }

  mute(fadeTime = 0.35) {
    if (!this.ctx) return;
    const g = this._n.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(0, this.ctx.currentTime + fadeTime);
  }

  unmute(fadeTime = 0.8) {
    if (!this.ctx) return;
    const g = this._n.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(1, this.ctx.currentTime + fadeTime);
  }

  // Deriva lenta de la textura del ruido rosa — movimiento Browniano en las frecuencias.
  // Sin LFO periódico (que suena a océano), sino pasos aleatorios acumulados.
  // Se llama cada ~25s desde el player para que el fondo nunca sea estático.
  driftTexture() {
    if (!this.ctx || !this._ctxCfg) return;
    const now = this.ctx.currentTime;
    const tc  = 8.0; // transición muy lenta
    const { warmth = 0.5, energy = 0.5 } = this._world;
    this._n.atmoBands.forEach(({ filter, gainN, baseGain, baseFreq, baseQ }, i) => {
      // Deriva aleatoria dentro del espacio definido por la temperatura actual
      const fCenter = baseFreq * lerp(0.78, 1.22, warmth);
      const qCenter = baseQ   * lerp(1.6,  0.55, warmth);
      const gCenter = baseGain * lerp(0.55, 1.45, energy);
      const tempBias = i === 0 ? lerp(0.45, 1.55, warmth)
                     : i === 2 ? lerp(1.55, 0.45, warmth) : 1.0;
      filter.frequency.setTargetAtTime(fCenter * (0.88 + Math.random() * 0.24), now, tc);
      filter.Q.setTargetAtTime(qCenter * (0.82 + Math.random() * 0.36), now, tc);
      gainN.gain.setTargetAtTime(gCenter * tempBias * (0.80 + Math.random() * 0.40), now, tc);
    });
    // También el tono del drone deriva ligeramente
    const dFreq = this._ctxCfg.drone.f;
    const drift = dFreq * (0.97 + Math.random() * 0.06);
    this._n.ground.frequency.setTargetAtTime(drift, now, tc);
    this._n.ground2.frequency.setTargetAtTime(drift * 0.5, now, tc);
  }

  setDisturbance(d) {
    if (!this.ctx) return;
    const now  = this.ctx.currentTime;
    const base = this._ctxCfg?.atmo ?? 0.68;
    this._n.atmoOut.gain.setTargetAtTime(lerp(base, base * 0.82, d * 0.8), now, 0.5);
  }

  setAtmoVolume(v) {
    this._atmoVol = v;
    if (this.ctx && this._n.atmoVol)
      this._n.atmoVol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }
  setAgentsVolume(v) {
    this._agentsVol = v;
    if (this.ctx && this._n.agentsVol)
      this._n.agentsVol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  // Conecta un nodo de evento a agentsOut pasando por un StereoPanner
  _pan(node, pan = 0) {
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      p.connect(this._n.agentsOut);
    } else {
      node.connect(this._n.agentsOut);
    }
  }

  // ─── Paleta onírica: metal, cristal, aliento, cuerdas, campanas ─────────────
  // Los 10 agentes no suenan como la realidad — la ABSTRAEN.
  // Cada día genera una mezcla única a partir de tres factores físicos:
  // movimiento → densidad y ritmo  |  clima → carácter emocional  |  mic → timbre

  play(species, params) {
    ({
      resonador:   () => this._resonador(params),
      cristal:     () => this._cristal(params),
      campana:     () => this._campana(params),
      cuerda:      () => this._cuerda(params),
      gota_metal:  () => this._gota_metal(params),
      aliento:     () => this._aliento(params),
      viento:      () => this._viento(params),
      arco:        () => this._arco(params),
      voz_lejana:  () => this._voz_lejana(params),
      pulso_metal: () => this._pulso_metal(params),
      granular:    () => this._granular(params),
    }[species] ?? (() => {}))();
  }

  // resonador — cuenco / barra de metal grave: FM inarmónico, larga resonancia
  _resonador({ freq = 180, decay = 2.2, energy = 0.6, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f   = freq * rnd(0.94, 1.06);
    const d   = decay * rnd(0.75, 1.4);

    const car = ctx.createOscillator(); car.type = 'sine';
    car.frequency.value = f;
    const mod  = ctx.createOscillator();
    const modG = ctx.createGain();
    mod.frequency.value = f * 2.756;
    modG.gain.value     = f * rnd(0.8, 2.5);

    const nse = this._noiseSource();
    const nG  = ctx.createGain();
    const nF  = ctx.createBiquadFilter();
    nF.type = 'highpass'; nF.frequency.value = f * 1.8;
    nG.gain.setValueAtTime(energy * 0.10, now);
    nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(energy * rnd(0.11, 0.18), now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);

    mod.connect(modG); modG.connect(car.frequency);
    car.connect(env);
    nse.connect(nF);   nF.connect(nG);
    this._pan(env, pan); this._pan(nG, pan * 0.5);
    mod.start(now); mod.stop(now + d + 0.1);
    car.start(now); car.stop(now + d + 0.1);
    nse.start(now); nse.stop(now + 0.1);
  }

  // cristal — armónico de vidrio: senos puros, ataque lentísimo, brillo etéreo
  _cristal({ freq = 600, warmth = 0.5, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f      = freq * rnd(0.85, 1.15);
    const attack = rnd(0.28, 0.75);
    const dur    = rnd(1.8, 4.2);

    [[1.00, 0.65, 0], [2.02, 0.25, pan * 0.5], [3.44, 0.10, pan]].forEach(([ratio, amp, p]) => {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(f * ratio, now);
      osc.frequency.setTargetAtTime(f * ratio * rnd(0.9985, 1.0015), now + attack + 0.4, 1.0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.10 * amp * lerp(0.6, 1.0, warmth), now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g); this._pan(g, p);
      osc.start(now); osc.stop(now + dur + 0.2);
    });
  }

  // campana — síntesis FM de campana (partiales de Chowning DX7)
  _campana({ freq = 160, energy = 0.6, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f = freq * rnd(0.88, 1.12);
    const d = rnd(2.5, 6.0) * lerp(1.4, 0.8, energy);

    [[1.000, 1.00, 1.00,  0    ],
     [2.756, 0.55, 0.86,  pan * 0.3],
     [5.404, 0.22, 0.72,  pan * 0.6],
     [8.458, 0.07, 0.58,  pan      ],
     [1.906, 0.32, 0.92, -pan * 0.4]].forEach(([ratio, amp, dMul, p]) => {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(energy * 0.095 * amp, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d * dMul);
      osc.connect(g); this._pan(g, p);
      osc.start(now); osc.stop(now + d + 0.2);
    });
  }

  // cuerda — cuerda grave: sierra → filtro, ataque lento de arco
  _cuerda({ freq = 80, warmth = 0.5, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f   = freq * rnd(0.90, 1.10);
    const d   = rnd(1.6, 4.0);
    const bow = rnd(0.18, 0.55);

    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.setTargetAtTime(f * 1.003, now + bow + 0.3, 0.6);
    osc.frequency.setTargetAtTime(f * 0.997, now + bow + 1.0, 0.6);

    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
    filt.frequency.value = f * lerp(4, 8, warmth);
    filt.Q.value = 2.0;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.12, now + bow);
    env.gain.setValueAtTime(0.20, now + d - 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);

    osc.connect(filt); filt.connect(env); this._pan(env, pan);
    osc.start(now); osc.stop(now + d + 0.1);
  }

  // gota_metal — gota de agua sobre metal
  _gota_metal({ brightness = 0.5, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f     = rnd(200, 800) * lerp(0.65, 1.35, brightness);
    const decay = rnd(0.5, 2.2);

    const car  = ctx.createOscillator(); car.type = 'sine';
    const mod  = ctx.createOscillator();
    const modG = ctx.createGain();
    car.frequency.setValueAtTime(f * 1.25, now);
    car.frequency.exponentialRampToValueAtTime(f, now + 0.055);
    mod.frequency.value = f * 3.14;
    modG.gain.value     = f * rnd(0.6, 1.4);

    const env = ctx.createGain();
    env.gain.setValueAtTime(rnd(0.11, 0.17), now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    mod.connect(modG); modG.connect(car.frequency);
    car.connect(env); this._pan(env, pan);
    mod.start(now); mod.stop(now + decay + 0.1);
    car.start(now); car.stop(now + decay + 0.1);
  }

  // aliento — respiración grave: ruido filtrado en rango bajo-vocal
  _aliento({ warmth = 0.5, energy = 0.5, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const src = this._noiseSource();
    const d   = rnd(0.6, 2.2);

    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = lerp(120, 400, warmth);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = lerp(900, 3500, warmth);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(energy * rnd(0.07, 0.13), now + d * 0.38);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);

    src.connect(hp); hp.connect(lp); lp.connect(env); this._pan(env, pan);
    src.start(now); src.stop(now + d + 0.1);
  }

  // viento — viento grave + agudo en canales opuestos
  _viento({ warmth = 0.5, altitude = 0.3, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const d   = rnd(2.0, 5.5);

    // Banda baja izquierda, banda alta derecha (o viceversa según pan)
    [[lerp(80, 260, altitude), 0.70, -pan], [lerp(800, 2800, warmth), 0.40, pan]].forEach(([freq, amp, p]) => {
      const src = this._noiseSource();
      const bp  = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = freq; bp.Q.value = rnd(0.4, 1.2);

      const lfo  = ctx.createOscillator(); lfo.frequency.value = rnd(0.18, 0.55);
      const lfoG = ctx.createGain(); lfoG.gain.value = amp * 0.028;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(amp * 0.075, now + d * 0.28);
      env.gain.setValueAtTime(amp * 0.13, now + d * 0.72);
      env.gain.exponentialRampToValueAtTime(0.0001, now + d);

      lfo.connect(lfoG); lfoG.connect(env.gain);
      src.connect(bp);   bp.connect(env);  this._pan(env, p);
      src.start(now); src.stop(now + d + 0.1);
      lfo.start(now); lfo.stop(now + d + 0.1);
    });
  }

  // arco — waterphone muy grave: glide onírico
  _arco({ warmth = 0.4, energy = 0.2, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f   = lerp(38, 130, warmth) * rnd(0.9, 1.1);
    const d   = rnd(2.8, 6.0);

    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.linearRampToValueAtTime(f * rnd(1.04, 1.10), now + d * 0.65);

    const filt = ctx.createBiquadFilter(); filt.type = 'bandpass';
    filt.frequency.setValueAtTime(f * 3.2, now);
    filt.frequency.linearRampToValueAtTime(f * 2.2, now + d);
    filt.Q.value = 5;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.11 * lerp(0.5, 1.0, 1 - energy), now + d * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);

    osc.connect(filt); filt.connect(env); this._pan(env, pan);
    osc.start(now); osc.stop(now + d + 0.1);
  }

  // voz_lejana — voz filtrada en la distancia, posicionada en el espacio
  _voz_lejana({ density = 0.3, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const src = this._noiseSource();
    const d   = rnd(0.35, 1.1);

    const f1 = lerp(250, 550, Math.random());
    const f2 = lerp(800, 1800, Math.random());
    const bp1 = ctx.createBiquadFilter(); bp1.type = 'bandpass';
    bp1.frequency.value = f1; bp1.Q.value = rnd(5, 10);
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass';
    bp2.frequency.value = f2; bp2.Q.value = rnd(4, 8);

    const vol = rnd(0.040, 0.080) * clamp(density * 4, 0.3, 1);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.06);
    env.gain.setValueAtTime(vol, now + d - 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);

    src.connect(bp1); bp1.connect(bp2); bp2.connect(env); this._pan(env, pan);
    src.start(now); src.stop(now + d + 0.1);
  }

  // pulso_metal — toque metálico breve, posicionado
  _pulso_metal({ freq = 700, energy = 0.5, pan = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime;
    const f   = freq * rnd(0.65, 1.45);
    const d   = rnd(0.05, 0.22);

    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(f * rnd(1.1, 1.6), now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.018);

    const env = ctx.createGain();
    env.gain.setValueAtTime(energy * rnd(0.08, 0.14), now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);

    osc.connect(env); this._pan(env, pan);
    osc.start(now); osc.stop(now + d + 0.05);
  }

  // granular — síntesis granular sobre audio real capturado del entorno
  // Baja energía → nube densa y continua (textura de fondo)
  // Alta energía → nube dispersa y reconocible (eventos discretos)
  _granular({ buffer, energy = 0.5, pan = 0, continuous = false }) {
    if (!buffer || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;

    const cloudDur  = continuous ? rnd(5.0, 9.0)  : rnd(1.8, 3.8);
    const numGrains = continuous
      ? Math.floor(lerp(14, 26, 1 - energy))
      : Math.floor(lerp(4, 11, energy));

    for (let i = 0; i < numGrains; i++) {
      const onset    = now + rnd(0, cloudDur * 0.75);
      const grainDur = continuous ? rnd(0.14, 0.30) : rnd(0.07, 0.22);
      const maxOff   = Math.max(0.001, buffer.duration - grainDur);
      const offset   = rnd(0, maxOff);

      // Pitch: continuo = muy disperso (abstrae). evento = cercano a 1 (reconocible)
      const rate = continuous
        ? rnd(0.18, 1.8) * (Math.random() < 0.25 ? 0.5 : 1)
        : rnd(0.55, 1.45);

      const vol = continuous
        ? rnd(0.06, 0.12)
        : rnd(0.18, 0.32) * lerp(0.7, 1.0, energy);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = clamp(rate, 0.1, 4);

      // Envolvente Hanning por grano
      const env = ctx.createGain();
      const fi  = grainDur * 0.28;
      const fo  = grainDur * 0.38;
      env.gain.setValueAtTime(0, onset);
      env.gain.linearRampToValueAtTime(vol, onset + fi);
      env.gain.setValueAtTime(vol, onset + grainDur - fo);
      env.gain.exponentialRampToValueAtTime(0.0001, onset + grainDur);

      src.connect(env);
      this._pan(env, clamp(pan + rnd(-0.45, 0.45), -1, 1));
      src.start(onset, offset);
      src.stop(onset + grainDur + 0.05);
    }
  }

  _distortCurve(amount) {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // Conecta la salida master a un MediaStreamDestination para grabar
  createRecordingStream() {
    if (!this.ctx) return null;
    this._recDest = this.ctx.createMediaStreamDestination();
    this._n.master.connect(this._recDest);
    return this._recDest.stream;
  }

  disconnectRecording() {
    if (!this._recDest) return;
    try { this._n.master.disconnect(this._recDest); } catch (_) {}
    this._recDest = null;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer; src.loop = true;
    src.loopStart = Math.random() * (this._noiseBuffer.duration - 0.5);
    return src;
  }

  _pinkNoiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._pinkNoiseBuffer; src.loop = true;
    src.loopStart = Math.random() * (this._pinkNoiseBuffer.duration - 0.5);
    return src;
  }

  _makeNoiseBuffer(secs) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Ruido rosa (1/f) — filtro de Kellet de 6 polos aplicado al buffer completo.
  // Igual energía por octava: no cansa, suena natural, como aire o agua muy lejana.
  // Investigación: Voss, R. & Clarke, J. (1975) — espectro 1/f en música y naturaleza.
  _makePinkNoiseBuffer(secs) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
    }
    return buf;
  }

  _makeReverb(decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * decay);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.9);
        if (i > 0) d[i] += d[i - 1] * 0.12;
      }
    }
    return buf;
  }
}
