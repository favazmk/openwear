# Security Policy

## Supported versions

Only the latest release on `master` receives fixes.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the impact.

You'll get a reply within a week. Fixes are released as soon as they're ready, and reporters are credited unless they prefer otherwise.

## Scope notes

OpenWear runs entirely in the browser. Strava credentials, Strava tokens and an optional OpenAI key are stored in `localStorage` on the user's own machine. Issues that let another site or an imported file read that data (for example XSS from a crafted GPX file) are in scope.
