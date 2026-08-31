import { LoadingRegion, SkeletonCard, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Team wird geladen">
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
