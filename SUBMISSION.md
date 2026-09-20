# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends the complete selection in one request, but the API caps bulk requests at 50 IDs. Any selection above 50 fails with `too_many_ids`. | `src/App.tsx`, `src/api/client.ts` | **Fixed**: selections are split into 50-ID chunks and processed with three concurrent workers. |
| 2 | Search sends a request on every keystroke, which wastes requests and can trigger the rolling rate limit during normal typing. | `src/App.tsx`, `src/features/assets/useAssets.ts` | **Fixed**: asset loading is debounced by 300 ms. |
| 3 | Search requests are neither cancelled nor associated with a request identity. A slow response for an older query can overwrite the results for a newer query. | `src/features/assets/useAssets.ts`, `src/api/client.ts` | **Fixed**: each query owns an `AbortController`, cleanup cancels obsolete work, and inactive responses are ignored. |
| 4 | Identical concurrent asset-list requests are not de-duplicated. Strict Mode, retries, or repeated mounts can issue duplicate network calls. | `src/api/client.ts`, `src/features/assets/useAssets.ts` | **Fixed**: requests share an in-flight promise keyed by the complete query, while each consumer retains independent cancellation. |
| 5 | Pagination is not implemented. The hook requests only the first page and never follows `nextCursor`, so users cannot browse the full library. | `src/features/assets/useAssets.ts`, `src/App.tsx` | **Fixed for Task 1**: cursor pages append to the current result set through a guarded Load more action. Infinite scrolling remains Task 2. |
| 6 | Query state is held only in React state. Search and status filters are lost on reload/share, and there is no URL representation for the current view. | `src/App.tsx` | **Fixed**: `q`, `status`, and `sort` initialize from and synchronize to URL query parameters using history replacement. |
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
| 17 | There is no offline detection or recovery state. The app continues making requests while offline and gives no user-oriented explanation when the connection returns or fails. | `src/App.tsx`, `src/api/client.ts` | Knowingly left: needs online/offline event handling and an offline banner. |
| 18 | There is no error boundary. A render-time component failure can blank the entire page with no recovery action. | `src/main.tsx` | Knowingly left: needs a component-level boundary with retry/reload. |
| 19 | The asset cards are clickable `div` elements without grid semantics, keyboard handlers, roving tabindex, arrow navigation, Enter, Space, or Shift-range selection. | `src/features/assets/AssetGrid.tsx` | Knowingly left for Task 5: pointer Shift-range selection is fixed in Task 3, but keyboard range selection remains. |
| 20 | The checkboxes have no asset-specific accessible name, and selection state is not exposed through `aria-selected` or equivalent grid semantics. | `src/features/assets/AssetGrid.tsx` | Knowingly left: needs explicit accessible labeling and state. |


The inventory intentionally separates root causes from user-visible effects. For example,
the search race is caused by missing cancellation and stale-response protection, while
the wrong rows shown to a producer are the consequence. I will change each row to
**fixed** only after implementing and testing the corresponding behavior; optional live
updates, statistics, and automated tests are not baseline defects and remain separate
scope decisions below.

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

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**

The search, status, and sort values are initialized from `URLSearchParams` and written with
`history.replaceState`, so reloads and shared links restore the view without creating one
history entry per typed character. A changed query resets the cursor and loaded items.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | | | |
| Cards re-rendered when toggling one selection | | | |
| Longest task during sustained scroll | | | |
| Requests fired while typing a 6-character query | | | |
| Production bundle, gzipped | | | |

What was the actual bottleneck, and how did you find it?

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** Your colour, spacing and type decisions, and where they live.
- **Status treatment.** How the four statuses read as a progression, and how they
  stay distinguishable without relying on colour.
- **States.** What you did with loading, empty, error, offline and partial
  failure.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
