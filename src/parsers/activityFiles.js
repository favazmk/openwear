/**
 * GPX and TCX workout files — the export format of Garmin Connect, Strava,
 * Coros, Polar, Suunto, Zepp (Amazfit) and most sports watches.
 * String-based (no DOM) so it runs in browsers, workers and Node tests.
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decode XML entities (named and numeric). */
export const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m
  );

const tagValue = (xml, tag) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([^<]*)<`));
  return m ? decodeXml(m[1].trim()) : null;
};

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Elevation gain with a 3 m hysteresis so GPS noise doesn't inflate it. */
function elevationGain(elevations) {
  let gain = 0;
  let ref = null;
  for (const e of elevations) {
    if (e == null) continue;
    if (ref == null || e < ref) ref = e;
    else if (e - ref >= 3) {
      gain += e - ref;
      ref = e;
    }
  }
  return Math.round(gain);
}

function summarize({ name, type, points, distanceM, calories, source }) {
  const times = points.map((p) => p.time).filter(Boolean);
  if (!times.length) return null;
  const start = new Date(times[0]);
  const end = new Date(times[times.length - 1]);

  let dist = distanceM;
  if (dist == null) {
    dist = 0;
    const geo = points.filter((p) => p.lat != null && p.lon != null);
    for (let i = 1; i < geo.length; i++) dist += haversine(geo[i - 1], geo[i]);
  }
  const hrs = points.map((p) => p.hr).filter((v) => v != null);

  return {
    id: `${source}_${start.toISOString()}`,
    title: name || `${type || 'Workout'} (${source.toUpperCase()})`,
    type: type || 'Workout',
    start: start.toISOString(),
    durationMinutes: Math.round((end - start) / 60000),
    distanceKm: dist ? +(dist / 1000).toFixed(2) : null,
    calories: calories ?? null,
    avgHeartRate: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHeartRate: hrs.length ? Math.max(...hrs) : null,
    elevationMeters: elevationGain(points.map((p) => p.ele))
  };
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function parseGpx(xml) {
  const points = [];
  for (const m of xml.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const lat = parseFloat((m[1].match(/lat="([^"]+)"/) || [])[1]);
    const lon = parseFloat((m[1].match(/lon="([^"]+)"/) || [])[1]);
    const ele = parseFloat(tagValue(m[2], 'ele'));
    const hr = parseInt(tagValue(m[2], 'hr') ?? tagValue(m[2], 'heartrate'), 10);
    points.push({
      lat: isNaN(lat) ? null : lat,
      lon: isNaN(lon) ? null : lon,
      ele: isNaN(ele) ? null : ele,
      hr: isNaN(hr) ? null : hr,
      time: tagValue(m[2], 'time')
    });
  }
  const trk = (xml.match(/<trk\b[^>]*>([\s\S]*?)<trkseg/) || [])[1] || '';
  const rawType = tagValue(trk, 'type');
  return summarize({
    name: tagValue(trk, 'name') || tagValue(xml, 'name'),
    type: rawType && isNaN(rawType) ? capitalize(rawType) : null,
    points,
    distanceM: null,
    calories: null,
    source: 'gpx'
  });
}

export function parseTcx(xml) {
  const points = [];
  let maxDist = null;
  for (const m of xml.matchAll(/<(?:\w+:)?Trackpoint>([\s\S]*?)<\/(?:\w+:)?Trackpoint>/g)) {
    const tp = m[1];
    const lat = parseFloat(tagValue(tp, 'LatitudeDegrees'));
    const lon = parseFloat(tagValue(tp, 'LongitudeDegrees'));
    const ele = parseFloat(tagValue(tp, 'AltitudeMeters'));
    const dist = parseFloat(tagValue(tp, 'DistanceMeters'));
    const hrBlock = (tp.match(/<(?:\w+:)?HeartRateBpm\b[^>]*>([\s\S]*?)<\/(?:\w+:)?HeartRateBpm>/) || [])[1];
    const hr = hrBlock ? parseInt(tagValue(hrBlock, 'Value'), 10) : NaN;
    if (!isNaN(dist)) maxDist = Math.max(maxDist ?? 0, dist);
    points.push({
      lat: isNaN(lat) ? null : lat,
      lon: isNaN(lon) ? null : lon,
      ele: isNaN(ele) ? null : ele,
      hr: isNaN(hr) ? null : hr,
      time: tagValue(tp, 'Time')
    });
  }
  const calories = [...xml.matchAll(/<(?:\w+:)?Calories>(\d+)</g)].reduce((a, m) => a + parseInt(m[1], 10), 0);
  const sport = (xml.match(/<(?:\w+:)?Activity\b[^>]*Sport="([^"]+)"/) || [])[1];
  return summarize({
    name: tagValue(xml, 'Notes'),
    type: sport && sport !== 'Other' ? sport : null,
    points,
    distanceM: maxDist,
    calories: calories || null,
    source: 'tcx'
  });
}

/** Parse by file extension. Returns a workout or null. */
export function parseActivityFile(fileName, text) {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'gpx') return parseGpx(text);
  if (ext === 'tcx') return parseTcx(text);
  throw new Error(`Unsupported file type ".${ext}". Use .gpx or .tcx (FIT support is on the roadmap).`);
}
