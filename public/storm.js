const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, u = '', d = 0) => (v == null ? '—' : `${Number(v).toFixed(d)}${u}`);
const tw = (iso) => { const d = new Date(iso); return isNaN(d) ? esc(iso || '—') : d.toLocaleString('en-GB', { timeZone: 'Asia/Taipei', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' TST'; };

const map = L.map('map', { zoomControl: true }).setView([23.7, 121], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 10, attribution: '© OpenStreetMap, © CARTO' }).addTo(map);
const layer = L.layerGroup().addTo(map);
let radarLayer = null;

async function loadRadar() {
  try {
    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
    const f = j.radar.past.at(-1);
    radarLayer = L.tileLayer(`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.6, zIndex: 5, attribution: 'Radar © RainViewer' });
    if ($('radar').checked) radarLayer.addTo(map);
  } catch { /* radar is optional */ }
}
$('radar').onchange = (e) => radarLayer && (e.target.checked ? radarLayer.addTo(map) : map.removeLayer(radarLayer));

const windColor = (g) => (g == null ? '#888' : g >= 32.7 ? '#e5484d' : g >= 20.8 ? '#e8a220' : g >= 13.9 ? '#d6c200' : '#2e9e6b');

function draw(d) {
  layer.clearLayers();
  for (const c of d.cities) {
    L.circleMarker([c.lat, c.lon], { radius: 7, color: '#fff', weight: 1.5, fillColor: windColor(c.gust), fillOpacity: 0.95 })
      .bindPopup(`<b>${esc(c.name)}</b><br>Wind ${fmt(c.wind, ' m/s', 1)}, gust ${fmt(c.gust, ' m/s', 1)}<br>Rain 24h: ${fmt(c.rainPast24h, ' mm', 1)}`)
      .addTo(layer);
  }
  for (const s of d.storms) {
    const pts = (a) => a.map((p) => [p.lat, p.lon]);
    if (s.past.length > 1) L.polyline(pts(s.past), { color: '#e5484d', weight: 3 }).addTo(layer);
    if (s.forecast.length) L.polyline([pts([s.now])[0], ...pts(s.forecast)], { color: '#e5484d', weight: 3, dashArray: '8 8' }).addTo(layer);
    for (const p of s.forecast) {
      L.circleMarker([p.lat, p.lon], { radius: 4, color: '#e5484d', fillOpacity: 1 })
        .bindTooltip(`+${p.tau ?? '?'}h · ${fmt(p.wind, ' m/s')}`).addTo(layer);
      if (p.probRadius) L.circle([p.lat, p.lon], { radius: p.probRadius * 1000, color: '#e5484d', weight: 1, fill: false, opacity: 0.4 }).addTo(layer);
    }
    if (s.now.r15) L.circle([s.now.lat, s.now.lon], { radius: s.now.r15 * 1000, color: '#e8a220', weight: 1, fillOpacity: 0.12 }).addTo(layer);
    L.marker([s.now.lat, s.now.lon], { icon: L.divIcon({ className: '', html: '<div style="font-size:28px;text-shadow:0 0 4px #000">🌀</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) })
      .bindTooltip(esc(s.name)).addTo(layer);
  }
  const all = d.storms.filter((s) => s.threatensTaiwan).flatMap((s) => [[s.now.lat, s.now.lon], ...s.forecast.map((p) => [p.lat, p.lon])]);
  if (all.length) map.fitBounds(L.latLngBounds([...all, [25.4, 121.9], [21.8, 120]]).pad(0.1));
}

function banner(d) {
  const near = d.storms.filter((s) => s.threatensTaiwan);
  const el = $('status');
  const live = Object.values(d.sources).some((v) => v === 'ok');
  if (!live) { el.className = 'banner watch'; el.textContent = 'Storm data sources are unreachable right now. Check cwa.gov.tw for official warnings.'; return; }
  if (!near.length) {
    el.className = 'banner calm';
    el.textContent = d.sources.cwa === 'no-key'
      ? 'No tropical cyclone reported near Taiwan (GDACS only — add CWA_API_KEY on the server for official CWA tracks).'
      : 'No active tropical cyclone within 1,000 km of Taiwan.';
    return;
  }
  const s = near[0];
  el.className = `banner ${s.distanceToTaiwanKm < 400 ? 'alert' : 'watch'}`;
  el.textContent = `${s.name}${s.class ? ' · ' + s.class : ''} — ${s.distanceToTaiwanKm.toLocaleString()} km from Taiwan`;
}

function cards(d) {
  $('storms').innerHTML = d.storms.map((s) => {
    const n = s.now;
    return `<div class="card"><h3>🌀 ${esc(s.name)} ${s.zhName ? `<span class="mut">${esc(s.zhName)}</span>` : ''}</h3>
      <small>${esc(s.source)} · ${tw(n.time)}${s.alert ? ' · GDACS alert: ' + esc(s.alert) : ''}</small>
      <div class="kv">
        <div><b>${fmt(n.lat, '°N', 1)} ${fmt(n.lon, '°E', 1)}</b><span>Position</span></div>
        <div><b>${s.distanceToTaiwanKm.toLocaleString()} km</b><span>To central Taiwan</span></div>
        <div><b>${fmt(n.wind, ' m/s', 1)}</b><span>Max sustained wind</span></div>
        <div><b>${fmt(n.gust, ' m/s', 1)}</b><span>Max gust</span></div>
        <div><b>${fmt(n.pressure, ' hPa')}</b><span>Central pressure</span></div>
        <div><b>${n.speed != null ? n.speed + ' km/h ' + esc(n.dir || '') : '—'}</b><span>Movement</span></div>
        <div><b>${fmt(n.r15, ' km')}</b><span>≥15 m/s radius</span></div>
      </div>
      ${s.forecast.length ? `<table><tr><th>Forecast</th><th>Position</th><th>Wind</th><th>hPa</th></tr>${s.forecast.map((p) =>
        `<tr><td>${p.tau != null ? '+' + p.tau + 'h' : tw(p.time)}</td><td>${fmt(p.lat, '°', 1)}, ${fmt(p.lon, '°', 1)}</td><td>${fmt(p.wind, ' m/s')}</td><td>${fmt(p.pressure)}</td></tr>`).join('')}</table>` : ''}
    </div>`;
  }).join('');
}

function citiesGrid(d) {
  $('cities').innerHTML = d.cities.map((c) =>
    `<div class="card"><b>${esc(c.name)}</b><br><span class="pill" style="background:${windColor(c.gust)}">gust ${fmt(c.gust, ' m/s', 1)}</span>
    <div class="mut">Wind ${fmt(c.wind, ' m/s', 1)} · ${fmt(c.pressure, ' hPa')}<br>Rain 24h ${fmt(c.rainPast24h, ' mm', 1)} · next 24h ${fmt(c.rainNext24h, ' mm', 1)}</div></div>`).join('');
}

async function load() {
  $('refresh').disabled = true;
  try {
    const r = await fetch('/api/storm');
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    banner(d); draw(d); cards(d); citiesGrid(d);
    $('foot').innerHTML = `Updated ${tw(d.generatedAt)}. Sources: ${Object.entries(d.sources).map(([k, v]) => `${k}: ${esc(v)}`).join(' · ')}. Observed/forecast storm data: <a href="https://www.cwa.gov.tw/V8/E/P/Typhoon/TY_NEWS.html">CWA</a>, <a href="https://www.gdacs.org">GDACS</a>; weather: Open-Meteo; radar: RainViewer. Informational only — follow official CWA warnings and local authorities.`;
  } catch (e) {
    $('status').className = 'banner watch';
    $('status').textContent = 'Could not load storm data (' + e.message + '). Showing nothing rather than guessing.';
  }
  $('refresh').disabled = false;
}
$('refresh').onclick = load;
loadRadar(); load(); setInterval(load, 5 * 60_000);
