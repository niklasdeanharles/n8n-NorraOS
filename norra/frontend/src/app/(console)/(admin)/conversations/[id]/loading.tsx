import { SkeletonTopbar } from '@/components/skeleton';

/** Mirrors the two-column detail layout so the chat does not jump into place. */
export default function Loading() {
  return (
    <>
      <SkeletonTopbar />
      <div
        className="content skel-region"
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 290px', gap: 20, maxWidth: 1240 }}
        aria-busy="true"
        aria-live="polite"
        aria-label="Konversation wird geladen"
      >
        <div className="card">
          <div className="chat">
            <div className="chat-log">
              {[72, 55, 84, 48, 66].map((width, i) => (
                <div key={i} className={i % 2 === 1 ? 'msg msg-user' : 'msg'}>
                  <div className="skel" style={{ width: 28, height: 28, borderRadius: 999, flex: 'none' }} />
                  <div className="skel" style={{ width: `${width * 3.4}px`, height: 42, borderRadius: 'var(--radius)' }} />
                </div>
              ))}
            </div>
            <div className="chat-compose">
              <div className="skel" style={{ height: 44, borderRadius: 'var(--radius-sm)', flex: 1 }} />
              <div className="skel" style={{ width: 96, height: 38, borderRadius: 999 }} />
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><div className="skel skel-title" style={{ width: 110 }} /></div>
            <div className="card-body">
              <div className="skel skel-line" style={{ width: '80%' }} />
              <div className="skel skel-line" style={{ width: '62%' }} />
              <div className="skel skel-line" style={{ width: '70%' }} />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div className="skel skel-title" style={{ width: 90 }} /></div>
            <div className="card-body">
              <div className="skel skel-line" style={{ width: '90%' }} />
              <div className="skel skel-line" style={{ width: '55%' }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
