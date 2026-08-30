import { LoadingRegion, SkeletonCard, SkeletonMetrics, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Posteingang wird geladen">
        <SkeletonMetrics count={3} />
        <SkeletonCard>
          <div>
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="skel-row">
                <div className="skel skel-line" style={{ width: '38%' }} />
                <div className="skel skel-line" style={{ width: '12%' }} />
                <div className="skel skel-line" style={{ width: '14%' }} />
                <div className="skel skel-line" style={{ width: '16%' }} />
              </div>
            ))}
          </div>
        </SkeletonCard>
      </LoadingRegion>
    </>
  );
}
