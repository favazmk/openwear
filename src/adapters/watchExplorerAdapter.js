/**
 * OpenWear - Watch Explorer (boAt, Noise, Fire-Boltt and other budget watches)
 *
 * Most budget watches don't use the standard Heart Rate service; they talk to
 * their phone app over undocumented vendor services. Nobody has published
 * those protocols. The explorer is the first step: it connects, lists every
 * service and characteristic it can see, reads the readable ones, and records
 * notifications for a while. The result is a JSON "device report" users can
 * attach to a GitHub issue so decoders can be written.
 *
 * Read-only by design: it never writes to the watch.
 */

import { BaseAdapter } from './baseAdapter.js';
import { DeviceProvider, emptyDataset } from '../schema/telemetrySchema.js';

// Web Bluetooth only exposes services listed up front. Standard ones plus
// vendor UUIDs commonly seen on Realtek/JieLi/Nordic-based watches.
export const EXPLORER_SERVICES = [
  'heart_rate', 'battery_service', 'device_information', 'current_time',
  'immediate_alert', 'alert_notification', 'user_data', 'running_speed_and_cadence',
  0x1822, // pulse oximeter
  0xfee7, 0xfee0, 0xfee1, 0xfeea, 0xfe95, 0xfff0, 0xffe0, 0xff00, 0xffd0, 0xae00, 0xae30, 0xd0ff,
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e' // Nordic UART
];

const NAMES = {
  '180d': 'Heart Rate', '180f': 'Battery', '180a': 'Device Information', '1805': 'Current Time',
  '1802': 'Immediate Alert', '1811': 'Alert Notification', '181c': 'User Data', '1814': 'Running Speed & Cadence',
  '1822': 'Pulse Oximeter', '2a37': 'Heart Rate Measurement', '2a38': 'Body Sensor Location', '2a19': 'Battery Level',
  '2a29': 'Manufacturer Name', '2a24': 'Model Number', '2a25': 'Serial Number', '2a26': 'Firmware Revision',
  '2a27': 'Hardware Revision', '2a28': 'Software Revision', '2a2b': 'Current Time',
  '6e400001': 'Nordic UART', '6e400002': 'Nordic UART RX', '6e400003': 'Nordic UART TX'
};

const SIG_BASE = '-0000-1000-8000-00805f9b34fb';

export function uuidName(uuid) {
  const short = uuid.endsWith(SIG_BASE) ? uuid.slice(4, 8) : uuid.slice(0, 8);
  return NAMES[short] || (uuid.endsWith(SIG_BASE) ? `0x${short.toUpperCase()}` : 'Vendor-specific');
}

export function toHex(dv) {
  return Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), (b) => b.toString(16).padStart(2, '0')).join(' ');
}

const toAscii = (dv) =>
  Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');

const PROPS = ['broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate', 'authenticatedSignedWrites', 'reliableWrite'];

export class WatchExplorerAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.WATCH_EXPLORER, 'Watch explorer (boAt, Noise…)', '🔬', { persist: false });
    this.report = null;
    this.device = null;
  }

  /**
   * @param {{ listenSeconds?: number, extraUuids?: string[], onLog?: (msg: string) => void }} opts
   */
  async explore({ listenSeconds = 20, extraUuids = [], onLog = () => {} } = {}) {
    if (!('bluetooth' in navigator)) throw new Error('Web Bluetooth is not available. Use Chrome, Edge or Opera.');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...EXPLORER_SERVICES, ...extraUuids.map((u) => u.trim().toLowerCase()).filter(Boolean)]
    });
    this.device = device;
    onLog(`Connecting to ${device.name || 'unnamed device'}…`);
    const server = await device.gatt.connect();

    const report = {
      schema: 'openwear-device-report/1',
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      device: { name: device.name || null },
      deviceInformation: {},
      batteryLevel: null,
      services: [],
      notifications: []
    };

    let services = [];
    try {
      services = await server.getPrimaryServices();
    } catch {
      onLog('No accessible services. If you know the vendor service UUID, add it under "Extra UUIDs".');
    }

    const listening = [];
    for (const service of services) {
      const entry = { uuid: service.uuid, name: uuidName(service.uuid), characteristics: [] };
      report.services.push(entry);
      onLog(`Service ${entry.name} (${service.uuid})`);
      let chars = [];
      try {
        chars = await service.getCharacteristics();
      } catch (err) {
        entry.error = err.message;
        continue;
      }
      for (const c of chars) {
        const ch = {
          uuid: c.uuid,
          name: uuidName(c.uuid),
          properties: PROPS.filter((p) => c.properties[p])
        };
        entry.characteristics.push(ch);
        if (c.properties.read) {
          try {
            const v = await c.readValue();
            ch.value = { hex: toHex(v), ascii: toAscii(v) };
            if (service.uuid.startsWith('0000180a')) report.deviceInformation[ch.name] = new TextDecoder().decode(v).replace(/\0+$/, '');
            if (c.uuid.startsWith('00002a19')) report.batteryLevel = v.getUint8(0);
          } catch (err) {
            ch.readError = err.message;
          }
        }
        if (c.properties.notify || c.properties.indicate) {
          try {
            c.addEventListener('characteristicvaluechanged', (e) => {
              if (report.notifications.length >= 500) return;
              report.notifications.push({ t: new Date().toISOString(), characteristic: c.uuid, hex: toHex(e.target.value) });
            });
            await c.startNotifications();
            listening.push(c);
          } catch (err) {
            ch.notifyError = err.message;
          }
        }
      }
    }

    if (listening.length) {
      onLog(`Recording notifications from ${listening.length} characteristic(s) for ${listenSeconds}s. Use the watch (start a heart-rate reading, take steps) to generate traffic.`);
      await new Promise((r) => setTimeout(r, listenSeconds * 1000));
      await Promise.allSettled(listening.map((c) => c.stopNotifications()));
    }

    if (device.gatt.connected) device.gatt.disconnect();
    onLog(`Done: ${report.services.length} service(s), ${report.notifications.length} notification(s) captured.`);

    this.report = report;
    const ds = emptyDataset(this.providerId, device.name || 'Unknown watch');
    this.setDataset(ds);
    return report;
  }

  /** Has the standard HR service, so the Bluetooth heart rate adapter will work. */
  get supportsStandardHeartRate() {
    return !!this.report?.services.some((s) => s.uuid.startsWith('0000180d'));
  }

  getSnapshot() {
    return super.getSnapshot({ batteryLevel: this.report?.batteryLevel });
  }

  async disconnect() {
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
  }
}
