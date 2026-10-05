/**
 * OpenWear - Workout files adapter (GPX / TCX)
 * Covers Garmin Connect, Coros, Polar, Suunto, Zepp and any app that exports GPX/TCX.
 */

import { BaseAdapter } from './baseAdapter.js';
import { parseActivityFile } from '../parsers/activityFiles.js';
import { DeviceProvider, emptyDataset, sortWorkouts } from '../schema/telemetrySchema.js';

export class ActivityFilesAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.ACTIVITY_FILES, 'Garmin & others (GPX/TCX)', '📁');
  }

  /** Adds workouts to any already imported; same start time = same workout. */
  async importFiles(files) {
    const dataset = this.dataset || emptyDataset(this.providerId, this.providerName);
    const byId = new Map(dataset.workouts.map((w) => [w.id, w]));
    const errors = [];
    for (const f of files) {
      try {
        const w = parseActivityFile(f.name, await f.text());
        if (w) byId.set(w.id, w);
        else errors.push(`${f.name}: no timestamped track points`);
      } catch (err) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }
    dataset.workouts = sortWorkouts([...byId.values()]);
    dataset.importedAt = new Date().toISOString();
    this.setDataset(dataset);
    return { dataset, errors };
  }
}
