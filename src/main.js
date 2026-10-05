/**
 * OpenWear - Universal Smartwatch & Health Telemetry Hub
 * Main Application Orchestrator
 */

import './style.css';
import { AppleHealthAdapter } from './adapters/appleHealthAdapter.js';
import { GoogleFitAdapter } from './adapters/googleFitAdapter.js';
import { StravaAdapter } from './adapters/stravaAdapter.js';
import { BoatWatchAdapter } from './adapters/boatWatchAdapter.js';
import { BLEWatchAdapter } from './adapters/bleWatchAdapter.js';
import { computeRecoveryReadiness } from './schema/telemetrySchema.js';
import { TelemetryCoach } from './ai/telemetryCoach.js';

// Initialize Adapters
const adapters = {
  apple_health: new AppleHealthAdapter(),
  google_fit: new GoogleFitAdapter(),
  strava: new StravaAdapter(),
  boat_watch: new BoatWatchAdapter(),
  generic_ble: new BLEWatchAdapter()
};

const coach = new TelemetryCoach();

// Global App State
let activeProvider = 'generic_ble';
let currentTelemetry = null;
let currentRecovery = null;
let activeChartMetric = 'heartRate'; // 'heartRate', 'steps', 'sleep'
let liveInterval = null;

// Initial state bootstrap
async function initApp() {
  // Connect default boAt / BLE adapter
  await adapters.generic_ble.connect(true);
  await adapters.apple_health.connect();
  await adapters.strava.connect();
  await adapters.googleFitAdapter?.connect?.();

  // Load telemetry
  await switchProvider('generic_ble');

  renderApp();
  setupEvents();
  startLiveHeartRateSimulation();
}

/**
 * Switch active wearable source
 */
async function switchProvider(providerId) {
  activeProvider = providerId;
  const adapter = adapters[providerId] || adapters.generic_ble;

  currentTelemetry = await adapter.fetchTelemetry();
  currentRecovery = computeRecoveryReadiness(currentTelemetry.vitals, currentTelemetry.sleep);

  updateUI();
}

/**
 * Render Complete UI Skeleton
 */
