/** @type {import('next').NextConfig} */
// INTERNAL_API_URL is a runtime env var set in docker-compose for server-side rewrites.
// Falls back to localhost:8080 for local `next dev` usage.
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8080';

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  async rewrites() {
    return [
      // Proxy API calls from the browser through Next.js server to the backend
      {
        source: '/api/v1/:path*',
        destination: `${INTERNAL_API_URL}/api/v1/:path*`,
      },
      // Proxy JMeter HTML report static files
      {
        source: '/report/:path*',
        destination: `${INTERNAL_API_URL}/report/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
