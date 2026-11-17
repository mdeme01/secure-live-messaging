# Secure Live Messaging

Share a live-updating, end-to-end encrypted text message with one receiver through a link.

The sender clicks **Create session** and gets two links: a private **Sender Link** to keep editing, and a **Receiver Link** to share. While the sender types, each change is encrypted and authenticated in the sender's browser, relayed through the server and shown read-only in the receiver's browser, which verifies every update before showing it. The server only ever sees session IDs, opaque ciphertext and a hash of the sender's token. It cannot read the message, and it cannot change, replay or reorder updates without the receiver noticing.

No accounts and no install: both sides only open a link.

## Contents

- [Running it locally](#running-it-locally)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Key technical decisions](#key-technical-decisions)
- [Security model](#security-model)
- [Tests](#tests)
- [Checks (what CI would run)](#checks-what-ci-would-run)
- [Known limitations](#known-limitations)
- [What we'd improve with more time](#what-wed-improve-with-more-time)
- [AI usage](#ai-usage)

## Running it locally

Requirements:

- Node.js 24 (see `.nvmrc`)
- pnpm 12 (`corepack enable`)

```sh
pnpm install
pnpm dev          # server on :3000, web app on http://localhost:4200
```

Open <http://localhost:4200>, click **Create session**, and open the Receiver Link in another browser or a private window. `pnpm dev` starts both apps; the Angular dev server proxies `/api` and `/socket.io` to the server, so the browser sees a single origin and CORS stays off.

The server reads `HOST` (default `localhost`) and `PORT` (default `3000`).

E2E tests use Playwright with Chromium. Install the browser once:

```sh
pnpm exec playwright install chromium
```

## Project structure

An Nx monorepo with pnpm, strict TypeScript, ESLint and Prettier.

```
apps/
  web/        Angular 22 frontend (standalone components, signals, zoneless, Tailwind 4)
    src/app/live/       Sender and Receiver controllers and the transport interface (+ socket.io adapter)
    src/app/session/    REST client and session creation
    src/app/pages/      landing, sender, receiver, not-found
  server/     Fastify 5 + socket.io 4 relay
    src/app/server.ts          buildServer() factory: headers, limits, heartbeat, expiry sweep
    src/app/session-store.ts   in-memory sessions (token hash, latest ciphertext, activity time)
    src/app/sessions.routes.ts POST/DELETE /api/sessions
    src/app/live.handlers.ts   socket events: join, publish, presence, ended
    src/app/role-slots.ts      one connected socket per role per session
  web-e2e/    Playwright tests: sender and receiver in two browser contexts
libs/
  protocol/   @slm/protocol: the shared wire contract (paths, events, payloads, error codes, limits, validators)
  crypto/     @slm/crypto: key/ID generation, seal/open, padding, link build/parse (Web Crypto only)
```

`@slm/protocol` is the single source of truth for both apps. A new event or limit is added there once, and the compiler enforces it on both sides through typed socket.io event maps.

## Architecture

```
 Sender browser                        Server (relay)                     Receiver browser
 ──────────────                        ──────────────                     ────────────────
 /s/{id}#k={key}&t={token}                                                /r/{id}#k={key}
 key + token stay in the fragment                                         key stays in the fragment

 create: generate key + session ID,
 seal "" as Update 0  ── POST /api/sessions {id, update0} ──▶  store id, update0, hash(token)
                       ◀── 201 {senderToken} ──────────────

 type → 300 ms debounce → seal(seq n)
        ── socket "update:publish" ──▶  check token, size, seq > stored
                                        store as latest ── "update" ──▶  open + verify (key, id, seq)
                                                                         show it, or reject it with a banner

 refresh / late join ── "session:join" ─▶ ack with latest Update ──────▶ same verify path
 end ── DELETE /api/sessions/{id} (Bearer token) ─▶ delete, emit "session:ended", disconnect both
```

- **REST** creates and ends sessions. **socket.io** (WebSocket only) carries the live channel: `session:join` and `update:publish` from client to server (both acknowledged), and `update`, `presence` and `session:ended` from server to client.
- The server keeps sessions in a `Map`: per session, the SHA-256 of the Sender Token, the latest sealed Update and the last-activity time. Connection state (which socket holds which role) lives beside it in `RoleSlots`. Nothing is persisted.
- On the frontend, the **Sender and Receiver controllers** hold all live-session behaviour (debounce, latest-wins publishing, rejoin and resync, verification order, integrity state, presence, end). They are plain classes exposing Angular signals, and they depend on a small `LiveTransport` interface, so they are tested against an in-memory fake. Page components only render controller state and forward input.
- `buildServer()` takes a clock, a session cap and an idle timeout, so tests start isolated instances on random ports and expire sessions without waiting.

## Key technical decisions

| Decision                                                                                                                                                                                                           | Why                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Secrets only in the URL fragment.** Receiver Link `/r/{id}#k={key}`, Sender Link `/s/{id}#k={key}&t={token}`.                                                                                                    | Browsers never send the fragment to the server. Links survive a refresh without any browser storage.                                                                                                     |
| **AES-256-GCM via Web Crypto**, fresh random 96-bit IV per Update, non-extractable `CryptoKey`.                                                                                                                    | Authenticated encryption from the platform, with no crypto dependency. Any change to the ciphertext, IV or tag fails decryption.                                                                         |
| **AAD = `slm/v1\|{sessionId}\|{seq}`.**                                                                                                                                                                            | Binds each ciphertext to its session and position, so it can't be spliced into another session or replayed at another sequence number. The version tag lets the format evolve.                           |
| **Monotonic sequence numbers, enforced by the receiver.** Equal seq is ignored as already seen; a lower one is an integrity failure.                                                                               | Stops the relay from rolling the receiver back to an older genuine message. The server also enforces it, but only as defence in depth.                                                                   |
| **Update 0 is the encrypted empty message, sent at creation.** The client therefore generates the 128-bit session ID (the AAD needs it).                                                                           | Every session always has an authenticated state, so "the sender hasn't written anything yet" is verified, not assumed. The server rejects ID collisions with 409.                                        |
| **Plaintext padded to 256-byte blocks** (4-byte length prefix + UTF-8 + zeros), validated after decryption.                                                                                                        | Hides the exact message length from the server and the network.                                                                                                                                          |
| **Sender Token** (256-bit, generated by the server, only its SHA-256 stored, compared in constant time) is required to join as sender, publish and end. It goes in the socket.io handshake `auth`, never in a URL. | The Receiver Link carries no write capability.                                                                                                                                                           |
| **Full snapshot, debounced 300 ms, one publish in flight, latest wins.**                                                                                                                                           | Simple and robust: no diffs to merge, and intermediate states that were overtaken are never sent. After a lost ack or `STALE_SEQUENCE` the sender rejoins and continues from the server's latest Update. |
| **One connected socket per role per session**, freed on disconnect; heartbeat 10 s + 5 s.                                                                                                                          | Keeps the session one-to-one. Clients retry a briefly "taken" role, which covers the moment before the server notices their own previous connection has died.                                            |
| **In-memory store, 1 h idle expiry, 1000-session cap, 64 KiB ciphertext cap.**                                                                                                                                     | Bounded memory without a database. Sessions are short-lived by design.                                                                                                                                   |
| **No CI service.**                                                                                                                                                                                                 | The check set below is the same one a pipeline would run, and is run locally before every merge.                                                                                                         |

## Security model

**What it protects against**

- **Honest-but-curious or compromised relay / network observer.** The server sees session IDs, ciphertext sizes (rounded to 256-byte blocks), timing and a hash of the sender token. It never sees the key or the plaintext. End-to-end tests assert that the key never appears in a request URL, in the create request or in any WebSocket frame, and that the plaintext never appears in a frame.
- **Tampering, injection, splicing and replay.** The receiver accepts an Update only if it authenticates under the session key with the AAD for _this_ session and a sequence number above the last one it accepted. Anything else is rejected and never shown as text. The receiver keeps the last verified message and shows _"Latest update failed integrity check — showing last verified message"_ until the next genuine Update arrives. An end-to-end test flips one ciphertext bit in a live WebSocket frame and checks exactly this.
- **Unauthorized writers.** Joining as sender, publishing and ending all require the Sender Token. The Receiver Link doesn't contain it.
- **Leaks through the browser.** Nothing is written to `localStorage`, `sessionStorage`, cookies or IndexedDB. The `CryptoKey` is non-extractable, and the raw key bytes are zeroed once imported. The encoded key remains in the URL fragment by design. `Referrer-Policy: no-referrer` is set both as a meta tag and as a server header.
- **Script injection.** A strict Content-Security-Policy (`default-src 'none'`, self-only scripts, styles and connections, no inline code, `base-uri 'self'`, `form-action 'none'`). Messages are rendered as text, never as HTML. An end-to-end test runs the whole flow and asserts there are no CSP violations.
- **Resource abuse.** Ciphertext ≤ 64 KiB, request bodies and socket frames are capped (oversized frames close the connection before parsing), at most 1000 live sessions, idle sessions expire, and every input is validated (formats, sizes, sequence numbers, roles). Every server HTTP response gets `nosniff`, `no-referrer` and `Cache-Control: no-store`.

**What it assumes, and doesn't protect against**

- **The code you run is honest.** As with any web-delivered cryptography, whoever serves the frontend could serve code that leaks the key. Compromised devices and malicious browser extensions are also out of scope.
- **Links are bearer credentials.** Whoever has the Receiver Link can read the message, and whoever has the Sender Link can edit and end the session. The one-receiver rule limits how many people can be connected at once; it is not authentication. Share links over a channel you trust.
- **Links stay in browser history** (the fragment is part of the URL), so a shared or synced history exposes them. The trade-off buys refresh support without storage.
- **Metadata is visible.** The server and the network can see when someone types, roughly how long the message is (to 256 bytes), and when each party is connected.
- **Rollback protection lasts as long as the page.** The receiver's last accepted sequence number lives in memory. After a receiver refresh, a malicious server could serve an older genuine Update. The same applies to the sender after a refresh, since it trusts any authentic latest Update when it rehydrates. If the sender then publishes from that older state, its updates arrive as stale or already-seen at a receiver that hasn't refreshed, so the rollback shows up there as an integrity warning.
- **Timestamps aren't authenticated.** "Last update received" is the time the receiver's browser accepted the Update, not when the sender wrote it.

## Tests

```sh
pnpm test         # all unit and integration tests (Vitest)
pnpm e2e          # Playwright; starts the server and the web dev server itself
pnpm nx test server   # one project: web, server, crypto, protocol
```

The tests target four seams and exercise behaviour from the outside:

1. **Whole app in a real browser** (`apps/web-e2e`, Playwright, two browser contexts as sender and receiver):
   - two consecutive updates reach the receiver live, and frames carry only ciphertext;
   - verified empty state, a late receiver and a reloaded sender;
   - the size limit;
   - a tampered frame produces the integrity banner, and the tampered text never appears;
   - second receiver and second sender tab turned away; presence;
   - offline edits delivered on reconnect; receiver drop and catch-up; refreshes;
   - ending a session;
   - the whole flow under the CSP with no violations.
2. **Server public interface** (`apps/server`, Vitest, real HTTP and real socket.io clients against an isolated instance on a random port, injected clock):
   - creation, validation, size limits, collisions and capacity;
   - the token required for sender join, publish and end;
   - `ROLE_TAKEN` and slot release; presence;
   - relay to late joiners; `STALE_SEQUENCE`;
   - ending and idle expiry; defensive headers; WebSocket-only transport.
3. **Crypto module** (`libs/crypto`, Vitest on Node's Web Crypto):
   - round trips, including empty and multi-byte Unicode text;
   - flipped bits in the IV, ciphertext and tag;
   - wrong key; another session's ciphertext; altered, stale and equal sequence numbers;
   - framing violations inside an authentic ciphertext;
   - padding buckets and the exact size limit;
   - link parsing.
4. **Live-session controllers** (`apps/web/src/app/live`, Vitest with a fake transport and fake timers):
   - debounce coalescing; one publish in flight with latest wins;
   - offline edits; resync after a stale or lost ack;
   - rehydration, and refusing to overwrite an unverifiable message;
   - receiver ordering, replay and forgery handling, banner clearing;
   - role-taken retries, presence, end and expiry.

Pages get light render tests. Where a test's meaning depended on one line of code, it was mutation-checked: the line was removed and the test confirmed to fail.

## Checks (what CI would run)

There is no hosted CI. This is the gate run locally before every merge, and the exact set a pipeline would run:

```sh
pnpm check
# = nx format:check
#   && nx run-many -t lint test build      (all projects)
#   && nx run web-e2e:e2e
```

## Known limitations

- **Single instance, in memory.** A restart loses every session, and the store can't be shared across instances. Horizontal scaling would need a shared store and a socket.io adapter.
- **No rate limiting.** The session cap bounds memory, but one client could fill all 1000 slots for up to an hour. A real deployment needs per-IP limits in front.
- **Production serving isn't included.** `pnpm nx build web` produces a static bundle (built with critical-CSS inlining off so it passes the CSP). It needs a reverse proxy that serves it and routes `/api` and `/socket.io` to the server on the same origin. That proxy should also send the CSP as a header, plus `frame-ancestors 'none'`, which a meta tag can't set, and HSTS. The e2e suite runs against the dev server.
- **Expiry is approximate.** Activity means create, join or publish; a receiver who just watches doesn't count. The sweep runs every 60 s, so an idle session can live up to 1 h + 60 s. The "an hour" copy is written out in the two pages that show it, not derived from the constant.
- **Brief "role taken" after a dead connection.** If a page reloads within the ~15 s before the server notices its previous connection died (for example after a network drop), the join is retried with back-off and normally succeeds. If the old connection is still held after the retries, the page asks you to reload.
- **The sender stops when the stored message can't be verified**, on a rejoin as well as on first load. This is stricter than strictly needed, but it means a sender never overwrites a message it can't read.
- **Session existence isn't secret.** `DELETE` with an unknown or malformed ID answers 404 before checking the token, the same thing a receiver join reveals.
- **Messages are plain text** with a limit of 65,276 UTF-8 bytes. One receiver, no replies, no history.

## What we'd improve with more time

- Ship a production server or reverse-proxy config with header-based CSP, `frame-ancestors`, HSTS and rate limiting, and run the e2e suite against the production build too.
- Keep the receiver's last accepted sequence number (and an authenticated sender timestamp inside the plaintext) so rollback protection survives a refresh and "last updated" means _written_, not _received_. Storing anything in the browser has its own trade-off, so this needs a deliberate decision.
- Optional key confirmation: show both sides a short fingerprint of the key, to detect a substituted link.
- Replace the per-test browser-context setup in the e2e suite (repeated in most specs) with a Playwright fixture.
- Factor the shared join/reconnect skeleton out of the two controllers if a third live role ever appears.

## AI usage

This project was built with **Claude Code** (CLI) running **Claude Opus 5.5**, with a human making every product and security decision and approving each step.

**How it was used**

- **Design.** Requirements were turned into a domain glossary and architecture decision records through a structured _grilling_ session: the agent proposed answers to each open design question and the human accepted, changed or rejected them. Examples: the human chose _no CI service_, chose to keep "last update received" as receipt time, and asked whether an empty new session was authenticated, which led to Update 0.
- **Planning.** The agreed design was written up as a spec with 48 user stories and agreed test seams, then split into 10 vertical-slice tickets.
- **Implementation.** One branch and one squash-merged PR per ticket, with conventional commits.
- **Review.** After each ticket, two independent reviewer sub-agents checked the diff against the coding standards and against the ticket and spec. Their findings were fixed or explicitly accepted with a recorded reason.

Skills (from the _mattpocock-skills_ plugin): `setup-matt-pocock-skills` (issue tracker and docs layout), `grill-with-docs` (grilling + domain modelling: glossary and ADRs), `to-spec` and `to-tickets` (spec and ticket breakdown), `code-review` (the standards and spec review per ticket) and `pr` (PR descriptions).

**One useful contribution.** While writing the spec, the agent noticed a gap in the agreed design. Update 0's AAD has to include the session ID, but the server was going to assign the ID only _after_ receiving Update 0. It proposed that the browser generate the 128-bit session ID and send it with Update 0 in one atomic request, with the server rejecting collisions. That keeps "every session always has an authenticated state" true without an extra round trip. Review sub-agents also caught real bugs before merge. One example: after a lost publish ack, the sender could get stuck re-sending a sequence number the server had already stored. The fix was to resync from the server's latest Update.

**Verified or corrected independently.** AI output was treated as a draft:

- **Scaffolding.** Generated scaffolding didn't work as suggested and was fixed by hand. The workspace generator ignored preset flags. Its template used TypeScript project references, which the Angular plugin refuses. An inferred server `serve` target exited immediately without a TTY.
- **Tests.** Mutation checks caught tests that passed for the wrong reason. A "frees roles" test turned out to be vacuous and was dropped.
- **Flaky test.** The final review found and fixed one: an oversized-body test raced the server closing the connection and hit `ECONNRESET` about 1 run in 6.
- **Assumptions.** Unclear points were checked by running code rather than trusted, for example whether Web Crypto works in the Angular unit-test environment.
