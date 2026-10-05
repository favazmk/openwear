/**
 * OpenWear - Demo data
 * Synthetic, clearly labelled sample data so the dashboard can be explored
 * before importing anything. Never mixed with real sources.
 */

import { BaseAdapter } from './baseAdapter.js';
import { DeviceProvider, emptyDataset, emptyDay } from '../schema/telemetrySchema.js';

// Small deterministic PRNG so the demo looks the same on every load.
function prng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

export function generateDemoDataset(now = new Date()) {
  const rand = prng(42);
  const ds = emptyDataset(DeviceProvider.DEMO, 'Demo data');
  const dayKey = (offset) => new Date(now.getTime() - offset * 86400000).toISOString().slice(0, 10);

  for (let i = 13; i >= 0; i--) {
    const total = 400 + Math.round(rand() * 90);
    const deep = Math.round(total * (0.14 + rand() * 0.06));
    const rem = Math.round(total * (0.2 + rand() * 0.05));
    ds.days[dayKey(i)] = Object.assign(emptyDay(), {
      steps: 6000 + Math.round(rand() * 7000),
      distanceKm: +(4 + rand() * 5).toFixed(1),
      activeCalories: 350 + Math.round(rand() * 300),
      heartRateAvg: 70 + Math.round(rand() * 8),
      restingHeartRate: 58 + Math.round(rand() * 6),
      hrv: 52 + Math.round(rand() * 18),
      hrvMethod: 'RMSSD',
      spo2: 96 + Math.round(rand() * 3),
      sleep: { totalMinutes: total, deepMinutes: deep, remMinutes: rem, lightMinutes: total - deep - rem - 25, awakeMinutes: 25 }
    });
  }
  const today = dayKey(0);
  ds.heartRateHourly[today] = Array.from({ length: 24 }, (_, h) => Math.round(62 + Math.sin(((h - 4) / 24) * Math.PI * 2) * 12 + rand() * 6));
  ds.days[today].heartRateLatest = ds.heartRateHourly[today][now.getHours()];

  const at = (daysAgo, hour) => new Date(new Date(dayKey(daysAgo)).setHours(hour, 0, 0, 0)).toISOString();
  ds.workouts = [
    { id: 'demo_1', title: 'Morning Interval Run', type: 'Run', start: at(0, 7), durationMinutes: 32, distanceKm: 5.1, calories: 340, avgHeartRate: 154, maxHeartRate: 172, elevationMeters: 40 },
    { id: 'demo_2', title: 'Coastal Ride', type: 'Ride', start: at(2, 17), durationMinutes: 75, distanceKm: 32.5, calories: 590, avgHeartRate: 138, maxHeartRate: 164, elevationMeters: 260 },
    { id: 'demo_3', title: 'Evening Badminton', type: 'Badminton', start: at(3, 19), durationMinutes: 40, distanceKm: null, calories: 320, avgHeartRate: 148, maxHeartRate: 171, elevationMeters: null }
  ];
  return ds;
}

export class DemoAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.DEMO, 'Demo data', '🧪', { persist: false });
    this.dataset = generateDemoDataset();
  }
}
