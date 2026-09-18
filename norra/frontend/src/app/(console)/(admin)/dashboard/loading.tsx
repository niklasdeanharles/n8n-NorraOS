import { LoadingRegion, SkeletonCard, SkeletonMetrics, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar />
      <LoadingRegion label="Übersicht wird geladen">
        <SkeletonMetrics />
        <SkeletonCard />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
