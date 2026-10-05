/**
 * OpenWear - Unified Health Telemetry Schema
 * Canonical data structures for universal smartwatch and wearable normalization.
 */

export const DeviceProvider = {
  APPLE_HEALTH: 'apple_health',
  GOOGLE_FIT: 'google_fit',
  STRAVA: 'strava',
  GARMIN: 'garmin',
  BOAT_WATCH: 'boat_watch',
  GENERIC_BLE: 'generic_ble',
  FITBIT: 'fitbit'
};

export const ActivityType = {
  RUN: 'Outdoor Run',
  TRAIL_RUN: 'Trail Run',
  CYCLING: 'Road Cycling',
  SWIMMING: 'Lap Swimming',
  HIIT: 'HIIT / Cardio',
  WALKING: 'Power Walk',
  YOGA: 'Yoga & Recovery'
};

/**
 * Standard Telemetry Snapshot
 */
export function createTelemetryPacket(provider, deviceName, options = {}) {
  const now = new Date();
  return {
    id: `pkt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    provider,
    deviceName: deviceName || 'Generic Wearable',
    timestamp: now.toISOString(),
    connectionState: options.connectionState || 'connected',
    batteryLevel: options.batteryLevel ?? 88,
    vitals: {
      heartRate: options.heartRate ?? 72,
      restingHeartRate: options.restingHeartRate ?? 61,
      hrv: options.hrv ?? 58, // Root Mean Square of Successive Differences (ms)
      spo2: options.spo2 ?? 98, // Blood Oxygen %
      stressIndex: options.stressIndex ?? 32, // 0 - 100
      respiratoryRate: options.respiratoryRate ?? 15 // breaths/min
    },
    activity: {
      steps: options.steps ?? 8420,
      stepGoal: options.stepGoal ?? 10000,
      distanceKm: options.distanceKm ?? 6.2,
      activeCalories: options.activeCalories ?? 495,
      activeMinutes: options.activeMinutes ?? 48
    },
    sleep: {
      totalMinutes: options.totalSleepMinutes ?? 465, // 7h 45m
      sleepScore: options.sleepScore ?? 86,
      deepMinutes: options.deepSleepMinutes ?? 105,
      remMinutes: options.remSleepMinutes ?? 115,
      lightMinutes: options.lightSleepMinutes ?? 210,
      awakeMinutes: options.awakeMinutes ?? 35,
      efficiencyPercent: 92
    },
    recentWorkouts: options.recentWorkouts || []
  };
}

/**
 * Calculate Recovery Readiness Score (0-100) based on HRV, Resting HR, Sleep & Fatigue
 */
export function computeRecoveryReadiness(vitals, sleep) {
  // HRV Contribution (optimal > 55ms)
  const hrvFactor = Math.min(100, Math.max(20, (vitals.hrv / 70) * 100));

  // Sleep Score Contribution
  const sleepFactor = sleep.sleepScore || 80;

  // Resting HR delta (lower is better, baseline 60bpm)
  const rhrFactor = Math.max(30, 100 - (vitals.restingHeartRate - 55) * 3);

  // Stress Penalty (lower stress is better)
  const stressBonus = Math.max(0, 100 - vitals.stressIndex);

  // Weighted composite score
  const readiness = Math.round(
    hrvFactor * 0.35 +
    sleepFactor * 0.35 +
    rhrFactor * 0.20 +
    stressBonus * 0.10
  );

  const clamped = Math.min(99, Math.max(10, readiness));

  let status = 'Moderate';
  let color = '#f59e0b'; // amber
  let advisory = 'Moderate recovery. Keep training balanced with adequate hydration.';

  if (clamped >= 85) {
    status = 'Optimal Recovery';
    color = '#10b981'; // emerald
    advisory = 'Supercharged readiness. Your autonomic nervous system is fully primed for high-intensity exertion.';
  } else if (clamped < 65) {
    status = 'Recovery Needed';
    color = '#f43f5e'; // rose
    advisory = 'Elevated physiological strain detected. Prioritize zone-2 active recovery or light mobility.';
  }

  return {
    score: clamped,
    status,
    color,
    advisory,
    breakdown: {
      hrvWeight: Math.round(hrvFactor),
      sleepWeight: Math.round(sleepFactor),
      rhrWeight: Math.round(rhrFactor),
      stressWeight: Math.round(stressBonus)
    }
  };
}
