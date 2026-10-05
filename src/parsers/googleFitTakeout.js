/**
 * Google Fit via Google Takeout (takeout.google.com → Fit → CSV).
 *
 * The Google Fit REST API is closed to new developers and Health Connect has
 * no web API, so Takeout is the only way to get this data into a browser app.
 *
 * Supported files from `Takeout/Fit/Daily activity metrics/`:
 *  - `Daily activity metrics.csv`  one row per day (column "Date")
 *  - `YYYY-MM-DD.csv`              15-minute rows for one day (column "Start time")
 * Columns are matched by name, so missing or reordered columns are fine.
 */

import { emptyDataset, emptyDay, trimHourly, DeviceProvider } from '../schema/telemetrySchema.js';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const COLUMNS = {
  date: (h) => h === 'date',
  start: (h) => h === 'start time',
  steps: (h) => h.startsWith('step count'),
  distanceM: (h) => h.startsWith('distance (m)'),
  hrAvg: (h) => h.startsWith('average heart rate'),
  hrMax: (h) => h.startsWith('max heart rate'),
  hrMin: (h) => h.startsWith('min heart rate')
};

function indexColumns(header) {
  const norm = header.map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, test] of Object.entries(COLUMNS)) idx[key] = norm.findIndex(test);
  return idx;
}

const num = (row, i) => {
  if (i < 0 || row[i] == null || row[i].trim() === '') return null;
  const v = parseFloat(row[i]);
  return isNaN(v) ? null : v;
};

/** Merge one Takeout CSV into `dataset` (created if omitted). Returns the dataset. */
export function mergeGoogleFitCsv(fileName, text, dataset = emptyDataset(DeviceProvider.GOOGLE_FIT, 'Google Fit (Takeout)')) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return dataset;
  const col = indexColumns(header);

  if (col.date >= 0) {
    // Daily summary file
    for (const r of rows) {
      const key = (r[col.date] || '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const day = (dataset.days[key] ||= emptyDay());
      const steps = num(r, col.steps);
      const dist = num(r, col.distanceM);
      if (steps != null) day.steps = Math.round(steps);
      if (dist != null) day.distanceKm = +(dist / 1000).toFixed(2);
      if (num(r, col.hrAvg) != null) day.heartRateAvg = Math.round(num(r, col.hrAvg));
      if (num(r, col.hrMax) != null) day.heartRateMax = Math.round(num(r, col.hrMax));
      if (num(r, col.hrMin) != null) day.heartRateMin = Math.round(num(r, col.hrMin));
    }
    return dataset;
  }

  const fileDay = (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (col.start >= 0 && fileDay) {
    // Intraday file: 15-minute buckets for a single day
    const hours = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
    let steps = 0;
    let sawSteps = false;
    let hrMin = Infinity;
    let hrMax = -Infinity;
    for (const r of rows) {
      const hour = parseInt((r[col.start] || '').slice(0, 2), 10);
      const s = num(r, col.steps);
      if (s != null) {
        steps += s;
        sawSteps = true;
      }
      const hr = num(r, col.hrAvg);
      if (hr != null && hour >= 0 && hour < 24) {
        hours[hour].sum += hr;
        hours[hour].n++;
      }
      if (num(r, col.hrMax) != null) hrMax = Math.max(hrMax, num(r, col.hrMax));
      if (num(r, col.hrMin) != null) hrMin = Math.min(hrMin, num(r, col.hrMin));
    }
    const day = (dataset.days[fileDay] ||= emptyDay());
    if (sawSteps && day.steps == null) day.steps = Math.round(steps);
    if (hours.some((h) => h.n)) {
      dataset.heartRateHourly[fileDay] = hours.map((h) => (h.n ? Math.round(h.sum / h.n) : null));
      dataset.heartRateHourly = trimHourly(dataset.heartRateHourly);
      const all = hours.filter((h) => h.n);
      day.heartRateAvg ??= Math.round(all.reduce((a, h) => a + h.sum / h.n, 0) / all.length);
    }
    if (isFinite(hrMax)) day.heartRateMax ??= Math.round(hrMax);
    if (isFinite(hrMin)) day.heartRateMin ??= Math.round(hrMin);
  }
  return dataset;
}
