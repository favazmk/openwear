/**
 * OpenWear - Strava adapter (Strava API v3, OAuth 2)
 *
 * Bring-your-own API app: each user creates a free app at
 * https://www.strava.com/settings/api (new apps are limited to one athlete
 * anyway) and pastes its Client ID and Secret here. Both are stored only in
 * this browser. Strava's API allows CORS, so no backend is needed.
 */

import { BaseAdapter } from './baseAdapter.js';
import { DeviceProvider, emptyDataset, sortWorkouts } from '../schema/telemetrySchema.js';
import * as storage from '../lib/storage.js';

const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

const pretty = (s = '') => s.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Strava SummaryActivity -> OpenWear workout */
export function mapStravaActivity(a) {
  return {
    id: `strava_${a.id}`,
    title: a.name || pretty(a.sport_type || a.type),
    type: pretty(a.sport_type || a.type || 'Workout'),
    start: a.start_date,
    durationMinutes: Math.round((a.moving_time ?? a.elapsed_time ?? 0) / 60),
    distanceKm: a.distance ? +(a.distance / 1000).toFixed(2) : null,
    calories: a.calories ?? null,
    avgHeartRate: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
    maxHeartRate: a.max_heartrate != null ? Math.round(a.max_heartrate) : null,
    elevationMeters: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null
  };
}

export class StravaAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.STRAVA, 'Strava', '⚡');
  }

  get app() {
    return storage.load('strava:app');
  }

  get tokens() {
    return storage.load('strava:tokens');
  }

  get isAuthorized() {
    return !!this.tokens?.refresh_token;
  }

  saveApp(clientId, clientSecret) {
    if (!/^\d+$/.test(clientId.trim()) || !clientSecret.trim()) throw new Error('Enter a numeric Client ID and the Client Secret.');
    storage.save('strava:app', { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  }

  redirectUri() {
    return location.origin + location.pathname;
  }

  /** Step 1: send the user to Strava's consent screen. */
  beginAuth() {
    const app = this.app;
    if (!app) throw new Error('Add your Strava API app first.');
    const state = crypto.randomUUID();
    sessionStorage.setItem('openwear:strava:state', state);
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state
    });
    location.assign(url);
  }

  /** Step 2: on page load, finish OAuth if Strava redirected back. Returns true if it did. */
  async handleRedirect() {
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('error')) return false;
    if (params.get('state') !== sessionStorage.getItem('openwear:strava:state')) return false;

    history.replaceState(null, '', this.redirectUri());
    sessionStorage.removeItem('openwear:strava:state');
    if (params.get('error')) throw new Error(`Strava authorization was declined (${params.get('error')}).`);
    if (!(params.get('scope') || '').includes('activity:read')) {
      throw new Error('Strava access was granted without activity permission. Connect again and keep "View data about your activities" ticked.');
    }
    await this.exchange({ grant_type: 'authorization_code', code: params.get('code') });
    return true;
  }

  async exchange(grant) {
    const app = this.app;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, ...grant })
    });
    if (!res.ok) throw new Error(`Strava token request failed (${res.status}). Check the Client ID/Secret and the app's callback domain.`);
    const t = await res.json();
    storage.save('strava:tokens', {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
      athlete: t.athlete ? `${t.athlete.firstname ?? ''} ${t.athlete.lastname ?? ''}`.trim() : this.tokens?.athlete
    });
  }

  async accessToken() {
    const t = this.tokens;
    if (!t) throw new Error('Strava is not connected.');
    if (t.expires_at - 60 > Date.now() / 1000) return t.access_token;
    await this.exchange({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    return this.tokens.access_token;
  }

  /** Fetch up to `pages` x 100 most recent activities. */
  async sync(pages = 2) {
    const token = await this.accessToken();
    const activities = [];
    for (let page = 1; page <= pages; page++) {
      const res = await fetch(`${API}/athlete/activities?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 429) throw new Error('Strava rate limit reached. Try again in 15 minutes.');
      if (!res.ok) throw new Error(`Strava API error ${res.status}.`);
      const batch = await res.json();
      activities.push(...batch);
      if (batch.length < 100) break;
    }
    const dataset = emptyDataset(this.providerId, this.tokens?.athlete ? `Strava · ${this.tokens.athlete}` : 'Strava');
    dataset.workouts = sortWorkouts(activities.map(mapStravaActivity));
    this.setDataset(dataset);
    return dataset;
  }

  disconnect() {
    storage.remove('strava:tokens');
    this.clear();
  }
}
