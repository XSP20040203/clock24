/* Clock24 — v1.0
 * 把 24 小时摊平成一个圆环。没有 12 点的自我重复，一天只有一圈。
 */
(() => {
  'use strict';

  const CX = 200, CY = 200, R = 170;
  const TAU = Math.PI * 2;

  const el = {
    svgStatic: document.getElementById('dial-static'),
    svgNight: document.getElementById('dial-night'),
    progress: document.getElementById('progressArc'),
    marker: document.getElementById('dial-marker'),
    halo: document.querySelector('.marker-halo'),
    core: document.querySelector('.marker-core'),
    phase: document.getElementById('phase'),
    digital: document.getElementById('digital'),
    dateline: document.getElementById('dateline'),
    pct: document.getElementById('pct'),
    countdown: document.getElementById('countdown'),
    yearpct: document.getElementById('yearpct'),
    railFill: document.getElementById('railFill'),
    btnPause: document.getElementById('btnPause'),
    btnTheme: document.getElementById('btnTheme'),
    pauseLabel: document.getElementById('pauseLabel')
  };

  const CIRC = TAU * R;
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------- 几何 ---------- */

  // 0 时在正上方，顺时针走。返回屏幕角度（弧度）。
  const angleOf = (hours) => (hours / 24) * TAU - Math.PI / 2;

  const pointAt = (r, hours) => {
    const a = angleOf(hours);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };

  // 一段弧的 path。整圈（24h）用两个半圆拼，避免 A 指令退化。
  function arcPath(r, fromH, toH) {
    const sweep = toH - fromH;
    if (sweep >= 24) {
      return `M ${CX} ${CY - r} A ${r} ${r} 0 1 1 ${CX} ${CY + r} A ${r} ${r} 0 1 1 ${CX} ${CY - r}`;
    }
    const s = pointAt(r, fromH);
    const e = pointAt(r, toH);
    const large = sweep > 12 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }

  /* ---------- 静态刻度 ---------- */

  const NS = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  function buildDial() {
    const frag = document.createDocumentFragment();

    // 夜的弧：0–5 时、19–24 时。白天没有刻度的地方，是灯的配额。
    for (const [a, b] of [[0, 5], [19, 24]]) {
      frag.appendChild(make('path', {
        class: 'night-arc',
        d: arcPath(R, a, b)
      }));
    }

    // 24 格小时刻度，每 3 小时一次长刻度
    for (let h = 0; h < 24; h++) {
      const quarter = h % 3 === 0;
      const inner = quarter ? 146 : 154;
      const p1 = pointAt(inner, h);
      const p2 = pointAt(162, h);
      const tick = make('line', {
        class: 'tick' + (quarter ? ' is-quarter' : ''),
        'data-hour': h,
        x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
        x2: p2.x.toFixed(2), y2: p2.y.toFixed(2)
      });
      frag.appendChild(tick);

      if (quarter) {
        // 数字放在环外，把盘心整个让给读数
        const lp = pointAt(187, h);
        const label = make('text', {
          class: 'tick-label is-quarter',
          x: lp.x.toFixed(2), y: lp.y.toFixed(2),
          'data-label-hour': h
        });
        label.textContent = pad2(h);
        frag.appendChild(label);
      }
    }

    el.svgStatic.appendChild(frag);
  }

  /* ---------- 时间的脸色 ---------- */

  const PHASES = [
    [5, '深夜'], [7, '黎明'], [11, '清晨'], [13, '正午'],
    [17, '午后'], [19, '黄昏'], [22, '夜晚'], [24, '深夜']
  ];

  const phaseOf = (h) => {
    for (const [until, name] of PHASES) if (h < until) return name;
    return '深夜';
  };

  // 6 时前、18 时后没有日光；正午满格。用 smoothstep 让环境光过渡得软一点。
  const dayTint = (h) => {
    const t = Math.min(1, Math.max(0, (h - 6) / 12));
    return t * t * (3 - 2 * t);
  };

  const DAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  /* ---------- 状态 ---------- */

  let paused = false;
  let frozen = null;      // 暂停时锁住的时刻
  let lastSecond = -1;
  let lastHour = -1;

  const dayOfYear = (d) =>
    Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
                Date.UTC(d.getFullYear(), 0, 0)) / 86400000);

  const daysInYear = (y) =>
    (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;

  /* ---------- 每帧 ---------- */

  function frame() {
    const now = frozen || new Date();

    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    const ms = now.getMilliseconds();

    const hoursFloat = h + m / 60 + s / 3600;
    const dayFrac = hoursFloat / 24;

    // 光点一直滑，不跳格
    const pos = pointAt(R, hoursFloat);
    el.halo.setAttribute('cx', pos.x.toFixed(2));
    el.halo.setAttribute('cy', pos.y.toFixed(2));
    el.core.setAttribute('cx', pos.x.toFixed(2));
    el.core.setAttribute('cy', pos.y.toFixed(2));

    if (s !== lastSecond || ms < 40) {
      // 进度弧
      el.progress.setAttribute('stroke-dasharray', `${(CIRC * dayFrac).toFixed(2)} ${CIRC.toFixed(2)}`);

      // 数字读数
      const hhmmss = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
      if (el.digital.textContent !== hhmmss) {
        el.digital.textContent = hhmmss;
        el.digital.setAttribute('datetime', hhmmss);
      }

      // 午夜倒计时
      const left = 86400 - (h * 3600 + m * 60 + s);
      const lh = Math.floor(left / 3600), lm = Math.floor((left % 3600) / 60), ls = left % 60;
      el.countdown.textContent = `${pad2(lh)}:${pad2(lm)}:${pad2(ls)}`;

      const pct = dayFrac * 100;
      el.pct.innerHTML = `${pct.toFixed(2)}<small>%</small>`;
      el.railFill.style.width = `${pct.toFixed(3)}%`;

      el.pct.parentElement.parentElement.setAttribute('aria-label', `今日已过 ${pct.toFixed(2)}%`);

      lastSecond = s;
    }

    if (h !== lastHour) {
      el.phase.textContent = phaseOf(h);
      el.dateline.textContent =
        `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${DAYS[now.getDay()]}`;

      const yp = (dayOfYear(now) + daysFrac(now)) / daysInYear(now.getFullYear()) * 100;
      el.yearpct.innerHTML = `${yp.toFixed(1)}<small>%</small>`;

      document.documentElement.style.setProperty('--day-tint', dayTint(h).toFixed(3));

      // 当前小时的那一格亮起来
      el.svgStatic.querySelectorAll('.tick').forEach((t) => {
        t.classList.toggle('is-now', Number(t.dataset.hour) === h);
      });

      lastHour = h;
    }

    requestAnimationFrame(frame);
  }

  const daysFrac = (d) =>
    (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;

  /* ---------- 交互 ---------- */

  const THEME_KEY = 'clock24:theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    el.btnTheme.setAttribute('aria-pressed', String(theme === 'light'));
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#F6F4F0' : '#0F172A');
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  }

  try {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === 'light' ? 'light' : 'dark');
  } catch (_) {
    applyTheme('dark');
  }

  el.btnTheme.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });

  function setPaused(next) {
    paused = next;
    frozen = paused ? new Date() : null;
    el.btnPause.setAttribute('aria-pressed', String(paused));
    el.pauseLabel.textContent = paused ? '继续' : '暂停';
  }

  el.btnPause.addEventListener('click', () => {
    setPaused(!paused);
    if (!paused) requestAnimationFrame(frame);
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('button, input, textarea, select')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      setPaused(!paused);
    } else if (e.key === 't' || e.key === 'T') {
      el.btnTheme.click();
    }
  });

  // 离开标签页时没必要烧 CPU
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !paused) requestAnimationFrame(frame);
  });

  /* ---------- 起步 ---------- */

  buildDial();
  requestAnimationFrame(frame);
})();
