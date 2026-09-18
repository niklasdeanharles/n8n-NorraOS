import { LoadingRegion, SkeletonBars, SkeletonCard, SkeletonMetrics, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Auswertung wird geladen">
        <SkeletonMetrics />
        <SkeletonCard><SkeletonBars /></SkeletonCard>
        <SkeletonCard><SkeletonBars rows={4} /></SkeletonCard>
      </LoadingRegion>
    </>
  );
}
