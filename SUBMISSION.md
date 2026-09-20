# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:** Pending recording.

---

## How to run it

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173` and the mock API at `http://localhost:8787`.
Check `/api/health` first; default testing requires `chaos: true` and `latency: true`.
The server and API contract are unchanged. `CHAOS=0 npm run dev:api` and
`LATENCY=0 npm run dev:api` are available only for focused development checks.

## Time spent

Not recorded reliably; I have documented implementation and verification gaps instead of
inventing a time breakdown.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends the complete selection in one request, but the API caps bulk requests at 50 IDs. Any selection above 50 fails with `too_many_ids`. | `src/App.tsx`, `src/api/client.ts` | **Fixed**: selections are split into 50-ID chunks and processed with three concurrent workers. |
| 2 | Search sends a request on every keystroke, which wastes requests and can trigger the rolling rate limit during normal typing. | `src/App.tsx`, `src/features/assets/useAssets.ts` | **Fixed**: asset loading is debounced by 300 ms. |
| 3 | Search requests are neither cancelled nor associated with a request identity. A slow response for an older query can overwrite the results for a newer query. | `src/features/assets/useAssets.ts`, `src/api/client.ts` | **Fixed**: each query owns an `AbortController`, cleanup cancels obsolete work, and inactive responses are ignored. |
| 4 | Identical concurrent asset-list requests are not de-duplicated. Strict Mode, retries, or repeated mounts can issue duplicate network calls. | `src/api/client.ts`, `src/features/assets/useAssets.ts` | **Fixed**: requests share an in-flight promise keyed by the complete query, while each consumer retains independent cancellation. |
| 5 | Pagination is not implemented. The hook requests only the first page and never follows `nextCursor`, so users cannot browse the full library. | `src/features/assets/useAssets.ts`, `src/App.tsx` | **Fixed for Task 1**: cursor pages append to the current result set through a guarded Load more action. Infinite scrolling remains Task 2. |
| 6 | Query state is held only in React state. Search and status filters are lost on reload/share, and there is no URL representation for the current view. | `src/App.tsx` | **Fixed**: `q`, `status`, `kind`, `tag`, and `sort` initialize from and synchronize to URL query parameters using history replacement. |
| 7 | Filter and sort changes do not explicitly reset pagination because pagination is absent. Once pagination is added, reusing the old cursor would produce the API's `stale_cursor` error. | `src/App.tsx`, `src/features/assets/useAssets.ts` | **Fixed**: the query generation resets items and cursor; obsolete page requests cannot append to a newer query. |
| 8 | Loading, empty, and failed states are not distinct. An empty result always renders the same empty message, while errors are rendered separately and the previous rows can remain visible during a new load. | `src/App.tsx`, `src/features/assets/useAssets.ts` | **Fixed**: initial loading, successful empty results, inline load errors, and populated results have separate UI states. |
| 9 | The grid renders every item it receives and has no virtualization. Loading thousands of assets would grow the DOM with scroll distance and harm memory and scrolling performance. | `src/features/assets/AssetGrid.tsx` | **Fixed**: a fixed-row virtual grid renders only visible rows plus overscan while preserving the full scroll height. |
| 10 | A selection change updates the parent `Set` and rerenders the whole grid; cards are not memoized or isolated. This makes selecting hundreds of assets unnecessarily expensive. | `src/App.tsx`, `src/features/assets/AssetGrid.tsx` | **Fixed**: cards are memoized, selection is reduced to a boolean prop, and selection/open callbacks are stable. |
| 11 | Thumbnails are always requested, even when `hasThumbnail` is false, and there is no `onError` fallback. A missing thumbnail produces a broken image instead of a stable placeholder. | `src/features/assets/AssetGrid.tsx`, `src/features/assets/AssetDetail.tsx` | **Fixed**: grid and detail thumbnails lazy/fixed-load, skip known missing images, and replace `404` failures with a stable “No preview” placeholder. |
| 12 | Bulk updates are treated as all-or-nothing. The `207` per-item result is reduced to a count, successful assets are not reconciled locally, failed assets are not rolled back individually, and there is no retry/undo subset. | `src/App.tsx` | **Fixed**: updates are optimistic, chunks respect the 50-ID cap, successes are kept, failures roll back individually, permanent reasons and IDs are shown, and retryable IDs have a dedicated retry action. |
| 13 | The list is not updated after a successful single-asset edit. `handleSaved` deliberately ignores the returned asset, so the grid can display stale status/version data. | `src/App.tsx`, `src/features/assets/AssetDetail.tsx` | **Fixed**: the returned asset replaces the matching item in the loaded list. |
| 14 | Single-asset saves do not handle `409 version_conflict` separately. The user receives a raw error and is not offered a refetch/review path. | `src/features/assets/AssetDetail.tsx`, `src/api/client.ts` | **Fixed**: the latest asset is refetched and the user must review it before choosing the status again. |
| 15 | The API client has no retry, backoff, jitter, or `Retry-After` support for transient `503`, `429`, network, or safe-to-retry write failures. | `src/api/client.ts` | **Fixed**: retries are capped at three attempts, use exponential backoff with jitter, honor `Retry-After`, and only retry transient failures. |
| 16 | API errors are flattened into strings, so callers cannot distinguish retryable failures, validation failures, conflicts, stale cursors, rate limits, and missing thumbnails without parsing text. | `src/api/client.ts` | **Fixed**: `ApiError` preserves HTTP status, API code, retryability, and human-readable copy. |
| 17 | There is no offline detection or recovery state. The app continues making requests while offline and gives no user-oriented explanation when the connection returns or fails. | `src/App.tsx`, `src/api/client.ts`, `src/features/assets/useAssets.ts` | **Fixed**: offline/online events drive a banner, new requests stop while offline, and the active query reloads after reconnection. Writes are not queued; the user is asked to reconnect and retry. |
| 18 | There is no error boundary. A render-time component failure can blank the entire page with no recovery action. | `src/main.tsx` | **Fixed**: a component-level boundary reports the failure and offers an application reload action. |
| 19 | The asset cards are clickable `div` elements without grid semantics, keyboard handlers, roving tabindex, arrow navigation, Enter, Space, or Shift-range selection. | `src/features/assets/AssetGrid.tsx` | **Fixed**: the grid has roving focus, arrow navigation, Enter, Space, and Shift-range selection. |
| 20 | Selection state is not exposed through `aria-selected` or equivalent grid semantics. | `src/features/assets/AssetGrid.tsx` | **Fixed**: cards expose `role="gridcell"`, `aria-selected`, and asset-labelled checkboxes. Screen-reader behavior still requires manual verification. |


