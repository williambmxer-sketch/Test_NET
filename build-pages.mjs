import { readFileSync, writeFileSync, existsSync, cpSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';

try {
  const clientDir = resolve('dist', 'client');
  const distDir = resolve('dist');
  if (existsSync(clientDir)) {
    const items = readdirSync(clientDir);
    const excludes = [];
    for (const item of items) {
      cpSync(resolve(clientDir, item), resolve(distDir, item), { recursive: true });
      const stat = statSync(resolve(clientDir, item));
      if (stat.isDirectory()) {
        excludes.push(`/${item}/*`);
      } else {
        excludes.push(`/${item}`);
      }
    }
    
    const routes = {
      version: 1,
      include: ["/*"],
      exclude: excludes
    };
    writeFileSync(resolve(distDir, '_routes.json'), JSON.stringify(routes, null, 2));
    
    console.log('[Pages Adapter] Copied static assets and generated _routes.json with excludes:', excludes);
  }

  const wranglerConfigPath = resolve('dist', 'server', 'wrangler.json');
  if (existsSync(wranglerConfigPath)) {
    const w = JSON.parse(readFileSync(wranglerConfigPath, 'utf8'));
    // w.main is probably 'index.js'. We want to create dist/_worker.js
    // that imports './server/index.js'
    const targetPath = resolve('dist', '_worker.js');
    const importPath = `./server/${w.main}`;
    
    // Create a proxy worker that exports the original worker
    const proxyWorkerContent = `import worker from "${importPath}";\nexport default worker;\n`;
    writeFileSync(targetPath, proxyWorkerContent);
    
    console.log(`[Pages Adapter] Created proxy worker at dist/_worker.js importing ${importPath}`);
  } else {
    console.warn("[Pages Adapter] wrangler.json not found in dist/server/");
  }
} catch (e) {
  console.error("[Pages Adapter] Error adapting for Pages:", e);
  process.exit(1);
}
