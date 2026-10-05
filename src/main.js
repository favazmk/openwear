/**
 * OpenWear - dashboard
 */

import './style.css';
import { DemoAdapter } from './adapters/demoAdapter.js';
import { AppleHealthAdapter } from './adapters/appleHealthAdapter.js';
import { GoogleFitAdapter } from './adapters/googleFitAdapter.js';
import { StravaAdapter } from './adapters/stravaAdapter.js';
import { ActivityFilesAdapter } from './adapters/activityFilesAdapter.js';
import { BLEWatchAdapter } from './adapters/bleWatchAdapter.js';
import { WatchExplorerAdapter } from './adapters/watchExplorerAdapter.js';
import { computeRecoveryReadiness, chartSeries } from './schema/telemetrySchema.js';
import { TelemetryCoach } from './ai/telemetryCoach.js';
import * as storage from './lib/storage.js';

const REPO = 'https://github.com/favazmk/openwear';

const adapters = {
  demo: new DemoAdapter(),
  apple_health: new AppleHealthAdapter(),
  google_fit: new GoogleFitAdapter(),
  strava: new StravaAdapter(),
  activity_files: new ActivityFilesAdapter(),
  generic_ble: new BLEWatchAdapter(),
  watch_explorer: new WatchExplorerAdapter()
};

const coach = new TelemetryCoach();

let activeProvider = 'demo';
let snapshot = null;
let recovery = null;
let chartMetric = 'heartRate';

