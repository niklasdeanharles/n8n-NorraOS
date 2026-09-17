import { LoadingRegion, SkeletonMetrics, SkeletonTable, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Betriebszustand wird geladen">
        <SkeletonMetrics count={4} />
        <SkeletonTable rows={3} columns={[26, 20, 12, 12, 18]} />
        <SkeletonTable rows={4} columns={[20, 44, 10, 14]} />
      </LoadingRegion>
    </>
  );
}
