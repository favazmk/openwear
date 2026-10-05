/**
 * OpenWear - Strava V3 Telemetry Adapter
 * Ingests Strava activities, GPX streams, cadence, power, and segment efforts.
 */

import { BaseAdapter } from './baseAdapter.js';
import { createTelemetryPacket } from '../schema/telemetrySchema.js';

export class StravaAdapter extends BaseAdapter {
  constructor() {
    super('strava', 'Strava Club & Athletes', '⚡');
  }

  async connect() {
    this.isConnected = true;
    this.activeDevice = 'Strava Connected Athlete';
    this.lastSyncTime = new Date().toLocaleTimeString();
    this.emitChange();
    return { success: true, deviceName: this.activeDevice };
  }

  /**
   * Parse a GPX file string into route and workout metrics
   */
  parseGpx(gpxText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(gpxText, 'text/xml');
      const trackPoints = xmlDoc.querySelectorAll('trkpt');

      let pointsCount = trackPoints.length;
      let elevations = [];

      trackPoints.forEach((pt) => {
        const ele = pt.querySelector('ele');
        if (ele) elevations.push(parseFloat(ele.textContent));
      });

      const minEle = elevations.length ? Math.min(...elevations) : 0;
      const maxEle = elevations.length ? Math.max(...elevations) : 0;

      return {
        trackPoints: pointsCount,
        elevationGain: Math.max(0, Math.round(maxEle - minEle)),
        name: xmlDoc.querySelector('name')?.textContent || 'Uploaded GPX Workout'
      };
    } catch (e) {
      console.warn('GPX parsing fallback:', e);
      return null;
    }
  }

  async fetchTelemetry() {
    return createTelemetryPacket(this.providerId, 'Strava Athlete Profile', {
      heartRate: 148,
      restingHeartRate: 56,
      hrv: 72,
      spo2: 99,
      stressIndex: 18,
      steps: 13200,
      stepGoal: 10000,
      distanceKm: 14.2,
      activeCalories: 820,
      activeMinutes: 75,
      totalSleepMinutes: 490,
      sleepScore: 94,
      recentWorkouts: [
        {
          id: 'strava_w1',
          title: 'Morning 10k Tempo Run',
          type: 'Outdoor Run',
          durationMinutes: 52,
          avgHeartRate: 161,
          maxHeartRate: 179,
          calories: 680,
          distanceKm: 10.02,
          pace: '5:11 /km',
          elevationMeters: 142,
          time: '6:00 AM'
        },
        {
          id: 'strava_w2',
          title: 'Coastal Sunset Ride',
          type: 'Road Cycling',
          durationMinutes: 75,
          avgHeartRate: 138,
          maxHeartRate: 164,
          calories: 590,
          distanceKm: 32.5,
          pace: '26.0 km/h',
          elevationMeters: 260,
          time: '2 days ago'
        }
      ]
    });
  }
}
