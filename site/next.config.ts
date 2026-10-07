import type { NextConfig } from 'next';
import path from 'node:path';

// A static export: plain files for Cloudflare Pages. trailingSlash writes page/index.html,
// so any static host serves /page/. Security headers live in public/_headers.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  turbopack: { root: path.resolve('..') },
};
export default config;
