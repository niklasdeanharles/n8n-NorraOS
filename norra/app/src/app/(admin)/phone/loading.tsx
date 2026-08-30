import { LoadingRegion, SkeletonCard, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Telefonnummern werden geladen">
        <SkeletonCard />
        <SkeletonForm fields={2} />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