The inventory intentionally separates root causes from user-visible effects. For example,
the search race is caused by missing cancellation and stale-response protection, while
the wrong rows shown to a producer are the consequence. I will change each row to
**fixed** only after implementing and testing the corresponding behavior; optional live
updates and automated tests remain separate scope decisions, while the optional stats
header is implemented non-blockingly and documented below.

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

Asset-list requests are keyed by their serialized query parameters. Identical in-flight
requests share one underlying fetch, while consumers can abort independently. I kept this
small rather than adding a data-fetching library because the assessment specifically tests
request ownership and cancellation.

**Stale response handling**

Search input uses a 300 ms debounce. Each query increments a generation, aborts its previous
controller, and accepts a page only when its generation is still current.

**Virtualization approach**

The grid uses fixed row geometry, overscan, and a spacer so only viewport-adjacent cards
are mounted while the scroll height still represents the full result set.

**Optimistic updates and rollback**

Bulk failures are separated into retryable and permanent groups. Legal-hold and missing
asset failures are explained and excluded from retry; temporary failures remain available
through a dedicated retry action.

**Retry and backoff policy**

The client retries only transient failures, for a maximum of three attempts, using capped
exponential backoff with jitter and the server's `Retry-After` value. Offline state is not
treated as a retry storm: requests stop immediately and the active query resumes on the
browser's `online` event. Writes made while offline are intentionally not queued.

**State placement and URL sync**

