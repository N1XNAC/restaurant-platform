#!/usr/bin/env node
/**
 * Build the customer website for static hosting (Netlify).
 *
 * The received customer app was written to call `/api/...` on its own origin.
 * This script copies it into `customer-site/dist`, writes a tiny runtime config
 * with the backend origin, and injects that config before `js/config.js` on
 * every page. The app source itself stays untouched.
 *
 * Usage:
 *   API_BASE_URL=https://api.example.com node deploy/netlify/build-customer-site.mjs
 *
 * With no API_BASE_URL the generated config is empty, which keeps the
 * same-origin behaviour used when the backend serves the site at `/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const sourceDir = path.join(repoRoot, 'customer-site');
const outDir = path.join(sourceDir, 'dist');

const rawBase = (
  process.env.API_BASE_URL ??
  process.env.CUSTOMER_API_BASE_URL ??
  ''
).trim();

let apiBaseUrl = '';
if (rawBase) {
  let parsed;
  try {
    parsed = new URL(rawBase);
  } catch {
    console.error(`API_BASE_URL is not a valid URL: ${rawBase}`);
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error(`API_BASE_URL must be http(s), received: ${rawBase}`);
    process.exit(1);
  }
  apiBaseUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

// On Netlify there is no backend on the same origin, so an empty value would
// produce a site whose every API call 404s against the Netlify domain. Fail the
// build loudly instead, unless the builder explicitly opts into same-origin.
if (!apiBaseUrl && process.env.NETLIFY === 'true' && process.env.ALLOW_SAME_ORIGIN !== 'true') {
  console.error(
    'API_BASE_URL is not set. In the Netlify site settings add:\n' +
      '  API_BASE_URL = https://api.your-domain.com\n' +
      '(the origin of the backend that serves /api).'
  );
  process.exit(1);
}

const SKIP = new Set(['dist', 'node_modules', '.netlify', 'netlify.toml', '.DS_Store']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
copyDir(sourceDir, outDir);

const runtimeConfig = `// Generated at build time by deploy/netlify/build-customer-site.mjs
// Do not edit: change API_BASE_URL in the Netlify environment instead.
window.__MV_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};
`;
fs.mkdirSync(path.join(outDir, 'js'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'js', 'runtime-config.js'), runtimeConfig);

const CONFIG_TAG = '<script src="js/config.js" defer></script>';
const RUNTIME_TAG = '<script src="js/runtime-config.js" defer></script>';

let patched = 0;
for (const file of fs.readdirSync(outDir)) {
  if (!file.endsWith('.html')) continue;
  const full = path.join(outDir, file);
  const html = fs.readFileSync(full, 'utf8');
  if (html.includes('js/runtime-config.js')) continue;
  if (!html.includes(CONFIG_TAG)) {
    console.warn(`! ${file}: could not find js/config.js include, left unchanged`);
    continue;
  }
  fs.writeFileSync(full, html.replace(CONFIG_TAG, `${RUNTIME_TAG}\n    ${CONFIG_TAG}`));
  patched += 1;
}

console.log(`Customer site built into customer-site/dist`);
console.log(`  API base URL: ${apiBaseUrl || '(same origin)'}`);
console.log(`  HTML pages patched: ${patched}`);
