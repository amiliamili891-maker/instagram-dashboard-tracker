export default function Loading() {
  return (
    <section className="sync-history">
      <header className="sync-header">
        <div className="sync-header-top">
          <div className="skeleton-line" style={{ width: '8rem', height: '1.5rem' }} />
          <div className="skeleton-line" style={{ width: '6rem', height: '2rem', borderRadius: '0.25rem' }} />
        </div>
        <div className="freshness-info">
          <div className="skeleton-line" style={{ width: '4rem', height: '1.2rem' }} />
          <div className="skeleton-line" style={{ width: '16rem', height: '0.8rem' }} />
        </div>
      </header>

      {/* Table skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
        <div className="skeleton-line" style={{ width: '100%', height: '2.5rem' }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton-line" style={{ width: '100%', height: '2rem' }} />
        ))}
      </div>
    </section>
  );
}
