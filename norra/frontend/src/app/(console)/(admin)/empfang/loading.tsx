import { LoadingRegion, SkeletonCard, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Empfang wird geladen">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonForm fields={6} />
      </LoadingRegion>
    </>
  );
}
