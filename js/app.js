/*
 * Движок викторины: слайды, навигация, таймеры, очки команд.
 * Содержимое берётся из js/data.js.
 */
(() => {
  "use strict";

  const Q = window.QUIZ;
  const Sound = window.Sound;
  const TEAM_COLORS = ["#ff6b6b", "#ffb347", "#4cd49a", "#4da3ff", "#b57cff", "#ff7ac8", "#5ee0d6", "#f5e663"];

  /* ─────────────── Утилиты ─────────────── */
  const stage = document.getElementById("stage");
  const slidesRoot = stage.querySelector(".slides");
  const backdrop = stage.querySelector(".backdrop");
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
  const teamColor = (i) => TEAM_COLORS[i % TEAM_COLORS.length];

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

  const listeners = new Set();
  const emit = (type) => listeners.forEach((fn) => fn(type));
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  /* ─────────────── Команды и очки ─────────────── */
  let teams = store.get("teams", null);
  if (!Array.isArray(teams) || !teams.length) teams = Q.teams.map((name) => ({ name, scores: {} }));

  const total = (t) => Object.values(t.scores || {}).reduce((a, b) => a + b, 0);
  function saveTeams(type = "teams") {
    store.set("teams", teams);
    emit(type);
  }
  function addPoints(teamIdx, roundId, d) {
    const t = teams[teamIdx];
    t.scores[roundId] = (t.scores[roundId] || 0) + d;
    saveTeams("scores");
  }
  function ranking() {
    const rows = teams.map((t, i) => ({ t, i, total: total(t) })).sort((a, b) => b.total - a.total || a.i - b.i);
    rows.forEach((r, k) => { r.place = k > 0 && rows[k - 1].total === r.total ? rows[k - 1].place : k + 1; });
    return rows;
  }

  // Фото фигурок (раунд 1) — хранятся, пока открыта страница
  const photos = {};

  /* ─────────────── Таймер ─────────────── */
  class Timer {
    constructor(phases, opts = {}) {
      this.phases = phases;
      this.opts = opts;
      this.el = el(`
        <div class="timer ${opts.size || ""}">
          <svg viewBox="0 0 100 100">
            <circle class="track" cx="50" cy="50" r="45" fill="none" stroke-width="${opts.size ? 7 : 5}"/>
            <circle class="bar" cx="50" cy="50" r="45" fill="none" stroke-width="${opts.size ? 7 : 5}" pathLength="1000" stroke-dasharray="1000"/>
          </svg>
          <div class="readout"><div class="digits"></div><div class="label"></div></div>
        </div>`);
      this.bar = this.el.querySelector(".bar");
      this.digits = this.el.querySelector(".digits");
      this.label = this.el.querySelector(".label");
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
      this.opts.onPhase && this.opts.onPhase(-1);
    }
    start() {
      if (this.state === "running" || this.state === "destroyed") return;
      if (this.state === "done") this.reset();
      Sound.unlock();
      if (this.state === "idle") this.opts.onPhase && this.opts.onPhase(this.idx);
      this.state = "running";
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
      this.render();
    }
    pause() {
      if (this.state !== "running") return;
      cancelAnimationFrame(this.raf);
      this.state = "paused";
      this.render();
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
      if (this.idx < this.phases.length - 1) {
        this.idx++;
        this.remaining = this.phase.seconds * 1000;
        this.lastSecs = null;
        Sound.end();
        this.opts.onPhase && this.opts.onPhase(this.idx);
      } else {
        this.remaining = 0;
        this.state = "done";
        Sound.end();
        this.opts.onPhase && this.opts.onPhase(this.phases.length);
        this.opts.onEnd && this.opts.onEnd();
      }
    }
    render() {
      const full = this.phase.seconds * 1000;
      const secs = Math.max(0, Math.ceil(this.remaining / 1000));
      this.bar.style.strokeDashoffset = String(1000 * (1 - Math.max(0, this.remaining) / full));
      this.digits.textContent = fmt(secs);
      const labels = { idle: this.opts.idleLabel || this.phase.label || "Готовы?", paused: "Пауза", done: "Время!", running: this.phase.label || "" };
      this.label.textContent = labels[this.state] || "";
      const warnAt = this.phase.seconds > 20 ? 10 : 3;
      const cl = this.el.classList;
      ["idle", "running", "paused", "done"].forEach((c) => cl.toggle(c, this.state === c));
      cl.toggle("warn", this.state === "running" && secs <= warnAt);
    }
    destroy() {
      cancelAnimationFrame(this.raf);
      this.state = "destroyed";
    }
  }

  /* ─────────────── Крупные надписи поверх слайда ─────────────── */
  function shout(parent, items, { step = 750, hold = 1600 } = {}) {
    const box = el(`<div class="shout"></div>`);
    parent.appendChild(box);
    let alive = true;
    (async () => {
      for (let k = 0; k < items.length && alive; k++) {
        const text = items[k];
        box.innerHTML = `<span class="${text.length > 6 ? "sm" : ""}">${esc(text)}</span>`;
        await sleep(k === items.length - 1 ? hold : step);
      }
      if (!alive) return;
      box.classList.add("out");
      await sleep(400);
      box.remove();
    })();
    return () => { alive = false; box.remove(); };
  }

  /* ─────────────── Картинки с подбором расширения ─────────────── */
  const EXTS = ["jpg", "png", "jpeg", "webp", "JPG", "PNG"];
  function loadImage(base, onOk, onFail) {
    const img = new Image();
    let k = 0;
    img.onload = () => onOk(img);
    img.onerror = () => {
      k++;
      if (k < EXTS.length) img.src = `${base}.${EXTS[k]}`;
      else onFail && onFail();
    };
    img.src = `${base}.${EXTS[0]}`;
    return img;
  }

  /* ─────────────── Конфетти ─────────────── */
  function confetti(parent) {
    const c = el(`<canvas class="confetti" width="1920" height="1080"></canvas>`);
    parent.appendChild(c);
    const g = c.getContext("2d");
    const colors = TEAM_COLORS;
    const parts = Array.from({ length: 260 }, () => ({
      x: 960 + (Math.random() - 0.5) * 400,
      y: 700,
      vx: (Math.random() - 0.5) * 34,
      vy: -Math.random() * 34 - 14,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 12 + Math.random() * 14,
      h: 8 + Math.random() * 10,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    let raf;
    const frame = (now) => {
      g.clearRect(0, 0, 1920, 1080);
      for (const p of parts) {
        p.vy += 0.75;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        g.restore();
      }
      if (now - t0 < 7000) raf = requestAnimationFrame(frame);
      else c.remove();
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); c.remove(); };
  }

  /* ─────────────── Просмотр фото ─────────────── */
  function lightbox(url, teamIdx) {
    closeLightbox();
    const lb = el(`<div class="lightbox"><img src="${url}" alt=""></div>`);
    if (teamIdx != null) {
      lb.appendChild(el(`<span class="chip accent tag" style="background:${teamColor(teamIdx)}"><b>${teamIdx + 1}</b> ${esc(teams[teamIdx]?.name)}</span>`));
    }
    lb.addEventListener("click", closeLightbox);
    stage.appendChild(lb);
  }
  function closeLightbox() {
    const lb = stage.querySelector(".lightbox");
    if (lb) { lb.remove(); return true; }
    return false;
  }

  /* ═══════════════ Сборка списка слайдов ═══════════════ */
  const slides = [];
  const add = (kind, data = {}) => slides.push({ kind, ...data });

  const BUILD = {
    sculpt(r, base) {
      r.questions.forEach((q, qi) => {
        const key = `${r.id}-${qi}`;
        const d = { ...base, q, qi, total: r.questions.length, key };
        add("sculptQ", d);
        add("gallery", d);
        add("sculptA", d);
      });
      (r.spare || []).forEach((q, qi) => {
        const d = { ...base, q, qi, key: `${r.id}-s${qi}`, spare: true, hidden: true, group: `${r.id}-spare-${qi}` };
        add("sculptQ", d);
        add("gallery", d);
        add("sculptA", d);
      });
      add("bonus", base);
    },
    sounds(r, base) {
      r.sounds.forEach((s, i) => add("sound", { ...base, s, i }));
      add("section", { ...base, emoji: "📝", eyebrow: "Все звуки прозвучали", title: "Сдаём карточки", text: "Теперь разбор: смотрим ответы и слушаем каждый звук ещё раз." });
      r.sounds.forEach((s, i) => add("soundReview", { ...base, s, i }));
    },
    bible(r, base) {
      r.statements.forEach((st, i) => {
        add("statement", { ...base, st, i });
        add("verdict", { ...base, st, i });
      });
    },
    closeup(r, base) {
      r.items.forEach((it, i) => {
        add("closeup", { ...base, it, i });
        add("closeupAnswer", { ...base, it, i });
      });
    },
    flip(r, base) {
      r.puzzles.forEach((p, i) => {
        add("flip", { ...base, p, i });
        add("flipAnswer", { ...base, p, i });
      });
    },
    order(r, base) {
      add("orderPlay", base);
      add("orderReveal", base);
    },
  };

  add("title");
  add("teams");
  Q.rounds.forEach((round, ri) => {
    const base = { round, ri };
    add("intro", base);
    BUILD[round.type](round, base);
    add("results", base);
  });
  add("final");

  // Подписи для списка слайдов (клавиша O)
  function slideLabel(s) {
    const cut = (t, n = 38) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    switch (s.kind) {
      case "title": return "Заставка";
      case "teams": return "Команды";
      case "intro": return "Правила раунда";
      case "results": return "Итоги раунда";
      case "final": return "Финал";
      case "sculptQ": return (s.spare ? "Запасной: " : `Вопрос ${s.qi + 1}: `) + cut(s.q.answer);
      case "gallery": return (s.spare ? "Запасной — " : `${s.qi + 1} — `) + "галерея";
      case "sculptA": return (s.spare ? "Запасной — " : `${s.qi + 1} — `) + "ответ";
      case "bonus": return "Бонус: лучшая фигурка";
      case "sound": return `Звук ${s.i + 1}`;
      case "section": return "Разбор";
      case "soundReview": return `Ответ ${s.i + 1}: ${cut(s.s.answer, 26)}`;
      case "statement": return `${s.i + 1}. ${cut(s.st.text)}`;
      case "verdict": return `${s.i + 1} — ответ`;
      case "closeup": return `${s.i + 1}. ${s.it.answer}`;
      case "closeupAnswer": return `${s.i + 1} — ответ`;
      case "flip": return `${s.i + 1}. ${cut(s.p.flipped)}`;
      case "flipAnswer": return `${s.i + 1} — ответ`;
      case "orderPlay": return "Раскладка (таймер)";
      case "orderReveal": return "Разбор цепочки";
      default: return s.kind;
    }
  }

  /* ═══════════════ Отрисовка слайдов ═══════════════ */
  const timerSide = (timer) => {
    const side = el(`<div class="side pop" style="--i:2"></div>`);
    side.appendChild(timer.el);
    return side;
  };
  const scoringChip = ([p, t]) => {
    const n = parseInt(String(p).replace("+", ""), 10);
    return `<span class="chip"><b>${esc(p)}</b> ${Number.isFinite(n) ? ptsWord(n) + " — " : ""}${esc(t)}</span>`;
  };

  const RENDER = {
    title(s, n) {
      n.classList.add("s-title");
      const ids = Q.rounds.map((r) => r.id);
      const letters = [...Q.title].map((ch, i) => `<span style="--i:${i};color:var(--r-${ids[i % ids.length]})">${esc(ch)}</span>`).join("");
      n.innerHTML = `
        <div class="kicker rise">${esc(Q.subtitle)}</div>
        <h1 class="rise" style="--i:1">${letters}</h1>
        <div class="rounds-strip">
          ${Q.rounds.map((r, i) => `
            <div class="round-card pop" data-round="${r.id}" style="--i:${i + 2}">
              <div class="emoji">${r.icon}</div>
              <div class="n">Раунд ${i + 1}</div>
              <div class="t">${esc(r.title)}</div>
            </div>`).join("")}
        </div>`;
    },

    teams(s, n) {
      n.classList.add("s-teams");
      const draw = () => {
        n.innerHTML = `
          <div class="eyebrow rise">Соревнуемся командами · ${Q.rounds.length} раундов</div>
          <h2 class="rise" style="--i:1">Команды</h2>
          <div class="teams-grid">
            ${teams.map((t, i) => `
              <div class="team-card pop" style="--tc:${teamColor(i)};--i:${i + 2}">
                <div class="team-badge">${i + 1}</div>
                <div class="name" contenteditable="plaintext-only" spellcheck="false" data-i="${i}">${esc(t.name)}</div>
              </div>`).join("")}
          </div>`;
        n.querySelectorAll(".name").forEach((nm) => {
          nm.addEventListener("input", () => {
            teams[Number(nm.dataset.i)].name = nm.textContent.trim() || `Команда ${Number(nm.dataset.i) + 1}`;
            saveTeams("rename");
          });
        });
      };
      draw();
      const off = on((type) => { if (type === "teams") draw(); });
      return { destroy: off };
    },

    intro(s, n) {
      const r = s.round;
      n.classList.add("s-intro");
      n.innerHTML = `
        <div class="left">
          <div class="big-num rise">${s.ri + 1}<span class="icon emoji pop" style="--i:3">${r.icon}</span></div>
          <h1 class="rise" style="--i:1">${esc(r.title)}</h1>
          <div class="tagline rise" style="--i:2">${esc(r.tagline)}</div>
        </div>
        <div class="right">
          ${r.rules.map((t, i) => `<div class="rule rise" style="--i:${i + 2}"><span class="n">${i + 1}</span><span>${esc(t)}</span></div>`).join("")}
          <div class="scoring rise" style="--i:${r.rules.length + 2}">${r.scoring.map(scoringChip).join("")}</div>
        </div>`;
    },

    /* ── Раунд 1 ── */
    sculptQ(s, n) {
      const r = s.round;
      n.classList.add("s-question");
      let cancelShout = null;
      const timer = new Timer(r.phases, {
        idleLabel: "Готовы?",
        onPhase: (k) => n.querySelectorAll(".phase").forEach((p, j) => {
          p.classList.toggle("active", j === k);
          p.classList.toggle("past", j < k);
        }),
        onEnd: () => { cancelShout = shout(n, ["Стоп!", "Фото — ведущему 📸"], { step: 1100, hold: 2200 }); },
      });
      const long = s.q.text.length > 150;
      n.innerHTML = `
        <div class="body">
          <div class="row rise">${s.spare ? `<span class="chip accent">Запасной вопрос</span>` : `<span class="counter">Вопрос <b>${s.qi + 1}</b> / ${s.total}</span>`}</div>
          <div class="q-text rise ${long ? "long" : ""}" style="--i:1">${esc(s.q.text)}</div>
          <div class="phases rise" style="--i:2">
            ${r.phases.map((p, i) => `<div class="phase" data-i="${i}">${i + 1}. ${esc(p.label)}<b>${fmt(p.seconds)}</b></div>`).join("")}
          </div>
        </div>`;
      n.appendChild(timerSide(timer));
      return {
        timer,
        next: () => (timer.state === "idle" ? (timer.start(), true) : false),
        destroy: () => { timer.destroy(); cancelShout && cancelShout(); },
      };
    },

    gallery(s, n) {
      n.classList.add("s-gallery");
      const list = (photos[s.key] ||= []);
      const input = el(`<input type="file" accept="image/*" multiple hidden>`);
      let target = 0;

      const put = (files, startAt) => {
        let k = startAt;
        for (const f of files) {
          if (!f.type.startsWith("image/")) continue;
          while (k < teams.length && list[k] && k !== startAt) k++;
          if (k >= teams.length) break;
          list[k] = URL.createObjectURL(f);
          k++;
        }
        draw();
      };
      const firstEmpty = () => { for (let i = 0; i < teams.length; i++) if (!list[i]) return i; return -1; };

      let firstDraw = true;
      const draw = () => {
        const cols = teams.length <= 4 ? 2 : 3;
        const anim = firstDraw ? "pop" : "";
        n.innerHTML = `
          <div class="head">
            <div>
              <div class="eyebrow rise">${s.spare ? "Запасной вопрос" : `Вопрос ${s.qi + 1}`} · Галерея</div>
              <h2 class="rise" style="--i:1">Что слепили команды?</h2>
            </div>
            <span class="chip rise" style="--i:2">Кто узнает фигурку?</span>
          </div>
          <div class="gallery" style="--cols:${cols}">
            ${teams.map((t, i) => `
              <div class="slot ${list[i] ? "filled" : ""} ${anim}" data-i="${i}" style="--tc:${teamColor(i)};--i:${i + 2}">
                <span class="tag"><i>${i + 1}</i>${esc(t.name)}</span>
                ${list[i]
                  ? `<img src="${list[i]}" alt=""><button class="remove" title="Убрать фото">✕</button>`
                  : `<div class="empty"><span class="emoji">📷</span>Перетащите фото сюда<br>или нажмите</div>`}
              </div>`).join("")}
          </div>`;
        n.appendChild(input);
        if (!firstDraw) n.querySelectorAll(".rise").forEach((x) => x.classList.remove("rise"));
        firstDraw = false;
        n.querySelectorAll(".slot").forEach((slot) => {
          const i = Number(slot.dataset.i);
          slot.addEventListener("click", (e) => {
            if (e.target.closest(".remove")) {
              list[i] = null;
              draw();
              return;
            }
            if (list[i]) lightbox(list[i], i);
            else { target = i; input.click(); }
          });
          slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("dragover"); });
          slot.addEventListener("dragleave", () => slot.classList.remove("dragover"));
          slot.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            put([...e.dataTransfer.files], i);
          });
        });
      };
      input.addEventListener("change", () => { put([...input.files], target); input.value = ""; });
      n.addEventListener("dragover", (e) => e.preventDefault());
      n.addEventListener("drop", (e) => {
        e.preventDefault();
        const k = firstEmpty();
        if (k >= 0) put([...e.dataTransfer.files], k);
      });
      const onPaste = (e) => {
        const files = [...(e.clipboardData?.files || [])];
        const k = firstEmpty();
        if (files.length && k >= 0) put(files, k);
      };
      document.addEventListener("paste", onPaste);
      draw();
      const off = on((type) => { if (type === "teams") draw(); });
      return { destroy: () => { document.removeEventListener("paste", onPaste); off(); } };
    },

    sculptA(s, n) {
      n.classList.add("s-answer");
      const long = s.q.answer.length > 12;
      n.innerHTML = `
        <div class="answer-art emoji pop">${s.q.emoji || "❔"}</div>
        <div class="body">
          <div class="eyebrow rise">Правильный ответ</div>
          <h1 class="rise ${long ? "long" : ""}" style="--i:1">${esc(s.q.answer)}</h1>
          ${s.q.note ? `<div class="note rise" style="--i:2">${esc(s.q.note)}</div>` : ""}
        </div>`;
    },

    bonus(s, n) {
      n.classList.add("s-gallery");
      const r = s.round;
      const keys = [...r.questions.map((_, qi) => `${r.id}-${qi}`), ...(r.spare || []).map((_, qi) => `${r.id}-s${qi}`)];
      const cols = teams.length <= 4 ? 2 : 3;
      n.innerHTML = `
        <div class="head">
          <div>
            <div class="eyebrow rise">Бонус зала · +1 ${ptsWord(1)}</div>
            <h2 class="rise" style="--i:1">Самая красивая фигурка</h2>
          </div>
          <span class="chip accent rise" style="--i:2">👏 Решают аплодисменты</span>
        </div>
        <div class="bonus-grid" style="--cols:${cols}">
          ${teams.map((t, i) => {
            const pics = keys.map((k) => photos[k]?.[i]).filter(Boolean);
            return `
              <div class="bonus-team pop" style="--tc:${teamColor(i)};--i:${i + 2}">
                <div class="tag">${esc(t.name)}</div>
                <div class="pics">
                  ${pics.length ? pics.slice(0, 4).map((u) => `<div data-u="${u}" data-i="${i}"><img src="${u}" alt=""></div>`).join("")
                    : `<div style="grid-column:1/-1;display:grid;place-items:center;color:var(--muted);font-size:24px">Нет фото</div>`}
                </div>
              </div>`;
          }).join("")}
        </div>`;
      n.querySelectorAll("[data-u]").forEach((d) => d.addEventListener("click", () => lightbox(d.dataset.u, Number(d.dataset.i))));
    },

    /* ── Раунд 2 ── */
    sound(s, n) {
      const r = s.round;
      n.classList.add("s-sound");
      n.innerHTML = `
        <div class="sound-orb pop"><span class="ring"></span><span class="ring"></span><span class="ring"></span>
          <span class="no-label">Звук</span><span class="n">${s.i + 1}</span></div>
        <div class="eq">${Array.from({ length: 28 }, (_, k) => `<i style="--i:${k}"></i>`).join("")}</div>
        <div class="sound-status">Слушаем внимательно</div>
        <div class="timer-wrap"></div>
        <div class="missing"></div>`;
      const status = n.querySelector(".sound-status");
      const missing = n.querySelector(".missing");
      const timer = new Timer([{ label: "Пишем", seconds: r.writeSeconds }], {
        size: "small",
        idleLabel: "Запись",
        onEnd: () => { status.textContent = "Следующий звук →"; },
      });
      n.querySelector(".timer-wrap").appendChild(timer.el);

      Sound.probe(s.s.file).then((ok) => {
        if (!ok) missing.textContent = s.s.synth ? "" : `Нет файла: ${s.s.file}`;
      });

      let state = "idle";
      let handle = null;
      let alive = true;
      const playOnce = async () => {
        n.classList.add("playing");
        handle = await Sound.play(s.s);
        if (handle.source === "missing") missing.textContent = `Нет файла: ${s.s.file}`;
        await handle.done;
        n.classList.remove("playing");
      };
      const run = async () => {
        state = "playing";
        status.textContent = "Звучит…";
        await playOnce();
        if (!alive) return;
        status.textContent = "Сейчас ещё раз";
        await sleep(3000);
        if (!alive) return;
        status.textContent = "Ещё раз…";
        await playOnce();
        if (!alive) return;
        status.textContent = "Записываем ответ!";
        state = "done";
        timer.start();
      };
      n.querySelector(".sound-orb").addEventListener("click", () => {
        if (state === "idle") run();
        else if (state === "done") playOnce();
      });
      return {
        timer,
        next: () => (state === "idle" ? (run(), true) : false),
        destroy: () => { alive = false; handle && handle.stop(); timer.destroy(); },
      };
    },

    section(s, n) {
      n.classList.add("s-section");
      n.innerHTML = `
        <div class="big-emoji emoji pop">${s.emoji}</div>
        <div class="eyebrow rise" style="margin-top:40px">${esc(s.eyebrow)}</div>
        <h2 class="rise" style="--i:1">${esc(s.title)}</h2>
        <p class="rise" style="--i:2">${esc(s.text)}</p>`;
    },

    soundReview(s, n) {
      n.classList.add("s-sound-review");
      n.innerHTML = `
        <div class="answer-art emoji pop">${s.s.emoji}</div>
        <div class="body">
          <div class="badge rise">Звук №${s.i + 1}</div>
          <h1 class="rise ${s.s.answer.length > 18 ? "long" : ""}" style="--i:1">${esc(s.s.answer)}</h1>
          <div class="detail rise" style="--i:2">${esc(s.s.detail)}</div>
          <div class="replay rise" style="--i:3">
            <button class="chip accent" style="cursor:pointer;border:0">▶ Послушать ещё раз</button>
            <div class="eq">${Array.from({ length: 16 }, (_, k) => `<i style="--i:${k}"></i>`).join("")}</div>
          </div>
        </div>`;
      let handle = null;
      let played = false;
      let alive = true;
      const play = async () => {
        played = true;
        handle && handle.stop();
        n.classList.add("playing");
        handle = await Sound.play(s.s);
        if (!alive) { handle.stop(); return; }
        await handle.done;
        n.classList.remove("playing");
      };
      n.querySelector("button").addEventListener("click", play);
      return {
        next: () => (played ? false : (play(), true)),
        destroy: () => { alive = false; handle && handle.stop(); },
      };
    },

    /* ── Раунд 3 ── */
    statement(s, n) {
      const r = s.round;
      n.classList.add("s-question", "s-statement");
      let cancelShout = null;
      const timer = new Timer([{ label: "Обсуждаем", seconds: r.seconds }], {
        idleLabel: "Готовы?",
        onEnd: () => { cancelShout = shout(n, ["3", "2", "1", "Таблички!"], { step: 800, hold: 2000 }); },
      });
      n.innerHTML = `
        <div class="body">
          <span class="counter rise">Утверждение <b>${s.i + 1}</b> / ${r.statements.length}</span>
          <div class="statement-card rise" style="--i:1">${esc(s.st.text)}</div>
          <div class="signs rise" style="--i:2"><div class="sign yes">ЕСТЬ</div><div class="sign no">НЕТ</div></div>
        </div>`;
      n.appendChild(timerSide(timer));
      return {
        timer,
        next: () => (timer.state === "idle" ? (timer.start(), true) : false),
        destroy: () => { timer.destroy(); cancelShout && cancelShout(); },
      };
    },

    verdict(s, n) {
      const st = s.st;
      const yes = st.isInBible;
      n.classList.add("s-verdict");
      n.innerHTML = `
        <div class="stmt rise">${s.i + 1}. ${esc(st.text)}</div>
        <div class="main">
          <div class="stamp ${yes ? "yes" : "no"}">${yes ? "ЕСТЬ" : "НЕТ"}</div>
          <div class="body">
            <div class="explain rise ${st.quote ? "quote" : ""}" style="--i:3">${esc(st.explain)}</div>
            ${st.ref ? `<div class="refs rise" style="--i:4"><span class="ref">${esc(st.ref)}</span></div>` : ""}
            ${st.aside ? `<div class="aside rise" style="--i:5">${esc(st.aside)}</div>` : ""}
          </div>
        </div>
        <div class="foot">${esc(s.round.refNote || "")}</div>`;
    },

    /* ── Раунд 4 ── */
    closeup(s, n) {
      const r = s.round;
      const it = s.it;
      n.classList.add("s-closeup");
      n.innerHTML = `
        <div class="frame"></div>
        <div class="hud">
          <div class="row">
            <div class="item-chip glass">Предмет <b>${s.i + 1}</b> / ${r.items.length}</div>
            <div class="stages glass">
              ${[0, 1, 2].map((k) => `<div class="stage-dot" data-k="${k}">Этап ${k + 1} · <b>${3 - k}</b> ${ptsWord(3 - k)}</div>`).join("")}
            </div>
          </div>
          <div class="timer-box glass"></div>
        </div>`;
      const frame = n.querySelector(".frame");
      const ZOOM = [[3.2, 14], [1.8, 5], [1, 0]];
      const ph = el(`<div class="placeholder"><div><span class="emoji">${it.emoji || "❔"}</span>Нет картинки<br><code>assets/closeup/${esc(it.prefix)}_1.jpg … _4.jpg</code></div></div>`);
      const imgs = [];
      const failed = [false, false, false];
      let stageIdx = 0;

      const show = () => {
        imgs.forEach((im, k) => im.classList.toggle("on", k === stageIdx && !failed[k]));
        ph.style.display = failed[stageIdx] ? "" : "none";
        const e = ph.querySelector(".emoji");
        e.style.setProperty("--zoom", ZOOM[stageIdx][0]);
        e.style.setProperty("--blur", ZOOM[stageIdx][1] + "px");
        n.querySelectorAll(".stage-dot").forEach((d, k) => {
          d.classList.toggle("active", k === stageIdx);
          d.classList.toggle("past", k < stageIdx);
        });
      };
      frame.appendChild(ph);
      [1, 2, 3].forEach((num, k) => {
        const img = loadImage(`assets/closeup/${it.prefix}_${num}`, () => show(), () => { failed[k] = true; show(); });
        img.alt = "";
        imgs.push(img);
        frame.appendChild(img);
      });
      ph.style.display = "none";

      const timer = new Timer([{ label: "", seconds: r.stageSeconds }], {
        size: "mini",
        onEnd: () => { if (stageIdx < 2) goStage(stageIdx + 1); },
      });
      n.querySelector(".timer-box").appendChild(timer.el);
      const goStage = (k) => {
        stageIdx = k;
        show();
        timer.reset();
        timer.start();
      };
      show();
      return {
        timer,
        next: () => {
          if (timer.state === "idle" && stageIdx === 0) { timer.start(); return true; }
          if (stageIdx < 2) { goStage(stageIdx + 1); return true; }
          return false;
        },
        destroy: () => timer.destroy(),
      };
    },

    closeupAnswer(s, n) {
      const it = s.it;
      n.classList.add("s-closeup");
      n.innerHTML = `
        <div class="frame"></div>
        <div class="closeup-answer glass" style="top:50px;bottom:auto">
          <span class="emoji">${it.emoji || ""}</span>
          <div>
            <h1>${esc(it.answer)}</h1>
            ${it.fact ? `<p>${esc(it.fact)}</p>` : ""}
          </div>
        </div>`;
      const frame = n.querySelector(".frame");
      const ph = el(`<div class="placeholder"><div><span class="emoji">${it.emoji || "❔"}</span></div></div>`);
      const img = loadImage(`assets/closeup/${it.prefix}_4`, (im) => im.classList.add("on"), () => {
        const img3 = loadImage(`assets/closeup/${it.prefix}_3`, (im) => im.classList.add("on"), () => frame.appendChild(ph));
        frame.appendChild(img3);
      });
      frame.appendChild(img);
    },

    /* ── Раунд 5 ── */
    flip(s, n) {
      const r = s.round;
      const p = s.p;
      n.classList.add("s-question", "s-flip");
      let cancelShout = null;
      const timer = new Timer([{ label: "Думаем", seconds: r.seconds }], {
        idleLabel: "Готовы?",
        onEnd: () => { cancelShout = shout(n, ["Время!"], { hold: 1400 }); },
      });
      const levels = ["", "лёгкая", "средняя", "сложная"];
      n.innerHTML = `
        <div class="body">
          <div class="row rise">
            <span class="counter">Загадка <b>${s.i + 1}</b> / ${r.puzzles.length}</span>
            <span class="level">${[1, 2, 3].map((k) => `<i class="${k <= p.level ? "on" : ""}"></i>`).join("")}&nbsp;${levels[p.level] || ""}</span>
          </div>
          <div class="flip-text rise" style="--i:1">«${esc(p.flipped)}»</div>
        </div>`;
      n.appendChild(timerSide(timer));
      return {
        timer,
        next: () => (timer.state === "idle" ? (timer.start(), true) : false),
        destroy: () => { timer.destroy(); cancelShout && cancelShout(); },
      };
    },

    flipAnswer(s, n) {
      const p = s.p;
      n.classList.add("s-flip-answer");
      n.innerHTML = `
        <div class="eyebrow rise">Оригинал · ${esc(p.kind)}</div>
        <div class="orig rise" style="--i:1">«${esc(p.original)}»</div>
        <div class="pairs">
          ${p.pairs.map(([a, b], k) => `<div class="pair pop" style="--i:${k + 3}"><s>${esc(a)}</s><span class="arr">→</span><b>${esc(b)}</b></div>`).join("")}
        </div>
        ${p.fact ? `<div class="fact rise" style="--i:${p.pairs.length + 3}">${esc(p.fact)}</div>` : ""}`;
    },

    /* ── Раунд 6 ── */
    orderPlay(s, n) {
      const r = s.round;
      n.classList.add("s-order-play");
      let cancelShout = null;
      const timer = new Timer([{ label: "Раскладываем", seconds: r.seconds }], {
        idleLabel: "Готовы?",
        onEnd: () => { cancelShout = shout(n, ["Стоп!", "Переворачиваем!"], { step: 1100, hold: 2000 }); },
      });
      // карточки на экране в перемешанном порядке
      const mix = [3, 0, 5, 1, 4, 2].filter((k) => k < r.events.length);
      const rots = [-3, 2, -1.5, 3, -2.5, 1.5];
      n.appendChild(timerSide(timer));
      n.appendChild(el(`
        <div class="cards">
          ${mix.map((k, j) => `
            <div class="event-card pop" style="--rot:${rots[j]}deg;--i:${j + 1}">
              <span class="emoji">${r.events[k].emoji}</span>
              <div class="t">${esc(r.events[k].title)}</div>
            </div>`).join("")}
        </div>`));
      return {
        timer,
        next: () => (timer.state === "idle" ? (timer.start(), true) : false),
        destroy: () => { timer.destroy(); cancelShout && cancelShout(); },
      };
    },

    orderReveal(s, n) {
      const r = s.round;
      n.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:flex-end">
          <div>
            <div class="eyebrow rise">Разбор · ${esc(r.tagline)}</div>
            <h2 class="rise" style="--i:1;font:800 72px/1 var(--display);margin:16px 0 0;letter-spacing:-0.02em;white-space:nowrap">Правильный порядок</h2>
          </div>
          <div class="scoring rise" style="--i:2;margin:0">${r.scoring.map(scoringChip).join("")}</div>
        </div>
        <div class="timeline">
          ${r.events.map((e, k) => `
            <div class="tl-item">
              <div class="node">${k + 1}</div>
              <div class="card">
                <span class="emoji">${e.emoji}</span>
                <div class="year">${e.year}</div>
                <div class="t">${esc(e.title)}</div>
                <div class="d">${esc(e.detail)}</div>
              </div>
            </div>`).join("")}
        </div>`;
      const items = [...n.querySelectorAll(".tl-item")];
      let shown = 0;
      return {
        next: () => {
          if (shown >= items.length) return false;
          items[shown++].classList.add("on");
          return true;
        },
      };
    },

    /* ── Итоги ── */
    results(s, n) {
      n.classList.add("s-results");
      const rid = s.round.id;
      let first = true;
      const draw = () => {
        const rows = ranking();
        const max = Math.max(1, ...rows.map((r) => r.total));
        const a = (cls, i) => (first ? `${cls}" style="--i:${i}` : "");
        n.innerHTML = `
          <div class="head">
            <div>
              <div class="eyebrow ${a("rise", 0)}">Итоги раунда ${s.ri + 1} из ${Q.rounds.length}</div>
              <h2 class="${a("rise", 1)}">${esc(s.round.title)}</h2>
            </div>
            <div class="row ${a("rise", 2)}"><span class="chip">за раунд</span><span class="chip">всего</span></div>
          </div>
          <div class="board">
            ${rows.map((row, k) => {
              const plus = row.t.scores[rid] || 0;
              return `
                <div class="board-row ${first ? "rise" : ""} ${row.place === 1 && row.total > 0 ? "leader" : ""}" style="--tc:${teamColor(row.i)};--i:${k + 2}" data-i="${row.i}">
                  <div class="fill" data-w="${(row.total / max) * 100}"></div>
                  <div class="place">${row.place}</div>
                  <div class="dot">${row.i + 1}</div>
                  <div class="name">${esc(row.t.name)}</div>
                  <div class="ctl"><button data-d="-1">−1</button><button data-d="1">+1</button><button data-d="2">+2</button></div>
                  <div class="plus ${plus ? "" : "zero"}">${plus > 0 ? "+" + plus : plus}</div>
                  <div class="total">${row.total}</div>
                </div>`;
            }).join("")}
          </div>`;
        const fills = n.querySelectorAll(".fill");
        if (first) requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach((f) => { f.style.width = f.dataset.w + "%"; })));
        else fills.forEach((f) => { f.style.transition = "none"; f.style.width = f.dataset.w + "%"; });
        n.querySelectorAll(".ctl button").forEach((b) => b.addEventListener("click", () => {
          addPoints(Number(b.closest(".board-row").dataset.i), rid, Number(b.dataset.d));
        }));
        first = false;
      };
      draw();
      return { destroy: on(draw) };
    },

    final(s, n) {
      n.classList.add("s-final");
      const rows = ranking();
      const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
      const top = rows.slice(0, 3);
      const rest = rows.slice(3);
      const order = [top[1], top[0], top[2]].filter(Boolean);
      const cls = (row) => `p${Math.min(row.place, 3)}`;
      n.innerHTML = `
        <div class="head">
          <div>
            <div class="eyebrow rise">Финал</div>
            <h2 class="rise" style="--i:1">Итоги викторины</h2>
          </div>
          <span class="chip rise" style="--i:2">${Q.rounds.length} раундов позади 🎉</span>
        </div>
        <div class="podium">
          ${order.map((row) => `
            <div class="pod ${cls(row)}" data-rank="${rows.indexOf(row)}" style="--tc:${teamColor(row.i)}">
              <div class="medal emoji">${medals[row.place] || "🏅"}</div>
              <div class="nm">${esc(row.t.name)}</div>
              <div class="pts">${row.total} ${ptsWord(row.total)}</div>
              <div class="block">${row.place}</div>
            </div>`).join("")}
        </div>
        <div class="rest">${rest.map((row) => `<span class="chip"><b>${row.place}.</b> ${esc(row.t.name)} · ${row.total}</span>`).join("")}</div>`;
      // открываем с 3-го места к 1-му
      const reveal = [...n.querySelectorAll(".pod")].sort((a, b) => b.dataset.rank - a.dataset.rank);
      let shown = 0;
      let stopConfetti = null;
      return {
        next: () => {
          if (shown >= reveal.length) return false;
          const pod = reveal[shown++];
          pod.classList.add("on");
          if (shown === reveal.length) {
            n.querySelector(".rest").classList.add("on");
            Sound.fanfare();
            stopConfetti = confetti(n);
          }
          return true;
        },
        destroy: () => stopConfetti && stopConfetti(),
      };
    },
  };

  /* ═══════════════ Навигация ═══════════════ */
  let cur = -1;
  let ctrl = {};
  const hudPos = document.querySelector("#hud .pos");

  function roundSlides(ri) {
    return slides.map((s, i) => [s, i]).filter(([s]) => s.ri === ri && !s.hidden);
  }

  function updateChrome(s) {
    const r = s.round;
    stage.dataset.round = r ? r.id : "";
    backdrop.classList.toggle("multi", !r);
    const bare = ["title", "closeup", "closeupAnswer"].includes(s.kind);
    chrome.classList.toggle("hidden", bare);
    progress.classList.toggle("hidden", bare);
    chrome.innerHTML = r
      ? `<span class="round-pill"><span class="num">${s.ri + 1}</span>${esc(r.title)}</span><span class="brand">${esc(Q.title)}</span>`
      : `<span></span><span class="brand">${esc(Q.title)}</span>`;
    progress.innerHTML = Q.rounds.map((round, ri) => {
      let w = 0;
      if (s.kind === "final") w = 100;
      else if (s.ri != null) {
        if (ri < s.ri) w = 100;
        else if (ri === s.ri) {
          const list = roundSlides(ri);
          const pos = list.findIndex(([, i]) => i >= cur);
          w = ((pos < 0 ? list.length : pos + 1) / list.length) * 100;
        }
      }
      return `<div class="seg" style="--seg:var(--r-${round.id})"><i style="width:${w}%"></i></div>`;
    }).join("");
    hudPos.textContent = `${cur + 1}/${slides.length}`;
  }

  function go(i, dir = 1) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (ctrl.destroy) ctrl.destroy();
    closeLightbox();
    stage.querySelectorAll(".slide:not(.leave)").forEach((old) => {
      old.classList.add("leave");
      setTimeout(() => old.remove(), 380);
    });
    cur = i;
    const s = slides[i];
    const node = el(`<section class="slide enter ${dir < 0 ? "back" : ""}"></section>`);
    if (s.round) node.dataset.round = s.round.id;
    ctrl = RENDER[s.kind](s, node) || {};
    slidesRoot.appendChild(node);
    setTimeout(() => node.classList.remove("enter", "back"), 700);
    updateChrome(s);
    store.set("slide", i);
    history.replaceState(null, "", "#" + (i + 1));
    refreshOverlay();
  }

  function next() {
    if (ctrl.next && ctrl.next()) return;
    const s = slides[cur];
    let j = cur + 1;
    if (!(s.hidden && slides[j] && slides[j].group === s.group)) {
      while (j < slides.length && slides[j].hidden) j++;
    }
    if (j < slides.length) go(j, 1);
  }

  function prev() {
    const s = slides[cur];
    let j = cur - 1;
    if (!(s.hidden && slides[j] && slides[j].group === s.group)) {
      while (j >= 0 && slides[j].hidden) j--;
    }
    if (j >= 0) go(j, -1);
  }

  /* ═══════════════ Оверлеи ведущего ═══════════════ */
  let overlay = null; // { type, node }

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
    if (type === "scores") overlay.tab = slides[cur].round ? slides[cur].round.id : Q.rounds[0].id;
    drawOverlay();
    stage.appendChild(node);
  }
  function refreshOverlay() { if (overlay && overlay.type === "slides") drawOverlay(); }

  function drawOverlay() {
    const { type, panel } = overlay;
    if (type === "scores") {
      const rid = overlay.tab;
      const round = Q.rounds.find((r) => r.id === rid);
      overlay.node.dataset.round = rid;
      panel.innerHTML = `
        <h3>Очки команд</h3>
        <div class="sub">Выберите раунд и начисляйте очки. Название команды можно исправить прямо в строке. Всё сохраняется в браузере.</div>
        <div class="tabs">${Q.rounds.map((r, i) => `<button class="tab ${r.id === rid ? "on" : ""}" data-r="${r.id}">${i + 1}. ${esc(r.title)}</button>`).join("")}</div>
        ${teams.map((t, i) => `
          <div class="sb-row" style="--tc:${teamColor(i)}" data-i="${i}">
            <span class="dot"></span>
            <input value="${esc(t.name)}" spellcheck="false">
            <button class="sb-btn" data-d="-1">−1</button>
            <span class="rp">${t.scores[rid] || 0}</span>
            <button class="sb-btn" data-d="1">+1</button>
            <button class="sb-btn" data-d="2">+2</button>
            <button class="sb-btn" data-d="3">+3</button>
            <span class="tt">всего ${total(t)}</span>
            <button class="sb-btn del" title="Удалить команду">✕</button>
          </div>`).join("")}
        <div class="actions">
          <button class="btn" data-a="add">+ Команда</button>
          <button class="btn danger" data-a="reset">Обнулить все очки</button>
          <span class="grow"></span>
          <button class="btn" data-a="close">Закрыть · Esc</button>
        </div>
        <div class="sub">Раунд «${esc(round.title)}»: ${round.scoring.map(([p, tx]) => `${p} — ${tx}`).join(" · ")}</div>`;
      panel.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { overlay.tab = b.dataset.r; drawOverlay(); }));
      panel.querySelectorAll(".sb-row").forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector("input").addEventListener("change", (e) => {
          teams[i].name = e.target.value.trim() || `Команда ${i + 1}`;
          saveTeams("teams");
        });
        row.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => {
          addPoints(i, rid, Number(b.dataset.d));
          drawOverlay();
        }));
        row.querySelector(".del").addEventListener("click", () => {
          if (teams.length <= 1 || !confirm(`Удалить «${teams[i].name}»?`)) return;
          teams.splice(i, 1);
          saveTeams("teams");
          drawOverlay();
        });
      });
      panel.querySelector('[data-a="add"]').addEventListener("click", () => {
        teams.push({ name: `Команда ${teams.length + 1}`, scores: {} });
        saveTeams("teams");
        drawOverlay();
      });
      panel.querySelector('[data-a="reset"]').addEventListener("click", () => {
        if (!confirm("Обнулить очки всех команд во всех раундах?")) return;
        teams.forEach((t) => { t.scores = {}; });
        saveTeams("teams");
        drawOverlay();
      });
      panel.querySelector('[data-a="close"]').addEventListener("click", closeOverlay);
    }

    if (type === "slides") {
      const item = (s, i) => `<button class="ov-item ${i === cur ? "cur" : ""} ${s.spare ? "spare" : ""}" data-i="${i}">${esc(slideLabel(s))}</button>`;
      const general = slides.map((s, i) => [s, i]).filter(([s]) => s.ri == null);
      panel.innerHTML = `
        <h3>Все слайды</h3>
        <div class="sub">Нажмите, чтобы перейти. Пунктиром — запасные вопросы (в обычном показе пропускаются).</div>
        <div class="ov-round"><h4>Общие</h4><div class="ov-list">${general.map(([s, i]) => item(s, i)).join("")}</div></div>
        ${Q.rounds.map((r, ri) => `
          <div class="ov-round" data-round="${r.id}">
            <h4>${ri + 1}. ${esc(r.title)}</h4>
            <div class="ov-list">${slides.map((s, i) => [s, i]).filter(([s]) => s.ri === ri).map(([s, i]) => item(s, i)).join("")}</div>
          </div>`).join("")}`;
      panel.querySelectorAll(".ov-item").forEach((b) => b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        closeOverlay();
        go(i, i < cur ? -1 : 1);
      }));
    }

    if (type === "help") {
      const keys = [
        ["→ · Пробел · PgDn", "Дальше (сначала запускает таймер / звук на слайде)"],
        ["← · PgUp", "Назад"],
        ["P", "Пауза / продолжить таймер"],
        ["R", "Перезапустить таймер"],
        ["S", "Очки команд"],
        ["O", "Все слайды (и запасные вопросы)"],
        ["F", "Полный экран"],
        ["T", "Светлая / тёмная тема"],
        ["B", "Чёрный экран"],
        ["M", "Выключить / включить сигналы таймера"],
        ["Esc", "Закрыть окно"],
      ];
      panel.innerHTML = `
        <h3>Управление</h3>
        <div class="sub">Пульт-презентер тоже работает: он нажимает PgUp / PgDn.</div>
        <dl class="keys">${keys.map(([k, d]) => `<dt>${k.split(" · ").map((x) => `<span class="hint-key">${x}</span>`).join(" ")}</dt><dd>${d}</dd>`).join("")}</dl>
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
  const timerReset = () => ctrl.timer && ctrl.timer.reset();

  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, [contenteditable]")) {
      if (e.key === "Escape" || (e.key === "Enter" && e.target.isContentEditable)) {
        e.preventDefault();
        e.target.blur();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    Sound.unlock();
    const blackout = stage.querySelector(".blackout");
    if (blackout && !["KeyB", "Period"].includes(e.code)) { blackout.remove(); e.preventDefault(); return; }

    switch (e.code) {
      case "Escape":
        if (!closeLightbox()) closeOverlay();
        break;
      case "KeyS": openOverlay("scores"); break;
      case "KeyO": openOverlay("slides"); break;
      case "KeyH": case "Slash": case "F1": e.preventDefault(); openOverlay("help"); break;
      case "KeyF": toggleFullscreen(); break;
      case "KeyT": toggleTheme(); break;
      case "KeyB": case "Period": toggleBlack(); break;
      case "KeyM": Sound.muted = !Sound.muted; if (overlay && overlay.type === "help") drawOverlay(); break;
      case "KeyP": timerToggle(); break;
      case "KeyR": timerReset(); break;
      case "Home": closeOverlay(); go(0, -1); break;
      case "End": closeOverlay(); go(slides.length - 1); break;
      default:
        if (overlay) return;
        if (["ArrowRight", "ArrowDown", "PageDown", "Space", "Enter", "NumpadEnter"].includes(e.code)) {
          e.preventDefault();
          if (!closeLightbox()) next();
        } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.code)) {
          e.preventDefault();
          if (!closeLightbox()) prev();
        }
    }
  });

  // Масштаб сцены под экран
  function fit() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  }
  window.addEventListener("resize", fit);
  fit();
  // Фокус на кнопке или поле не должен прокручивать сцену
  document.addEventListener("scroll", (e) => {
    const t = e.target === document ? document.scrollingElement : e.target;
    if (t && (t.scrollTop || t.scrollLeft) && !t.closest?.(".overlay")) { t.scrollTop = 0; t.scrollLeft = 0; }
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
    scores: () => openOverlay("scores"),
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
  go(Number.isFinite(start) ? start : 0);
})();
