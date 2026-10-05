/**
 * OpenWear - boAt Smartwatch Adapter
 * Specialized telemetry decoder for boAt Wave, Storm, Lunar, and Matrix series.
 */

import { BaseAdapter } from './baseAdapter.js';
import { createTelemetryPacket } from '../schema/telemetrySchema.js';

export class BoatWatchAdapter extends BaseAdapter {
  constructor() {
    super('boat_watch', 'boAt Crest / Wave OS', '🚤');
  }

  async connect() {
    this.isConnected = true;
    this.activeDevice = 'boAt Wave Pro (Crest OS)';
    this.lastSyncTime = new Date().toLocaleTimeString();
    this.emitChange();
    return { success: true, deviceName: this.activeDevice };
  }

  async fetchTelemetry() {
    return createTelemetryPacket(this.providerId, this.activeDevice || 'boAt Storm Call 3', {
      heartRate: 72,
      restingHeartRate: 63,
      hrv: 59,
      spo2: 98,
      stressIndex: 29,
      steps: 9850,
      stepGoal: 10000,
      distanceKm: 7.1,
      activeCalories: 510,
      activeMinutes: 52,
      totalSleepMinutes: 450,
      sleepScore: 85,
      deepSleepMinutes: 95,
      remSleepMinutes: 105,
      lightSleepMinutes: 215,
      awakeMinutes: 35,
      recentWorkouts: [
        {
          id: 'boat_w1',
          title: 'Evening Badminton Match',
          type: 'HIIT / Cardio',
          durationMinutes: 40,
          avgHeartRate: 148,
          maxHeartRate: 171,
          calories: 320,
          distanceKm: 2.1,
          time: 'Yesterday 7:00 PM'
        }
      ]
    });
  }
}
