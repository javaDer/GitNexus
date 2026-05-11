#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const coreDir = path.resolve(__dirname, '..', 'node_modules', '@ladybugdb', 'core');
const target = path.join(coreDir, 'lbugjs.node');

if (fs.existsSync(target)) {
  console.log('[ladybugdb] native binding already present');
  process.exit(0);
}

const platform = process.platform;
const arch = process.arch;
const packageName = `@ladybugdb/core-${platform}-${arch}`;

let source;
try {
  const packageJson = require.resolve(`${packageName}/package.json`, { paths: [coreDir] });
  source = path.join(path.dirname(packageJson), 'lbugjs.node');
} catch {
  source = path.resolve(coreDir, 'prebuilt', `lbugjs-${platform}-${arch}.node`);
}

if (!fs.existsSync(source)) {
  console.error(`[ladybugdb] missing native binding for ${platform}-${arch}`);
  console.error(`[ladybugdb] expected ${packageName} or ${source}`);
  process.exit(1);
}

fs.copyFileSync(source, target);
console.log(`[ladybugdb] copied native binding from ${source}`);
