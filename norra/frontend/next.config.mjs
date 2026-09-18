/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Buendelt Server und nur die tatsaechlich erreichten Abhaengigkeiten nach
  // `.next/standalone`. Vercel braucht das nicht, ignoriert es aber auch nicht
  // stoerend -- fuer ein eigenes Image ist es der Unterschied zwischen ~200 MB
  // und dem kompletten node_modules.
  output: 'standalone',
  // Pins tracing to this repository. Left over from living inside a monorepo,
  // and still correct standalone: without it Next walks up looking for a
  // lockfile and can pick one outside the checkout.
  outputFileTracingRoot: import.meta.dirname,
  // Fail the build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
