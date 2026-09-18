import { LoadingRegion, SkeletonCard, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Bestellquellen werden geladen">
        <SkeletonCard />
        <SkeletonForm fields={6} />
      </LoadingRegion>
    </>
  );
}
