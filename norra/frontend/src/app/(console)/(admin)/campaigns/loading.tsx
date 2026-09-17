import { LoadingRegion, SkeletonCard, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Kampagnen werden geladen">
        <SkeletonForm fields={8} />
        <SkeletonCard />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
