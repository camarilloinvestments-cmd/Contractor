/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: process.env.NEXT_OUTPUT_MODE,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: process.env.NEXT_OUTPUT_MODE ? path.join(__dirname, '../') : '/',
  images: { unoptimized: true },
  async headers() {
    // Self-hosted security headers. GPS is mandatory so geolocation is allowed
    // for same-origin; camera/microphone are disabled. Fonts are self-hosted via
    // next/font, map tiles come from OpenStreetMap, uploads/logos from the
    // configured S3 origin (S3_PUBLIC_ORIGIN), so those are whitelisted below.
    const s3Origin = process.env.S3_PUBLIC_ORIGIN || '';
    const imgExtra = s3Origin ? ` ${s3Origin}` : '';
    const connectExtra = s3Origin ? ` ${s3Origin}` : '';
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Next.js injects inline bootstrap scripts; 'unsafe-inline' is required
      // without a per-request nonce. No remote script origins are allowed.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      `img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org${imgExtra}`,
      `connect-src 'self'${connectExtra}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
  // Next 16 BLOCKS unlisted origins on /_next/* and /__nextjs* in dev — including the /_next/hmr
  // WEBSOCKET upgrade, and Turbopack gates client module wiring on that socket, so a blocked origin
  // means the page renders but never hydrates, with no console error (the block writes a raw
  // non-HTTP reply onto the upgrade socket). Every conversation sharing this project directory —
  // the root and each of its forks — previews from its OWN subdomain against this one config, so
  // each of their hosts is named here; listing only the current one leaves the others hydrating
  // never. Plus 127.0.0.1 because Next's built-in default covers `localhost` but not the IP, and
  // the platform's browser checks on the pod browse via 127.0.0.1. Enumerated hosts, never a
  // wildcard: every conversation previews under the same parent domain and serves content its own
  // author controls, so `**.<domain>` would let any UNRELATED app's preview reach this dev server.
  allowedDevOrigins: ['127.0.0.1', '90fad4cdd.na111.preview.abacusai.app'],
};

const fs = require('fs');
const userConfigPath = path.join(__dirname, 'next.config.user.json');
const userConfigAllowedKeys = { skipTrailingSlashRedirect: 'boolean', trailingSlash: 'boolean' };
if (fs.existsSync(userConfigPath)) {
  const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
  for (const key of Object.keys(userConfig)) {
    if (typeof userConfig[key] !== userConfigAllowedKeys[key]) {
      throw new Error(`next.config.user.json: unsupported override "${key}". Supported boolean keys: skipTrailingSlashRedirect, trailingSlash.`);
    }
    nextConfig[key] = userConfig[key];
  }
}

module.exports = nextConfig;

