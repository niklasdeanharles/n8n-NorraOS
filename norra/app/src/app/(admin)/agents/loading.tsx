import { LoadingRegion, SkeletonCard, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar />
      <LoadingRegion label="Agenten werden geladen">
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
