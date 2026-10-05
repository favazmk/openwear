# OpenWear

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A local-first, open-source dashboard that brings your wearable data together in the browser — and a toolkit for decoding the budget smartwatches that nobody supports.**

Health data is split across Apple Health, Google Fit, Strava, Garmin and dozens of vendor apps. Budget watches popular in India (boAt, Noise, Fire-Boltt) are worse: their Bluetooth protocols are undocumented, so the data is locked in each vendor's app. OpenWear imports what can be imported today, streams what standard Bluetooth exposes, and gives owners of unsupported watches a tool to capture what their device sends so decoders can be written in the open.

Everything runs in your browser. There is no OpenWear server; imported data is stored in `localStorage` on your machine.

## What works today

| Source | How | Data |
| --- | --- | --- |
| **Apple Health** | Import `export.xml` (streamed — multi-GB exports are fine) | Steps, distance, active energy, heart rate (daily + hourly), resting HR, HRV (SDNN), SpO₂, sleep stages, workouts |
| **Google Fit** | Import Google Takeout CSVs (`Fit/Daily activity metrics/`) | Steps, distance, heart rate (daily + hourly) |
| **Strava** | OAuth with your own Strava API app | Last 200 activities: type, duration, distance, heart rate, elevation |
| **Garmin, Coros, Polar, Suunto, Zepp…** | Import `.gpx` / `.tcx` workout files | Duration, distance, elevation gain, heart rate, calories (TCX) |
| **Bluetooth heart rate** | Web Bluetooth, standard Heart Rate service `0x180D` | Live heart rate, live HRV (RMSSD) when RR intervals are sent, battery |
| **boAt / budget watch explorer** | Web Bluetooth, read-only scan | Lists services and characteristics, reads values, records notifications, exports a JSON device report |

Plus:

- **Readiness score** from HRV, resting HR and sleep, compared with your own 14-day baseline. Only signals that exist are used; with none, no score is shown.
- **Coach**: rule-based answers from your data, or bring your own OpenAI key for free-form questions. The key is kept in your browser and sent only to `api.openai.com`.
- **Export** any source as JSON.
- **Demo data** (clearly labelled) so you can look around before importing.

No metric is ever invented: if a source doesn't provide it, the dashboard shows "—".

## Why some sources work the way they do

- **Google Fit:** the Fit REST API no longer accepts new developers and Health Connect is Android-only with no web API, so Google Takeout is the only route into a browser app.
- **Strava:** Strava's API allows browser requests (CORS), so OAuth runs client-side with no backend. Each user creates their own free API app because new Strava apps are limited to one athlete until Strava reviews them.
- **Garmin:** the Garmin Health API is partner-only. GPX/TCX export works for everyone. FIT support is planned.
- **Budget watches:** no public protocol docs exist. See [Help decode your watch](#help-decode-your-watch).

## Getting started

Requires Node.js 20.19+ and, for Bluetooth features, Chrome, Edge or Opera (desktop or Android).

```bash
git clone https://github.com/favazmk/openwear.git
cd openwear
npm install
npm run dev     # http://localhost:5173
npm test        # parser and scoring tests (node:test, no extra deps)
npm run build   # static build in dist/
```

The build is a static site; host `dist/` anywhere. For Strava on a deployed site, set your Strava app's *Authorization Callback Domain* to that host.

## Help decode your watch

If you own a boAt, Noise, Fire-Boltt or other watch that OpenWear can't read yet:

1. Unpair it from its phone app (most watches allow only one connection).
2. Open **boAt / budget watch explorer**, click **Scan a watch**, and use the watch while it records (start a heart-rate reading, walk a few steps).
3. Download the device report and [open a device-report issue](https://github.com/favazmk/openwear/issues/new?labels=device-report&title=Device%20report%3A%20) with the JSON attached.

The explorer only reads; it never writes to the watch. Reports contain the device name and the raw bytes it sent, and no personal data from other sources.

## Project layout

```
src/
  parsers/        pure, tested parsers: Apple Health XML, Google Takeout CSV, GPX/TCX
  adapters/       one per source; each produces a normalized Dataset
  schema/         Dataset shape, snapshot builder, readiness score
  ai/             coach (rules + optional OpenAI)
  lib/storage.js  guarded localStorage
  main.js         dashboard UI
test/             node:test suites
```

## Roadmap

- FIT file import (Garmin native format)
- Decoders for the first budget watches, built from device reports
- Health Connect via an Android companion
- IndexedDB storage for full-resolution history
- Charts across multiple sources at once

## Privacy

OpenWear has no backend and no analytics. Imported data stays in your browser until you remove it (**Clear all local data** in the footer). Data leaves your machine only when you choose to connect Strava (reads from Strava) or add an OpenAI key (summary metrics are sent with each question).

OpenWear is not a medical device. Don't use it for diagnosis or treatment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Device reports, parser fixes for real-world exports, and new adapters are the most useful contributions.

## License

[MIT](LICENSE)
