/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The development "N" badge is never part of a screen: it would show in design captures (dev only).
  devIndicators: false,
  experimental: { staleTimes: { dynamic: 300, static: 300 }, serverActions: { bodySizeLimit: '51mb' } },
};
export default nextConfig;
