/**
 * OpenWear - Bluetooth heart rate adapter (Web Bluetooth, Chrome/Edge/Opera)
 *
 * Works with anything exposing the standard Bluetooth SIG Heart Rate service
 * (0x180D): chest straps (Polar, Garmin HRM, Wahoo), Polar/Coros/Amazfit
 * watches in HR-broadcast mode, PineTime, and some budget watches.
 * When the device sends RR intervals, a live HRV (RMSSD) is computed.
 */

import { BaseAdapter } from './baseAdapter.js';
import { DeviceProvider, emptyDataset, emptyDay } from '../schema/telemetrySchema.js';

/**
 * Decode a Heart Rate Measurement (0x2A37) value.
 * @param {DataView} value
 * @returns {{ heartRate: number, rrIntervalsMs: number[] }}
 */
export function parseHeartRateMeasurement(value) {
  const flags = value.getUint8(0);
  let offset = 1;
  let heartRate;
  if (flags & 0x01) {
    heartRate = value.getUint16(offset, true);
    offset += 2;
  } else {
    heartRate = value.getUint8(offset);
    offset += 1;
  }
  if (flags & 0x08) offset += 2; // energy expended
  const rrIntervalsMs = [];
  if (flags & 0x10) {
    for (; offset + 1 < value.byteLength; offset += 2) {
      rrIntervalsMs.push(Math.round((value.getUint16(offset, true) / 1024) * 1000));
    }
  }
  return { heartRate, rrIntervalsMs };
}

/** Root mean square of successive RR differences, in ms. Needs >= 10 intervals. */
export function rmssd(rr) {
  if (rr.length < 10) return null;
  let sum = 0;
  for (let i = 1; i < rr.length; i++) sum += (rr[i] - rr[i - 1]) ** 2;
  return Math.round(Math.sqrt(sum / (rr.length - 1)));
}

export class BLEWatchAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.GENERIC_BLE, 'Bluetooth heart rate', '⌚', { persist: false });
    this.device = null;
    this.live = []; // [{ t: ISO, v: bpm }]
    this.rr = [];
    this.batteryLevel = null;
    this.onDisconnected = this.onDisconnected.bind(this);
  }

  isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  get isConnected() {
    return !!this.device?.gatt?.connected;
  }

  async connect() {
    if (!this.isSupported()) throw new Error('Web Bluetooth is not available. Use Chrome, Edge or Opera on desktop or Android.');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service', 'device_information']
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
    const server = await device.gatt.connect();

    const hr = await (await server.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
    hr.addEventListener('characteristicvaluechanged', (e) => this.onMeasurement(e.target.value));
    await hr.startNotifications();

    try {
      const battery = await (await server.getPrimaryService('battery_service')).getCharacteristic('battery_level');
      this.batteryLevel = (await battery.readValue()).getUint8(0);
    } catch {
      this.batteryLevel = null; // optional service
    }

    this.live = [];
    this.rr = [];
    this.setDataset(emptyDataset(this.providerId, device.name || 'Bluetooth heart rate'));
    return { deviceName: device.name };
  }

  onMeasurement(value) {
    const { heartRate, rrIntervalsMs } = parseHeartRateMeasurement(value);
    if (!heartRate) return; // 0 = sensor has no contact
    this.live.push({ t: new Date().toISOString(), v: heartRate });
    if (this.live.length > 600) this.live.shift();
    this.rr.push(...rrIntervalsMs);
    if (this.rr.length > 120) this.rr.splice(0, this.rr.length - 120);

    const vals = this.live.map((p) => p.v);
    const today = new Date().toISOString().slice(0, 10);
    const day = Object.assign(emptyDay(), {
      heartRateLatest: heartRate,
      heartRateAvg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      heartRateMin: Math.min(...vals),
      heartRateMax: Math.max(...vals),
      hrv: rmssd(this.rr),
      hrvMethod: 'RMSSD'
    });
    this.dataset.days = { [today]: day };
    this.emitChange({ liveHeartRate: heartRate });
  }

  onDisconnected() {
    this.emitChange({ disconnected: true });
  }

  async disconnect() {
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
      if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
    this.device = null;
    this.emitChange({ disconnected: true });
  }

  getSnapshot() {
    const last = this.live[this.live.length - 1];
    return super.getSnapshot({ heartRate: last?.v, batteryLevel: this.batteryLevel });
  }
}
