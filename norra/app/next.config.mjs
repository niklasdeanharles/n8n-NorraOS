/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // norra/app is deliberately outside n8n's pnpm workspace. Without this, Next
  // walks up to the monorepo lockfile and traces the wrong file tree.
  outputFileTracingRoot: import.meta.dirname,
  // Fail the build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
