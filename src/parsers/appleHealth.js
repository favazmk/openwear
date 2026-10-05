/**
 * Streaming parser for Apple Health `export.xml`
 * (Health app → profile → Export All Health Data → unzip → export.xml).
 *
 * Exports are often 1GB+, so this never builds a DOM: feed text chunks to
 * push(), then call finish() for a normalized dataset.
 *
 * iPhone and Apple Watch both record steps/distance/energy, so summing every
 * record double-counts. For those metrics we total per source and keep the
 * largest source per day — the same idea Health uses for its own summaries.
 */

import { emptyDataset, emptyDay, sortWorkouts, trimHourly, DeviceProvider } from '../schema/telemetrySchema.js';
import { decodeXml } from './activityFiles.js';

const TAG_RE = /<(\/?)(Record|Workout|WorkoutStatistics)(?=[\s>/])([^>]*?)(\/?)>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

const ASLEEP = {
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAsleepCore: 'core',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'unspecified',
  HKCategoryValueSleepAnalysisAsleep: 'unspecified',
  HKCategoryValueSleepAnalysisAwake: 'awake',
  HKCategoryValueSleepAnalysisInBed: 'inBed'
};

/** "2024-01-15 07:30:00 +0530" -> Date */
export function parseAppleDate(s) {
  if (!s) return null;
  const iso = s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function attrs(str) {
  const out = {};
  for (const m of str.matchAll(ATTR_RE)) out[m[1]] = m[2].includes('&') ? decodeXml(m[2]) : m[2];
  return out;
}

function toKm(value, unit) {
  if (unit === 'mi') return value * 1.609344;
  if (unit === 'm') return value / 1000;
  return value; // km
}

function toKcal(value, unit) {
  return unit === 'kJ' ? value / 4.184 : value; // kcal / Cal
}

function prettyWorkoutType(t = '') {
  return t.replace('HKWorkoutActivityType', '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workout';
}

export class AppleHealthParser {
  constructor() {
    this.buf = '';
    this.days = new Map();
    this.hourly = new Map();
    this.nights = new Map();
    this.workouts = [];
    this.current = null; // open <Workout>
    this.recordCount = 0;
  }

  day(key) {
    let d = this.days.get(key);
    if (!d) {
      d = {
        steps: new Map(),
        dist: new Map(),
        energy: new Map(),
        hr: { sum: 0, n: 0, min: Infinity, max: -Infinity, latestT: '', latest: null },
        rhr: { t: '', v: null },
        hrv: { sum: 0, n: 0 },
        spo2: { sum: 0, n: 0 }
      };
      this.days.set(key, d);
    }
    return d;
  }

  push(text) {
    this.buf += text;
    const cut = this.buf.lastIndexOf('>');
    if (cut < 0) return;
    const chunk = this.buf.slice(0, cut + 1);
    this.buf = this.buf.slice(cut + 1);
    for (const m of chunk.matchAll(TAG_RE)) this.tag(m[1] === '/', m[2], m[3], m[4] === '/');
  }

  tag(closing, name, attrStr, selfClosing) {
    if (name === 'Workout') {
      if (closing) return this.closeWorkout();
      this.openWorkout(attrs(attrStr));
      if (selfClosing) this.closeWorkout();
      return;
    }
    if (closing) return;
    if (name === 'WorkoutStatistics') return this.current && this.workoutStat(attrs(attrStr));
    this.record(attrs(attrStr));
  }

  record(a) {
    const type = a.type;
    if (!type || !a.startDate) return;
    this.recordCount++;
    const key = a.startDate.slice(0, 10);
    const v = parseFloat(a.value);
    const src = a.sourceName || '?';
    const addTo = (map, val) => map.set(src, (map.get(src) || 0) + val);

    switch (type) {
      case 'HKQuantityTypeIdentifierStepCount':
        if (!isNaN(v)) addTo(this.day(key).steps, v);
        break;
      case 'HKQuantityTypeIdentifierDistanceWalkingRunning':
        if (!isNaN(v)) addTo(this.day(key).dist, toKm(v, a.unit));
        break;
      case 'HKQuantityTypeIdentifierActiveEnergyBurned':
        if (!isNaN(v)) addTo(this.day(key).energy, toKcal(v, a.unit));
        break;
      case 'HKQuantityTypeIdentifierHeartRate': {
        if (isNaN(v)) break;
        const hr = this.day(key).hr;
        hr.sum += v;
        hr.n++;
        hr.min = Math.min(hr.min, v);
        hr.max = Math.max(hr.max, v);
        if (a.startDate >= hr.latestT) {
          hr.latestT = a.startDate;
          hr.latest = v;
        }
        const hour = parseInt(a.startDate.slice(11, 13), 10);
        let hours = this.hourly.get(key);
        if (!hours) this.hourly.set(key, (hours = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }))));
        if (hour >= 0 && hour < 24) {
          hours[hour].sum += v;
          hours[hour].n++;
        }
        break;
      }
      case 'HKQuantityTypeIdentifierRestingHeartRate': {
        if (isNaN(v)) break;
        const r = this.day(key).rhr;
        if (a.startDate >= r.t) Object.assign(r, { t: a.startDate, v });
        break;
      }
      case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN': {
        if (isNaN(v)) break;
        const h = this.day(key).hrv;
        h.sum += v;
        h.n++;
        break;
      }
      case 'HKQuantityTypeIdentifierOxygenSaturation': {
        if (isNaN(v)) break;
        const s = this.day(key).spo2;
        s.sum += v <= 1 ? v * 100 : v;
        s.n++;
        break;
      }
      case 'HKCategoryTypeIdentifierSleepAnalysis': {
        const stage = ASLEEP[a.value];
        const start = parseAppleDate(a.startDate);
        const end = parseAppleDate(a.endDate);
        if (!stage || !start || !end) break;
        const night = a.endDate.slice(0, 10); // a night belongs to the morning it ends
        let bySource = this.nights.get(night);
        if (!bySource) this.nights.set(night, (bySource = new Map()));
        let t = bySource.get(src);
        if (!t) bySource.set(src, (t = { deep: 0, rem: 0, core: 0, unspecified: 0, awake: 0, inBed: 0 }));
        t[stage] += (end - start) / 60000;
        break;
      }
    }
  }

  openWorkout(a) {
    const start = parseAppleDate(a.startDate);
    const dur = parseFloat(a.duration);
    this.current = {
      id: `apple_${a.startDate}`,
      title: prettyWorkoutType(a.workoutActivityType),
      type: prettyWorkoutType(a.workoutActivityType),
      start: start ? start.toISOString() : null,
      durationMinutes: isNaN(dur) ? null : Math.round(a.durationUnit === 'h' ? dur * 60 : a.durationUnit === 's' ? dur / 60 : dur),
      distanceKm: a.totalDistance ? +toKm(parseFloat(a.totalDistance), a.totalDistanceUnit).toFixed(2) : null,
      calories: a.totalEnergyBurned ? Math.round(toKcal(parseFloat(a.totalEnergyBurned), a.totalEnergyBurnedUnit)) : null,
      avgHeartRate: null,
      maxHeartRate: null,
      elevationMeters: null
    };
  }

  workoutStat(a) {
    const w = this.current;
    if (a.type === 'HKQuantityTypeIdentifierHeartRate') {
      if (a.average) w.avgHeartRate = Math.round(parseFloat(a.average));
      if (a.maximum) w.maxHeartRate = Math.round(parseFloat(a.maximum));
    } else if (a.type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && a.sum && w.calories == null) {
      w.calories = Math.round(toKcal(parseFloat(a.sum), a.unit));
    } else if (/Distance/.test(a.type || '') && a.sum && w.distanceKm == null) {
      w.distanceKm = +toKm(parseFloat(a.sum), a.unit).toFixed(2);
    }
  }

  closeWorkout() {
    if (this.current) this.workouts.push(this.current);
    this.current = null;
  }

  finish(deviceName = 'Apple Health') {
    this.push('');
    const ds = emptyDataset(DeviceProvider.APPLE_HEALTH, deviceName);
    const maxOf = (map) => (map.size ? Math.max(...map.values()) : null);

    for (const [key, d] of this.days) {
      const day = emptyDay();
      const steps = maxOf(d.steps);
      const dist = maxOf(d.dist);
      const energy = maxOf(d.energy);
      day.steps = steps == null ? null : Math.round(steps);
      day.distanceKm = dist == null ? null : +dist.toFixed(2);
      day.activeCalories = energy == null ? null : Math.round(energy);
      if (d.hr.n) {
        day.heartRateAvg = Math.round(d.hr.sum / d.hr.n);
        day.heartRateMin = Math.round(d.hr.min);
        day.heartRateMax = Math.round(d.hr.max);
        day.heartRateLatest = Math.round(d.hr.latest);
      }
      day.restingHeartRate = d.rhr.v == null ? null : Math.round(d.rhr.v);
      if (d.hrv.n) {
        day.hrv = Math.round(d.hrv.sum / d.hrv.n);
        day.hrvMethod = 'SDNN';
      }
      day.spo2 = d.spo2.n ? Math.round(d.spo2.sum / d.spo2.n) : null;
      ds.days[key] = day;
    }

    for (const [night, bySource] of this.nights) {
      // Prefer the source with the most actual sleep (usually the Watch).
      let best = null;
      let bestAsleep = -1;
      for (const t of bySource.values()) {
        const asleep = t.deep + t.rem + t.core + t.unspecified;
        if (asleep > bestAsleep) [best, bestAsleep] = [t, asleep];
      }
      const staged = best.deep + best.rem + best.core > 0;
      const total = bestAsleep > 0 ? bestAsleep : best.inBed;
      if (!total) continue;
      (ds.days[night] ||= emptyDay()).sleep = {
        totalMinutes: Math.round(total),
        deepMinutes: staged ? Math.round(best.deep) : null,
        remMinutes: staged ? Math.round(best.rem) : null,
        lightMinutes: staged ? Math.round(best.core) : null,
        awakeMinutes: staged ? Math.round(best.awake) : null
      };
    }

    const hourly = {};
    for (const [key, hours] of this.hourly) hourly[key] = hours.map((h) => (h.n ? Math.round(h.sum / h.n) : null));
    ds.heartRateHourly = trimHourly(hourly);
    ds.workouts = sortWorkouts(this.workouts);
    ds.recordCount = this.recordCount;
    return ds;
  }
}

/** Parse a File/Blob in the browser, reporting progress as a 0..1 fraction. */
export async function parseAppleHealthFile(file, onProgress = () => {}) {
  const parser = new AppleHealthParser();
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(value);
    read += value.length;
    onProgress(Math.min(1, read / file.size));
  }
  return parser.finish();
}