const $ = (sel) => document.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Escape first, then apply a tiny safe subset of markdown. */
function formatMarkdown(text) {
  return escapeHtml(text)
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const show = (v, digits) => (v == null ? '—' : typeof v === 'number' && digits != null ? v.toFixed(digits) : v.toLocaleString());

function setStatus(msg, kind = 'info') {
  const el = $('#status');
  el.textContent = msg || '';
  el.dataset.kind = kind;
  el.hidden = !msg;
}

async function run(task) {
  try {
    setStatus('');
    await task();
  } catch (err) {
    if (err?.name === 'NotFoundError') return setStatus('No device selected.', 'info');
    console.error(err);
    setStatus(err.message || String(err), 'error');
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function initApp() {
  renderShell();
  setupEvents();

  for (const a of Object.values(adapters)) a.subscribe(() => a.providerId === activeProvider && refresh());

  const remembered = storage.load('ui:active');
  const firstWithData = Object.keys(adapters).find((k) => k !== 'demo' && adapters[k].hasData);
  activeProvider = remembered && adapters[remembered]?.hasData ? remembered : firstWithData || 'demo';

  await run(async () => {
    if (await adapters.strava.handleRedirect()) {
      activeProvider = 'strava';
      setStatus('Strava connected. Syncing activities…');
      await adapters.strava.sync();
      setStatus('Strava activities synced.', 'success');
    }
  });

  selectProvider(activeProvider);
}

function selectProvider(id) {
  activeProvider = id;
  if (id !== 'demo' && adapters[id].hasData) storage.save('ui:active', id);
  document.querySelectorAll('.device-chip').forEach((c) => c.classList.toggle('active', c.dataset.provider === id));
  renderSourcePanel();
  refresh();
}

function refresh() {
  const adapter = adapters[activeProvider];
  snapshot = adapter.getSnapshot();
  recovery = computeRecoveryReadiness(snapshot);
  document.querySelectorAll('.device-chip').forEach((c) => c.classList.toggle('has-data', adapters[c.dataset.provider].hasData));
  updateVitals();
  renderWorkouts(snapshot.recentWorkouts);
  drawChart();
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const CHIPS = [
  ['demo', '🧪 Demo data'],
  ['apple_health', '🍎 Apple Health'],
  ['google_fit', '🟢 Google Fit'],
  ['strava', '⚡ Strava'],
  ['activity_files', '📁 Garmin & GPX/TCX'],
  ['generic_ble', '⌚ Bluetooth HR'],
  ['watch_explorer', '🔬 boAt / budget watch explorer']
];

function renderShell() {
  $('#app').innerHTML = `
    <header class="app-header">
      <div class="header-container">
        <a href="#" class="brand-wrapper">
          <div class="brand-icon">⚡</div>
          <div class="brand-info"><h1>OpenWear <span class="brand-badge">v0.2</span></h1></div>
        </a>
        <div class="header-actions">
          <button id="btn-export" class="btn btn-secondary">Export data</button>
          <a href="${REPO}" target="_blank" class="btn btn-outline" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </header>

    <main class="app-main">
      <section class="devices-bar" aria-label="Data sources">
        ${CHIPS.map(([id, label]) => `<button class="device-chip" data-provider="${id}"><span class="pulse-dot"></span><span>${label}</span></button>`).join('')}
      </section>

      <p id="status" class="notice" role="status" hidden></p>
      <section id="source-panel" class="panel-card source-panel" aria-live="polite"></section>

      <section class="vitals-grid">
        ${vitalCard('Heart rate', '❤️', 'rose', 'val-heart-rate', 'bpm', '<span>Resting: <strong id="val-rhr">—</strong> bpm</span><span id="val-hr-range"></span>')}
        ${vitalCard('HRV', '📈', 'cyan', 'val-hrv', 'ms', '<span id="val-hrv-method"></span><span id="val-hrv-delta"></span>')}
        ${vitalCard('Blood oxygen', '🫁', 'emerald', 'val-spo2', '%', '<span>SpO₂</span><span id="val-spo2-note"></span>')}
        ${vitalCard('Steps', '👟', 'violet', 'val-steps', '/ 10k', '<span>Distance: <strong id="val-distance">—</strong> km</span><span><strong id="val-calories">—</strong> kcal</span>')}
      </section>

      <section class="content-grid">
        <article class="panel-card">
          <div class="panel-header">
            <h2><span>📊</span> Trends</h2>
            <div class="chart-controls">
              <button class="chart-tab active" data-metric="heartRate">Heart rate</button>
              <button class="chart-tab" data-metric="steps">Steps (14 days)</button>
              <button class="chart-tab" data-metric="sleep">Sleep (14 nights)</button>
            </div>
          </div>
          <div class="chart-canvas-container"><canvas id="telemetry-chart" role="img" aria-label="Trend chart"></canvas></div>
          <div style="margin-top: 1.5rem;">
            <h3 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.75rem;">Recent workouts</h3>
            <div id="workouts-list"></div>
          </div>
        </article>

        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <article class="panel-card">
            <div class="panel-header">
              <h2><span>⚡</span> Readiness</h2>
              <span id="recovery-badge" class="brand-badge">—</span>
            </div>
            <div class="recovery-container">
              <div class="gauge-circle">
                <svg viewBox="0 0 160 160"><circle class="gauge-bg" cx="80" cy="80" r="70" /><circle id="gauge-fill-ring" class="gauge-fill" cx="80" cy="80" r="70" /></svg>
                <div class="gauge-center-text"><span id="recovery-score" class="gauge-score">—</span><span class="gauge-label">Readiness</span></div>
              </div>
              <p id="recovery-advisory" class="recovery-advisory"></p>
            </div>
          </article>

          <article class="coach-chat">
            <div class="coach-header">
              <div class="coach-header-title"><span>🤖</span> Coach</div>
              <span id="coach-mode" class="ai-pulse-pill"></span>
            </div>
            <details class="ai-settings">
              <summary>AI settings</summary>
              <form id="ai-form">
                <label>OpenAI API key <input id="ai-key" class="coach-input" type="password" autocomplete="off" placeholder="sk-…" /></label>
                <label>Model <input id="ai-model" class="coach-input" type="text" autocomplete="off" /></label>
                <p class="muted">Stored only in this browser. When set, your summary metrics are sent to OpenAI with each question.</p>
                <button class="btn btn-secondary" type="submit">Save</button>
              </form>
            </details>
            <div id="coach-messages" class="coach-messages">
              <div class="chat-bubble coach">Ask about readiness, sleep or heart rate. Answers use only the data from the selected source.</div>
            </div>
            <div class="prompt-suggestions">
              <button class="prompt-pill" data-prompt="Am I ready to train hard today?">⚡ Readiness</button>
              <button class="prompt-pill" data-prompt="How was my sleep?">🌙 Sleep</button>
              <button class="prompt-pill" data-prompt="Summarize my heart rate and HRV">❤️ Heart</button>
            </div>
            <form id="coach-form" class="coach-input-bar">
              <input id="coach-input" class="coach-input" type="text" placeholder="Ask about your data…" autocomplete="off" aria-label="Question for the coach" />
              <button type="submit" class="btn btn-primary" style="padding: 0.6rem 0.9rem;">Send</button>
            </form>
          </article>
        </div>
      </section>
    </main>

    <footer class="app-footer">
      <div class="footer-container">
        <div><strong>OpenWear</strong> — local-first, open-source wearable data hub (MIT). Not a medical device.</div>
        <div class="footer-links">
          <a href="${REPO}" target="_blank" rel="noreferrer">GitHub</a>
          <a href="${REPO}/issues/new?labels=device-report&title=Device%20report%3A%20" target="_blank" rel="noreferrer">Submit a device report</a>
          <a href="#" id="btn-clear-all">Clear all local data</a>
        </div>
      </div>
    </footer>
  `;
  renderCoachMode();
}

function vitalCard(title, icon, accent, id, unit, footer) {
  return `
    <article class="vital-card">
      <div class="vital-header">
        <span class="vital-title">${title}</span>
        <div class="vital-icon-box" style="background: var(--accent-${accent}-glow, rgba(255,255,255,0.06)); color: var(--accent-${accent});"><span>${icon}</span></div>
      </div>
      <div class="vital-body"><span id="${id}" class="vital-value">—</span><span class="vital-unit">${unit}</span></div>
      <div class="vital-footer">${footer}</div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Source panel: per-provider import / connect controls
// ---------------------------------------------------------------------------

function renderSourcePanel() {
  const panel = $('#source-panel');
  const a = adapters[activeProvider];
  const meta = a.dataset?.importedAt && activeProvider !== 'demo' ? `<p class="muted">Last updated ${new Date(a.dataset.importedAt).toLocaleString()} · ${escapeHtml(a.dataset.deviceName)}</p>` : '';
  const clearBtn = a.hasData && a.persist ? '<button class="btn btn-outline" data-action="clear">Remove this data</button>' : '';

  const views = {
    demo: () => `
      <h2>🧪 Demo data</h2>
      <p>You're looking at <strong>synthetic sample data</strong>. Pick a source above to load your own. Everything stays in this browser.</p>`,

    apple_health: () => `
      <h2>🍎 Apple Health</h2>
      <ol class="steps">
        <li>On iPhone: Health → profile picture → <em>Export All Health Data</em>.</li>
        <li>Unzip <code>export.zip</code> and choose <code>apple_health_export/export.xml</code>.</li>
      </ol>
      <p class="muted">Parsed in your browser, streaming, so multi-GB exports work. Steps, distance, energy, heart rate, resting HR, HRV (SDNN), SpO₂, sleep stages and workouts.</p>
      <div class="row">
        <label class="btn btn-primary file-btn">Choose export.xml<input type="file" accept=".xml" data-action="apple-file" hidden /></label>
        ${clearBtn}
      </div>
      <progress id="import-progress" max="1" value="0" hidden></progress>
      ${meta}`,

    google_fit: () => `
      <h2>🟢 Google Fit</h2>
      <ol class="steps">
        <li>Go to <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a>, select only <em>Fit</em>, and export.</li>
        <li>Open <code>Takeout/Fit/Daily activity metrics/</code> and select all the <code>.csv</code> files.</li>
      </ol>
      <p class="muted">Google's Fit API is closed to new apps and Health Connect has no web API, so Takeout is the route. Steps, distance and heart rate (daily and per hour).</p>
      <div class="row">
        <label class="btn btn-primary file-btn">Choose CSV files<input type="file" accept=".csv" multiple data-action="google-files" hidden /></label>
        ${clearBtn}
      </div>
      ${meta}`,

    strava: () => {
      const s = adapters.strava;
      if (!s.app) {
        return `
          <h2>⚡ Strava</h2>
          <ol class="steps">
            <li>Create a free API app at <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">strava.com/settings/api</a>.</li>
            <li>Set <em>Authorization Callback Domain</em> to <code>${escapeHtml(location.hostname)}</code>.</li>
            <li>Paste the app's Client ID and Client Secret below. They stay in this browser.</li>
          </ol>
          <form id="strava-form" class="row">
            <input name="clientId" class="coach-input" placeholder="Client ID" inputmode="numeric" required aria-label="Strava Client ID" />
            <input name="clientSecret" class="coach-input" type="password" placeholder="Client Secret" required aria-label="Strava Client Secret" />
            <button class="btn btn-primary" type="submit">Save</button>
          </form>`;
      }
      if (!s.isAuthorized) {
        return `
          <h2>⚡ Strava</h2>
          <p>API app saved. Connect your account to import your last 200 activities.</p>
          <div class="row">
            <button class="btn btn-primary" data-action="strava-connect">Connect with Strava</button>
            <button class="btn btn-outline" data-action="strava-reset">Change API app</button>
          </div>`;
      }
      return `
        <h2>⚡ Strava</h2>
        <div class="row">
          <button class="btn btn-primary" data-action="strava-sync">Sync activities</button>
          <button class="btn btn-outline" data-action="strava-disconnect">Disconnect</button>
        </div>
        ${meta}`;
    },

    activity_files: () => `
      <h2>📁 Garmin, Coros, Polar, Suunto, Zepp (GPX / TCX)</h2>
      <p>Export workouts as <code>.gpx</code> or <code>.tcx</code> (in Garmin Connect: open an activity → ⚙ → <em>Export to TCX</em>) and add them here. Duration, distance, elevation and heart rate are computed from the track.</p>
      <div class="row">
        <label class="btn btn-primary file-btn">Add GPX/TCX files<input type="file" accept=".gpx,.tcx" multiple data-action="activity-files" hidden /></label>
        ${clearBtn}
      </div>
      ${meta}`,

    generic_ble: () => {
      const b = adapters.generic_ble;
      return `
        <h2>⌚ Bluetooth heart rate</h2>
        <p>Live heart rate from any device with the standard Bluetooth Heart Rate service: chest straps, Polar/Coros/Amazfit watches in HR broadcast mode, PineTime. Live HRV (RMSSD) is shown when the device sends RR intervals.</p>
        ${b.isSupported() ? '' : '<p class="notice" data-kind="error">This browser has no Web Bluetooth. Use Chrome, Edge or Opera on desktop or Android.</p>'}
        <div class="row">
          ${b.isConnected
            ? `<span>Connected to <strong>${escapeHtml(b.dataset?.deviceName)}</strong>${b.batteryLevel != null ? ` · battery ${b.batteryLevel}%` : ''}</span><button class="btn btn-outline" data-action="ble-disconnect">Disconnect</button>`
            : `<button class="btn btn-primary" data-action="ble-connect" ${b.isSupported() ? '' : 'disabled'}>Pair device</button>`}
        </div>`;
    },

    watch_explorer: () => {
      const x = adapters.watch_explorer;
      const r = x.report;
      return `
        <h2>🔬 boAt / budget watch explorer</h2>
        <p>Most budget watches (boAt, Noise, Fire-Boltt…) use undocumented Bluetooth protocols. This tool lists what your watch exposes and records its messages, read-only, so we can write decoders. <strong>Disconnect the watch from its phone app first</strong> — most only accept one connection.</p>
        <div class="row">
          <label>Listen for <input id="explore-seconds" class="coach-input small" type="number" min="5" max="120" value="20" /> s</label>
          <input id="explore-uuids" class="coach-input" placeholder="Extra service UUIDs (optional, comma-separated)" aria-label="Extra service UUIDs" />
          <button class="btn btn-primary" data-action="explore" ${'bluetooth' in navigator ? '' : 'disabled'}>Scan a watch</button>
        </div>
        <pre id="explore-log" class="log-box" ${r ? '' : 'hidden'}></pre>
        ${r ? `
          <p><strong>${escapeHtml(r.device.name || 'Unnamed device')}</strong>: ${r.services.length} services, ${r.notifications.length} messages captured${r.batteryLevel != null ? `, battery ${r.batteryLevel}%` : ''}.
          ${x.supportsStandardHeartRate ? 'It has the standard Heart Rate service, so <strong>Bluetooth HR</strong> works with it.' : ''}</p>
          <div class="row">
            <button class="btn btn-secondary" data-action="explore-download">Download device report (.json)</button>
            <a class="btn btn-outline" target="_blank" rel="noreferrer" href="${REPO}/issues/new?labels=device-report&title=${encodeURIComponent(`Device report: ${r.device.name || 'unknown'}`)}">Open an issue and attach it</a>
          </div>` : ''}`;
    }
  };

  panel.innerHTML = views[activeProvider]();
  if (activeProvider === 'watch_explorer' && x_log.length) $('#explore-log').textContent = x_log.join('\n');
}

let x_log = [];

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function setupEvents() {
  document.querySelectorAll('.device-chip').forEach((chip) => chip.addEventListener('click', () => selectProvider(chip.dataset.provider)));

  document.querySelectorAll('.chart-tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      chartMetric = tab.dataset.metric;
      drawChart();
    })
  );

  const panel = $('#source-panel');

  panel.addEventListener('change', (e) => {
    const action = e.target.dataset.action;
    const files = e.target.files;
    if (!files?.length) return;
    run(async () => {
      if (action === 'apple-file') {
        const bar = $('#import-progress');
        bar.hidden = false;
        setStatus(`Reading ${files[0].name}…`);
        const ds = await adapters.apple_health.importFile(files[0], (p) => (bar.value = p));
        setStatus(`Imported ${plural(ds.recordCount, 'record')} across ${plural(Object.keys(ds.days).length, 'day')} and ${plural(ds.workouts.length, 'workout')}.`, 'success');
      } else if (action === 'google-files') {
        const ds = await adapters.google_fit.importFiles(files);
        setStatus(`Imported ${plural(Object.keys(ds.days).length, 'day')} from Google Fit.`, 'success');
      } else if (action === 'activity-files') {
        const { dataset, errors } = await adapters.activity_files.importFiles(files);
        setStatus(errors.length ? `Imported with problems — ${errors.join('; ')}` : `${plural(dataset.workouts.length, 'workout')} loaded.`, errors.length ? 'error' : 'success');
      }
      renderSourcePanel();
    });
  });

  panel.addEventListener('submit', (e) => {
    if (e.target.id !== 'strava-form') return;
    e.preventDefault();
    const f = new FormData(e.target);
    run(async () => {
      adapters.strava.saveApp(f.get('clientId'), f.get('clientSecret'));
      renderSourcePanel();
    });
  });

  panel.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action || e.target.type === 'file') return;
    run(async () => {
      switch (action) {
        case 'clear':
          adapters[activeProvider].clear();
          break;
        case 'strava-connect':
          adapters.strava.beginAuth();
          return;
        case 'strava-reset':
          storage.remove('strava:app');
          break;
        case 'strava-sync': {
          setStatus('Syncing Strava…');
          const ds = await adapters.strava.sync();
          setStatus(`${ds.workouts.length} Strava activities synced.`, 'success');
          break;
        }
        case 'strava-disconnect':
          adapters.strava.disconnect();
          break;
        case 'ble-connect': {
          const { deviceName } = await adapters.generic_ble.connect();
          setStatus(`Streaming heart rate from ${deviceName || 'device'}.`, 'success');
          break;
        }
        case 'ble-disconnect':
          await adapters.generic_ble.disconnect();
          break;
        case 'explore': {
          x_log = [];
          const log = $('#explore-log');
          log.hidden = false;
          const onLog = (m) => {
            x_log.push(m);
            log.textContent = x_log.join('\n');
          };
          await adapters.watch_explorer.explore({
            listenSeconds: Math.min(120, Math.max(5, +$('#explore-seconds').value || 20)),
            extraUuids: $('#explore-uuids').value.split(','),
            onLog
          });
          break;
        }
        case 'explore-download': {
          const r = adapters.watch_explorer.report;
          download(`openwear-device-report-${(r.device.name || 'unknown').replace(/\W+/g, '-')}.json`, r);
          return;
        }
      }
      renderSourcePanel();
      refresh();
    });
  });

  adapters.generic_ble.subscribe(({ data }) => {
    if (data?.disconnected && activeProvider === 'generic_ble') renderSourcePanel();
  });

  $('#btn-export').addEventListener('click', () => {
    const a = adapters[activeProvider];
    if (!a.dataset) return setStatus('Nothing to export for this source yet.');
    download(`openwear-export-${activeProvider}.json`, a.dataset);
  });

  $('#btn-clear-all').addEventListener('click', (e) => {
    e.preventDefault();
    if (!confirm('Remove all imported data, Strava tokens and AI settings from this browser?')) return;
    for (const a of Object.values(adapters)) if (a.persist) a.clear();
    ['strava:app', 'strava:tokens', 'ai', 'ui:active'].forEach(storage.remove);
    selectProvider('demo');
    renderCoachMode();
    setStatus('All local data removed.', 'success');
  });

  // AI settings
  const s = coach.settings;
  $('#ai-key').value = s.apiKey;
  $('#ai-model').value = s.model;
  $('#ai-form').addEventListener('submit', (e) => {
    e.preventDefault();
    coach.saveSettings({ apiKey: $('#ai-key').value, model: $('#ai-model').value });
    renderCoachMode();
    e.target.closest('details').open = false;
  });

  // Coach chat
  const form = $('#coach-form');
  const input = $('#coach-input');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    appendChat(q, 'user');
    input.value = '';
    const bubble = appendChat('Thinking…', 'coach');
    const { text, error } = await coach.askCoach(q, snapshot, recovery);
    bubble.innerHTML = formatMarkdown(error ? `${error}. Showing the rule-based answer instead.\n\n${text}` : text);
    $('#coach-messages').scrollTop = $('#coach-messages').scrollHeight;
  });
  document.querySelectorAll('.prompt-pill').forEach((p) =>
    p.addEventListener('click', () => {
      input.value = p.dataset.prompt;
      form.requestSubmit();
    })
  );

  window.addEventListener('resize', drawChart);
}

