import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { transform } from 'esbuild';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function buildStatic() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }

  ensureDir(path.join(DIST, 'css'));
  ensureDir(path.join(DIST, 'js'));
  ensureDir(path.join(DIST, 'assets', 'images'));

  for (const file of fs.readdirSync(ROOT)) {
    if (file.endsWith('.html')) {
      const htmlContent = fs.readFileSync(path.join(ROOT, file), 'utf8');
      fs.writeFileSync(path.join(DIST, file), minifyHtml(htmlContent), 'utf8');
    }
  }

  for (const file of fs.readdirSync(path.join(ROOT, 'css'))) {
    if (file.endsWith('.css')) {
      const raw = fs.readFileSync(path.join(ROOT, 'css', file), 'utf8');
      const result = await transform(raw, { loader: 'css', minify: true });
      fs.writeFileSync(path.join(DIST, 'css', file), result.code, 'utf8');
    }
  }

  for (const file of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (file.endsWith('.js')) {
      const srcPath = path.join(ROOT, 'js', file);
      execSync(`node --check "${srcPath}"`, { stdio: 'inherit' });
      const raw = fs.readFileSync(srcPath, 'utf8');
      const result = await transform(raw, {
        loader: 'js',
        minify: true,
        target: 'es2020',
      });
      fs.writeFileSync(path.join(DIST, 'js', file), result.code, 'utf8');
    }
  }

  for (const file of fs.readdirSync(path.join(ROOT, 'assets', 'images'))) {
    fs.copyFileSync(
      path.join(ROOT, 'assets', 'images', file),
      path.join(DIST, 'assets', 'images', file)
    );
  }

  for (const deployFile of ['netlify.toml', 'vercel.json']) {
    const filePath = path.join(ROOT, deployFile);
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, path.join(DIST, deployFile));
    }
  }

  console.log('Static production bundle minified and written to dist/');
}

buildStatic().catch((err) => {
  console.error('Static build failed:', err);
  process.exit(1);
});
