/**
 * OpenWear - Unified Health Telemetry Schema
 *
 * Every adapter produces a Dataset: per-day aggregates plus workouts.
 * Unknown metrics are `null` — never invented. The UI shows "—" for them.
 */

export const DeviceProvider = {
  DEMO: 'demo',
  APPLE_HEALTH: 'apple_health',
  GOOGLE_FIT: 'google_fit',
  STRAVA: 'strava',
  ACTIVITY_FILES: 'activity_files',
  GENERIC_BLE: 'generic_ble',
  WATCH_EXPLORER: 'watch_explorer'
};

/** A day's aggregates. All fields optional; missing = null. */
export function emptyDay() {
  return {
    steps: null,
    distanceKm: null,
    activeCalories: null,
    heartRateAvg: null,
    heartRateMin: null,
    heartRateMax: null,
    heartRateLatest: null,
    restingHeartRate: null,
    hrv: null, // ms
    hrvMethod: null, // 'SDNN' (Apple) | 'RMSSD'
    spo2: null, // %
    sleep: null // { totalMinutes, deepMinutes, remMinutes, lightMinutes, awakeMinutes }
  };
}

export function emptyDataset(provider, deviceName) {
  return {
    provider,
    deviceName,
    importedAt: new Date().toISOString(),
    days: {}, // 'YYYY-MM-DD' -> emptyDay()
    heartRateHourly: {}, // 'YYYY-MM-DD' -> [24 x avg bpm | null]
    workouts: [] // newest first
  };
}

/**
 * Workout shape:
 * { id, title, type, start (ISO), durationMinutes, distanceKm, calories,
 *   avgHeartRate, maxHeartRate, elevationMeters }
 */
export function sortWorkouts(workouts, limit = 200) {
  return workouts
    .filter((w) => w.start)
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .slice(0, limit);
}

/** Keep only the most recent `keep` days of hourly heart rate. */
export function trimHourly(hourly, keep = 30) {
  const keys = Object.keys(hourly).sort().slice(-keep);
  return Object.fromEntries(keys.map((k) => [k, hourly[k]]));
}

const hasData = (day) => day && Object.entries(day).some(([k, v]) => k !== 'hrvMethod' && v != null);

/** Most recent day key that has any data, or null. */
export function latestDayKey(dataset) {
  return Object.keys(dataset?.days || {}).sort().reverse().find((k) => hasData(dataset.days[k])) || null;
}

/** Most recent non-null value of `field` on or before `dayKey`, scanning back up to `lookback` days. */
function recent(dataset, field, dayKey, lookback = 3) {
  const keys = Object.keys(dataset.days).filter((k) => k <= dayKey).sort().reverse().slice(0, lookback);
  for (const k of keys) {
    const v = dataset.days[k][field];
    if (v != null) return v;
  }
  return null;
}

/** Mean of `field` over the `n` days before `dayKey` (baseline), or null. */
export function baseline(dataset, field, dayKey, n = 14) {
  const vals = Object.keys(dataset.days)
    .filter((k) => k < dayKey)
    .sort()
    .slice(-n)
    .map((k) => dataset.days[k][field])
    .filter((v) => v != null);
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * Build the dashboard snapshot from a dataset.
 * `live` lets a streaming source (BLE) override the current heart rate.
 */
export function buildSnapshot(dataset, live = {}) {
  const dayKey = latestDayKey(dataset);
  const day = dayKey ? dataset.days[dayKey] : emptyDay();
  const sleep = dayKey ? recent(dataset, 'sleep', dayKey, 2) : null;

  return {
    provider: dataset.provider,
    deviceName: dataset.deviceName,
    isDemo: dataset.provider === DeviceProvider.DEMO,
    dayKey,
    batteryLevel: live.batteryLevel ?? null,
    vitals: {
      heartRate: live.heartRate ?? day.heartRateLatest ?? day.heartRateAvg ?? null,
      restingHeartRate: dayKey ? recent(dataset, 'restingHeartRate', dayKey) : null,
      hrv: dayKey ? recent(dataset, 'hrv', dayKey) : null,
      hrvMethod: day.hrvMethod ?? (dayKey ? recent(dataset, 'hrvMethod', dayKey) : null),
      spo2: dayKey ? recent(dataset, 'spo2', dayKey) : null,
      hrvBaseline: dayKey ? baseline(dataset, 'hrv', dayKey) : null,
      rhrBaseline: dayKey ? baseline(dataset, 'restingHeartRate', dayKey) : null
    },
    activity: {
      steps: day.steps,
      stepGoal: 10000,
      distanceKm: day.distanceKm,
      activeCalories: day.activeCalories
    },
    sleep,
    recentWorkouts: (dataset.workouts || []).slice(0, 5)
  };
}

/** Chart series for a metric: [{ label, value }] — real data only. */
export function chartSeries(dataset, metric, liveHeartRate = []) {
  if (metric === 'heartRate') {
    if (liveHeartRate.length) {
      return liveHeartRate.slice(-60).map((p) => ({ label: p.t.slice(11, 19), value: p.v }));
    }
    const key = Object.keys(dataset.heartRateHourly || {}).sort().pop();
    if (!key) return [];
    return dataset.heartRateHourly[key]
      .map((v, h) => ({ label: `${h}:00`, value: v }))
      .filter((p) => p.value != null);
  }
  const keys = Object.keys(dataset.days || {}).sort().slice(-14);
  const pick = metric === 'steps' ? (d) => d.steps : (d) => d.sleep?.totalMinutes ?? null;
  return keys
    .map((k) => ({ label: k.slice(5), value: pick(dataset.days[k]) }))
    .filter((p) => p.value != null);
}

/**
 * Recovery readiness (0-100) from whatever signals exist, each scored
 * relative to the user's own 14-day baseline when available.
 * Returns null when there is not enough data to say anything.
 */
export function computeRecoveryReadiness(snapshot) {
  const { vitals, sleep } = snapshot;
  const parts = [];

  if (vitals.hrv != null) {
    // Ratio to personal baseline; absolute fallback assumes ~60ms typical.
    const ref = vitals.hrvBaseline ?? 60;
    parts.push({ key: 'hrv', weight: 0.4, score: clamp(50 + (vitals.hrv / ref - 1) * 150, 0, 100) });
  }
  if (vitals.restingHeartRate != null) {
    const ref = vitals.rhrBaseline ?? 60;
    parts.push({ key: 'rhr', weight: 0.3, score: clamp(70 - (vitals.restingHeartRate - ref) * 6, 0, 100) });
  }
  if (sleep?.totalMinutes) {
    // 8h = 100, linear down to 0 at 4h.
    parts.push({ key: 'sleep', weight: 0.3, score: clamp(((sleep.totalMinutes - 240) / 240) * 100, 0, 100) });
  }
  if (!parts.length) return null;

  const total = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / total);

  let status = 'Moderate';
  let color = '#f59e0b';
  let advisory = 'Moderate recovery. Keep training balanced.';
  if (score >= 75) {
    status = 'Well recovered';
    color = '#10b981';
    advisory = 'Signals look strong. A good day for harder training.';
  } else if (score < 50) {
    status = 'Recovery needed';
    color = '#f43f5e';
    advisory = 'Signals look weak. Favour easy aerobic work, mobility, or rest.';
  }

  return {
    score,
    status,
    color,
    advisory,
    basedOn: parts.map((p) => p.key),
    breakdown: Object.fromEntries(parts.map((p) => [p.key, Math.round(p.score)]))
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