The search, status, kind, tag, and sort values are initialized from `URLSearchParams` and
written with `history.replaceState`, so reloads and shared links restore the view without
creating one history entry per typed character. A changed query resets the cursor and loaded
items.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | Baseline unmeasured; baseline renders every loaded item | Not measured in browser yet; implementation uses viewport rows plus overscan | Planned Chrome DevTools Elements count |
| Cards re-rendered when toggling one selection | Baseline unmeasured; cards were not memoized | Not measured in React Profiler yet; cards are memoized with stable callbacks | Planned React DevTools Profiler comparison |
| Longest task during sustained scroll | Baseline unmeasured | Not measured in browser yet | Planned Chrome Performance recording with 5,000+ rows |
| Requests fired while typing a 6-character query | Baseline behavior is one request per keystroke | Not measured in Network panel; 300 ms debounce is implemented | Planned Chrome Network request count |
| Production bundle, gzipped | 48 kB baseline stated in the brief | 52.64 kB JavaScript from `npm run build` | Vite production output, 2026-09-20 |

What was the actual bottleneck, and how did you find it?

The initial bottlenecks were unbounded card rendering, request-per-keystroke search, and
whole-grid selection updates. The implementation now uses a fixed-row virtual grid, a 300 ms
debounce, request cancellation/deduplication, and memoized cards. Browser profiler values are
left explicitly unmeasured rather than presented as estimates.

---

## Accessibility

- **Keyboard model:** the grid uses roving `tabIndex`, with one focused grid cell at a time. Arrow keys move by card or row, Enter opens the detail panel, Space toggles selection, and Shift + Space extends selection from the anchor. The detail panel focuses its Close button on open, closes on Escape, and restores focus to the originating card when closed.
- **Testing:** TypeScript and production build checks pass. Manual keyboard and screen-reader verification is still outstanding and is not being claimed as complete.
- **Known gaps:** screen-reader announcement quality and focus behavior when filtering removes the focused virtualized card need manual browser/assistive-technology verification.

---

## Interface decisions

I optimized for a reviewer who scans and updates assets repeatedly, so the interface stays
dense, stable, and action-oriented instead of decorative. The visual system uses teal as a
focused accent, cool neutral surfaces, compact spacing tokens, and a restrained status
progression from Draft through Archived. Fixed media geometry, explicit empty/error/offline
states, and human-readable notices keep the interface honest when the network or backend
misbehaves. The detail panel moves below the grid on narrow windows while the grid keeps its
own stable scroll surface.

- **Visual system.** Tokens live in `src/styles.css`: ink, muted ink, surface, line, teal accent, spacing, and radii. The UI uses Trebuchet MS for a compact operational tone and avoids one-off decorative values where practical.
- **Status treatment.** Status labels remain visible and are paired with text markers: Draft `○`, In review `◐`, Approved `✓`, and Archived `—`; color is supporting information, not the only carrier.
- **States.** Loading, empty, request error, offline, error-boundary, loading-more, and partial bulk failure have separate copy and layouts. Retryable bulk failures expose a retry action; legal-hold and missing assets are not retried.
- **Contrast.** Automated WCAG contrast auditing has not yet been run; this is recorded rather than claimed as verified.
- **Copy.** Raw rate-limit and upstream messages are rewritten as service-busy or temporary-availability guidance, and offline copy explains what remains available and what action is required.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

I did not queue writes while offline because replaying status changes later could surprise a
reviewer; the user is asked to reconnect and retry. I used a hand-rolled fixed-row virtual
grid to keep ownership and behavior explainable, accepting that variable-height cards would
require a more capable virtualizer. Live SSE reconciliation and automated concurrency tests
were not added; with another day I would add focused rollback/retry tests and verify scrolling,
screen-reader output, and contrast in the target browser.

## Critique of the API

Production design would benefit from a standard error envelope that always includes
retryability and a machine-readable retry delay. Bulk status should ideally support an
idempotency key and return a stable operation identifier for progress and retry; the client
currently has to chunk requests and merge per-item results. The cursor contract is correct
but strict, so every query change must reset pagination. The deliberately slow stats endpoint
is loaded non-blockingly so it cannot delay the primary asset workflow.

## Anything you would like us to look at

The request pipeline and bulk operation are the most deliberate parts: stale queries are
cancelled and generation-guarded, identical reads share an in-flight request, and partial
bulk results roll back only failed IDs. The optional `/api/stats` header is non-blocking and
failure-tolerant. The remaining open verification items are browser performance numbers,
automated contrast checking, and actual screen-reader testing.
