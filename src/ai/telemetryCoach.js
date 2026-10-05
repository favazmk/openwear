/**
 * OpenWear - AI coach
 *
 * Bring-your-own OpenAI key: entered in the UI, kept in this browser's
 * localStorage, sent only to api.openai.com. Never put a key in a VITE_
 * env var — Vite inlines those into the public bundle.
 * Without a key, a small rule-based coach answers from the same data.
 */

import * as storage from '../lib/storage.js';

const fmt = (v, unit = '') => (v == null ? 'not available' : `${v}${unit}`);
const hm = (min) => (min == null ? 'not available' : `${Math.floor(min / 60)}h ${min % 60}m`);

/** Plain-text summary of the snapshot for the model. Only real values. */
export function describeSnapshot(s, recovery) {
  const v = s.vitals;
  const lines = [
    `Source: ${s.deviceName}${s.isDemo ? ' (synthetic demo data)' : ''}; latest day with data: ${s.dayKey ?? 'none'}`,
    `Heart rate: ${fmt(v.heartRate, ' bpm')}; resting: ${fmt(v.restingHeartRate, ' bpm')} (14-day baseline ${fmt(v.rhrBaseline && Math.round(v.rhrBaseline), ' bpm')})`,
    `HRV${v.hrvMethod ? ` (${v.hrvMethod})` : ''}: ${fmt(v.hrv, ' ms')} (14-day baseline ${fmt(v.hrvBaseline && Math.round(v.hrvBaseline), ' ms')})`,
    `SpO2: ${fmt(v.spo2, '%')}`,
    `Steps: ${fmt(s.activity.steps)}; distance: ${fmt(s.activity.distanceKm, ' km')}; active energy: ${fmt(s.activity.activeCalories, ' kcal')}`,
    `Sleep: ${hm(s.sleep?.totalMinutes)} (deep ${fmt(s.sleep?.deepMinutes, 'm')}, REM ${fmt(s.sleep?.remMinutes, 'm')})`,
    `Recovery score: ${recovery ? `${recovery.score}/100 (${recovery.status}; based on ${recovery.basedOn.join(', ')})` : 'not enough data'}`,
    `Recent workouts: ${JSON.stringify(s.recentWorkouts)}`
  ];
  return lines.join('\n');
}

export class TelemetryCoach {
  get settings() {
    return storage.load('ai', { apiKey: '', model: 'gpt-4o-mini' });
  }

  saveSettings({ apiKey, model }) {
    storage.save('ai', { apiKey: apiKey.trim(), model: model.trim() || 'gpt-4o-mini' });
  }

  get usesOpenAI() {
    return !!this.settings.apiKey;
  }

  /** @returns {Promise<{ text: string, source: 'openai' | 'rules', error?: string }>} */
  async askCoach(question, snapshot, recovery) {
    const { apiKey, model } = this.settings;
    if (apiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.4,
            max_tokens: 400,
            messages: [
              {
                role: 'system',
                content:
                  'You are OpenWear, a fitness and recovery assistant. Answer only from the data provided; say so when a metric is not available. Be concise and practical. You are not a doctor: for symptoms or abnormal readings, recommend seeing a clinician.'
              },
              { role: 'user', content: `Data:\n${describeSnapshot(snapshot, recovery)}\n\nQuestion: ${question}` }
            ]
          })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return { text, source: 'openai' };
      } catch (err) {
        return { text: this.rules(question, snapshot, recovery), source: 'rules', error: `OpenAI request failed: ${err.message}` };
      }
    }
    return { text: this.rules(question, snapshot, recovery), source: 'rules' };
  }

  /** Rule-based answers. Every number shown comes from the snapshot. */
  rules(question, s, recovery) {
    const q = question.toLowerCase();
    const { vitals: v, sleep, activity } = s;

    if (!s.dayKey && !s.recentWorkouts.length) {
      return 'No data yet. Import a source (Apple Health, Google Fit, Strava, GPX/TCX) or pair a Bluetooth heart rate device.';
    }

    if (/sleep|tired|rem|deep/.test(q)) {
      if (!sleep) return 'This source has no sleep data.';
      const pct = (m) => (m == null ? null : Math.round((m / sleep.totalMinutes) * 100));
      let out = `**Sleep:** ${hm(sleep.totalMinutes)}.`;
      if (sleep.deepMinutes != null) out += ` Deep ${sleep.deepMinutes}m (${pct(sleep.deepMinutes)}%), REM ${sleep.remMinutes}m (${pct(sleep.remMinutes)}%).`;
      out += sleep.totalMinutes < 420 ? '\nUnder 7 hours. Most adults need 7–9.' : '\nWithin the 7–9 hour range most adults need.';
      return out;
    }

    if (/train|workout|run|hard|recover|ready/.test(q)) {
      if (!recovery) return 'Not enough data for a readiness estimate. It needs HRV, resting heart rate or sleep.';
      return `**Readiness ${recovery.score}/100 — ${recovery.status}** (from ${recovery.basedOn.join(', ')}).\n${recovery.advisory}`;
    }

    if (/hrv|heart|pulse|spo2|oxygen/.test(q)) {
      return [
        `**Heart rate:** ${fmt(v.heartRate, ' bpm')}`,
        `**Resting HR:** ${fmt(v.restingHeartRate, ' bpm')}${v.rhrBaseline ? ` (your 14-day average ${Math.round(v.rhrBaseline)})` : ''}`,
        `**HRV${v.hrvMethod ? ` (${v.hrvMethod})` : ''}:** ${fmt(v.hrv, ' ms')}${v.hrvBaseline ? ` (your 14-day average ${Math.round(v.hrvBaseline)})` : ''}`,
        `**SpO2:** ${fmt(v.spo2, '%')}`
      ].join('\n');
    }

    if (/python|code|export|pandas|csv/.test(q)) {
      return 'Use **Export data** in the footer to download everything as JSON. Load it in pandas with:\n```\nimport json, pandas as pd\nd = json.load(open("openwear-export.json"))\ndays = pd.DataFrame.from_dict(d["days"], orient="index")\n```';
    }

    return [
      `**${s.deviceName}** — latest data ${s.dayKey ?? 'n/a'}`,
      `Steps: ${fmt(activity.steps?.toLocaleString())}`,
      `Resting HR: ${fmt(v.restingHeartRate, ' bpm')} · HRV: ${fmt(v.hrv, ' ms')}`,
      `Sleep: ${hm(sleep?.totalMinutes)}`,
      recovery ? `Readiness: ${recovery.score}/100` : 'Readiness: not enough data',
      '',
      'Ask about sleep, readiness, or heart rate. Add an OpenAI key in AI settings for free-form answers.'
    ].join('\n');
  }
}
