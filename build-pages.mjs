import { readFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

try {
  const wranglerConfigPath = resolve('dist', 'server', 'wrangler.json');
  if (existsSync(wranglerConfigPath)) {
    const w = JSON.parse(readFileSync(wranglerConfigPath, 'utf8'));
    const mainPath = resolve('dist', 'server', w.main);
    const targetPath = resolve('dist', '_worker.js');
    copyFileSync(mainPath, targetPath);
    console.log(`[Pages Adapter] Copied worker from ${w.main} to dist/_worker.js`);
  } else {
    console.warn("[Pages Adapter] wrangler.json not found in dist/server/");
  }
} catch (e) {
  console.error("[Pages Adapter] Error adapting for Pages:", e);
  process.exit(1);
}
