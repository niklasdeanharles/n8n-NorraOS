/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pins tracing to this repository. Left over from living inside a monorepo,
  // and still correct standalone: without it Next walks up looking for a
  // lockfile and can pick one outside the checkout.
  outputFileTracingRoot: import.meta.dirname,
  // Fail the build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
