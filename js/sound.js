/*
 * Звук: проигрывание файлов раунда «Звуки детства», встроенные синтезированные
 * замены (если файла нет) и сигналы таймера.
 */
window.Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false; // выключает только сигналы таймера, не звуки раунда

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function noise() {
    if (!noiseBuf) {
      const c = audio();
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  const NAMES = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  function freq(name) {
    const m = /^([A-G]#?)(\d)$/.exec(name);
    const midi = 12 * (Number(m[2]) + 1) + NAMES[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function tone(dest, f, t, dur, { type = "square", vol = 0.1, release = 0.03 } = {}) {
    const c = audio();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, Math.max(t + 0.01, t + dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function burst(dest, t, dur, { f = 2000, q = 1, vol = 0.4 } = {}) {
    const c = audio();
    const s = c.createBufferSource();
    s.buffer = noise();
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(bp).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  // Встроенные мелодии. Каждая функция планирует звук и возвращает длительность в секундах.
  const SYNTHS = {
    // «Gran Vals» Ф. Тарреги — мелодия звонка Nokia
    nokia(dest, t0) {
      const u = 0.135;
      const seq = [["E6", 1], ["D6", 1], ["F#5", 2], ["G#5", 2], ["C#6", 1], ["B5", 1], ["D5", 2], ["E5", 2],
        ["B5", 1], ["A5", 1], ["C#5", 2], ["E5", 2], ["A5", 6]];
      let t = t0;
      for (const [n, d] of seq) {
        tone(dest, freq(n), t, d * u * 0.95, { type: "square", vol: 0.06 });
        tone(dest, freq(n), t, d * u * 0.95, { type: "sine", vol: 0.1 });
        t += d * u;
      }
      return t - t0 + 0.2;
    },

    // «Коробейники» — тема из «Тетриса»
    tetris(dest, t0) {
      const q = 0.3;
      const melody = [["E5", 1], ["B4", .5], ["C5", .5], ["D5", 1], ["C5", .5], ["B4", .5],
        ["A4", 1], ["A4", .5], ["C5", .5], ["E5", 1], ["D5", .5], ["C5", .5],
        ["B4", 1.5], ["C5", .5], ["D5", 1], ["E5", 1],
        ["C5", 1], ["A4", 1], ["A4", 2]];
      let t = t0;
      for (const [n, d] of melody) {
        tone(dest, freq(n), t, d * q * 0.9, { type: "square", vol: 0.07 });
        t += d * q;
      }
      // бас: октавы восьмыми
      const bass = [["E", 8], ["A", 8], ["G#", 4], ["E", 4], ["A", 8]];
      let b = t0;
      for (const [n, count] of bass) {
        for (let i = 0; i < count; i++) {
          tone(dest, freq(n + (i % 2 ? "3" : "2")), b, q / 2 * 0.85, { type: "triangle", vol: 0.16 });
          b += q / 2;
        }
      }
      return t - t0 + 0.2;
    },

    // Шесть сигналов точного времени
    pips(dest, t0) {
      for (let i = 0; i < 6; i++) tone(dest, 1000, t0 + i, 0.1, { type: "sine", vol: 0.35, release: 0.01 });
      return 5.4;
    },

    // Набор номера на дисковом телефоне
    rotary(dest, t0) {
      const digits = [2, 9, 5, 7];
      let t = t0 + 0.1;
      for (const d of digits) {
        // поворот диска — шорох
        for (let i = 0; i < 6; i++) burst(dest, t + i * 0.05, 0.05, { f: 900, q: 0.7, vol: 0.06 });
        t += 0.45;
        // возврат диска — щелчки 10 в секунду
        const n = d === 0 ? 10 : d;
        for (let i = 0; i < n; i++) {
          burst(dest, t + i * 0.1, 0.025, { f: 2600, q: 2, vol: 0.9 });
          burst(dest, t + i * 0.1 + 0.004, 0.04, { f: 380, q: 1.5, vol: 0.5 });
        }
        t += n * 0.1 + 0.55;
      }
      return t - t0;
    },
  };

  function playSynth(name) {
    const c = audio();
    const g = c.createGain();
    g.connect(master);
    const dur = SYNTHS[name](g, c.currentTime + 0.05);
    let timer;
    const done = new Promise((res) => { timer = setTimeout(res, dur * 1000 + 100); });
    return {
      done,
      stop() {
        clearTimeout(timer);
        g.gain.setTargetAtTime(0, c.currentTime, 0.02);
        setTimeout(() => g.disconnect(), 200);
      },
    };
  }

  // Проверка, есть ли файл (кешируется)
  const probeCache = new Map();
  function probe(file) {
    if (!file) return Promise.resolve(false);
    if (!probeCache.has(file)) {
      probeCache.set(file, new Promise((res) => {
        const a = new Audio();
        a.preload = "auto";
        a.addEventListener("canplay", () => res(true), { once: true });
        a.addEventListener("error", () => res(false), { once: true });
        a.src = file;
        setTimeout(() => res(false), 4000);
      }));
    }
    return probeCache.get(file);
  }

  function playFile(file, clip) {
    const a = new Audio(file);
    let timer, fade;
    let stopped = false;
    const done = new Promise((res) => {
      const finish = () => { clearTimeout(timer); clearInterval(fade); res(); };
      a.addEventListener("ended", finish, { once: true });
      a.addEventListener("error", finish, { once: true });
      a.play().catch(finish);
      if (clip) {
        // плавно затухаем последние 0.6 с отрывка
        timer = setTimeout(() => {
          fade = setInterval(() => {
            a.volume = Math.max(0, a.volume - 0.1);
            if (a.volume <= 0.01) { a.pause(); finish(); }
          }, 60);
        }, Math.max(0, clip * 1000 - 600));
      }
      a._finish = finish;
    });
    return {
      done,
      stop() {
        if (stopped) return;
        stopped = true;
        a.pause();
        a._finish && a._finish();
      },
    };
  }

  // Играет звук раунда: файл, а если его нет — встроенную замену.
  // Возвращает { done: Promise, stop(), source: "file"|"synth"|"missing" }
  async function play(sound) {
    audio();
    if (await probe(sound.file)) return { ...playFile(sound.file, sound.clip), source: "file" };
    if (sound.synth && SYNTHS[sound.synth]) return { ...playSynth(sound.synth), source: "synth" };
    return { done: Promise.resolve(), stop() {}, source: "missing" };
  }

  // Сигналы таймера
  function tick() {
    if (muted) return;
    const c = audio();
    tone(master, 740, c.currentTime + 0.01, 0.09, { type: "sine", vol: 0.25 });
  }
  function end() {
    if (muted) return;
    const c = audio();
    const t = c.currentTime + 0.01;
    tone(master, 523.25, t, 0.16, { type: "triangle", vol: 0.35 });
    tone(master, 659.25, t + 0.14, 0.16, { type: "triangle", vol: 0.35 });
    tone(master, 783.99, t + 0.28, 0.5, { type: "triangle", vol: 0.35, release: 0.3 });
  }
  function fanfare() {
    if (muted) return;
    const c = audio();
    const t = c.currentTime + 0.02;
    [["C5", 0, .15], ["E5", .15, .15], ["G5", .3, .15], ["C6", .45, .7]].forEach(([n, s, d]) => {
      tone(master, freq(n), t + s, d, { type: "square", vol: 0.06, release: 0.2 });
      tone(master, freq(n), t + s, d, { type: "triangle", vol: 0.25, release: 0.2 });
    });
  }

  return {
    play, probe, tick, end, fanfare,
    unlock: audio,
    get muted() { return muted; },
    set muted(v) { muted = v; },
  };
})();
