/**
 * OpenWear - Base Adapter
 *
 * An adapter turns one source (a file export, an API, a Bluetooth device)
 * into a normalized Dataset (see schema/telemetrySchema.js). The dashboard
 * only ever reads `adapter.dataset` and `adapter.getSnapshot()`.
 */

import { emptyDataset, buildSnapshot } from '../schema/telemetrySchema.js';
import * as storage from '../lib/storage.js';

export class BaseAdapter {
  /**
   * @param {string} providerId   stable id, also the storage key
   * @param {string} providerName human label
   * @param {string} icon
   * @param {{ persist?: boolean }} options
   */
  constructor(providerId, providerName, icon, { persist = true } = {}) {
    this.providerId = providerId;
    this.providerName = providerName;
    this.icon = icon;
    this.persist = persist;
    this.listeners = new Set();
    this.dataset = (persist && storage.load(`dataset:${providerId}`)) || null;
  }

  get hasData() {
    return !!this.dataset && (Object.keys(this.dataset.days).length > 0 || this.dataset.workouts.length > 0);
  }

  /** Replace the dataset, persist it, and notify listeners. */
  setDataset(dataset) {
    this.dataset = dataset;
    if (this.persist) storage.save(`dataset:${this.providerId}`, dataset);
    this.emitChange();
  }

  clear() {
    this.dataset = null;
    storage.remove(`dataset:${this.providerId}`);
    this.emitChange();
  }

  getSnapshot(live = {}) {
    return buildSnapshot(this.dataset || emptyDataset(this.providerId, this.providerName), live);
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emitChange(data) {
    for (const listener of this.listeners) {
      try {
        listener({ adapter: this, data });
      } catch (err) {
        console.error(`OpenWear adapter listener error [${this.providerId}]:`, err);
      }
    }
  }
}
