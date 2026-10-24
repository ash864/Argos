// Storm data aggregation for Taiwan. Only reports what upstream sources return; never invents values.
const TTL = 5 * 60_000;
const CWA_KEY = process.env.CWA_API_KEY; // free key: https://opendata.cwa.gov.tw
const TAIWAN = { lat: 23.7, lon: 121.0 };

export const CITIES = [
  ['Taipei 台北', 25.04, 121.56], ['Keelung 基隆', 25.13, 121.74], ['Taichung 台中', 24.15, 120.67],
  ['Hualien 花蓮', 23.98, 121.6], ['Tainan 台南', 22.99, 120.21], ['Kaohsiung 高雄', 22.63, 120.3],
  ['Taitung 台東', 22.76, 121.14], ['Hengchun 恆春', 22.0, 120.74], ['Penghu 澎湖', 23.57, 119.58],
  ['Lanyu 蘭嶼', 22.04, 121.55], ['Matsu 馬祖', 26.16, 119.95], ['Kinmen 金門', 24.45, 118.38],
];

const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'Argos-StormTracker/1.0' } });
  if (!r.ok) throw new Error(`${new URL(url).host} responded ${r.status}`);
  return r.json();
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad((lon2 - lon1)) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(a)));
}

// CWA scale by max sustained wind (m/s): 17.2–32.6 mild, 32.7–50.9 moderate, >=51 strong
export function cwaClass(ms) {
  if (ms == null) return null;
  if (ms >= 51) return 'Strong 強烈颱風';
  if (ms >= 32.7) return 'Moderate 中度颱風';
  if (ms >= 17.2) return 'Mild 輕度颱風';
  return 'Tropical depression 熱帶性低氣壓';
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
function parseCoord(c) {
  const [lon, lat] = String(c ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
const point = (f, extra = {}) => {
  const p = parseCoord(f.coordinate);
  if (!p) return null;
  return {
    ...p, wind: num(f.maxWindSpeed), gust: num(f.maxGustSpeed), pressure: num(f.pressure),
    speed: num(f.movingSpeed), dir: f.movingDirection || null,
    r15: num(f.circleOf15Ms?.radius), r25: num(f.circleOf25Ms?.radius),
    probRadius: num(f.radiusOf70PercentProbability), ...extra,
  };
};

// Official source: Central Weather Administration, dataset W-C0034-005 (typhoon analysis + forecast tracks)
async function fromCWA() {
  if (!CWA_KEY) return { storms: [], status: 'no-key' };
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-005?Authorization=${encodeURIComponent(CWA_KEY)}&format=JSON`;
  const j = await getJson(url);
  const list = j?.records?.tropicalCyclones?.tropicalCyclone ?? [];
  const storms = list.map((t) => {
    const past = (t.analysisData?.fix ?? []).map((f) => point(f, { time: f.fixTime })).filter(Boolean);
    const forecast = (t.forecastData?.fix ?? []).map((f) => point(f, { time: f.forecastTime ?? f.initTime, tau: num(f.tau) })).filter(Boolean);
    const now = past.at(-1) ?? forecast[0];
    if (!now) return null;
    return {
      id: `cwa-${t.cwaTdNo ?? t.typhoonName}`, source: 'CWA 中央氣象署',
      name: t.typhoonName || t.cwaTyphoonName || 'Unnamed', zhName: t.cwaTyphoonName || null,
      class: cwaClass(now.wind), now, past, forecast,
    };
  }).filter(Boolean);
  return { storms, status: 'ok' };
}

// Independent cross-check: GDACS tropical cyclone feed (no key). Current position + severity only.
async function fromGDACS() {
  const j = await getJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC');
  const storms = [];
  for (const f of j?.features ?? []) {
    const p = f.properties ?? {};
    if (f.geometry?.type !== 'Point' || p.iscurrent === 'false' || p.iscurrent === false) continue;
    const [lon, lat] = f.geometry.coordinates;
    if (lon < 100 || lon > 160 || lat < -2 || lat > 45) continue; // western North Pacific only
    const kmh = num(p.severitydata?.severity);
    storms.push({
      id: `gdacs-${p.eventid}`, source: 'GDACS', name: p.eventname || p.name || 'Unnamed', zhName: null,
      alert: p.alertlevel || null, updated: p.todate || null,
      now: { lat, lon, wind: kmh == null ? null : +(kmh / 3.6).toFixed(1), time: p.todate || null }, past: [], forecast: [],
    });
  }
  return { storms, status: 'ok' };
}

async function weather() {
  const q = new URLSearchParams({
    latitude: CITIES.map((c) => c[1]).join(','), longitude: CITIES.map((c) => c[2]).join(','),
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,pressure_msl',
    hourly: 'precipitation', forecast_days: 2, past_days: 1, wind_speed_unit: 'ms', timezone: 'Asia/Taipei',
  });
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((d, i) => {
    const times = d.hourly?.time ?? [];
    const nowIdx = Math.max(0, times.findIndex((t) => t > (d.current?.time ?? '')) - 1);
    const sum = (a, b) => (d.hourly?.precipitation ?? []).slice(Math.max(0, a), b).reduce((s, v) => s + (v || 0), 0);
    return {
      name: CITIES[i][0], lat: CITIES[i][1], lon: CITIES[i][2], time: d.current?.time,
      temp: d.current?.temperature_2m, wind: d.current?.wind_speed_10m, windDir: d.current?.wind_direction_10m,
      gust: d.current?.wind_gusts_10m, pressure: d.current?.pressure_msl,
      rainPast24h: +sum(nowIdx - 23, nowIdx + 1).toFixed(1), rainNext24h: +sum(nowIdx + 1, nowIdx + 25).toFixed(1),
    };
  });
}

export async function stormReport() {
  return cached('report', async () => {
    const sources = {};
    const run = async (name, fn) => {
      try { const r = await fn(); sources[name] = r.status ?? 'ok'; return r.storms ?? r; }
      catch (e) { sources[name] = `error: ${e.message}`; return null; }
    };
    const [cwa, gdacs, cities] = await Promise.all([run('cwa', fromCWA), run('gdacs', fromGDACS), run('weather', weather)]);
    // Prefer official CWA records; add GDACS storms CWA doesn't already list (matched within ~300 km)
    const storms = [...(cwa ?? [])];
    for (const g of gdacs ?? []) {
      if (!storms.some((s) => distanceKm(s.now.lat, s.now.lon, g.now.lat, g.now.lon) < 300)) storms.push(g);
    }
    for (const s of storms) {
      s.distanceToTaiwanKm = distanceKm(s.now.lat, s.now.lon, TAIWAN.lat, TAIWAN.lon);
      s.threatensTaiwan = s.distanceToTaiwanKm < 1000;
    }
    storms.sort((a, b) => a.distanceToTaiwanKm - b.distanceToTaiwanKm);
    return { generatedAt: new Date().toISOString(), sources, storms, cities: cities ?? [] };
  });
}
