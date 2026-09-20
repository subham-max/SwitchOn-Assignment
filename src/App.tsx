import { useEffect, useState } from 'react';
import { ApiError, bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];
const SORT_VALUES = new Set(SORTS.map((option) => option.value));

function initialQueryState() {
  const params = new URLSearchParams(window.location.search);
  const requestedSort = params.get('sort') as NonNullable<AssetQuery['sort']> | null;
  return {
    q: params.get('q') ?? '',
    status: params.get('status')?.split(',').filter((value): value is AssetStatus => STATUSES.includes(value as AssetStatus)) ?? [],
    sort: requestedSort && SORT_VALUES.has(requestedSort) ? requestedSort : 'updatedAt:desc' as const,
  };
}

export function App() {
  const [initial] = useState(initialQueryState);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>(initial.sort);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { items, total, loading, loadingMore, error, hasMore, loadMore, updateItems } = useAssets({ q, status, sort, limit: 24 });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (q) params.set('q', q);
    else params.delete('q');
    if (status.length) params.set('status', status.join(','));
    else params.delete('status');
    params.set('sort', sort);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [q, status, sort]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);

    const previous = new Map(items.filter((asset) => selectedIds.has(asset.id)).map((asset) => [asset.id, asset]));
    updateItems((current) => current.map((asset) => (selectedIds.has(asset.id) ? { ...asset, status: next } : asset)));

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
      setNotice(failures.length === 0
        ? `${applied} assets updated successfully.`
        : `${applied} updated. ${failures.length} failed: ${failures.slice(0, 3).map((failure) => `${failure.id} (${failure.code})`).join(', ')}${failures.length > 3 ? ', and more.' : '.'}`);
      setSelectedIds(new Set(failures.map(({ id }) => id)));
    } catch (err) {
      updateItems((current) => current.map((asset) => previous.get(asset.id) ?? asset));
      setNotice(err instanceof Error ? err.message : 'Bulk update failed');
    }
  }

  function handleSaved(asset: Asset) {
    updateItems((current) => current.map((item) => item.id === asset.id ? asset : item));
  }

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
        <span className="muted" aria-live="polite">
          {loading ? 'Loading assets…' : `${items.length} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {selectedIds.size > 0 && (
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

      {notice && <p className="notice">{notice}</p>}
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
              />
              {hasMore && (
                <button className="load-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading more…' : 'Load more assets'}
                </button>
              )}
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
