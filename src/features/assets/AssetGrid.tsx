import { thumbnailUrl } from '@/api/client';
import { memo, useEffect, useRef, useState } from 'react';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
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
  const [columns, setColumns] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

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

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="grid" onScroll={handleScroll}>
      <div className="grid__spacer" style={{ height: Math.max(0, rowCount * rowStride - GRID_GAP + GRID_PADDING * 2) }}>
        <div className="grid__window" style={{ transform: `translateY(${firstRow * rowStride + GRID_PADDING}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {visibleAssets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={selectedIds.has(asset.id)}
          active={activeId === asset.id}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
        />
      ))}
        </div>
      </div>
    </div>
  );
}

const AssetCard = memo(function AssetCard({ asset, selected, active, onToggleSelect, onOpen }: {
  asset: Asset;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(!asset.hasThumbnail);

  return (
    <div
      className={'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')}
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
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleSelect(asset.id)}
      />
    </div>
  );
});