function renderCoachMode() {
  const s = coach.settings;
  $('#coach-mode').textContent = s.apiKey ? `OpenAI · ${s.model}` : 'Rule-based';
}

function appendChat(text, sender) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${sender}`;
  div.innerHTML = sender === 'user' ? escapeHtml(text) : formatMarkdown(text);
  $('#coach-messages').appendChild(div);
  $('#coach-messages').scrollTop = $('#coach-messages').scrollHeight;
  return div;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function updateVitals() {
  const { vitals: v, activity } = snapshot;
  const set = (id, val) => ($(id).textContent = val);

  set('#val-heart-rate', show(v.heartRate));
  set('#val-rhr', show(v.restingHeartRate));
  const day = adapters[activeProvider].dataset?.days?.[snapshot.dayKey];
  set('#val-hr-range', day?.heartRateMin != null ? `${day.heartRateMin}–${day.heartRateMax} bpm` : '');

  set('#val-hrv', show(v.hrv));
  set('#val-hrv-method', v.hrvMethod ? `Method: ${v.hrvMethod}` : '');
  set('#val-hrv-delta', v.hrv != null && v.hrvBaseline ? `${v.hrv >= v.hrvBaseline ? '+' : ''}${Math.round(v.hrv - v.hrvBaseline)} ms vs 14-day avg` : '');

  set('#val-spo2', show(v.spo2));
  set('#val-spo2-note', v.spo2 == null ? '' : v.spo2 >= 95 ? 'Typical range' : 'Below 95%');

  set('#val-steps', show(activity.steps));
  set('#val-distance', show(activity.distanceKm));
  set('#val-calories', show(activity.activeCalories));

  const ring = $('#gauge-fill-ring');
  if (recovery) {
    set('#recovery-score', recovery.score);
    $('#recovery-badge').textContent = recovery.status;
    $('#recovery-badge').style.color = recovery.color;
    set('#recovery-advisory', `${recovery.advisory} Based on: ${recovery.basedOn.join(', ')}.`);
    ring.style.strokeDashoffset = 440 - (440 * recovery.score) / 100;
    ring.style.stroke = recovery.color;
  } else {
    set('#recovery-score', '—');
    $('#recovery-badge').textContent = 'No data';
    $('#recovery-badge').style.color = '';
    set('#recovery-advisory', 'Needs HRV, resting heart rate or sleep from this source.');
    ring.style.strokeDashoffset = 440;
  }

  document.title = `OpenWear — ${snapshot.deviceName}`;
}

function renderWorkouts(workouts) {
  const box = $('#workouts-list');
  if (!workouts?.length) {
    box.innerHTML = '<p class="muted">No workouts from this source.</p>';
    return;
  }
  box.innerHTML = workouts
    .map((w) => {
      const stats = [
        w.durationMinutes != null && `${w.durationMinutes} min`,
        w.distanceKm != null && `${w.distanceKm} km`,
        w.avgHeartRate != null && `avg ${w.avgHeartRate} bpm`,
        w.elevationMeters && `↑${w.elevationMeters} m`
      ].filter(Boolean);
      return `
        <div class="workout-item">
          <div class="workout-left">
            <div class="workout-icon">${workoutIcon(w.type)}</div>
            <div class="workout-meta">
              <h4>${escapeHtml(w.title)}</h4>
              <span>${escapeHtml(new Date(w.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} • ${escapeHtml(w.type)}</span>
            </div>
          </div>
          <div class="workout-stats">
            <div>${w.calories != null ? `<strong>${w.calories}</strong> kcal` : ''}</div>
            <span style="color: var(--text-muted); font-size: 0.75rem;">${escapeHtml(stats.join(' • '))}</span>
          </div>
        </div>`;
    })
    .join('');
}

function workoutIcon(type = '') {
  if (/run/i.test(type)) return '🏃';
  if (/ride|cycl|bik/i.test(type)) return '🚴';
  if (/swim/i.test(type)) return '🏊';
  if (/walk|hike/i.test(type)) return '🚶';
  if (/strength|weight/i.test(type)) return '🏋️';
  return '⚡';
}

function drawChart() {
  const canvas = $('#telemetry-chart');
  if (!canvas || !snapshot) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const { width: w, height: h } = canvas.getBoundingClientRect();
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const adapter = adapters[activeProvider];
  const live = activeProvider === 'generic_ble' ? adapter.live : [];
  const points = adapter.dataset ? chartSeries(adapter.dataset, chartMetric, live) : [];
  const color = { heartRate: '#f43f5e', steps: '#8b5cf6', sleep: '#10b981' }[chartMetric];
  const fmtVal = chartMetric === 'sleep' ? (v) => `${(v / 60).toFixed(1)}h` : (v) => Math.round(v).toLocaleString();

  ctx.font = '12px "JetBrains Mono", monospace';
  if (points.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText(points.length ? `${fmtVal(points[0].value)} (${points[0].label})` : 'No data for this metric from this source', w / 2, h / 2);
    ctx.textAlign = 'start';
    return;
  }

  const left = 56;
  const right = 16;
  const top = 16;
  const bottom = 30;
  const vals = points.map((p) => p.value);
  const min = chartMetric === 'heartRate' ? Math.min(...vals) * 0.95 : 0;
  const max = Math.max(...vals) * 1.05 || 1;
  const x = (i) => left + (i * (w - left - right)) / (points.length - 1);
  const y = (v) => h - bottom - ((v - min) / (max - min || 1)) * (h - top - bottom);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.fillStyle = '#64748b';
  for (let k = 0; k <= 3; k++) {
    const v = min + ((max - min) * k) / 3;
    ctx.beginPath();
    ctx.moveTo(left, y(v));
    ctx.lineTo(w - right, y(v));
    ctx.stroke();
    ctx.fillText(fmtVal(v), 4, y(v) + 4);
  }

  const grad = ctx.createLinearGradient(0, top, 0, h - bottom);
  grad.addColorStop(0, `${color}44`);
  grad.addColorStop(1, `${color}00`);
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.lineTo(x(points.length - 1), h - bottom);
  ctx.lineTo(x(0), h - bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const every = Math.ceil(points.length / 8);
  ctx.fillStyle = '#64748b';
  points.forEach((p, i) => {
    if (i % every && i !== points.length - 1) return;
    ctx.fillText(p.label, x(i) - 14, h - 10);
  });
}

initApp();
