import { LoadingRegion, SkeletonCard, SkeletonMetrics, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Wissensbasis wird geladen">
        <SkeletonMetrics count={3} />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
