import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: appDir,
  },
};

export default nextConfig;
