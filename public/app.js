/* global Chart, THREE */
'use strict';

// ================= 3D BACKGROUND — rotating earth =================
(function initBg() {
  if (typeof THREE === 'undefined') return;
  const canvas = document.getElementById('bg3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
  camera.position.set(0, 2, 30);

  scene.add(new THREE.AmbientLight(0x2a3a66, 1.4));
  const sun = new THREE.DirectionalLight(0x9db9ff, 2.2);
  sun.position.set(-20, 8, 12);
  scene.add(sun);
  const rim = new THREE.PointLight(0x8a5bff, 50, 90);
  rim.position.set(16, -6, -10);
  scene.add(rim);

  // ---------- procedural earth texture (continents drawn on canvas) ----------
  function earthTexture() {
    const W = 1024, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // oceans
    const ocean = g.createLinearGradient(0, 0, 0, H);
    ocean.addColorStop(0, '#0a1e3f');
    ocean.addColorStop(0.5, '#0d2850');
    ocean.addColorStop(1, '#0a1e3f');
    g.fillStyle = ocean;
    g.fillRect(0, 0, W, H);
    // continents — rough blobs in the right places (equirectangular projection)
    g.fillStyle = '#123a6e';
    const blobs = [
      // [x%, y%, w%, h%] — North America, South America, Africa, Europe, Asia, Australia
      [13, 30, 16, 22], [22, 58, 9, 24], [50, 38, 11, 26], [50, 22, 9, 12],
      [62, 26, 26, 24], [82, 62, 9, 10], [30, 18, 10, 8], [71, 14, 9, 8],
    ];
    for (const [x, y, w, h] of blobs) {
      g.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r = 0.6 + Math.sin(a * 3.1 + x) * 0.22 + Math.cos(a * 5.3 + y) * 0.18;
        const px = ((x + Math.cos(a) * w * r) / 100) * W;
        const py = ((y + Math.sin(a) * h * r) / 100) * H;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
    }
    // coastline glow
    g.strokeStyle = 'rgba(91,140,255,.55)';
    g.lineWidth = 2;
    g.filter = 'blur(1px)';
    for (const [x, y, w, h] of blobs) {
      g.beginPath();
      g.ellipse((x / 100) * W, (y / 100) * H, (w / 100) * W * 0.8, (h / 100) * H * 0.8, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.filter = 'none';
    // ice caps
    g.fillStyle = 'rgba(160,200,255,.5)';
    g.fillRect(0, 0, W, 14);
    g.fillRect(0, H - 16, W, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(11, 64, 64),
    new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.75, metalness: 0.15 })
  );
  earth.position.set(0, -3.5, -18);
  scene.add(earth);

  // city lights on the night side (points sampled on land-ish areas)
  const cityGeo = new THREE.BufferGeometry();
  const cityPos = [];
  for (let i = 0; i < 900; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
    const r = 11.03;
    cityPos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  cityGeo.setAttribute('position', new THREE.Float32BufferAttribute(cityPos, 3));
  const cities = new THREE.Points(cityGeo, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.09, transparent: true, opacity: 0.8 }));
  cities.position.copy(earth.position);
  scene.add(cities);

  // atmosphere glow (back-side shell)
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(11.9, 64, 64),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vN; void main(){
        float i = pow(0.62 - dot(vN, vec3(0.,0.,1.)), 2.2);
        gl_FragColor = vec4(0.35, 0.55, 1.0, 1.0) * i; }`,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true,
    })
  );
  atmo.position.copy(earth.position);
  scene.add(atmo);

  // orbiting price arcs around the planet (trading routes)
  const arcs = [];
  const arcMat = new THREE.LineBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.5 });
  const arcMat2 = new THREE.LineBasicMaterial({ color: 0x2ee6a8, transparent: true, opacity: 0.4 });
  for (let i = 0; i < 8; i++) {
    const pts = [];
    const tilt = Math.random() * Math.PI, r = 12.5 + Math.random() * 4;
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.15) {
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * Math.sin(tilt), Math.sin(a) * r * Math.cos(tilt)));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), i % 2 ? arcMat : arcMat2);
    line.position.copy(earth.position);
    line.rotation.y = Math.random() * Math.PI;
    scene.add(line);
    arcs.push(line);
  }

  // ---------- starfield ----------
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 1600; i++) {
    starPos.push((Math.random() - 0.5) * 260, (Math.random() - 0.5) * 160, -Math.random() * 160 - 30);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8fa8d8, size: 0.16, transparent: true, opacity: 0.85 })));

  // ---------- shooting data-packets along arcs ----------
  const packets = arcs.map((arc, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x5b8cff : 0x2ee6a8 }));
    m.userData = { arc, t: Math.random() };
    scene.add(m);
    return m;
  });

  let mouseX = 0, mouseY = 0;
  addEventListener('pointermove', (e) => {
    mouseX = (e.clientX / innerWidth - 0.5) * 2;
    mouseY = (e.clientY / innerHeight - 0.5) * 2;
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setSize(innerWidth, innerHeight);

  let t = 0;
  (function animate() {
    requestAnimationFrame(animate);
    t += 0.004;
    earth.rotation.y = t * 0.9;
    cities.rotation.y = t * 0.9;
    for (const p of packets) {
      p.userData.t = (p.userData.t + 0.0016) % 1;
      const geo = p.userData.arc.geometry;
      const posAttr = geo.attributes.position;
      const idx = Math.floor(p.userData.t * (posAttr.count - 1));
      p.position.set(
        posAttr.getX(idx) + p.userData.arc.position.x,
        posAttr.getY(idx) + p.userData.arc.position.y,
        posAttr.getZ(idx) + p.userData.arc.position.z
      );
      p.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.userData.arc.rotation.y);
    }
    camera.position.x += (mouseX * 3.5 - camera.position.x) * 0.03;
    camera.position.y += (2 - mouseY * 2 - camera.position.y) * 0.03;
    camera.lookAt(0, -2, -18);
    renderer.render(scene, camera);
  })();
})();

// ================= APP STATE =================
const S = {
  token: localStorage.getItem('tj_token') || '',
  ws: null,
  account: null,
  prices: {},
  positions: [],
  history: [],
  equityCurve: [],
  calOffset: 0,
  chart: null,
  histSort: { k: 'close_time', dir: -1 },
  connected: false,
};

const $ = (id) => document.getElementById(id);
const fmt$ = (n, sign = false) =>
  (sign && n > 0 ? '+' : '') + (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (sec) => new Date(sec * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtHold = (t) => {
  if (!t.open_time) return '—';
  const m = Math.round((t.close_time - t.open_time) / 60);
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
};

// ================= LOGIN =================
(async function checkServer() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    $('bridge-hint').textContent = d.bridge
      ? '✅ Connected to MT5 on this machine — log in with your real account'
      : '⚠ MT5 bridge not running — start it with: python mt5_bridge.py';
    $('bridge-hint').className = 'login-hint ' + (d.bridge ? 'ok' : 'bad');
  } catch { /* server starting */ }
})();

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  $('login-btn').querySelector('span').textContent = 'Authorizing with MT5…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: $('lg-server').value, id: $('lg-id').value, password: $('lg-pass').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    S.token = data.token;
    localStorage.setItem('tj_token', S.token);
    enterApp();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('login-btn').disabled = false;
    $('login-btn').querySelector('span').textContent = 'Connect to MT5';
  }
});

$('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { authorization: 'Bearer ' + S.token } });
  localStorage.removeItem('tj_token');
  if (S.ws) S.ws.close();
  location.reload();
});

// ================= APP ENTRY =================
function enterApp() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  connectWs();
  loadHistory();
}

function applySnapshot(snap, curveChanged) {
  const a = snap.account;
  S.account = a;
  S.prices = snap.prices || {};
  S.positions = snap.positions || [];
  if (curveChanged || !S.equityCurve.length) {
    S.equityCurve = snap.equityCurve || [];
    renderChart();
    renderCalendar();
  }
  $('acct-chip').textContent = `${a.server} · #${a.login} · ${a.currency}`;
  renderMoney();
  renderMarket();
  renderTicker();
  renderOpen();
}

// ================= WEBSOCKET =================
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${S.token}`);
  S.ws = ws;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') { S.connected = true; pulse(); applySnapshot(msg.data, msg.curveChanged); }
    if (msg.type === 'bridge-down') {
      $('live-dot').classList.remove('on');
      $('acct-chip').textContent = msg.reconnecting
        ? '⟳ Reconnecting to MT5 (auto-heals in a few seconds)…'
        : '⚠ MT5 connection lost — waiting for bridge…';
    }
  };
  ws.onclose = (ev) => {
    $('live-dot').classList.remove('on');
    if (ev.code !== 4001 && S.token) setTimeout(connectWs, 2000);
  };
  ws.onopen = () => $('live-dot').classList.add('on');
}

function pulse() {
  const d = $('live-dot');
  d.classList.add('on');
  clearTimeout(pulse._t);
  pulse._t = setTimeout(() => d.classList.toggle('on', S.ws && S.ws.readyState === 1), 900);
}

// ================= MONEY HEADER =================
function renderMoney() {
  const a = S.account;
  if (!a) return;
  $('stat-balance').textContent = fmt$(a.balance);
  $('stat-equity').textContent = fmt$(a.equity);
  const u = $('stat-unrealized');
  u.textContent = fmt$(a.unrealized, true);
  u.className = a.unrealized > 0 ? 'pos' : a.unrealized < 0 ? 'neg' : '';
  $('stat-margin').textContent = a.margin_level ? a.margin_level.toFixed(1) + '%' : '∞';
}

// ================= MARKET WATCH + TICKER =================
let mwFilter = '';
$('mw-search').addEventListener('input', () => { mwFilter = $('mw-search').value.trim().toUpperCase(); renderMarket(); });

function renderMarket() {
  const tb = $('market-table').querySelector('tbody');
  const prev = renderMarket.prev || {};
  const entries = Object.entries(S.prices)
    .filter(([sym]) => !mwFilter || sym.toUpperCase().includes(mwFilter))
    .sort((a, b) => a[0].localeCompare(b[0]));
  $('mw-count').textContent = entries.length;
  tb.innerHTML = '';
  const color = (v, pv) => (pv == null ? 'inherit' : v > pv ? 'var(--win)' : v < pv ? 'var(--loss)' : 'inherit');
  const digits = (v) => (v >= 1000 ? 2 : v >= 100 ? 3 : v >= 1 ? 5 : 6);
  for (const [sym, p] of entries) {
    const d = digits(p.bid);
    const spread = p.ask - p.bid;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${sym}</td>
      <td style="color:${color(p.bid, prev[sym] && prev[sym].bid)}">${p.bid.toFixed(d)}</td>
      <td style="color:${color(p.ask, prev[sym] && prev[sym].ask)}">${p.ask.toFixed(d)}</td>
      <td class="muted">${spread.toFixed(d)}</td>`;
    tb.appendChild(tr);
  }
  renderMarket.prev = JSON.parse(JSON.stringify(S.prices));
}

