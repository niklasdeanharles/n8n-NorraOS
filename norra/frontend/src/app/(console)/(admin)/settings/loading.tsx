import { LoadingRegion, SkeletonCard, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar action={false} />
      <LoadingRegion label="Einstellungen werden geladen">
        <SkeletonForm fields={3} />
        <SkeletonForm fields={1} />
        <SkeletonCard />
      </LoadingRegion>
    </>
  );
}