function renderApp() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <!-- Application Header -->
    <header class="app-header">
      <div class="header-container">
        <a href="#" class="brand-wrapper">
          <div class="brand-icon">⚡</div>
          <div class="brand-info">
            <h1>OpenWear <span class="brand-badge">OSS v1.0</span></h1>
          </div>
        </a>

        <div class="header-actions">
          <button id="btn-pair-ble" class="btn btn-primary" title="Pair physical Bluetooth smartwatch">
            <span>⌚</span> Pair Smartwatch (BLE)
          </button>
          <button id="btn-sync-all" class="btn btn-secondary">
            <span>🔄</span> Sync Providers
          </button>
          <a href="https://github.com/favazmk/boat-watch" target="_blank" class="btn btn-outline" rel="noreferrer">
            <span>⭐</span> GitHub OSS
          </a>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="app-main">
      
      <!-- Wearables Device Selection Bar -->
      <section class="devices-bar" aria-label="Connected Wearable Providers">
        <button class="device-chip active" data-provider="generic_ble">
          <span class="pulse-dot"></span>
          <span>⌚ boAt / BLE Smartwatch</span>
        </button>
        <button class="device-chip" data-provider="apple_health">
          <span class="pulse-dot"></span>
          <span>🍎 Apple Health / Watch</span>
        </button>
        <button class="device-chip" data-provider="strava">
          <span class="pulse-dot"></span>
          <span>⚡ Strava Club Sync</span>
        </button>
        <button class="device-chip" data-provider="google_fit">
          <span class="pulse-dot"></span>
          <span>🟢 Google Fit / Health Connect</span>
        </button>
        <button class="device-chip" data-provider="boat_watch">
          <span class="pulse-dot"></span>
          <span>🚤 boAt Wave Crest OS</span>
        </button>
      </section>

      <!-- Key Biometric Vitals Grid -->
      <section class="vitals-grid">
        <!-- Heart Rate -->
        <article class="vital-card">
          <div class="vital-header">
            <span class="vital-title">Heart Rate</span>
            <div class="vital-icon-box" style="background: rgba(244, 63, 94, 0.15); color: var(--accent-rose);">
              <span class="heart-beat">❤️</span>
            </div>
          </div>
          <div class="vital-body">
            <span id="val-heart-rate" class="vital-value">72</span>
            <span class="vital-unit">BPM</span>
          </div>
          <div class="vital-footer">
            <span>Resting: <strong id="val-rhr">61</strong> bpm</span>
            <span style="color: var(--accent-emerald);">● Live Stream</span>
          </div>
        </article>

        <!-- HRV (Autonomic Resilience) -->
        <article class="vital-card">
          <div class="vital-header">
            <span class="vital-title">HRV (RMSSD)</span>
            <div class="vital-icon-box" style="background: rgba(6, 182, 212, 0.15); color: var(--accent-cyan);">
              <span>📈</span>
            </div>
          </div>
          <div class="vital-body">
            <span id="val-hrv" class="vital-value">64</span>
            <span class="vital-unit">ms</span>
          </div>
          <div class="vital-footer">
            <span>Autonomic Tone: <strong style="color: var(--accent-cyan);">Optimal</strong></span>
            <span>+8ms vs avg</span>
          </div>
        </article>

        <!-- Blood Oxygen SpO2 -->
        <article class="vital-card">
          <div class="vital-header">
            <span class="vital-title">Blood Oxygen</span>
            <div class="vital-icon-box" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald);">
              <span>🫁</span>
            </div>
          </div>
          <div class="vital-body">
            <span id="val-spo2" class="vital-value">98</span>
            <span class="vital-unit">%</span>
          </div>
          <div class="vital-footer">
            <span>Arterial O2 Saturation</span>
            <span style="color: var(--accent-emerald);">Normal (95-100%)</span>
          </div>
        </article>

        <!-- Daily Steps -->
        <article class="vital-card">
          <div class="vital-header">
            <span class="vital-title">Daily Steps</span>
            <div class="vital-icon-box" style="background: rgba(139, 92, 246, 0.15); color: var(--accent-violet);">
              <span>👟</span>
            </div>
          </div>
          <div class="vital-body">
            <span id="val-steps" class="vital-value">9,140</span>
            <span class="vital-unit">/ 10k</span>
          </div>
          <div class="vital-footer">
            <span>Distance: <strong id="val-distance">6.8</strong> km</span>
            <span><strong id="val-calories">512</strong> kcal</span>
          </div>
        </article>
      </section>

      <!-- Charts & AI Recovery Row -->
      <section class="content-grid">
        <!-- Left: Telemetry Time-Series Chart -->
        <article class="panel-card">
          <div class="panel-header">
            <h2><span>📊</span> Multi-Device Telemetry Telemetry</h2>
            <div class="chart-controls">
              <button class="chart-tab active" data-metric="heartRate">Heart Rate (24h)</button>
              <button class="chart-tab" data-metric="steps">Activity Steps</button>
              <button class="chart-tab" data-metric="sleep">Sleep Architecture</button>
            </div>
          </div>

          <div class="chart-canvas-container">
            <canvas id="telemetry-chart"></canvas>
          </div>

          <!-- Recent Activity Mini-Feed -->
          <div style="margin-top: 1.5rem;">
            <h3 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.75rem;">Recent Workouts & Synced Activities</h3>
            <div id="workouts-list"></div>
          </div>
        </article>

        <!-- Right: AI Recovery & Autonomous Coach -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <!-- Recovery Ring Card -->
          <article class="panel-card">
            <div class="panel-header">
              <h2><span>⚡</span> Physiological Recovery</h2>
              <span id="recovery-badge" class="brand-badge" style="color: var(--accent-emerald);">Optimal</span>
            </div>

            <div class="recovery-container">
              <div class="gauge-circle">
                <svg viewBox="0 0 160 160">
                  <circle class="gauge-bg" cx="80" cy="80" r="70" />
                  <circle id="gauge-fill-ring" class="gauge-fill" cx="80" cy="80" r="70" />
                </svg>
                <div class="gauge-center-text">
                  <span id="recovery-score" class="gauge-score">88</span>
                  <span class="gauge-label">Readiness</span>
                </div>
              </div>

              <p id="recovery-advisory" class="recovery-advisory">
                Supercharged readiness. Your autonomic nervous system is fully primed for high-intensity exertion.
              </p>
            </div>
          </article>

          <!-- AI Telemetry Coach Chat -->
          <article class="coach-chat">
            <div class="coach-header">
              <div class="coach-header-title">
                <span>🤖</span> OpenWear AI Coach
              </div>
              <span class="ai-pulse-pill">GPT / Codex Ready</span>
            </div>

            <div id="coach-messages" class="coach-messages">
              <div class="chat-bubble coach">
                👋 Hello! I'm your <strong>OpenWear Telemetry AI</strong>. I synthesize multi-wearable biometric feeds from Apple Health, Google Fit, Strava, and your smartwatch.
                <br><br>
                Try asking me about your recovery readiness, sleep cycle analysis, or request Python analytics code!
              </div>
            </div>

            <div class="prompt-suggestions">
              <button class="prompt-pill" data-prompt="Analyze today's recovery and training readiness">⚡ Readiness Check</button>
              <button class="prompt-pill" data-prompt="Explain my deep sleep vs REM architecture">🌙 Sleep Analysis</button>
              <button class="prompt-pill" data-prompt="Generate Python pandas code for heart rate zones">💻 Export Python Code</button>
            </div>

            <form id="coach-form" class="coach-input-bar">
              <input 
                id="coach-input" 
                class="coach-input" 
                type="text" 
                placeholder="Ask about vitals, workouts, or training..." 
                autocomplete="off"
              />
              <button type="submit" class="btn btn-primary" style="padding: 0.6rem 0.9rem;">
                Send
              </button>
            </form>
          </article>
        </div>
      </section>

    </main>

    <!-- Footer -->
    <footer class="app-footer">
      <div class="footer-container">
        <div>
          <strong>OpenWear</strong> — Open Source Universal Wearable & Health Telemetry Hub (MIT Licensed).
        </div>
        <div class="footer-links">
          <a href="https://github.com/favazmk/boat-watch" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://openai.com/form/codex-for-oss/" target="_blank" rel="noreferrer">Codex for OSS</a>
          <a href="#docs">Documentation</a>
        </div>
      </div>
    </footer>
  `;
}

/**
 * Setup Event Listeners
 */
function setupEvents() {
  // Device chip switching
  document.querySelectorAll('.device-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      document.querySelectorAll('.device-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      await switchProvider(chip.dataset.provider);
    });
  });

  // Metric tab switching
  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeChartMetric = tab.dataset.metric;
      drawChart();
    });
  });

  // Web Bluetooth Pairing Button
  document.querySelector('#btn-pair-ble').addEventListener('click', async () => {
    const ble = adapters.generic_ble;
    const res = await ble.connect(false);
    alert(`Connected to: ${res.deviceName} (${res.simulated ? 'Simulated BLE Stream' : 'Physical BLE GATT'})`);
    await switchProvider('generic_ble');
  });

  // Sync All Providers Button
  document.querySelector('#btn-sync-all').addEventListener('click', async () => {
    const btn = document.querySelector('#btn-sync-all');
    btn.innerHTML = '<span>⏳</span> Syncing...';
    await new Promise(r => setTimeout(r, 600));
    await switchProvider(activeProvider);
    btn.innerHTML = '<span>✅</span> All Synced';
    setTimeout(() => {
      btn.innerHTML = '<span>🔄</span> Sync Providers';
    }, 1800);
  });

  // AI Coach Chat Form
  const form = document.querySelector('#coach-form');
  const input = document.querySelector('#coach-input');
  const messagesBox = document.querySelector('#coach-messages');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    appendChatMessage(query, 'user');
    input.value = '';

    // Typing indicator
    const typingId = appendChatMessage('OpenWear AI is analyzing telemetry streams...', 'coach');

    const response = await coach.askCoach(query, currentTelemetry, currentRecovery);
    
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.innerHTML = formatMarkdown(response);
    }
    messagesBox.scrollTop = messagesBox.scrollHeight;
  });

  // Quick Prompt Pills
  document.querySelectorAll('.prompt-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      input.value = pill.dataset.prompt;
      form.dispatchEvent(new Event('submit'));
    });
  });

  // Redraw chart on resize
  window.addEventListener('resize', drawChart);
}

function appendChatMessage(text, sender) {
  const messagesBox = document.querySelector('#coach-messages');
  const id = `msg_${Date.now()}`;
  const div = document.createElement('div');
  div.id = id;
  div.className = `chat-bubble ${sender}`;
  div.innerHTML = sender === 'user' ? escapeHtml(text) : formatMarkdown(text);
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
  return id;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMarkdown(text) {
  let html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/```python([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/\n/g, '<br>');
  return html;
}

