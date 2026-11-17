# Secure Live Messaging

Share a live-updating, end-to-end encrypted text message with one receiver through a link. Text is encrypted in the sender's browser and decrypted in the receiver's browser; the server only relays data it cannot read.

> Work in progress: full architecture, security notes and limitations will be documented here.

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 12 (`corepack enable`)

## Getting started

```sh
pnpm install
pnpm dev          # server on :3000, web app on http://localhost:4200 (proxies /api and /socket.io)
```

## Checks

```sh
pnpm check        # format check, lint, unit/integration tests, build, e2e
```

E2E tests use Playwright (Chromium); install the browser once with `pnpm exec playwright install chromium`.
