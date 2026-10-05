import path from 'node:path';
import type { NextConfig } from 'next';

// Браузер обращается к /api/v1 на том же origin; Next.js проксирует запросы во внутренний API.
// Значение читается при сборке (next.config сериализуется в standalone-сервер), поэтому в Docker
// API_INTERNAL_URL передаётся как build-arg. Серверные компоненты читают API_INTERNAL_URL во время выполнения.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
