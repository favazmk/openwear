/**
 * OpenWear - Base Wearable Adapter Interface
 */

export class BaseAdapter {
  constructor(providerId, providerName, icon) {
    this.providerId = providerId;
    this.providerName = providerName;
    this.icon = icon;
    this.isConnected = false;
    this.activeDevice = null;
    this.lastSyncTime = null;
    this.listeners = new Set();
  }

  async connect() {
    throw new Error(`connect() not implemented for ${this.providerName}`);
  }

  async disconnect() {
    this.isConnected = false;
    this.activeDevice = null;
    this.emitChange();
  }

  async fetchTelemetry() {
    throw new Error(`fetchTelemetry() not implemented for ${this.providerName}`);
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
        console.error(`Error in OpenWear adapter listener [${this.providerId}]:`, err);
      }
    }
  }

  getStatus() {
    return {
      providerId: this.providerId,
      providerName: this.providerName,
      icon: this.icon,
      isConnected: this.isConnected,
      activeDevice: this.activeDevice,
      lastSyncTime: this.lastSyncTime
    };
  }
}
