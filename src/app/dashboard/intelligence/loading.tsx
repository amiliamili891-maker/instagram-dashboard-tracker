export default function Loading() {
  return (
    <section className="intelligence-page">
      <div className="skeleton-line" style={{ width: '12rem', height: '1.5rem', marginBottom: '1.5rem' }} />

      {/* Section card skeletons */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="intelligence-section" style={{ marginBottom: '1.5rem' }}>
          <div className="skeleton-line" style={{ width: '10rem', height: '1.2rem', marginBottom: '1rem' }} />
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
            <div className="skeleton-line" style={{ width: '100%', height: '4rem', borderRadius: '0.5rem' }} />
            <div className="skeleton-line" style={{ width: '100%', height: '4rem', borderRadius: '0.5rem' }} />
          </div>
        </div>
      ))}
    </section>
  );
}
