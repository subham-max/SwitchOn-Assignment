import { thumbnailUrl } from '@/api/client';
import { memo, useEffect, useRef, useState } from 'react';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string, extendRange: boolean) => void;
  onOpen: (id: string) => void;
  onReachEnd?: () => void;
}

/**
 * Baseline grid. Renders every row it is given, re-renders every card on any
 * selection change, and is not reachable by keyboard.
 */
const CARD_MIN_WIDTH = 220;
const CARD_HEIGHT = 278;
const GRID_GAP = 12;
const GRID_PADDING = 16;

export function AssetGrid({ assets, selectedIds, activeId, onToggleSelect, onOpen, onReachEnd }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [columns, setColumns] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedId, setFocusedId] = useState(assets[0]?.id ?? null);

  useEffect(() => {
    if (focusedId && assets.some((asset) => asset.id === focusedId)) return;
    setFocusedId(assets[0]?.id ?? null);
  }, [assets, focusedId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const availableWidth = viewport.clientWidth - GRID_PADDING * 2 + GRID_GAP;
      setColumns(Math.max(1, Math.floor(availableWidth / (CARD_MIN_WIDTH + GRID_GAP))));
      setViewportHeight(viewport.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && onReachEnd && viewport.scrollHeight <= viewport.clientHeight) onReachEnd();
  }, [assets.length, onReachEnd]);

  const rowCount = Math.ceil(assets.length / columns);
  const rowStride = CARD_HEIGHT + GRID_GAP;
  const firstRow = Math.max(0, Math.floor(scrollTop / rowStride) - 2);
  const visibleRows = Math.ceil(viewportHeight / rowStride) + 4;
  const lastRow = Math.min(rowCount, firstRow + visibleRows);
  const visibleAssets = assets.slice(firstRow * columns, lastRow * columns);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    setScrollTop(nextScrollTop);
    if (onReachEnd && event.currentTarget.scrollHeight - nextScrollTop - event.currentTarget.clientHeight < rowStride * 3) {
      onReachEnd();
    }
  }

  function moveFocus(index: number) {
    const nextIndex = Math.max(0, Math.min(assets.length - 1, index));
    const nextAsset = assets[nextIndex];
    if (!nextAsset) return;
    setFocusedId(nextAsset.id);
    const row = Math.floor(nextIndex / columns);
    const nextTop = row * rowStride;
    const viewport = viewportRef.current;
    if (viewport && (nextTop < viewport.scrollTop || nextTop + CARD_HEIGHT > viewport.scrollTop + viewport.clientHeight)) {
      viewport.scrollTop = Math.max(0, nextTop - CARD_HEIGHT);
    }
    requestAnimationFrame(() => cardRefs.current.get(nextAsset.id)?.focus());
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>, assetIndex: number, assetId: string) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocus(assetIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus(assetIndex - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(assetIndex + columns);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(assetIndex - columns);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(assetId);
    } else if (event.key === ' ') {
      event.preventDefault();
      onToggleSelect(assetId, event.shiftKey);
    }
  }

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="grid" role="grid" aria-label="Media assets" onScroll={handleScroll}>
      <div className="grid__spacer" style={{ height: Math.max(0, rowCount * rowStride - GRID_GAP + GRID_PADDING * 2) }}>
        <div className="grid__window" style={{ transform: `translateY(${firstRow * rowStride + GRID_PADDING}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {visibleAssets.map((asset, visibleIndex) => {
        const assetIndex = firstRow * columns + visibleIndex;
        return (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={selectedIds.has(asset.id)}
          active={activeId === asset.id}
          focused={focusedId === asset.id}
          cardRef={(element) => {
            if (element) cardRefs.current.set(asset.id, element);
            else cardRefs.current.delete(asset.id);
          }}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onKeyDown={(event) => handleCardKeyDown(event, assetIndex, asset.id)}
        />
        );
      })}
        </div>
      </div>
    </div>
  );
}

const AssetCard = memo(function AssetCard({ asset, selected, active, focused, cardRef, onToggleSelect, onOpen, onKeyDown }: {
  asset: Asset;
  selected: boolean;
  active: boolean;
  focused: boolean;
  cardRef: (element: HTMLDivElement | null) => void;
  onToggleSelect: (id: string, extendRange: boolean) => void;
  onOpen: (id: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(!asset.hasThumbnail);

  return (
    <div
      ref={cardRef}
      className={'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')}
      role="gridcell"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-asset-id={asset.id}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(asset.id)}
    >
      {thumbnailFailed ? (
        <div className="card__thumb card__thumb--missing" role="img" aria-label="Thumbnail unavailable">No preview</div>
      ) : (
        <img className="card__thumb" src={thumbnailUrl(asset.id)} alt="" loading="lazy" onError={() => setThumbnailFailed(true)} />
      )}
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted">{asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}</p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        aria-label={`Select ${asset.name}`}
        checked={selected}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelect(asset.id, event.shiftKey);
        }}
        onChange={() => undefined}
      />
    </div>
  );
});
