export default function Loading() {
  return (
    <section className="trends-page">
      <header className="trends-header">
        <div className="skeleton-line" style={{ width: '6rem', height: '1.5rem' }} />
      </header>

      {/* Controls skeleton */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div className="skeleton-line" style={{ width: '10rem', height: '2rem' }} />
        <div className="skeleton-line" style={{ width: '8rem', height: '2rem' }} />
        <div className="skeleton-line" style={{ width: '8rem', height: '2rem' }} />
      </div>

      {/* Chart placeholder */}
      <div className="skeleton-line" style={{ width: '100%', height: '300px', borderRadius: '0.5rem' }} />

      {/* Table skeleton */}
      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-line" style={{ width: '100%', height: '2rem' }} />
        ))}
      </div>
    </section>
  );
}
