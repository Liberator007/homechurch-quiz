/*
 * Движок викторины: слайды, навигация, таймеры.
 * Порядок в каждом раунде: правила → вопросы (номер → вопрос с таймером) → список ответов,
 * которые открываются по одному. Всё переключается кликом мыши или клавишей.
 * Содержимое берётся из js/data.js.
 */
(() => {
  "use strict";

  const Q = window.QUIZ;
  const Sound = window.Sound;
  const NUMBER_FIRST = Q.numberFirst !== false;

  /* ─────────────── Утилиты ─────────────── */
  const stage = document.getElementById("stage");
  const slidesRoot = stage.querySelector(".slides");
  const chrome = stage.querySelector(".chrome");
  const progress = stage.querySelector(".progress");

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  };
  const ptsWord = (n) => plural(n, "очко", "очка", "очков");
  const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s));
  const fmtLong = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} сек`);
  const pad = (n) => String(n).padStart(2, "0");

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("quiz:" + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try { localStorage.setItem("quiz:" + k, JSON.stringify(v)); } catch { /* приватный режим */ }
    },
  };

  /* ─────────────── Таймер ─────────────── */
  class Timer {
    constructor(phases, opts = {}) {
      this.phases = phases;
      this.opts = opts;
      this.el = el(`
        <div class="timer">
          <svg viewBox="0 0 100 100">
            <circle class="track" cx="50" cy="50" r="47" fill="none" stroke-width="1"/>
            <circle class="bar" cx="50" cy="50" r="47" fill="none" stroke-width="2.4" pathLength="1000" stroke-dasharray="1000"/>
          </svg>
          <div class="digits"></div>
        </div>`);
      this.bar = this.el.querySelector(".bar");
      this.digits = this.el.querySelector(".digits");
      this.loop = this.loop.bind(this);
      this.reset();
    }
    get phase() { return this.phases[this.idx]; }
    reset() {
      cancelAnimationFrame(this.raf);
      this.idx = 0;
      this.remaining = this.phase.seconds * 1000;
      this.lastSecs = null;
      this.state = "idle";
      this.render();
      this.opts.onState && this.opts.onState(this);
    }
    start() {
      if (this.state === "running" || this.state === "destroyed") return;
      if (this.state === "done") this.reset();
      Sound.unlock();
      this.state = "running";
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
      this.render();
      this.opts.onState && this.opts.onState(this);
    }
    pause() {
      if (this.state !== "running") return;
      cancelAnimationFrame(this.raf);
      this.state = "paused";
      this.render();
      this.opts.onState && this.opts.onState(this);
    }
    toggle() {
      if (this.state === "running") this.pause();
      else this.start();
    }
    loop(now) {
      if (this.state !== "running") return;
      this.remaining -= now - this.last;
      this.last = now;
      const secs = Math.ceil(this.remaining / 1000);
      if (secs !== this.lastSecs) {
        if (secs > 0 && secs <= 3) Sound.tick();
        this.lastSecs = secs;
      }
      if (this.remaining <= 0) this.advance();
      this.render();
      if (this.state === "running") this.raf = requestAnimationFrame(this.loop);
    }
    advance() {
      Sound.end();
      if (this.idx < this.phases.length - 1) {
        this.idx++;
        this.remaining = this.phase.seconds * 1000;
        this.lastSecs = null;
      } else {
        this.remaining = 0;
        this.state = "done";
        this.opts.onEnd && this.opts.onEnd();
      }
      this.opts.onState && this.opts.onState(this);
    }
    render() {
      const full = this.phase.seconds * 1000;
      const secs = Math.max(0, Math.ceil(this.remaining / 1000));
      this.bar.style.strokeDashoffset = String(1000 * (1 - Math.max(0, this.remaining) / full));
      this.digits.textContent = fmt(secs);
      const cl = this.el.classList;
      ["idle", "running", "paused", "done"].forEach((c) => cl.toggle(c, this.state === c));
      cl.toggle("warn", this.state === "running" && secs <= (this.phase.seconds > 20 ? 10 : 3));
    }
    destroy() {
      cancelAnimationFrame(this.raf);
      this.state = "destroyed";
    }
  }

  /* ─────────────── Картинки с подбором расширения ─────────────── */
  const EXTS = ["jpg", "png", "jpeg", "webp", "JPG", "PNG"];
  function loadImage(base, onOk, onFail) {
    const img = new Image();
    let k = 0;
    img.alt = "";
    img.onload = () => onOk && onOk(img);
    img.onerror = () => {
      k++;
      if (k < EXTS.length) img.src = `${base}.${EXTS[k]}`;
      else onFail && onFail(img);
    };
    img.src = `${base}.${EXTS[0]}`;
    return img;
  }

  /* ═══════════════ Сборка списка слайдов ═══════════════ */
  const slides = [];
  const add = (kind, data = {}) => slides.push({ kind, ...data });
  const visited = new Set(); // какие запасные вопросы показывали

  // Что показать в списке ответов раунда
  const ANSWERS = {
    sculpt: (r) => [
      ...r.questions.map((q, i) => ({ n: i + 1, prompt: q.short || q.text, answer: q.answer, detail: q.note })),
      ...(r.spare || []).map((q, i) => ({ prompt: `${q.short || q.text} (запасной)`, answer: q.answer, detail: q.note, key: `${r.id}-spare-${i}` }))
        .filter((a) => visited.has(a.key))
        .map((a, i) => ({ ...a, n: r.questions.length + i + 1 })),
    ],
    sounds: (r) => r.sounds.map((s, i) => ({ n: i + 1, answer: s.answer, detail: s.detail, sound: s })),
    bible: (r) => r.statements.map((st, i) => ({
      n: i + 1, prompt: st.text, verdict: st.isInBible, answer: st.explain,
      ref: st.ref,
    })),
    flip: (r) => r.puzzles.map((p, i) => ({ n: i + 1, prompt: `«${p.flipped}»`, answer: `«${p.original}»`, detail: [p.kind, p.fact].filter(Boolean).join(". ") })),
    order: (r, s) => [...r.waves[s.wave].cards].sort((a, b) => a.place - b.place).map((c) => ({
      n: c.place, prompt: c.title, answer: c.answer, detail: c.detail, thumb: c.image && `assets/order/${c.image}`,
    })),
  };

  const BUILD = {
    sculpt(r, base) {
      r.questions.forEach((q, i) => add("sculptQ", { ...base, q, i, total: r.questions.length }));
      (r.spare || []).forEach((q, i) => add("sculptQ", { ...base, q, i, spare: true, hidden: true, key: `${r.id}-spare-${i}` }));
    },
    sounds(r, base) { r.sounds.forEach((s, i) => add("sound", { ...base, s, i, total: r.sounds.length })); },
    bible(r, base) { r.statements.forEach((st, i) => add("statement", { ...base, st, i, total: r.statements.length })); },
    closeup(r, base) { r.items.forEach((it, i) => add("closeup", { ...base, it, i, total: r.items.length })); },
    flip(r, base) { r.puzzles.forEach((p, i) => add("flip", { ...base, p, i, total: r.puzzles.length })); },
    order(r, base) { r.waves.forEach((w, i) => add("orderPlay", { ...base, w, i, total: r.waves.length })); },
  };

  add("title");
  Q.rounds.forEach((round, ri) => {
    const base = { round, ri };
    add("intro", base);
    BUILD[round.type](round, base);
    // у «Собери порядок» ответы — отдельно на каждую волну
    if (round.waves) round.waves.forEach((w, wave) => add("answers", { ...base, wave }));
    else if (round.type === "closeup") add("closeupAnswers", base);
    else add("answers", base);
  });
  add("end");

  function slideLabel(s) {
    const cut = (t, n = 36) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    switch (s.kind) {
      case "title": return "Заставка";
      case "end": return "Конец";
      case "intro": return "Суть раунда";
      case "closeupAnswers": return "Ответы";
      case "answers": return s.wave != null ? `Ответы: волна ${s.wave + 1}` : "Ответы";
      case "sculptQ": return (s.spare ? "Запасной: " : `${s.i + 1}. `) + cut(s.q.short || s.q.text);
      case "sound": return `Звук ${s.i + 1}`;
      case "statement": return `${s.i + 1}. ${cut(s.st.text)}`;
      case "closeup": return `Предмет ${s.i + 1}`;
      case "flip": return `${s.i + 1}. ${cut(s.p.flipped)}`;
      case "orderPlay": return `Волна ${s.i + 1}. ${s.w.title}`;
      default: return s.kind;
    }
  }

  /* ═══════════════ Общий макет вопроса: содержимое слева, время справа ═══════════════ */
  /*
   * opts.cover   — html заставки с номером (показывается до клика)
   * opts.body    — html самого вопроса
   * opts.phases  — фазы таймера [{label, seconds}]
   * opts.steps   — показывать список фаз/этапов под таймером
   * opts.onReveal(ctx) — что делать по первому клику (по умолчанию — запустить таймер)
   */
  function questionSlide(s, n, opts) {
    n.classList.add("s-q");
    const covered = NUMBER_FIRST && opts.cover;
    if (covered) n.classList.add("covered");
    n.innerHTML = `
      <div class="q-main">
        ${covered ? `<div class="q-cover">${opts.cover}</div>` : ""}
        <div class="q-body">${opts.body}</div>
      </div>
      <aside class="q-side">
        <div class="side-label">Время</div>
        <div class="timer-slot"></div>
        ${opts.steps ? `<ul class="steps">${opts.steps.map((st) => `<li><span>${esc(st[0])}</span><b>${esc(st[1])}</b></li>`).join("")}</ul>` : ""}
        <div class="status"></div>
      </aside>`;
    const status = n.querySelector(".status");
    const stepEls = [...n.querySelectorAll(".steps li")];
    const markStep = (k) => stepEls.forEach((li, j) => {
      li.classList.toggle("active", j === k);
      li.classList.toggle("past", j < k);
    });
    const timer = new Timer(opts.phases, {
      onState: (t) => {
        if (opts.stepsFollowTimer) markStep(t.state === "idle" ? -1 : t.state === "done" ? t.phases.length : t.idx);
        if (t.state === "paused") status.textContent = "Пауза";
        else if (t.state !== "done") status.textContent = "";
      },
      onEnd: () => {
        status.textContent = opts.endText || "Время вышло";
        opts.onEnd && opts.onEnd(ctx);
      },
    });
    n.querySelector(".timer-slot").appendChild(timer.el);

    let revealed = !covered && !opts.manualStart;
    let started = false;
    const ctx = { n, timer, status, markStep, s };
    const reveal = () => {
      n.classList.remove("covered");
      revealed = true;
    };
    const start = () => {
      started = true;
      if (opts.onReveal) opts.onReveal(ctx);
      else timer.start();
    };
    if (!covered && !opts.manualStart) start();

    return {
      timer,
      ctx,
      next: () => {
        if (!revealed) { reveal(); start(); return true; }
        if (!started) { start(); return true; }
        return opts.next ? opts.next(ctx) : false;
      },
      destroy: () => { timer.destroy(); opts.destroy && opts.destroy(ctx); },
    };
  }

  const cover = (what, i, total) =>
    `<div class="what">${esc(what)}</div><div class="big">${i + 1}${total ? `<small>/ ${total}</small>` : ""}</div>`;
  const counter = (what, i, total) => `<div class="q-count">${esc(what)} <b>${i + 1}</b>${total ? ` из ${total}` : ""}</div>`;

  /* ═══════════════ Отрисовка слайдов ═══════════════ */
  const RENDER = {
    title(s, n) {
      n.classList.add("s-title");
      n.innerHTML = `
        <div class="label appear">${esc(Q.subtitle)}</div>
        <h1 class="appear" style="--i:1">${esc(Q.title)}</h1>
        <div class="rounds">
          ${Q.rounds.map((r, i) => `<div class="appear" data-round="${r.id}" style="--i:${i + 2}"><span>Раунд ${i + 1}</span>${esc(r.title)}</div>`).join("")}
        </div>`;
    },

    intro(s, n) {
      const r = s.round;
      n.classList.add("s-intro");
      // **текст** в «Сути» — жирным
      const about = esc(r.about).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      n.innerHTML = `
        <div class="label appear">Раунд ${s.ri + 1} из ${Q.rounds.length}</div>
        <h1 class="appear" style="--i:1">${esc(r.title)}</h1>
        <p class="about appear" style="--i:2">${about}</p>`;
    },

    /* ── Раунд 1 ── */
    sculptQ(s, n) {
      if (s.spare) visited.add(s.key);
      const r = s.round;
      const long = s.q.text.length > 150;
      return questionSlide(s, n, {
        cover: s.spare ? `<div class="what">Запасной вопрос</div><div class="big">${s.i + 1}</div>` : cover("Вопрос", s.i, s.total),
        body: `${s.spare ? `<div class="q-count">Запасной вопрос</div>` : counter("Вопрос", s.i, s.total)}
               <div class="q-text ${long ? "long" : ""}">${esc(s.q.text)}</div>`,
        phases: r.phases,
        steps: r.phases.length > 1 ? r.phases.map((p) => [p.label, fmt(p.seconds)]) : null,
        stepsFollowTimer: true,
        endText: "Стоп! Фото — ведущему",
      });
    },

    /* ── Раунд 2 ── */
    sound(s, n) {
      const r = s.round;
      let handle = null;
      let alive = true;
      let state = "idle";
      const q = questionSlide(s, n, {
        body: `
          ${counter("Звук", s.i, s.total)}
          <div class="sound-num"><div class="big">${s.i + 1}</div></div>
          <div class="eq">${Array.from({ length: 32 }, (_, k) => `<i style="--i:${k}"></i>`).join("")}</div>
          <div class="sound-status">Слушаем внимательно</div>
          <div class="missing"></div>`,
        phases: [{ label: "Пишем ответ", seconds: r.writeSeconds }],
        manualStart: true,
        endText: "Следующий звук",
        onReveal: async (ctx) => {
          state = "playing";
          const st = n.querySelector(".sound-status");
          const playOnce = async () => {
            n.classList.add("playing");
            handle = await Sound.play(s.s);
            if (handle.source === "missing") n.querySelector(".missing").textContent = `Нет файла: ${s.s.file}`;
            await handle.done;
            n.classList.remove("playing");
          };
          st.textContent = "Звучит…";
          await playOnce();
          if (!alive) return;
          st.textContent = "Сейчас ещё раз";
          await sleep(3000);
          if (!alive) return;
          st.textContent = "Ещё раз…";
          await playOnce();
          if (!alive) return;
          st.textContent = "Записываем ответ";
          state = "done";
          ctx.timer.start();
        },
        destroy: () => { alive = false; handle && handle.stop(); },
      });
      Sound.probe(s.s.file).then((ok) => {
        if (!ok && !s.s.synth) n.querySelector(".missing").textContent = `Нет файла: ${s.s.file}`;
      });
      return q;
    },

    /* ── Раунд 3 ── */
    statement(s, n) {
      return questionSlide(s, n, {
        cover: cover("Утверждение", s.i, s.total),
        body: `${counter("Утверждение", s.i, s.total)}
               <div class="statement">${esc(s.st.text)}</div>
               <div class="yn"><span class="y">ЕСТЬ</span><span class="n">НЕТ</span></div>`,
        phases: [{ label: "Обсуждаем", seconds: s.round.seconds }],
        endText: "3-2-1 — поднимаем таблички!",
      });
    },

    /* ── Раунд 4 ── */
    closeup(s, n) {
      const r = s.round;
      const it = s.it;
      n.classList.add("s-closeup");
      const q = questionSlide(s, n, {
        cover: cover("Предмет", s.i, s.total),
        body: `<div class="frame"></div>`,
        phases: [{ label: "", seconds: r.seconds }],
      });
      const frame = n.querySelector(".frame");
      const img = loadImage(`assets/closeup/${it.prefix}_1`, (im) => im.classList.add("on"), () => {
        frame.innerHTML = `<div class="placeholder"><div>Нет картинки<br><code>assets/closeup/${esc(it.prefix)}_1.jpg</code></div></div>`;
      });
      img.style.transform = `scale(${r.zoom || 1})`;
      frame.appendChild(img);
      return q;
    },

    /* ── Ответы «Крупного плана»: по кликам крупный план → целиком → слово-ответ ── */
    closeupAnswers(s, n) {
      const r = s.round;
      n.classList.add("s-cu-answers");
      n.innerHTML = `
        <div class="head">
          <div>
            <div class="label">Раунд ${s.ri + 1} · ${esc(r.title)}</div>
            <h2>Ответы</h2>
          </div>
        </div>
        <div class="cu-body">
          <div class="cu-frame"></div>
          <div class="cu-side">
            <div class="q-count">Предмет <b class="cu-num">1</b> из ${r.items.length}</div>
            <div class="cu-answer"></div>
          </div>
        </div>`;
      const frame = n.querySelector(".cu-frame");
      const num = n.querySelector(".cu-num");
      const answer = n.querySelector(".cu-answer");
      // заранее грузим все картинки: [крупный план, целиком] для каждого предмета
      const pics = r.items.map((it) => [1, 2].map((k) => {
        const im = loadImage(`assets/closeup/${it.prefix}_${k}`, null, () => im.classList.add("missing"));
        if (k === 1) im.style.transform = `scale(${r.zoom || 1})`;
        return im;
      }));
      // шаг: 0 — крупный план, 1 — целиком, 2 — слово-ответ
      let item = 0;
      let step = 0;
      const show = () => {
        frame.replaceChildren(...pics[item]);
        pics[item][0].classList.toggle("on", step === 0);
        pics[item][1].classList.toggle("on", step >= 1);
        num.textContent = item + 1;
        answer.textContent = r.items[item].answer;
        answer.classList.toggle("on", step >= 2);
      };
      show();
      return {
        next: () => {
          if (step < 2) step++;
          else if (item < r.items.length - 1) { item++; step = 0; }
          else return false;
          show();
          return true;
        },
        prev: () => {
          if (step > 0) step--;
          else if (item > 0) { item--; step = 2; }
          else return false;
          show();
          return true;
        },
      };
    },

    /* ── Раунд 5 ── */
    flip(s, n) {
      return questionSlide(s, n, {
        cover: cover("Загадка", s.i, s.total),
        body: `${counter("Загадка", s.i, s.total)}
               <div class="flip-text">«${esc(s.p.flipped)}»</div>`,
        phases: [{ label: "Думаем", seconds: s.round.seconds }],
      });
    },

    /* ── Раунд 6 ── */
    orderPlay(s, n) {
      const r = s.round;
      const w = s.w;
      const withImages = w.cards.some((c) => c.image);
      return questionSlide(s, n, {
        cover: `${cover("Волна", s.i, s.total)}<div class="cover-title">${esc(w.title)}</div>`,
        body: `${counter("Волна", s.i, s.total)}
               <div class="wave-title">${esc(w.title)}</div>
               <div class="wave-note">${esc(w.note ? `${w.note} · от раннего к позднему` : "От раннего к позднему")}</div>
               <div class="cards ${withImages ? "with-images" : ""}">
                 ${w.cards.map((c) => `<div>${c.image ? `<img src="assets/order/${esc(c.image)}.jpg" alt="">` : ""}<span>${esc(c.title)}</span></div>`).join("")}
               </div>`,
        phases: [{ label: "Раскладываем", seconds: r.seconds }],
        endText: "Стоп!",
      });
    },

    /* ── Ответы раунда ── */
    answers(s, n) {
      const r = s.round;
      const items = ANSWERS[r.type](r, s);
      const w = s.wave != null ? r.waves[s.wave] : null;
      const compact = items.every((a) => !a.prompt);
      const two = compact && items.length > 6;
      n.classList.add("s-answers");
      n.innerHTML = `
        <div class="head">
          <div>
            <div class="label">Раунд ${s.ri + 1} · ${esc(r.title)}${w ? ` · Волна ${s.wave + 1}` : ""}</div>
            <h2>${w ? `Ответы: ${esc(w.title)}` : "Ответы"}</h2>
          </div>
          <div class="q-count"><b class="shown">0</b> из ${items.length}</div>
        </div>
        <ol class="alist ${compact ? "compact" : ""} ${two ? "two" : ""}">
          ${items.map((a, idx) => `${two && idx === 0 ? `<div class="acol">` : ""}${two && idx === Math.ceil(items.length / 2) ? `</div><div class="acol">` : ""}
            <li class="arow">
              <div class="an">${esc(a.n)}</div>
              ${compact ? "" : `<div class="aq">${a.thumb ? `<span class="thumb ${a.thumbAfter ? "swap" : ""}"><img class="t-before" data-src="${esc(a.thumb)}" alt="">${a.thumbAfter ? `<img class="t-after" data-src="${esc(a.thumbAfter)}" alt="">` : ""}</span>` : ""}<span>${esc(a.prompt)}</span></div>`}
              <div class="aa"><div class="aa-in">
                <div class="ans">${a.verdict != null ? `<span class="verdict ${a.verdict ? "y" : "n"}">${a.verdict ? "ЕСТЬ" : "НЕТ"}</span>` : ""}${a.verdict != null ? "" : esc(a.answer)}</div>
                ${a.verdict != null ? `<div class="det" style="color:var(--fg-2)">${esc(a.answer)}${a.ref ? ` <span class="ref">${esc(a.ref)}</span>` : ""}</div>` : ""}
                ${a.detail ? `<div class="det">${esc(a.detail)}</div>` : ""}
              </div></div>
            </li>`).join("")}${two ? "</div>" : ""}
        </ol>`;
      // миниатюры («Крупный план», здания)
      n.querySelectorAll(".thumb img[data-src]").forEach((im) => {
        loadImage(im.dataset.src, (ok) => { im.src = ok.src; }, () => im.remove());
      });

      const rows = [...n.querySelectorAll(".arow")];
      const shownEl = n.querySelector(".shown");
      let shown = 0;
      let handle = null;
      const update = () => {
        rows.forEach((row, k) => {
          row.classList.toggle("on", k < shown);
          row.classList.toggle("cur", k === shown - 1);
        });
        shownEl.textContent = shown;
      };
      // Уменьшаем шрифт, если список не помещается. Пояснение видно только у последнего
      // открытого ответа, поэтому проверяем худший случай — каждую строку раскрытой.
      const fit = () => {
        const list = n.querySelector(".alist");
        if (!list.isConnected) return;
        const tallest = () => {
          let max = 0;
          rows.forEach((row) => {
            rows.forEach((x) => x.classList.remove("cur"));
            row.classList.add("cur");
            max = Math.max(max, list.scrollHeight);
          });
          update();
          return max;
        };
        let k = 1;
        list.style.setProperty("--k", k);
        while (tallest() > list.clientHeight + 1 && k > 0.5) {
          k -= 0.04;
          list.style.setProperty("--k", k.toFixed(2));
        }
      };
      requestAnimationFrame(fit);
      document.fonts && document.fonts.ready.then(() => requestAnimationFrame(fit));

      return {
        next: () => {
          if (shown >= rows.length) return false;
          shown++;
          update();
          const a = items[shown - 1];
          if (a.sound) {
            handle && handle.stop();
            Sound.play(a.sound).then((h) => { handle = h; });
          }
          return true;
        },
        prev: () => {
          if (shown === 0) return false;
          handle && handle.stop();
          shown--;
          update();
          return true;
        },
        destroy: () => handle && handle.stop(),
      };
    },

    end(s, n) {
      n.classList.add("s-end");
      n.innerHTML = `
        <div class="label appear">${esc(Q.subtitle)}</div>
        <h1 class="appear" style="--i:1">Спасибо за игру!</h1>
        <p class="appear" style="--i:2">Подводим итоги</p>`;
    },
  };

  /* ═══════════════ Навигация ═══════════════ */
  let cur = -1;
  let ctrl = {};
  const hudPos = document.querySelector("#hud .pos");

  function updateChrome(s) {
    const r = s.round;
    stage.dataset.round = r ? r.id : "";
    const bare = ["title", "end", "closeup"].includes(s.kind);
    chrome.classList.toggle("hidden", bare || !r);
    progress.classList.toggle("hidden", bare);
    chrome.innerHTML = r ? `<span class="round">Раунд ${s.ri + 1} <b>${esc(r.title)}</b></span><span></span>` : "";
    progress.innerHTML = Q.rounds.map((round, ri) => {
      let w = 0;
      if (s.kind === "end") w = 100;
      else if (s.ri != null) {
        if (ri < s.ri) w = 100;
        else if (ri === s.ri) {
          const list = slides.map((x, i) => [x, i]).filter(([x]) => x.ri === ri && !x.hidden);
          const pos = list.findIndex(([, i]) => i >= cur);
          w = ((pos < 0 ? list.length : pos + 1) / list.length) * 100;
        }
      }
      return `<div class="seg" style="--seg:var(--r-${round.id})"><i style="width:${w}%"></i></div>`;
    }).join("");
    hudPos.textContent = `${cur + 1}/${slides.length}`;
  }

  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (ctrl.destroy) ctrl.destroy();
    stage.querySelectorAll(".slide:not(.leave)").forEach((old) => {
      old.classList.add("leave");
      setTimeout(() => old.remove(), 320);
    });
    cur = i;
    const s = slides[i];
    const node = el(`<section class="slide enter"></section>`);
    if (s.round) node.dataset.round = s.round.id;
    ctrl = RENDER[s.kind](s, node) || {};
    slidesRoot.appendChild(node);
    setTimeout(() => node.classList.remove("enter"), 600);
    updateChrome(s);
    store.set("slide", i);
    history.replaceState(null, "", "#" + (i + 1));
    if (overlay && overlay.type === "slides") drawOverlay();
  }

  function next() {
    if (ctrl.next && ctrl.next()) return;
    let j = cur + 1;
    while (j < slides.length && slides[j].hidden) j++;
    if (j < slides.length) go(j);
  }

  function prev() {
    if (ctrl.prev && ctrl.prev()) return;
    let j = cur - 1;
    while (j >= 0 && slides[j].hidden) j--;
    if (j >= 0) go(j);
  }

  /* ═══════════════ Окна ведущего ═══════════════ */
  let overlay = null;

  function closeOverlay() {
    if (!overlay) return false;
    overlay.node.remove();
    overlay = null;
    return true;
  }
  function openOverlay(type) {
    if (overlay && overlay.type === type) { closeOverlay(); return; }
    closeOverlay();
    const node = el(`<div class="overlay"><div class="panel"></div></div>`);
    node.addEventListener("click", (e) => { if (e.target === node) closeOverlay(); });
    overlay = { type, node, panel: node.firstElementChild };
    drawOverlay();
    stage.appendChild(node);
  }

  function drawOverlay() {
    const { type, panel } = overlay;
    if (type === "slides") {
      const item = (s, i) => `<button class="ov-item ${i === cur ? "cur" : ""} ${s.spare ? "spare" : ""}" data-i="${i}">${esc(slideLabel(s))}</button>`;
      const general = slides.map((s, i) => [s, i]).filter(([s]) => s.ri == null);
      panel.innerHTML = `
        <h3>Все слайды</h3>
        <div class="sub">Нажмите, чтобы перейти. Пунктиром — запасные вопросы: в обычном показе они пропускаются.</div>
        <div class="ov-round"><h4>Общие</h4><div class="ov-list">${general.map(([s, i]) => item(s, i)).join("")}</div></div>
        ${Q.rounds.map((r, ri) => `
          <div class="ov-round" data-round="${r.id}">
            <h4>${ri + 1}. ${esc(r.title)}</h4>
            <div class="ov-list">${slides.map((s, i) => [s, i]).filter(([s]) => s.ri === ri).map(([s, i]) => item(s, i)).join("")}</div>
          </div>`).join("")}`;
      panel.querySelectorAll(".ov-item").forEach((b) => b.addEventListener("click", () => {
        closeOverlay();
        go(Number(b.dataset.i));
      }));
    }
    if (type === "help") {
      const keys = [
        ["Клик · → · Пробел · PgDn", "Дальше: показать вопрос и запустить время, следующий вопрос, открыть следующий ответ"],
        ["Правый клик · ← · PgUp", "Назад (в списке ответов — скрыть последний)"],
        ["P", "Пауза / продолжить время"],
        ["R", "Запустить время заново"],
        ["O", "Все слайды и запасные вопросы"],
        ["F", "Полный экран"],
        ["T", "Светлая / тёмная тема"],
        ["B", "Чёрный экран"],
        ["M", "Выключить / включить сигналы таймера"],
        ["Esc", "Закрыть окно"],
      ];
      panel.innerHTML = `
        <h3>Управление</h3>
        <div class="sub">Пульт-презентер тоже работает: он нажимает PgUp / PgDn.</div>
        <dl class="keys">${keys.map(([k, d]) => `<dt>${k.split(" · ").map((x) => `<span class="key">${x}</span>`).join(" ")}</dt><dd>${d}</dd>`).join("")}</dl>
        <div class="sub" style="margin-top:30px">Сигналы таймера: ${Sound.muted ? "выключены" : "включены"}.</div>`;
    }
  }

  /* ═══════════════ Клавиатура, мышь, экран ═══════════════ */
  function toggleTheme() {
    const light = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    store.set("theme", light ? "light" : "dark");
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  function toggleBlack() {
    const b = stage.querySelector(".blackout");
    if (b) b.remove();
    else stage.appendChild(el(`<div class="blackout"></div>`));
  }
  const timerToggle = () => ctrl.timer && ctrl.timer.toggle();
  const timerReset = () => { if (ctrl.timer) { ctrl.timer.reset(); ctrl.timer.start(); } };
  const removeBlackout = () => {
    const b = stage.querySelector(".blackout");
    if (b) { b.remove(); return true; }
    return false;
  };

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    Sound.unlock();
    if (removeBlackout() && !["KeyB", "Period"].includes(e.code)) { e.preventDefault(); return; }

    switch (e.code) {
      case "Escape": closeOverlay(); break;
      case "KeyO": openOverlay("slides"); break;
      case "KeyH": case "Slash": case "F1": e.preventDefault(); openOverlay("help"); break;
      case "KeyF": toggleFullscreen(); break;
      case "KeyT": toggleTheme(); break;
      case "KeyB": case "Period": toggleBlack(); break;
      case "KeyM": Sound.muted = !Sound.muted; if (overlay && overlay.type === "help") drawOverlay(); break;
      case "KeyP": timerToggle(); break;
      case "KeyR": timerReset(); break;
      case "Home": closeOverlay(); go(0); break;
      case "End": closeOverlay(); go(slides.length - 1); break;
      default:
        if (overlay) return;
        if (["ArrowRight", "ArrowDown", "PageDown", "Space", "Enter", "NumpadEnter"].includes(e.code)) {
          e.preventDefault();
          next();
        } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.code)) {
          e.preventDefault();
          prev();
        }
    }
  });

  // Клик мышью по экрану — дальше, правый клик — назад
  stage.addEventListener("click", (e) => {
    if (e.button !== 0 || e.target.closest(".overlay")) return;
    Sound.unlock();
    if (removeBlackout()) return;
    next();
  });
  stage.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".overlay")) return;
    e.preventDefault();
    if (removeBlackout()) return;
    prev();
  });

  // Масштаб сцены под экран
  function fit() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  }
  window.addEventListener("resize", fit);
  fit();
  // Фокус на кнопке не должен прокручивать сцену
  document.addEventListener("scroll", (e) => {
    const t = e.target === document ? document.scrollingElement : e.target;
    if (t && (t.scrollTop || t.scrollLeft) && !(t.closest && t.closest(".overlay"))) { t.scrollTop = 0; t.scrollLeft = 0; }
  }, true);

  // Кнопки ведущего и скрытие курсора
  const hud = document.getElementById("hud");
  let idleT;
  document.addEventListener("mousemove", () => {
    hud.classList.add("show");
    document.body.classList.remove("hide-cursor");
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      if (hud.matches(":hover")) return;
      hud.classList.remove("show");
      if (!overlay) document.body.classList.add("hide-cursor");
    }, 2500);
  });
  const HUD_ACTIONS = {
    prev, next,
    timer: timerToggle,
    slides: () => openOverlay("slides"),
    full: toggleFullscreen,
    theme: toggleTheme,
    help: () => openOverlay("help"),
  };
  hud.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", (e) => {
    e.currentTarget.blur();
    Sound.unlock();
    HUD_ACTIONS[b.dataset.a]();
  }));

  // Тема
  document.documentElement.dataset.theme = store.get("theme", "dark");

  // Старт: слайд из адреса (#12) или последний открытый
  const fromHash = parseInt(location.hash.slice(1), 10);
  const start = Number.isFinite(fromHash) ? fromHash - 1 : store.get("slide", 0);
  window.addEventListener("hashchange", () => {
    const k = parseInt(location.hash.slice(1), 10) - 1;
    if (Number.isFinite(k) && k !== cur) go(k);
  });
  go(Number.isFinite(start) && slides[start] ? start : 0);
})();
