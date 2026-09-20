import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetKind, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const KINDS: AssetKind[] = ['image', 'video', 'document'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];
const SORT_VALUES = new Set(SORTS.map((option) => option.value));
const RETRYABLE_BULK_CODES = new Set(['conflict', 'request_failed', 'network_error', 'rate_limited', 'upstream_unavailable', 'write_failed']);

function initialQueryState() {
  const params = new URLSearchParams(window.location.search);
  const requestedSort = params.get('sort') as NonNullable<AssetQuery['sort']> | null;
  return {
    q: params.get('q') ?? '',
    status: params.get('status')?.split(',').filter((value): value is AssetStatus => STATUSES.includes(value as AssetStatus)) ?? [],
    kind: params.get('kind')?.split(',').filter((value): value is AssetKind => KINDS.includes(value as AssetKind)) ?? [],
    tag: params.get('tag')?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
    sort: requestedSort && SORT_VALUES.has(requestedSort) ? requestedSort : 'updatedAt:desc' as const,
  };
}

export function App() {
  const [initial] = useState(initialQueryState);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [kind, setKind] = useState<AssetKind[]>(initial.kind);
  const [tagInput, setTagInput] = useState(initial.tag.join(', '));
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>(initial.sort);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryableIds, setRetryableIds] = useState<string[]>([]);
  const [retryStatus, setRetryStatus] = useState<AssetStatus | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const tags = tagInput.split(',').map((value) => value.trim()).filter(Boolean);
  const { items, total, loading, loadingMore, error, hasMore, loadMore, updateItems } = useAssets({ q, status, kind, tag: tags, sort, limit: 24 });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (q) params.set('q', q);
    else params.delete('q');
    if (status.length) params.set('status', status.join(','));
    else params.delete('status');
    if (kind.length) params.set('kind', kind.join(','));
    else params.delete('kind');
    if (tags.length) params.set('tag', tags.join(','));
    else params.delete('tag');
    params.set('sort', sort);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [q, status, kind, tagInput, sort]);

  const toggleSelect = useCallback((id: string, extendRange: boolean) => {
    setSelectedIds((prev) => {
      if (extendRange && selectionAnchor.current) {
        const anchorIndex = items.findIndex((asset) => asset.id === selectionAnchor.current);
        const targetIndex = items.findIndex((asset) => asset.id === id);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const next = new Set(prev);
          items.slice(start, end + 1).forEach((asset) => next.add(asset.id));
          return next;
        }
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    selectionAnchor.current = id;
  }, [items]);

  const selectAllLoaded = useCallback(() => {
    setSelectedIds(new Set(items.map((asset) => asset.id)));
    selectionAnchor.current = items[0]?.id ?? null;
  }, [items]);

  async function applyBulkStatus(next: AssetStatus, requestedIds = [...selectedIds]) {
    const ids = requestedIds;
    if (ids.length === 0) return;
    setNotice(null);

    const requestedSet = new Set(requestedIds);
    const previous = new Map(items.filter((asset) => requestedSet.has(asset.id)).map((asset) => [asset.id, asset]));
    updateItems((current) => current.map((asset) => (requestedSet.has(asset.id) ? { ...asset, status: next } : asset)));

    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += 50) chunks.push(ids.slice(index, index + 50));
    const results: Array<Awaited<ReturnType<typeof bulkSetStatus>>> = [];
    const failures: Array<{ id: string; code: string }> = [];
    let nextChunk = 0;

    async function worker() {
      while (nextChunk < chunks.length) {
        const chunk = chunks[nextChunk];
        nextChunk += 1;
        if (!chunk) break;
        try {
          const result = await bulkSetStatus(chunk, next);
          results.push(result);
        } catch (err) {
          const code = err instanceof ApiError ? err.code : 'request_failed';
          chunk.forEach((id) => failures.push({ id, code }));
        }
      }
    }

    try {
      await Promise.all([worker(), worker(), worker()]);
      results.forEach((result) => {
        result.results.forEach((resultItem) => {
          if (resultItem.ok) {
            updateItems((current) => current.map((asset) => asset.id === resultItem.id ? resultItem.asset : asset));
          } else {
            failures.push({ id: resultItem.id, code: resultItem.code });
          }
        });
      });
      const failedIds = new Set(failures.map(({ id }) => id));
      updateItems((current) => current.map((asset) => failedIds.has(asset.id) ? previous.get(asset.id) ?? asset : asset));
      const applied = ids.length - failures.length;
      const retryable = failures.filter((failure) => RETRYABLE_BULK_CODES.has(failure.code));
      const permanent = failures.filter((failure) => !RETRYABLE_BULK_CODES.has(failure.code));
      const permanentDetails = permanent.slice(0, 3).map(({ id, code }) => `${id} (${code === 'legal_hold' ? 'legal hold' : code === 'not_found' ? 'no longer exists' : 'not changed'})`).join(', ');
      setRetryableIds(retryable.map(({ id }) => id));
      setRetryStatus(retryable.length > 0 ? next : null);
      setNotice(failures.length === 0
        ? `${applied} assets updated successfully.`
        : `${applied} updated. ${retryable.length > 0 ? `${retryable.length} temporary failure${retryable.length === 1 ? '' : 's'} can be retried. ` : ''}${permanent.length > 0 ? `${permanent.length} permanent failure${permanent.length === 1 ? '' : 's'}: ${permanentDetails}${permanent.length > 3 ? ', and more.' : '.'}` : ''}`);
      setSelectedIds(new Set(failures.map(({ id }) => id)));
    } catch (err) {
      updateItems((current) => current.map((asset) => previous.get(asset.id) ?? asset));
      setNotice(err instanceof Error ? err.message : 'Bulk update failed');
    }
  }

  const handleSaved = useCallback((asset: Asset) => {
    updateItems((current) => current.map((item) => item.id === asset.id ? asset : item));
  }, [updateItems]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      {!isOnline && (
        <div className="offline-banner" role="alert">
          You are offline. Existing results remain available; reconnect to load or save changes.
        </div>
      )}

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) =>
                setStatus((prev) =>
                  e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                )
              }
            />
            {statusLabel(s)}
          </label>
        ))}
        {KINDS.map((assetKind) => (
          <label key={assetKind}>
            <input
              type="checkbox"
              checked={kind.includes(assetKind)}
              onChange={(event) => setKind((current) => event.target.checked ? [...current, assetKind] : current.filter((value) => value !== assetKind))}
            />
            {assetKind}
          </label>
        ))}
        <input
          className="tag-filter"
          type="search"
          placeholder="Tags: hero, campaign"
          value={tagInput}
          onChange={(event) => setTagInput(event.target.value)}
          aria-label="Filter by tags"
        />
        <span className="muted" aria-live="polite">
          {loading ? 'Loading assets…' : `${items.length} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {items.length > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected of {items.length} loaded</span>
          <button onClick={selectAllLoaded} disabled={selectedIds.size === items.length}>Select all loaded</button>
          {selectedIds.size > 0 && <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>}
          {selectedIds.size > 0 && STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && items.length === 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          {retryableIds.length > 0 && retryStatus && (
            <button onClick={() => applyBulkStatus(retryStatus, retryableIds)}>
              Retry {retryableIds.length} temporary failure{retryableIds.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
      {error && items.length > 0 && <p className="error">{error}</p>}

      <main className="content">
        <div className="results">
          {loading && items.length === 0 ? (
            <div className="empty" role="status"><p>Loading assets…</p></div>
          ) : error && items.length === 0 ? (
            <div className="empty error-state" role="alert">
              <p>We could not load these assets.</p>
              <p className="muted">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="empty">
              <p>No assets match these filters.</p>
              <p className="muted">Try a different search or clear a filter.</p>
            </div>
          ) : (
            <>
              <AssetGrid
                assets={items}
                selectedIds={selectedIds}
                activeId={activeId}
                onToggleSelect={toggleSelect}
                onOpen={setActiveId}
                onReachEnd={hasMore && !loadingMore ? loadMore : undefined}
              />
              {loadingMore && <p className="load-more" role="status">Loading more assets…</p>}
            </>
          )}
        </div>
        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
