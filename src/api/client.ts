import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

/** Shared request handling keeps transient failures and API error codes explicit. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
  const exponentialMs = Math.min(4000, 300 * 2 ** attempt);
  const jitterMs = Math.round(Math.random() * 200);
  return Math.max(retryAfterMs, exponentialMs + jitterMs);
}

function isRetryableStatus(status: number, method: string): boolean {
  return status === 429 || status === 503 || (status === 500 && method !== 'GET');
}

function userMessage(code: string, status: number, fallback: string): string {
  if (code === 'offline') return 'You are offline. Reconnect to continue working.';
  if (code === 'rate_limited') return 'The service is busy. We will try again shortly.';
  if (code === 'upstream_unavailable') return 'The service is temporarily unavailable.';
  if (code === 'version_conflict') return 'This asset changed before your edit was saved.';
  if (code === 'stale_cursor') return 'The results changed. Refreshing this view is required.';
  return status >= 500 ? 'The service could not complete that request.' : fallback;
}

interface InFlightAssetRequest {
  controller: AbortController;
  consumers: number;
  promise: Promise<AssetPage>;
}

const inFlightAssetRequests = new Map<string, InFlightAssetRequest>();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new ApiError(userMessage('offline', 0, ''), 0, 'offline', false);
      }
      const res = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (res.ok) return res.json() as Promise<T>;

      let code = 'request_failed';
      let detail = res.statusText;
      try {
        const body = await res.json();
        code = body?.error?.code ?? code;
        detail = body?.error?.message ?? detail;
      } catch {
        /* response was not JSON */
      }

      const retryable = isRetryableStatus(res.status, method);
      if (retryable && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, res.headers.get('retry-after'))));
        continue;
      }
      throw new ApiError(userMessage(code, res.status, detail), res.status, code, retryable);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new ApiError(userMessage('offline', 0, ''), 0, 'offline', false);
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, null)));
        continue;
      }
      throw new ApiError('The network connection failed. Please try again.', 0, 'network_error', true);
    }
  }

  throw new ApiError('The request could not be completed.', 0, 'request_failed', false);
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  const key = toSearchParams(query);
  let entry = inFlightAssetRequests.get(key);
  if (!entry) {
    const controller = new AbortController();
    const promise = request<AssetPage>(`/api/assets?${key}`, { signal: controller.signal });
    entry = { controller, consumers: 0, promise };
    inFlightAssetRequests.set(key, entry);
    promise.finally(() => {
      if (inFlightAssetRequests.get(key)?.promise === promise) inFlightAssetRequests.delete(key);
    }).catch(() => undefined);
  }

  const requestEntry = entry;
  requestEntry.consumers += 1;
  return new Promise<AssetPage>((resolve, reject) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      requestEntry.consumers -= 1;
      signal?.removeEventListener('abort', onAbort);
      if (requestEntry.consumers === 0) {
        requestEntry.controller.abort();
        if (inFlightAssetRequests.get(key)?.promise === requestEntry.promise) inFlightAssetRequests.delete(key);
      }
    };
    const onAbort = () => {
      release();
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    requestEntry.promise.then((page) => {
      if (settled) return;
      release();
      resolve(page);
    }, (error: unknown) => {
      if (settled) return;
      release();
      reject(error);
    });
  });
}

export function getAsset(id: string): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`);
}

export function getAssetsByIds(ids: string[]): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call.
  return request(`/api/assets/batch?ids=${ids.join(',')}`);
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
  });
}

export function bulkSetStatus(ids: string[], status: Asset['status']): Promise<BulkResult> {
  // Note: the endpoint rejects more than 50 ids per call.
  return request<BulkResult>('/api/assets/bulk-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
