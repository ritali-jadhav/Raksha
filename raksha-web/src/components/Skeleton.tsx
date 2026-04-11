/**
 * Reusable skeleton loading components with shimmer animations
 */

export function SkeletonText({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return (
    <div className="skeleton" style={{ width, height, borderRadius: 6 }} />
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="skeleton" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonText width="60%" height={16} />
          <SkeletonText width="40%" height={12} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonMap() {
  return (
    <div className="skeleton" style={{
      width: '100%',
      height: 200,
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <span style={{ fontSize: 32, opacity: 0.3 }}>🗺️</span>
    </div>
  );
}

export function SkeletonActionGrid() {
  return (
    <div className="actions-grid">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 90, borderRadius: 'var(--radius-md)' }} />
      ))}
    </div>
  );
}