/**
 * Update UI with Current Telemetry & Recovery
 */
function updateUI() {
  if (!currentTelemetry) return;

  const { vitals, activity, sleep, recentWorkouts } = currentTelemetry;

  document.querySelector('#val-heart-rate').textContent = vitals.heartRate;
  document.querySelector('#val-rhr').textContent = vitals.restingHeartRate;
  document.querySelector('#val-hrv').textContent = vitals.hrv;
  document.querySelector('#val-spo2').textContent = vitals.spo2;
  document.querySelector('#val-steps').textContent = activity.steps.toLocaleString();
  document.querySelector('#val-distance').textContent = activity.distanceKm;
  document.querySelector('#val-calories').textContent = activity.activeCalories;

  // Recovery Score Gauge
  if (currentRecovery) {
    document.querySelector('#recovery-score').textContent = currentRecovery.score;
    const badge = document.querySelector('#recovery-badge');
    badge.textContent = currentRecovery.status;
    badge.style.color = currentRecovery.color;

    const advisory = document.querySelector('#recovery-advisory');
    advisory.textContent = currentRecovery.advisory;

    // SVG Circle stroke-dashoffset: circumference = 2 * PI * 70 = 440
    const offset = 440 - (440 * currentRecovery.score) / 100;
    const ring = document.querySelector('#gauge-fill-ring');
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = currentRecovery.color;
  }

  // Workouts Feed
  renderWorkouts(recentWorkouts);

  // Redraw Canvas Chart
  drawChart();
}