function renderTicker() {
  const inner = $('ticker-inner');
  inner.innerHTML = Object.entries(S.prices)
    .slice(0, 40)
    .map(([sym, p]) => `<span><span class="sym">${sym}</span> ${p.bid}</span>`)
    .join('');
}

// ================= OPEN POSITIONS =================
function renderOpen() {
  const tb = $('open-table').querySelector('tbody');
  tb.innerHTML = '';
  $('open-count').textContent = S.positions.length;
  $('open-empty').style.display = S.positions.length ? 'none' : 'block';
  for (const p of S.positions) {
    const cur = S.prices[p.symbol];
    const cls = p.unrealized > 0 ? 'pos' : p.unrealized < 0 ? 'neg' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.symbol}</td>
      <td class="side-${p.side}">${p.side.toUpperCase()}</td>
      <td>${p.volume}</td>
      <td>${p.price_open}</td>
      <td>${cur ? cur.bid : p.price_current}</td>
      <td>${p.sl || '—'}</td><td>${p.tp || '—'}</td>
      <td class="${cls}">${fmt$(p.unrealized, true)}</td>`;
    tb.appendChild(tr);
  }
}

// ================= EQUITY CHART =================
function renderChart() {
  const labels = S.equityCurve.map((d) => d.day);
  const data = S.equityCurve.map((d) => d.balance);
  if (S.chart) {
    S.chart.data.labels = labels;
    S.chart.data.datasets[0].data = data;
    S.chart.update('none');
    return;
  }
  const ctx = $('equity-chart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 270);
  grad.addColorStop(0, 'rgba(91,140,255,.4)');
  grad.addColorStop(1, 'rgba(138,91,255,0)');
  S.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Balance', data, borderColor: '#5b8cff', backgroundColor: grad, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 8, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,14,26,.95)', borderColor: 'rgba(91,140,255,.4)', borderWidth: 1,
          callbacks: {
            label: (c) => ` Balance: ${fmt$(c.parsed.y)}`,
            afterLabel: (c) => {
              const d = S.equityCurve[c.dataIndex];
              return d && d.trades ? ` Day PnL: ${fmt$(d.pnl, true)} (${d.trades} deals)` : '';
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#7d8cab', maxTicksLimit: 10 }, grid: { color: 'rgba(120,150,220,.07)' } },
        y: { ticks: { color: '#7d8cab', callback: (v) => '$' + v.toLocaleString() }, grid: { color: 'rgba(120,150,220,.07)' } },
      },
    },
  });
}

// ================= CALENDAR =================
$('cal-prev').addEventListener('click', () => { S.calOffset++; renderCalendar(); });
$('cal-next').addEventListener('click', () => { S.calOffset = Math.max(0, S.calOffset - 1); renderCalendar(); });

function renderCalendar() {
  const byDay = {};
  for (const d of S.equityCurve) byDay[d.day] = d;
  const todayStr = new Date().toISOString().slice(0, 10);
  const ref = new Date(todayStr + 'T00:00:00Z');
  ref.setUTCMonth(ref.getUTCMonth() - S.calOffset);
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
  $('cal-title').textContent = ref.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const cal = $('calendar');
  cal.innerHTML = '';
  for (const h of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const el = document.createElement('div');
    el.className = 'cal-head'; el.textContent = h;
    cal.appendChild(el);
  }
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells = [];
  for (let i = lead; i > 0; i--) cells.push({ d: prevMonthDays - i + 1, other: true, date: new Date(Date.UTC(y, m - 1, prevMonthDays - i + 1)) });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, other: false, date: new Date(Date.UTC(y, m, d)) });
  const tail = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= tail; d++) cells.push({ d, other: true, date: new Date(Date.UTC(y, m + 1, d)) });

  let monthTotal = 0, monthTrades = 0;
  for (const c of cells) {
    const key = c.date.toISOString().slice(0, 10);
    const rec = byDay[key];
    const el = document.createElement('div');
    el.className = 'cal-day' + (c.other ? ' other' : '');
    let inner = `<div class="d">${c.d}</div>`;
    if (rec && rec.trades) {
      el.classList.add(rec.pnl > 0 ? 'win' : rec.pnl < 0 ? 'loss' : 'flat');
      inner += `<div class="v">${fmt$(rec.pnl, true)}</div><div class="n">${rec.trades} deal${rec.trades > 1 ? 's' : ''}</div>`;
      if (!c.other) { monthTotal += rec.pnl; monthTrades += rec.trades; }
    }
    if (key === todayStr) el.classList.add('today');
    el.innerHTML = inner;
    el.title = rec && rec.trades ? `${key}: ${fmt$(rec.pnl, true)} over ${rec.trades} deals` : key;
    cal.appendChild(el);
  }
  if (monthTrades) {
    const tot = document.createElement('div');
    tot.className = 'cal-day';
    tot.style.gridColumn = 'span 7';
    tot.innerHTML = `<div class="n">MONTH TOTAL</div><div class="v ${monthTotal >= 0 ? 'pos' : 'neg'}">${fmt$(monthTotal, true)} · ${monthTrades} deals</div>`;
    cal.appendChild(tot);
  }
}

// ================= HISTORY =================
async function loadHistory() {
  const days = $('hist-days').value;
  const res = await fetch('/api/history?days=' + days, { headers: { authorization: 'Bearer ' + S.token } });
  if (!res.ok) return;
  const data = await res.json();
  S.history = data.trades || [];
  if (data.equityCurve && data.equityCurve.length) {
    S.equityCurve = data.equityCurve;
    renderChart();
    renderCalendar();
  }
  renderHistory();
}

function renderHistory() {
  const q = $('hist-search').value.trim().toUpperCase();
  const side = $('hist-side').value;
  const result = $('hist-result').value;
  let rows = S.history.filter((t) =>
    (!q || t.symbol.toUpperCase().includes(q)) &&
    (!side || t.side === side) &&
    (!result || (result === 'win' ? t.pnl > 0 : t.pnl <= 0)));
  const { k, dir } = S.histSort;
  rows = [...rows].sort((a, b) => ((a[k] ?? 0) > (b[k] ?? 0) ? 1 : (a[k] ?? 0) < (b[k] ?? 0) ? -1 : 0) * dir);

  $('hist-count').textContent = rows.length;
  const total = rows.reduce((s, t) => s + t.pnl, 0);
  const wins = rows.filter((t) => t.pnl > 0).length;
  $('hist-summary').innerHTML = `
    <span>Net PnL: <b class="${total >= 0 ? 'pos' : 'neg'}">${fmt$(total, true)}</b></span>
    <span>Win rate: <b>${rows.length ? Math.round((wins / rows.length) * 100) : 0}%</b></span>
    <span>Best: <b class="pos">${rows.length ? fmt$(Math.max(...rows.map((t) => t.pnl)), true) : '—'}</b></span>
    <span>Worst: <b class="neg">${rows.length ? fmt$(Math.min(...rows.map((t) => t.pnl)), true) : '—'}</b></span>`;

  const tb = $('history-table').querySelector('tbody');
  tb.innerHTML = '';
  for (const t of rows.slice(0, 500)) {
    const tr = document.createElement('tr');
    const cls = t.pnl > 0 ? 'pos' : 'neg';
    tr.innerHTML = `
      <td>${t.ticket}</td><td>${t.close_time ? fmtDate(t.close_time) : '—'}</td><td>${t.symbol}</td>
      <td class="side-${t.side}">${t.side.toUpperCase()}</td><td>${t.lots}</td>
      <td>${t.open_price ?? '—'}</td><td>${t.close_price ?? '—'}</td>
      <td>${fmtHold(t)}</td>
      <td class="${cls}">${fmt$(t.pnl, true)}</td>`;
    tb.appendChild(tr);
  }
}

['hist-search', 'hist-side', 'hist-result'].forEach((id) => $(id).addEventListener('input', renderHistory));
$('hist-days').addEventListener('change', loadHistory);
document.querySelectorAll('#history-table th').forEach((th) =>
  th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (k === 'hold') return;
    S.histSort.dir = S.histSort.k === k ? -S.histSort.dir : -1;
    S.histSort.k = k;
    renderHistory();
  }));

// ================= TABS =================
document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    if (btn.dataset.tab === 'overview') renderChart();
  }));

// ================= AI COACH =================
$('coach-run').addEventListener('click', async () => {
  const out = $('coach-out');
  out.classList.add('loading');
  out.textContent = 'Reading your real MT5 journal and analyzing…';
  $('coach-run').disabled = true;
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token },
      body: JSON.stringify({ prompt: $('coach-prompt').value }),
    });
    const data = await res.json();
    out.classList.remove('loading');
    if (!res.ok) { out.textContent = 'Error: ' + (data.error || 'failed'); return; }
    out.innerHTML = mdToHtml(data.analysis || 'No analysis returned.');
    $('coach-status').textContent = data.heuristic
      ? 'Built-in heuristic analysis of your real journal (add an AI API key via ⚙ AI Key for full AI coaching).'
      : 'Powered by your AI API key, analyzing your real MT5 history.';
  } catch (e) {
    out.classList.remove('loading');
    out.textContent = 'Error: ' + e.message;
  } finally {
    $('coach-run').disabled = false;
  }
});

function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc(md).split('\n');
  let html = '', inList = false;
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  for (const line of lines) {
    const t = line.trim();
    if (/^#{1,3}\s/.test(t)) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${inline(t.replace(/^#{1,3}\s*/, ''))}</h3>`; }
    else if (/^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(t.replace(/^([-*•]|\d+[.)])\s*/, ''))}</li>`;
    } else if (t === '') { if (inList) { html += '</ul>'; inList = false; } }
    else { if (inList) { html += '</ul>'; inList = false; } html += `<p>${inline(t)}</p>`; }
  }
  if (inList) html += '</ul>';
  return html;
}

// ================= SETTINGS MODAL =================
$('btn-settings').addEventListener('click', async () => {
  $('settings-modal').classList.remove('hidden');
  try {
    const r = await fetch('/api/ai-settings', { headers: { authorization: 'Bearer ' + S.token } });
    const d = await r.json();
    $('ai-base-url').value = d.baseUrl || 'https://api.cosmoshub.tech';
    $('ai-model').value = d.model || 'qwen-3.7-max';
    $('ai-key-input').placeholder = d.hasKey ? '•••••••• (saved — type to replace)' : 'sk-cos-…';
  } catch { /* keep defaults */ }
});
$('ai-key-close').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
$('ai-key-save').addEventListener('click', async () => {
  await fetch('/api/ai-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token },
    body: JSON.stringify({
      apiKey: $('ai-key-input').value.trim(),
      baseUrl: $('ai-base-url').value.trim(),
      model: $('ai-model').value.trim(),
    }),
  });
  $('settings-modal').classList.add('hidden');
  $('coach-status').textContent = $('ai-key-input').value.trim()
    ? `AI settings saved — coaching via ${$('ai-model').value.trim() || 'default model'}.`
    : 'Saved. Note: no API key set — built-in heuristic analysis will be used until you add one.';
});
