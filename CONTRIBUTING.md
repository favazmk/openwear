# Contributing to OpenWear

Thanks for helping. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Most useful contributions

1. **Device reports** for watches OpenWear can't read yet (see "Help decode your watch" in the README).
2. **Decoders** that turn a device report's vendor messages into heart rate, steps or sleep.
3. **Parser fixes** for real exports that don't import correctly. Please include a small, anonymized sample in `test/`.
4. **New adapters** for other sources.

## Adding an adapter

Adapters live in `src/adapters/` and extend `BaseAdapter`. An adapter's only job is to produce a normalized Dataset (see `src/schema/telemetrySchema.js`) and call `this.setDataset(dataset)`:

- Put parsing in a pure function in `src/parsers/` (no DOM, no `window`) so it runs in `node --test`.
- Never invent values. Unknown metrics stay `null`.
- Expose import/connect methods (`importFile`, `importFiles`, `connect`, `sync`…) and wire them into the source panel in `src/main.js`.
- Add tests in `test/`.

## Development

```bash
npm install
npm run dev
npm test
```

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(parser): …`, `fix(ble): …`) and open PRs against `master`.

## Reporting bugs

Open an issue with your browser and OS, the source you were importing, and any console errors. Never attach your full health export. Cut it down to the few records that show the problem.
