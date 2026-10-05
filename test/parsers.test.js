import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AppleHealthParser, parseAppleDate } from '../src/parsers/appleHealth.js';
import { mergeGoogleFitCsv, parseCsv } from '../src/parsers/googleFitTakeout.js';
import { parseGpx, parseTcx, haversine } from '../src/parsers/activityFiles.js';
import { parseHeartRateMeasurement, rmssd } from '../src/adapters/bleWatchAdapter.js';
import { mapStravaActivity } from '../src/adapters/stravaAdapter.js';
import { buildSnapshot, computeRecoveryReadiness, emptyDataset, emptyDay, chartSeries } from '../src/schema/telemetrySchema.js';
import { generateDemoDataset } from '../src/adapters/demoAdapter.js';

const APPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData locale="en_IN">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-10-04 08:00:00 +0530" endDate="2026-10-04 08:10:00 +0530" value="3000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" startDate="2026-10-04 08:00:00 +0530" endDate="2026-10-04 08:10:00 +0530" value="2500"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" startDate="2026-10-04 18:00:00 +0530" endDate="2026-10-04 18:10:00 +0530" value="1000"/>
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="Apple Watch" unit="mi" startDate="2026-10-04 08:00:00 +0530" endDate="2026-10-04 08:10:00 +0530" value="1"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Apple Watch" unit="kJ" startDate="2026-10-04 08:00:00 +0530" endDate="2026-10-04 08:10:00 +0530" value="418.4"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" unit="count/min" startDate="2026-10-04 08:05:00 +0530" endDate="2026-10-04 08:05:00 +0530" value="120">
  <MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="0"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" unit="count/min" startDate="2026-10-04 21:00:00 +0530" endDate="2026-10-04 21:00:00 +0530" value="60"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" startDate="2026-10-04 00:00:00 +0530" endDate="2026-10-04 23:59:00 +0530" value="57"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" startDate="2026-10-04 03:00:00 +0530" endDate="2026-10-04 03:01:00 +0530" value="50"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" startDate="2026-10-04 04:00:00 +0530" endDate="2026-10-04 04:01:00 +0530" value="70"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Apple Watch" unit="%" startDate="2026-10-04 03:00:00 +0530" endDate="2026-10-04 03:00:00 +0530" value="0.97"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-10-03 23:00:00 +0530" endDate="2026-10-04 07:00:00 +0530" value="HKCategoryValueSleepAnalysisInBed"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-03 23:30:00 +0530" endDate="2026-10-04 01:00:00 +0530" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-04 01:00:00 +0530" endDate="2026-10-04 02:00:00 +0530" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-04 02:00:00 +0530" endDate="2026-10-04 02:10:00 +0530" value="HKCategoryValueSleepAnalysisAwake"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-04 02:10:00 +0530" endDate="2026-10-04 03:40:00 +0530" value="HKCategoryValueSleepAnalysisAsleepREM"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Apple Watch" startDate="2026-10-04 07:00:00 +0530" endDate="2026-10-04 07:30:00 +0530">
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-10-04 07:00:00 +0530" endDate="2026-10-04 07:30:00 +0530" average="150.4" minimum="100" maximum="171" unit="count/min"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-10-04 07:00:00 +0530" endDate="2026-10-04 07:30:00 +0530" sum="300" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2026-10-04 07:00:00 +0530" endDate="2026-10-04 07:30:00 +0530" sum="5" unit="km"/>
 </Workout>
