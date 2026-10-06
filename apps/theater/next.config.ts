import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  allowedDevOrigins: process.env.DEMO_HOSTNAME ? [process.env.DEMO_HOSTNAME] : [],
  transpilePackages: ['@decision/gateway'],
  serverExternalPackages: ['fastify', '@fastify/bearer-auth'],
  turbopack: { root: path.resolve('../..') },
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'same-origin' },
  ] }]; },
};
export default config;
