import { LoadingRegion, SkeletonForm, SkeletonTopbar } from '@/components/skeleton';

export default function Loading() {
  return (
    <>
      <SkeletonTopbar />
      <LoadingRegion label="Agent wird geladen">
        <SkeletonForm />
        <SkeletonForm fields={2} />
        <SkeletonForm fields={3} />
      </LoadingRegion>
    </>
  );
}