</HealthData>`;

test('parseAppleDate handles Apple offsets', () => {
  assert.equal(parseAppleDate('2026-10-04 08:00:00 +0530').toISOString(), '2026-10-04T02:30:00.000Z');
});

test('Apple Health: streaming parse gives the same result for any chunk size', () => {
  const whole = new AppleHealthParser();
  whole.push(APPLE_XML);
  const a = whole.finish();

  const chunked = new AppleHealthParser();
  for (let i = 0; i < APPLE_XML.length; i += 37) chunked.push(APPLE_XML.slice(i, i + 37));
  const b = chunked.finish();

  delete a.importedAt;
  delete b.importedAt;
  assert.deepEqual(a, b);
});

test('Apple Health: aggregates, de-duplicates sources, converts units', () => {
  const p = new AppleHealthParser();
  p.push(APPLE_XML);
  const ds = p.finish();
  const day = ds.days['2026-10-04'];

  assert.equal(day.steps, 3500, 'Watch total (2500+1000) beats iPhone (3000); never summed across sources');
  assert.equal(day.distanceKm, 1.61);
  assert.equal(day.activeCalories, 100);
  assert.equal(day.heartRateAvg, 90);
  assert.equal(day.heartRateLatest, 60);
  assert.equal(day.restingHeartRate, 57);
  assert.equal(day.hrv, 60);
  assert.equal(day.hrvMethod, 'SDNN');
  assert.equal(day.spo2, 97);
  assert.deepEqual(day.sleep, { totalMinutes: 240, deepMinutes: 60, remMinutes: 90, lightMinutes: 90, awakeMinutes: 10 });

  assert.equal(ds.heartRateHourly['2026-10-04'][8], 120);
  assert.equal(ds.heartRateHourly['2026-10-04'][21], 60);
  assert.equal(ds.recordCount, 16);

  assert.equal(ds.workouts.length, 1);
  assert.deepEqual(
    { ...ds.workouts[0], id: undefined, start: undefined },
    { id: undefined, start: undefined, title: 'Running', type: 'Running', durationMinutes: 30, distanceKm: 5, calories: 300, avgHeartRate: 150, maxHeartRate: 171, elevationMeters: null }
  );
});

test('Google Fit: CSV parser handles quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
});

test('Google Fit: daily summary + intraday files', () => {
  const daily = '﻿Date,Move Minutes count,Calories (kcal),Distance (m),Average heart rate (bpm),Max heart rate (bpm),Min heart rate (bpm),Step count\n2026-10-03,40,2100,5200.5,72.4,140,55,7012\n2026-10-04,,,,,,,\n';
  const intraday = 'Start time,End time,Average heart rate (bpm),Step count\n08:00:00.000+05:30,08:15:00.000+05:30,100,500\n08:15:00.000+05:30,08:30:00.000+05:30,120,700\n21:00:00.000+05:30,21:15:00.000+05:30,60,\n';
  let ds = mergeGoogleFitCsv('Daily activity metrics.csv', daily);
  ds = mergeGoogleFitCsv('2026-10-04.csv', intraday, ds);

  assert.equal(ds.days['2026-10-03'].steps, 7012);
  assert.equal(ds.days['2026-10-03'].distanceKm, 5.2);
  assert.equal(ds.days['2026-10-03'].heartRateAvg, 72);
  assert.equal(ds.days['2026-10-03'].activeCalories, null, 'Takeout calories include BMR, so they are not reported as active energy');
  assert.equal(ds.days['2026-10-04'].steps, 1200);
  assert.equal(ds.heartRateHourly['2026-10-04'][8], 110);
  assert.equal(ds.heartRateHourly['2026-10-04'][21], 60);
});

test('XML entities are decoded in names', () => {
  const w = parseGpx('<gpx><trk><name>Run &amp; Ride &#8212; &lt;5k&gt;</name><trkseg><trkpt lat="1" lon="1"><time>2026-10-04T12:00:00Z</time></trkpt></trkseg></trk></gpx>');
  assert.equal(w.title, 'Run & Ride — <5k>');
});

test('haversine: 1 degree of latitude ≈ 111 km', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 10);
});

test('GPX: distance, duration, heart rate, elevation with noise filter', () => {
  const pt = (lat, ele, t, hr) =>
    `<trkpt lat="${lat}" lon="76.0"><ele>${ele}</ele><time>${t}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`;
  const gpx = `<gpx><metadata><name>meta</name></metadata><trk><name>Evening Run</name><type>running</type><trkseg>
    ${pt(10.0, 10, '2026-10-04T12:00:00Z', 120)}
    ${pt(10.005, 11, '2026-10-04T12:10:00Z', 140)}
    ${pt(10.01, 20, '2026-10-04T12:20:00Z', 160)}
    ${pt(10.015, 19, '2026-10-04T12:30:00Z', 150)}
  </trkseg></trk></gpx>`;
  const w = parseGpx(gpx);
  assert.equal(w.title, 'Evening Run');
  assert.equal(w.type, 'Running');
  assert.equal(w.durationMinutes, 30);
  assert.equal(w.distanceKm, 1.67);
  assert.equal(w.avgHeartRate, 143);
  assert.equal(w.maxHeartRate, 160);
  assert.equal(w.elevationMeters, 10);
});

test('TCX: uses device distance and lap calories', () => {
  const tp = (t, d, hr) => `<Trackpoint><Time>${t}</Time><DistanceMeters>${d}</DistanceMeters><HeartRateBpm><Value>${hr}</Value></HeartRateBpm></Trackpoint>`;
  const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap><TotalTimeSeconds>3600</TotalTimeSeconds><Calories>500</Calories><Track>
    ${tp('2026-10-04T06:00:00Z', 0, 110)}${tp('2026-10-04T07:00:00Z', 25000, 150)}
  </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const w = parseTcx(tcx);
  assert.equal(w.type, 'Biking');
  assert.equal(w.distanceKm, 25);
  assert.equal(w.durationMinutes, 60);
  assert.equal(w.calories, 500);
  assert.equal(w.avgHeartRate, 130);
});

test('BLE: decodes 8-bit and 16-bit heart rate with RR intervals', () => {
  const u8 = new DataView(Uint8Array.from([0x00, 72]).buffer);
  assert.deepEqual(parseHeartRateMeasurement(u8), { heartRate: 72, rrIntervalsMs: [] });

  // flags: 16-bit HR + energy expended + RR present
  const bytes = Uint8Array.from([0x19, 0x2c, 0x01, 0x10, 0x00, 0x00, 0x04, 0x00, 0x02]);
  assert.deepEqual(parseHeartRateMeasurement(new DataView(bytes.buffer)), { heartRate: 300, rrIntervalsMs: [1000, 500] });
});

test('rmssd', () => {
  assert.equal(rmssd([800, 810]), null);
  assert.equal(rmssd([800, 820, 800, 820, 800, 820, 800, 820, 800, 820]), 20);
});

test('Strava activity mapping', () => {
  const w = mapStravaActivity({ id: 1, name: 'Lunch Ride', sport_type: 'MountainBikeRide', start_date: '2026-10-04T06:00:00Z', moving_time: 3600, distance: 20000, average_heartrate: 140.6, total_elevation_gain: 300.4 });
  assert.equal(w.type, 'Mountain Bike Ride');
  assert.equal(w.durationMinutes, 60);
  assert.equal(w.distanceKm, 20);
  assert.equal(w.avgHeartRate, 141);
  assert.equal(w.maxHeartRate, null);
  assert.equal(w.elevationMeters, 300);
});

test('snapshot never invents values', () => {
  const ds = emptyDataset('x', 'X');
  ds.days['2026-10-04'] = Object.assign(emptyDay(), { steps: 100 });
  const s = buildSnapshot(ds);
  assert.equal(s.activity.steps, 100);
  assert.equal(s.vitals.heartRate, null);
  assert.equal(s.vitals.hrv, null);
  assert.equal(s.sleep, null);
  assert.equal(computeRecoveryReadiness(s), null);
});

test('recovery uses personal baseline and only available signals', () => {
  const ds = emptyDataset('x', 'X');
  for (let i = 1; i <= 5; i++) ds.days[`2026-10-0${i}`] = Object.assign(emptyDay(), { hrv: 50, restingHeartRate: 60 });
  ds.days['2026-10-06'] = Object.assign(emptyDay(), { hrv: 60, restingHeartRate: 58 });
  const r = computeRecoveryReadiness(buildSnapshot(ds));
  assert.deepEqual(r.basedOn, ['hrv', 'rhr']);
  assert.ok(r.score >= 75, `HRV above and RHR below baseline should read as recovered, got ${r.score}`);
});

test('demo dataset is complete and chartable', () => {
  const ds = generateDemoDataset(new Date('2026-10-05T10:00:00Z'));
  assert.equal(Object.keys(ds.days).length, 14);
  assert.equal(chartSeries(ds, 'heartRate').length, 24);
  assert.equal(chartSeries(ds, 'sleep').length, 14);
  assert.ok(computeRecoveryReadiness(buildSnapshot(ds)));
});
