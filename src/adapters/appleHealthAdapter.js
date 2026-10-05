/**
 * OpenWear - Apple Health adapter
 * Imports `export.xml` from Health → profile → Export All Health Data.
 * Parsing is streamed and runs entirely in the browser.
 */

import { BaseAdapter } from './baseAdapter.js';
import { parseAppleHealthFile } from '../parsers/appleHealth.js';
import { DeviceProvider } from '../schema/telemetrySchema.js';

export class AppleHealthAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.APPLE_HEALTH, 'Apple Health', '🍎');
  }

  async importFile(file, onProgress) {
    if (/\.zip$/i.test(file.name)) {
      throw new Error('Unzip export.zip first, then choose apple_health_export/export.xml.');
    }
    const dataset = await parseAppleHealthFile(file, onProgress);
    if (!dataset.recordCount) throw new Error('No Health records found. Is this the export.xml file?');
    this.setDataset(dataset);
    return dataset;
  }
}
