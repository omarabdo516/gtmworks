/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { staleTimes: { dynamic: 300, static: 300 }, serverActions: { bodySizeLimit: '51mb' } },
};
export default nextConfig;
