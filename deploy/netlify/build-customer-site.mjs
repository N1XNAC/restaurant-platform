#!/usr/bin/env node
/**
 * CLI entry point for building the customer website.
 *
 * The implementation lives in `customer-site/build.mjs` so that Netlify can run
 * `node build.mjs` from the site's base directory without reaching outside it.
 * This wrapper keeps `node deploy/netlify/build-customer-site.mjs` working from
 * the repo root (used by deploy-customer.sh and local previews).
 *
 * Usage:
 *   API_BASE_URL=https://api.example.com node deploy/netlify/build-customer-site.mjs
 */
import '../../customer-site/build.mjs';
