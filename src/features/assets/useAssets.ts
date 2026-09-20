import { useEffect, useRef, useState } from 'react';
import { listAssets } from '@/api/client';
import type { Asset, AssetQuery } from '@/lib/types';

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const INITIAL_STATE: State = {
  items: [],
  total: 0,
  nextCursor: null,
  loading: true,
  loadingMore: false,
  error: null,
};

export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    loadingMore.current = false;
    setState({ ...INITIAL_STATE });

    const timeout = window.setTimeout(() => {
      listAssets(query, requestController.signal)
        .then((page) => {
          if (generation.current !== currentGeneration) return;
          setState({
            items: page.items,
            total: page.total,
            nextCursor: page.nextCursor,
            loading: false,
            loadingMore: false,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (generation.current !== currentGeneration || (err instanceof DOMException && err.name === 'AbortError')) return;
          setState((current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : 'Something went wrong' }));
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      requestController.abort();
    };
  }, [JSON.stringify(query)]);

  function loadMore() {
    if (!state.nextCursor || state.loading || loadingMore.current) return;
    const currentGeneration = generation.current;
    const requestController = controller.current ?? new AbortController();
    controller.current = requestController;
    loadingMore.current = true;
    setState((current) => ({ ...current, loadingMore: true, error: null }));

    listAssets({ ...query, cursor: state.nextCursor }, requestController.signal)
      .then((page) => {
        if (generation.current !== currentGeneration) return;
        setState((current) => ({
          ...current,
          items: [...current.items, ...page.items],
          total: page.total,
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      })
      .catch((err: unknown) => {
        if (generation.current !== currentGeneration || (err instanceof DOMException && err.name === 'AbortError')) return;
        setState((current) => ({ ...current, loadingMore: false, error: err instanceof Error ? err.message : 'Could not load more assets' }));
      })
      .finally(() => {
        if (generation.current === currentGeneration) loadingMore.current = false;
      });
  }

  function updateItems(update: (items: Asset[]) => Asset[]) {
    setState((current) => ({ ...current, items: update(current.items) }));
  }

  return { ...state, hasMore: Boolean(state.nextCursor), loadMore, updateItems };
}
