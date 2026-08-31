import { LoadingRegion, SkeletonCard, SkeletonMetrics, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Freigaben werden geladen">
        <SkeletonMetrics count={3} />
        <SkeletonCard />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
