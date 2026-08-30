import { LoadingRegion, SkeletonCard, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Nummer wird geladen">
        <SkeletonForm fields={3} />
        <SkeletonForm fields={2} />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
