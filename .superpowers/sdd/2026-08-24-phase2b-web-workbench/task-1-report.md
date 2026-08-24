# Task 1 Report — Thin HTTP Adapter and trusted Web Gateway

## Files

- `src/http/webCapabilities.js`
- `src/http/webGateway.js`
- `src/http/httpErrors.js`
- `src/http/createWebHttpAdapter.js`
- `test/webGateway.test.js`
- `test/webHttpAdapter.test.js`

## Behavior

- The gateway is frozen and derives the fixed local web actor, `web` surface, closed per-request capability, correlation ID, and host-bound context before calling the Core Application Contract.
- Browser-supplied trust fields and malformed request IDs are rejected before dispatch. Internal query/event helpers allocate request IDs through the same trusted path.
- Capability maps are frozen and checked against every contract command, query, and event-query type.
- The Express adapter uses 64kb JSON parsing, exposes the four specified API routes without CORS, uses only injected dependencies, maps the stable contract errors to HTTP status, preserves contract version metadata, and returns sanitized envelopes.
- Private browser input fields are rejected; private output fields are removed; thrown failures become sanitized `storage_failure` envelopes. Interaction requests report `runtime_unavailable` when no interaction service is injected.

## RED evidence

1. `npm test -- test/webGateway.test.js test/webHttpAdapter.test.js` failed as expected with `ERR_MODULE_NOT_FOUND` for both new HTTP modules before any production module existed.
2. `.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webGateway.test.js` then failed for the newly specified malformed `requestId` behavior because the gateway still dispatched it.
3. The same focused gateway command failed after specifying that private successful-response fields must be removed rather than making an otherwise usable query fail.

## GREEN evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webGateway.test.js test/webHttpAdapter.test.js`

Result: 10 tests passed, 0 failed.

## Self-review

- Reviewed all four source files: only Contract types, Express, and local HTTP helpers are imported; there are no Core, repository, SQLite, runtime, app-composition, legacy-route, or memory-store imports.
- Verified the HTTP route tests use native `fetch` with an ephemeral `http.createServer(app)`, not Supertest.
- `git diff --check` completed without whitespace errors for tracked changes; newly created files were also inspected directly.

## Commit

`feat: add thin web application adapter`

## Concerns

None. The adapter deliberately remains a dependency-injected boundary; server composition and UI/runtime wiring are out of scope.

## Fix Round 1

### Changes

- The final Express error handler now converts injected middleware errors (including `next(error)`) into sanitized JSON `storage_failure` responses, while parse and 64kb limit errors remain `invalid_request`.
- `GET /api/events` now accepts only `type`, `requestId`, and `payload`; forbidden, unknown, repeated, and malformed parameters are rejected before dispatch.
- Browser output filtering now blocks nested runtime, prompt, reasoning, database, host-authority, and Pi runtime/config/session namespaces.
- Interaction requests reject forged trusted fields before determining whether a runtime service is available.
- Malformed event payloads now return `invalid_request` directly rather than using a fabricated private field.

### RED evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webHttpAdapter.test.js`

Result: 5 expected regressions failed: forged interaction fields incorrectly returned `runtime_unavailable`; injected middleware fell through to Express HTML; event query fields were silently dropped; nested `piSession`/`piConfig`/`reasoningTrace` leaked; and the malformed-payload path still fabricated `stack`.

### GREEN evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webHttpAdapter.test.js test/webGateway.test.js`

Result: 14 tests passed, 0 failed.

`npm test`

Result: 387 tests passed, 0 failed.

### Self-review

- Rechecked the adapter's final error middleware: it does not delegate unknown errors to Express's default renderer.
- Rechecked event query parsing: validation precedes construction of the gateway request, so discarded trust fields cannot influence dispatch.
- Rechecked nested output filtering and its focused regression coverage for Pi configuration/session and reasoning traces.

### Fix commit

`fix: harden web adapter boundary`

## Fix Round 2

### Changes

- Injected Vite and function-form static middleware now receive a buffered response facade. Their `write`/`end` calls are held until a successful completion; `next(error)` discards buffered bytes and reaches the stable JSON error handler.
- The final error handler retains the Express four-argument signature and destroys only an already-committed response, a state the injected middleware boundary cannot create.
- Private output filtering now blocks the complete normalized `pi*` namespace, including credentials, environment, and request fields.

### RED evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webHttpAdapter.test.js`

Result: 2 expected regressions failed: middleware that wrote a sensitive partial body before `next(error)` produced HTTP 200, and nested `piCredentials`/`piEnvironment`/`piRequest` remained in the output.

### GREEN evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webHttpAdapter.test.js`

Result: 8 tests passed, 0 failed.

`npm test`

Result: 387 tests passed, 0 failed.

### Self-review

- The partial-write regression uses native fetch against an ephemeral server and verifies both the stable error envelope and absence of the sensitive bytes.
- The facade does not expose the real response write/end methods to injected middleware; buffered data is discarded before the stable error response is constructed.
- The `pi*` rule is recursive through objects and arrays and removes the newly covered credential/environment/request fields.

### Fix commit

`fix: buffer injected web middleware`

## Fix Round 3

### Changes

- Replaced the response facade with a temporary interception on the real Express/Node response. Unrelated native methods and properties, including events, `locals`, and response inspection helpers, remain available to injected middleware.
- Buffered `end()` now defers commit for two microtasks. A synchronous `next(error)`, throw, or already-returned Promise rejection wins during that bounded window, restores the original response methods, drops the buffered bytes, and emits the stable failure envelope.
- Interception covers `write`, `end`, all common header methods, `flushHeaders`, and Node's two- and three-argument `writeHead` signatures. On normal continuation it restores the original response and all transient header/status changes.

### RED evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webHttpAdapter.test.js`

Result: 2 expected regressions failed: a middleware calling `end('middleware private detail')` followed by `next(error)` returned HTTP 200, and the facade lacked native response methods required by the compatibility regression.

### GREEN evidence

`.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webHttpAdapter.test.js`

Result: 9 tests passed, 0 failed.

`npm test`

Result: 388 tests passed, 0 failed.

### Self-review

- The critical regression now exercises the actual Node write/end sequence over native fetch and proves the client receives neither the sensitive bytes nor a partial success response.
- The compatibility regression verifies real `on`, `once`, `locals`, `getHeaders`, `flushHeaders`, and three-argument `writeHead` usage; the buffered header/status state is discarded before the downstream gateway response.
- Commit is bounded to two microtasks, so a middleware that ends successfully is not left waiting indefinitely.

### Fix commit

`fix: preserve response semantics in web buffer`
