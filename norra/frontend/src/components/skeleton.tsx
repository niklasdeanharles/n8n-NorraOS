/**
 * Loading placeholders for the admin routes.
 *
 * Next.js streams `loading.tsx` while a server component awaits its data, so
 * these run in the real layout — same paddings, same card frames, same column
 * count as the page they stand in for. That is the point: a skeleton whose
 * shape differs from the result produces a visible jump when the data lands.
 */

export function SkeletonTopbar({ action = true }: { action?: boolean }) {
  return (
    <header className="topbar">
      <div style={{ width: '100%', maxWidth: 320 }}>
        <div className="skel skel-title" style={{ width: 150, height: 18 }} />
        <div className="skel skel-line" style={{ width: 230, marginTop: 8 }} />
      </div>
      {action ? <div className="skel" style={{ width: 132, height: 32, borderRadius: 999 }} /> : null}
    </header>
  );
}

export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="metrics">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="metric">
          <div className="skel skel-line" style={{ width: '58%' }} />
          <div className="skel skel-metric" />
          <div className="skel skel-line" style={{ width: '42%', marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

/** Column widths are fractions of the row so the stand-in matches the table. */
export function SkeletonTable({ rows = 6, columns = [40, 16, 16, 14] }: { rows?: number; columns?: number[] }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="skel-row">
          {columns.map((width, c) => (
            <div key={c} className="skel skel-line" style={{ width: `${width}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ title, children }: { title?: boolean; children?: React.ReactNode }) {
  return (
    <div className="card card-body-flush">
      <div className="card-head">
        {title === false ? null : <div className="skel skel-title" style={{ width: 170 }} />}
      </div>
      {children ?? <SkeletonTable />}
    </div>
  );
}

export function SkeletonBars({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card-body">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bar-row">
          <div>
            <div className="skel skel-line" style={{ width: `${58 - i * 6}%`, marginBottom: 8 }} />
            <div className="skel skel-bar" style={{ width: `${92 - i * 14}%` }} />
          </div>
          <div className="skel skel-line" style={{ width: 26 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonForm({ fields = 5 }: { fields?: number }) {
  return (
    <div className="card">
      <div className="card-head"><div className="skel skel-title" style={{ width: 130 }} /></div>
      <div className="card-body form-grid">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i}>
            <div className="skel skel-line" style={{ width: '45%', marginBottom: 9 }} />
            <div className="skel" style={{ height: 38, borderRadius: 'var(--radius-sm)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps a loading screen. `aria-busy` plus a polite label is what a screen
 * reader gets — the shimmer says nothing to it.
 */
export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="content stack skel-region" style={{ gap: 20 }} aria-busy="true" aria-live="polite" aria-label={label}>
      {children}
    </div>
  );
}
