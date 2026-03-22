export default function Loading() {
  return (
    <section className="sessions-page">
      <header className="sessions-header">
        <div className="skeleton-line" style={{ width: '6rem', height: '1.5rem' }} />
        <div className="skeleton-line" style={{ width: '4rem', height: '1rem' }} />
      </header>

      {/* Controls skeleton */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div className="skeleton-line" style={{ width: '8rem', height: '2rem' }} />
        <div className="skeleton-line" style={{ width: '8rem', height: '2rem' }} />
        <div className="skeleton-line" style={{ width: '8rem', height: '2rem' }} />
      </div>

      {/* Table rows skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
        <div className="skeleton-line" style={{ width: '100%', height: '2.5rem' }} />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton-line" style={{ width: '100%', height: '2rem' }} />
        ))}
      </div>
    </section>
  );
}
