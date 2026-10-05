/**
 * OpenWear - Google Fit adapter (Google Takeout CSV import)
 * See parsers/googleFitTakeout.js for why Takeout instead of the REST API.
 */

import { BaseAdapter } from './baseAdapter.js';
import { mergeGoogleFitCsv } from '../parsers/googleFitTakeout.js';
import { DeviceProvider, emptyDataset } from '../schema/telemetrySchema.js';

export class GoogleFitAdapter extends BaseAdapter {
  constructor() {
    super(DeviceProvider.GOOGLE_FIT, 'Google Fit (Takeout)', '🟢');
  }

  /** Import one or more CSVs from Takeout/Fit/Daily activity metrics/. */
  async importFiles(files) {
    let dataset = emptyDataset(this.providerId, this.providerName);
    const csvs = [...files].filter((f) => /\.csv$/i.test(f.name));
    if (!csvs.length) throw new Error('Choose the .csv files from Takeout/Fit/Daily activity metrics/.');
    // Daily summary first so intraday files only fill gaps.
    csvs.sort((a, b) => (/daily activity metrics/i.test(b.name) ? 1 : 0) - (/daily activity metrics/i.test(a.name) ? 1 : 0));
    for (const f of csvs) dataset = mergeGoogleFitCsv(f.name, await f.text(), dataset);
    if (!Object.keys(dataset.days).length) throw new Error('No daily rows found in those CSV files.');
    this.setDataset(dataset);
    return dataset;
  }
}
