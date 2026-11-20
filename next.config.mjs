// The CI image build sets NEXT_SKIP_CHECKS=true: the fast job already ran the lint and the type check, and `next build`
// runs both by default (#403). A release image and a local build leave it unset, so both keep the checks.
const skipChecks = process.env.NEXT_SKIP_CHECKS === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The development "N" badge is never part of a screen: it would show in design captures (dev only).
  devIndicators: false,
  experimental: { staleTimes: { dynamic: 300, static: 300 }, serverActions: { bodySizeLimit: '51mb' } },
  ...(skipChecks ? { eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: true } } : {}),
};
export default nextConfig;
