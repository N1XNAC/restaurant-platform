#!/usr/bin/env node
/**
 * Build the customer website for static hosting (Netlify).
 *
 * Lives inside the site folder on purpose: Netlify runs the build with the
 * site's **base directory** as the working directory, so `node build.mjs`
 * resolves no matter how the repository is checked out. (A `node
 * ../deploy/...` command breaks when the base directory is left unset and
 * Netlify runs from the repo root.)
 *
 * It copies the app into `dist`, writes `js/runtime-config.js` with the backend
 * origin, and injects that script before `js/config.js` on every page. The app
 * source itself stays untouched.
 *
 * Usage (from this folder, or from anywhere — paths are resolved from this file):
 *   API_BASE_URL=https://api.example.com node build.mjs
 *
 * With no API_BASE_URL the generated config is empty, which keeps the
 * same-origin behaviour used when the backend serves the site at `/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file sits in customer-site/, next to index.html.
const siteDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(siteDir, 'dist');

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

// On a static host (Netlify, GitHub Pages) there is no backend on the same
// origin, so an empty value would produce a site whose every API call 404s
// against the static host. Fail the build loudly instead, unless the builder
// explicitly opts into same-origin.
const requiresRemoteApi =
  process.env.NETLIFY === 'true' || process.env.GITHUB_ACTIONS === 'true';
if (!apiBaseUrl && requiresRemoteApi && process.env.ALLOW_SAME_ORIGIN !== 'true') {
  console.error(
    'API_BASE_URL is not set. In the hosting settings add:\n' +
      '  API_BASE_URL = https://api.your-domain.com\n' +
      '(the origin of the backend that serves /api).'
  );
  process.exit(1);
}

const SKIP = new Set([
  'dist',
  'node_modules',
  '.netlify',
  '.github',
  '.git',
  'netlify.toml',
  'build.mjs',
  'README.md',
  '.DS_Store',
]);

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
copyDir(siteDir, outDir);

const runtimeConfig = `// Generated at build time by customer-site/build.mjs
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

console.log(`Customer site built into ${path.relative(process.cwd(), outDir) || outDir}`);
console.log(`  API base URL: ${apiBaseUrl || '(same origin)'}`);
console.log(`  HTML pages patched: ${patched}`);
