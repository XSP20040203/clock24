/* Clock24 — v2.0
 * 把 24 小时摊平成一个圆环。没有 12 点的自我重复，一天只有一圈。
 *
 * v1.0 只有本地时间。
 * v2.0 加了：任意时区为表盘时区、多时区对照条、12/24 制切换、
 *            按经纬度算出的日出日落刻度、秒表、以及 ?tz= 深链。
 */
(() => {
  'use strict';

  const CX = 200, CY = 200, R = 170;
  const TAU = Math.PI * 2;
  const NS = 'http://www.w3.org/2000/svg';

  const el = {
    svgStatic: document.getElementById('dial-static'),
    svgSolar: document.getElementById('dial-solar'),
    progress: document.getElementById('progressArc'),
    halo: document.querySelector('.marker-halo'),
    core: document.querySelector('.marker-core'),
    phase: document.getElementById('phase'),
    digital: document.getElementById('digital'),
    meridiem: document.getElementById('meridiem'),
    dateline: document.getElementById('dateline'),
    tzline: document.getElementById('tzline'),
    pct: document.getElementById('pct'),
    countdown: document.getElementById('countdown'),
    yearpct: document.getElementById('yearpct'),
    railFill: document.getElementById('railFill'),
    solarNote: document.getElementById('solarNote'),
    zoneList: document.getElementById('zoneList'),
    btnPause: document.getElementById('btnPause'),
    btnTheme: document.getElementById('btnTheme'),
    btnFormat: document.getElementById('btnFormat'),
    formatLabel: document.getElementById('formatLabel'),
    pauseLabel: document.getElementById('pauseLabel'),
    tzSelect: document.getElementById('tzSelect'),
    latInput: document.getElementById('latInput'),
    lonInput: document.getElementById('lonInput'),
    btnGeo: document.getElementById('btnGeo'),
    geoNote: document.getElementById('geoNote'),
    swDisplay: document.getElementById('swDisplay'),
    swStart: document.getElementById('swStart'),
    swLap: document.getElementById('swLap'),
    swReset: document.getElementById('swReset'),
    swLaps: document.getElementById('swLaps')
  };

  const CIRC = TAU * R;
  const pad2 = (n) => String(n).padStart(2, '0');
  const LOCAL_TZ = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (_) { return 'UTC'; }
  })();

  /* ================= 配置 ================= */

  const CITIES = [
    { name: '本地', tz: LOCAL_TZ },
    { name: 'UTC', tz: 'UTC' },
    { name: '纽约', tz: 'America/New_York' },
    { name: '伦敦', tz: 'Europe/London' },
    { name: '东京', tz: 'Asia/Tokyo' },
    { name: '上海', tz: 'Asia/Shanghai' },
    { name: '迪拜', tz: 'Asia/Dubai' },
    { name: '洛杉矶', tz: 'America/Los_Angeles' },
    { name: '悉尼', tz: 'Australia/Sydney' },
    { name: '圣保罗', tz: 'America/Sao_Paulo' }
  ];

  // 对照条里永远显示这四个
  const STRIP = ['local', 'utc', 'new-york', 'tokyo'];
  const STRIP_INDEX = {
    local: { name: '本地', tz: LOCAL_TZ },
    utc: { name: 'UTC', tz: 'UTC' },
    'new-york': { name: '纽约', tz: 'America/New_York' },
    tokyo: { name: '东京', tz: 'Asia/Tokyo' }
  };

  const STORE_KEY = 'clock24:v2';
  const LEGACY_THEME_KEY = 'clock24:theme';

  const params = new URLSearchParams(location.search);

  const state = {
    theme: 'dark',
    tz: LOCAL_TZ,
    hour12: false,
    lat: 39.9042,
    lon: 116.4074,
    paused: false
  };

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) {}
    if (saved && typeof saved === 'object') Object.assign(state, {
      theme: saved.theme === 'light' ? 'light' : 'dark',
      tz: typeof saved.tz === 'string' ? saved.tz : LOCAL_TZ,
      hour12: !!saved.hour12,
      lat: Number.isFinite(saved.lat) ? saved.lat : state.lat,
      lon: Number.isFinite(saved.lon) ? saved.lon : state.lon
    });
    else {
      try {
        if (localStorage.getItem(LEGACY_THEME_KEY) === 'light') state.theme = 'light';
      } catch (_) {}
    }

    // URL 优先于记忆
    const tz = params.get('tz');
    if (tz) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        state.tz = tz;
      } catch (_) { /* 无效时区就当没写 */ }
    }
    const lat = parseFloat(params.get('lat'));
    const lon = parseFloat(params.get('lon'));
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) state.lat = lat;
    if (Number.isFinite(lon) && lon >= -180 && lon <= 180) state.lon = lon;
    if (params.get('h12') === '1') state.hour12 = true;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  /* ================= 时区数学 ================= */

  const fmtCache = new Map();
  function fmt(tz, opts) {
    const key = tz + '|' + JSON.stringify(opts);
    let f = fmtCache.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz, hourCycle: 'h23' }, opts));
      fmtCache.set(key, f);
    }
    return f;
  }

  const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  /** 把一个时刻拆成某个时区里的年月日时分秒 */
  function partsIn(tz, d) {
    const o = {};
    for (const { type, value } of fmt(tz, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
    }).formatToParts(d)) o[type] = value;
    return {
      y: +o.year, mo: +o.month, d: +o.day,
      h: +o.hour % 24, mi: +o.minute, s: +o.second,
      wd: WEEKDAY[o.weekday] ?? d.getDay()
    };
  }

  /** 该时区相对 UTC 的偏移（分钟），按当天的真实夏令时算 */
  function offsetIn(tz, d) {
    const p = partsIn(tz, d);
    const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return Math.round((asUTC - d.getTime()) / 60000);
  }

  const utcLabel = (mins) => {
    const sign = mins < 0 ? '−' : '+';
    const a = Math.abs(mins);
    const h = Math.floor(a / 60), m = a % 60;
    return `UTC${sign}${h}${m ? ':' + pad2(m) : ''}`;
  };

  const dayOfYear = (y, mo, d) => Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const daysInYear = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);

  /**
   * 日出日落近似（NOAA 的常用简化式）。
   * 误差几分钟量级，够画刻度，不够当天文台。
   * 返回本地钟点（0–24 的小时数）。
   */
  function solarTimes(p, lat, lon, tzOffsetMin) {
    const rad = Math.PI / 180;
    const N = dayOfYear(p.y, p.mo, p.d);
    const B = (2 * Math.PI * (N - 81)) / 364;
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // 分钟
    const decl = -23.44 * Math.cos(rad * (360 / 365) * (N + 10));               // 度

    const cosH = (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl * rad)) /
                 (Math.cos(lat * rad) * Math.cos(decl * rad));

    if (cosH > 1) return { polar: 'night' };  // 极夜
    if (cosH < -1) return { polar: 'day' };   // 极昼

    const H = Math.acos(cosH) / rad;                                  // 时角，度
    const noon = 720 - 4 * lon - eot + tzOffsetMin;                   // 本地分钟
    const norm = (h) => ((h % 24) + 24) % 24;

    return {
      noon: norm(noon / 60),
      rise: norm((noon - 4 * H) / 60),
      set: norm((noon + 4 * H) / 60),
      H
    };
  }

  /* ================= 几何 ================= */

  const angleOf = (hours) => (hours / 24) * TAU - Math.PI / 2;

  const pointAt = (r, hours) => {
    const a = angleOf(hours);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };

  function arcPath(r, fromH, toH) {
    const sweep = toH - fromH;
    if (sweep >= 24) {
      return `M ${CX} ${CY - r} A ${r} ${r} 0 1 1 ${CX} ${CY + r} A ${r} ${r} 0 1 1 ${CX} ${CY - r}`;
    }
    const s = pointAt(r, fromH);
    const e = pointAt(r, toH);
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 12 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }

  const make = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* ================= 静态刻度 ================= */

  function buildDial() {
    const frag = document.createDocumentFragment();

    // 夜的弧：0–5 时、19–24 时。白天没有刻度的地方，是灯的配额。
    for (const [a, b] of [[0, 5], [19, 24]]) {
      frag.appendChild(make('path', { class: 'night-arc', d: arcPath(R, a, b) }));
    }

    for (let h = 0; h < 24; h++) {
      const quarter = h % 3 === 0;
      const p1 = pointAt(quarter ? 146 : 154, h);
      const p2 = pointAt(162, h);
      frag.appendChild(make('line', {
        class: 'tick' + (quarter ? ' is-quarter' : ''),
        'data-hour': h,
        x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
        x2: p2.x.toFixed(2), y2: p2.y.toFixed(2)
      }));

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

  /* ================= 日出日落刻度 ================= */

  let solarKey = '';
  let solarCache = null;

  function renderSolar(p, tzOffsetMin) {
    const key = `${p.y}-${p.mo}-${p.d}|${state.lat.toFixed(3)}|${state.lon.toFixed(3)}|${tzOffsetMin}`;
    if (key === solarKey) return solarCache;
    solarKey = key;

    const s = solarTimes(p, state.lat, state.lon, tzOffsetMin);
    while (el.svgSolar.firstChild) el.svgSolar.removeChild(el.svgSolar.firstChild);

    if (s.polar) {
      el.solarNote.textContent = s.polar === 'day'
        ? '极昼 · 今天太阳不落'
        : '极夜 · 今天太阳不升';
      return (solarCache = s);
    }

    for (const h of [s.rise, s.set]) {
      const pos = pointAt(R, h);
      el.svgSolar.appendChild(make('circle', {
        class: 'solar-mark',
        cx: pos.x.toFixed(2), cy: pos.y.toFixed(2), r: 4.5
      }));
    }

    const hm = (h) => `${pad2(Math.floor(h))}:${pad2(Math.round((h % 1) * 60))}`;
    el.solarNote.innerHTML =
      `日出 <b>${hm(s.rise)}</b> · 日落 <b>${hm(s.set)}</b>` +
      ` · 昼长 ${(s.set - s.rise > 0 ? s.set - s.rise : s.set - s.rise + 24).toFixed(1)} 小时（近似）`;

    return (solarCache = s);
  }

  /* ================= 时区对照条 ================= */

  const zoneNodes = [];

  function buildZones() {
    for (const id of STRIP) {
      const city = STRIP_INDEX[id];
      const li = document.createElement('li');
      li.className = 'zone';

      const a = document.createElement('span');
      a.className = 'zone-city';
      a.textContent = city.name;

      const b = document.createElement('span');
      b.className = 'zone-time';
      b.textContent = '--:--';

      const c = document.createElement('span');
      c.className = 'zone-delta';

      li.append(a, b, c);
      el.zoneList.appendChild(li);
      zoneNodes.push({ el: li, time: b, delta: c, tz: city.tz });
    }
  }

  /* ================= 读数 ================= */

  const PHASES = [
    [5, '深夜'], [7, '黎明'], [11, '清晨'], [13, '正午'],
    [17, '午后'], [19, '黄昏'], [22, '夜晚'], [24, '深夜']
  ];

  const phaseOf = (h) => {
    for (const [until, name] of PHASES) if (h < until) return name;
    return '深夜';
  };

  // 6 时前、18 时后没有日光；正午满格。smoothstep 让环境光过渡得软一点。
  const dayTint = (h) => {
    const t = Math.min(1, Math.max(0, (h - 6) / 12));
    return t * t * (3 - 2 * t);
  };

  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  const twelve = (h) => (h % 12 === 0 ? 12 : h % 12);

  function renderDigital(p) {
    if (state.hour12) {
      el.digital.textContent = `${pad2(twelve(p.h))}:${pad2(p.mi)}:${pad2(p.s)}`;
      el.meridiem.hidden = false;
      el.meridiem.textContent = p.h < 12 ? 'AM' : 'PM';
      el.digital.setAttribute('datetime', `${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`);
      el.meridiem.setAttribute('title', p.h < 12 ? '上午' : '下午');
    } else {
      el.digital.textContent = `${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`;
      el.digital.setAttribute('datetime', `${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`);
      el.meridiem.hidden = true;
    }
  }

  /* ================= 秒表 ================= */

  const sw = { running: false, t0: 0, acc: 0, laps: [], last: 0 };

  const swElapsed = () => sw.acc + (sw.running ? performance.now() - sw.t0 : 0);

  function swFormat(ms) {
    const cs = Math.floor(ms / 10) % 100;
    const total = Math.floor(ms / 1000);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    return (h ? `${pad2(h)}:` : '') + `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
  }

  function swRender() {
    el.swDisplay.textContent = swFormat(swElapsed());
    el.swStart.textContent = sw.running ? '暂停' : (sw.acc || sw.t0 ? '继续' : '开始');
    el.swLap.disabled = !sw.running;
    el.swReset.disabled = !sw.acc && !sw.running && sw.laps.length === 0;
  }

  function swToggle() {
    if (sw.running) {
      sw.acc += performance.now() - sw.t0;
      sw.running = false;
    } else {
      sw.t0 = performance.now();
      sw.running = true;
    }
    swRender();
  }

  function swDoLap() {
    if (!sw.running) return;
    const now = swElapsed();
    sw.laps.unshift(now - sw.last);
    sw.last = now;
    if (sw.laps.length > 30) sw.laps.pop();

    const ol = el.swLaps;
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    sw.laps.forEach((ms, i) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = `第 ${sw.laps.length - i} 段`;
      const b = document.createElement('span');
      b.textContent = swFormat(ms);
      li.append(a, b);
      ol.appendChild(li);
    });
    swRender();
  }

  function swDoReset() {
    sw.running = false; sw.acc = 0; sw.t0 = 0; sw.last = 0; sw.laps = [];
    while (el.swLaps.firstChild) el.swLaps.removeChild(el.swLaps.firstChild);
    swRender();
  }

  /* ================= 面板 ================= */

  function buildTzSelect() {
    for (const c of CITIES) {
      const o = document.createElement('option');
      o.value = c.tz;
      o.textContent = c.tz === c.name ? c.tz : `${c.name} · ${c.tz}`;
      el.tzSelect.appendChild(o);
    }
    // 记忆里可能是个列表外的时区（比如 ?tz=），补一个
    if (!CITIES.some((c) => c.tz === state.tz)) {
      const o = document.createElement('option');
      o.value = state.tz;
      o.textContent = state.tz;
      el.tzSelect.appendChild(o);
    }
    el.tzSelect.value = state.tz;
  }

  function initTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];

    const select = (tab) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (dir) {
          e.preventDefault();
          const next = tabs[(i + dir + tabs.length) % tabs.length];
          select(next); next.focus();
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          const next = e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
          select(next); next.focus();
        }
      });
    });

    select(tabs[0]);
  }

  /* ================= 主题 / 格式 ================= */

  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    el.btnTheme.setAttribute('aria-pressed', String(state.theme === 'light'));
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', state.theme === 'light' ? '#F6F4F0' : '#0F172A');
    save();
  }

  function applyFormat() {
    el.btnFormat.setAttribute('aria-pressed', String(state.hour12));
    el.formatLabel.textContent = state.hour12 ? '12 时' : '24 时';
    save();
  }

  /* ================= 每帧 ================= */

  let frozen = null;
  let lastSecond = -1;
  let lastHour = -1;
  let lastZoneSecond = -1;

  function frame() {
    const now = frozen || new Date();
    const p = partsIn(state.tz, now);
    const hoursFloat = p.h + p.mi / 60 + p.s / 3600;
    const dayFrac = hoursFloat / 24;

    // 光点一直滑，不跳格
    const pos = pointAt(R, hoursFloat);
    const px = pos.x.toFixed(2), py = pos.y.toFixed(2);
    el.halo.setAttribute('cx', px); el.halo.setAttribute('cy', py);
    el.core.setAttribute('cx', px); el.core.setAttribute('cy', py);

    if (sw.running) el.swDisplay.textContent = swFormat(swElapsed());

    if (p.s !== lastSecond) {
      el.progress.setAttribute('stroke-dasharray', `${(CIRC * dayFrac).toFixed(2)} ${CIRC.toFixed(2)}`);

      renderDigital(p);

      const left = 86400 - (p.h * 3600 + p.mi * 60 + p.s);
      el.countdown.textContent =
        `${pad2(Math.floor(left / 3600))}:${pad2(Math.floor((left % 3600) / 60))}:${pad2(left % 60)}`;

      const pct = dayFrac * 100;
      el.pct.innerHTML = `${pct.toFixed(2)}<small>%</small>`;
      el.railFill.style.width = `${pct.toFixed(3)}%`;

      lastSecond = p.s;
    }

    if (p.mi !== lastZoneSecond) {
      const primaryDay = `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
      for (const z of zoneNodes) {
        const q = partsIn(z.tz, now);
        z.time.textContent = state.hour12
          ? `${pad2(twelve(q.h))}:${pad2(q.mi)}`
          : `${pad2(q.h)}:${pad2(q.mi)}`;

        const qDay = `${q.y}-${pad2(q.mo)}-${pad2(q.d)}`;
        if (qDay === primaryDay) {
          z.delta.textContent = '';
          delete z.delta.dataset.past;
        } else {
          const diff = (Date.UTC(q.y, q.mo - 1, q.d) - Date.UTC(p.y, p.mo - 1, p.d)) / 86400000;
          z.delta.textContent = diff > 0 ? `明天 +${diff}` : `昨天 ${diff}`;
          z.delta.classList.toggle('is-past', diff < 0);
        }
      }
      lastZoneSecond = p.mi;
    }

    if (p.h !== lastHour) {
      el.phase.textContent = phaseOf(p.h);
      el.dateline.textContent = `${p.y}年${p.mo}月${p.d}日 ${WEEKDAYS[p.wd]}`;

      const yp = ((dayOfYear(p.y, p.mo, p.d) + 1) - 1 + hoursFloat / 24) / daysInYear(p.y) * 100;
      el.yearpct.innerHTML = `${yp.toFixed(1)}<small>%</small>`;

      document.documentElement.style.setProperty('--day-tint', dayTint(p.h).toFixed(3));

      el.svgStatic.querySelectorAll('.tick').forEach((t) => {
        t.classList.toggle('is-now', Number(t.dataset.hour) === p.h);
      });

      // 偏移与日出日落每小时算一次就够
      const offMin = offsetIn(state.tz, now);
      el.tzline.textContent = `${state.tz} · ${utcLabel(offMin)}`;
      const offRound = Math.round(offMin / 15) * 15;
      renderSolar(p, offRound);

      const zone = tzLineZone(state.tz);
      el.tzSelect.title = zone;
      for (const z of zoneNodes) z.el.classList.toggle('is-primary', z.tz === state.tz);

      lastHour = p.h;
    }

    requestAnimationFrame(frame);
  }

  const tzLineZone = (tz) => CITIES.find((c) => c.tz === tz)?.name ?? tz;

  /* ================= 事件 ================= */

  function setPaused(next) {
    state.paused = next;
    frozen = next ? new Date() : null;
    el.btnPause.setAttribute('aria-pressed', String(next));
    el.pauseLabel.textContent = next ? '继续' : '暂停';
    save();
  }

  el.btnPause.addEventListener('click', () => setPaused(!state.paused));

  el.btnTheme.addEventListener('click', () => {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
  });

  el.btnFormat.addEventListener('click', () => {
    state.hour12 = !state.hour12;
    applyFormat();
    lastSecond = -1; lastZoneSecond = -1;
  });

  el.tzSelect.addEventListener('change', () => {
    state.tz = el.tzSelect.value;
    save();
    lastHour = -1; lastSecond = -1; lastZoneSecond = -1;
  });

  function applyCoords() {
    const lat = parseFloat(el.latInput.value);
    const lon = parseFloat(el.lonInput.value);
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) state.lat = lat;
    if (Number.isFinite(lon) && lon >= -180 && lon <= 180) state.lon = lon;
    el.latInput.value = state.lat.toFixed(4);
    el.lonInput.value = state.lon.toFixed(4);
    solarKey = ''; lastHour = -1;
    el.geoNote.textContent = `日出日落按这对坐标近似计算（${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}°）。`;
    save();
  }

  el.latInput.addEventListener('change', applyCoords);
  el.lonInput.addEventListener('change', applyCoords);

  el.btnGeo.addEventListener('click', () => {
    if (!navigator.geolocation) {
      el.geoNote.textContent = '这个浏览器不给定位权限。手填经纬度也行。';
      return;
    }
    el.geoNote.textContent = '正在定位…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        el.latInput.value = pos.coords.latitude.toFixed(4);
        el.lonInput.value = pos.coords.longitude.toFixed(4);
        applyCoords();
        el.geoNote.textContent = `已按你的位置更新（±${Math.round(pos.coords.accuracy)} 米）。`;
      },
      () => { el.geoNote.textContent = '定位被拒了。手填经纬度也行。'; },
      { timeout: 8000 }
    );
  });

  el.swStart.addEventListener('click', swToggle);
  el.swLap.addEventListener('click', swDoLap);
  el.swReset.addEventListener('click', swDoReset);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('button, input, textarea, select, [role="tab"]')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      setPaused(!state.paused);
    } else if (e.key === 't' || e.key === 'T') {
      el.btnTheme.click();
    } else if (e.key === 'f' || e.key === 'F') {
      el.btnFormat.click();
    }
  });

  /* ================= 起步 ================= */

  load();
  buildDial();
  buildZones();
  buildTzSelect();
  initTabs();
  applyTheme(state.theme);
  applyFormat();
  el.latInput.value = state.lat.toFixed(4);
  el.lonInput.value = state.lon.toFixed(4);
  el.geoNote.textContent = `日出日落按这对坐标近似计算（${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}°）。`;
  swRender();
  requestAnimationFrame(frame);
})();