function renderWorkouts(workouts) {
  const container = document.querySelector('#workouts-list');
  if (!workouts || workouts.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No recent activities logged today.</p>`;
    return;
  }

  container.innerHTML = workouts.map(w => `
    <div class="workout-item">
      <div class="workout-left">
        <div class="workout-icon">${getWorkoutIcon(w.type)}</div>
        <div class="workout-meta">
          <h4>${w.title}</h4>
          <span>${w.time} • ${w.type}</span>
        </div>
      </div>
      <div class="workout-stats">
        <div><strong>${w.calories}</strong> kcal</div>
        <span style="color: var(--text-muted); font-size: 0.75rem;">${w.durationMinutes} min • Avg ${w.avgHeartRate} bpm</span>
      </div>
    </div>
  `).join('');
}

function getWorkoutIcon(type) {
  if (type.includes('Run')) return '🏃';
  if (type.includes('Cycle')) return '🚴';
  if (type.includes('Swim')) return '🏊';
  if (type.includes('Cardio') || type.includes('HIIT')) return '⚡';
  return '👟';
}

/**
 * High-Precision Telemetry Time-Series Canvas Chart
 */
function drawChart() {
  const canvas = document.querySelector('#telemetry-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  // Generate 24 hourly data points based on metric
  const points = [];
  const count = 24;

  let baseVal = 70;
  let color = '#06b6d4';
  let unit = 'BPM';

  if (activeChartMetric === 'heartRate') {
    baseVal = currentTelemetry?.vitals?.heartRate || 72;
    color = '#f43f5e';
    unit = 'BPM';
  } else if (activeChartMetric === 'steps') {
    baseVal = 450;
    color = '#8b5cf6';
    unit = 'Steps';
  } else if (activeChartMetric === 'sleep') {
    baseVal = 85;
    color = '#10b981';
    unit = 'Score';
  }

  for (let i = 0; i < count; i++) {
    const timeFactor = Math.sin((i / count) * Math.PI * 2);
    let val = baseVal + timeFactor * 18 + (Math.sin(i * 1.5) * 8);
    if (activeChartMetric === 'steps' && (i < 6 || i > 22)) val = 0;
    points.push(Math.max(20, Math.round(val)));
  }

  // Draw Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 50) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(w - 20, y);
    ctx.stroke();
  }

  // Plot Area Gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, `${color}44`);
  gradient.addColorStop(1, `${color}00`);

  const stepX = (w - 70) / (count - 1);
  const minVal = Math.min(...points) * 0.85;
  const maxVal = Math.max(...points) * 1.15;
  const range = maxVal - minVal || 1;

  ctx.beginPath();
  points.forEach((val, i) => {
    const x = 50 + i * stepX;
    const y = h - 30 - ((val - minVal) / range) * (h - 60);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  // Stroke Line
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Fill area under line
  ctx.lineTo(50 + (count - 1) * stepX, h - 30);
  ctx.lineTo(50, h - 30);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw Data Points
  points.forEach((val, i) => {
    if (i % 3 === 0 || i === count - 1) {
      const x = 50 + i * stepX;
      const y = h - 30 - ((val - minVal) / range) * (h - 60);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Time labels
      ctx.fillStyle = '#64748b';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(`${i}:00`, x - 12, h - 10);
    }
  });
}

/**
 * Live Micro-Fluctuation Simulation
 */
function startLiveHeartRateSimulation() {
  if (liveInterval) clearInterval(liveInterval);

  liveInterval = setInterval(() => {
    if (!currentTelemetry) return;
    const hrEl = document.querySelector('#val-heart-rate');
    if (!hrEl) return;

    const base = currentTelemetry.vitals.heartRate;
    const delta = Math.round((Math.random() - 0.5) * 3);
    const liveVal = Math.max(55, base + delta);

    hrEl.textContent = liveVal;
  }, 2500);
}

// Kickstart App
initApp();
