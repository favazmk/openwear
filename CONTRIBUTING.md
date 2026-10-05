# Contributing to OpenWear

Thank you for your interest in contributing to **OpenWear**! We welcome contributions from developers, biometric researchers, and wearable enthusiasts worldwide.

## Code of Conduct

This project and everyone participating in it is governed by the [OpenWear Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### 1. Adding a New Wearable Adapter
OpenWear is architected around a pluggable adapter model (`src/adapters/`). To add support for a new device (e.g., Whoop, Oura, Amazfit, Withings):
1. Create a new adapter file extending `BaseAdapter`: `src/adapters/<brand>Adapter.js`.
2. Implement required interfaces:
   - `connect()`: Device handshake, OAuth2 flow, or BLE characteristic subscription.
   - `fetchTelemetry()`: Ingest raw provider metrics.
   - `normalize()`: Transform into the canonical `UnifiedHealthTelemetry` schema.
   - `disconnect()`: Clean teardown and stream cancellation.
3. Add unit tests verifying schema conformance.
4. Submit a Pull Request!

### 2. Enhancing AI Health Models
Our telemetry intelligence layer (`src/ai/telemetryCoach.js`) provides recovery prediction, anomaly detection, and training load synthesis. Contributions improving heuristic recovery scoring, LLM prompts, or synthetic data pipelines are warmly welcomed.

### 3. Reporting Bugs
- Use GitHub Issues to submit bug reports.
- Include OS, browser version, device model, and console error logs.

## Development Workflow

1. Fork the repo and clone locally:
   ```bash
   git clone https://github.com/your-username/openwear.git
   cd openwear
   npm install
   ```
2. Start the local Vite development server:
   ```bash
   npm run dev
   ```
3. Commit using Conventional Commits:
   ```bash
   git commit -m "feat(adapter): add amazfit Zepp OS ble parser"
   ```
4. Push to your branch and open a PR against `main`.
