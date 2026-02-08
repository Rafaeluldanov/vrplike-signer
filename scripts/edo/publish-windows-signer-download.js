const fs = require('fs');
const path = require('path');

function mustExistFile(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`File not found: ${p}`);
  }
  const st = fs.statSync(p);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${p}`);
  }
  return st;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function formatBytes(n) {
  const mb = n / (1024 * 1024);
  return `${Math.round(mb * 10) / 10} MB`;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const src =
    (process.env.SIGNER_SETUP_EXE && String(process.env.SIGNER_SETUP_EXE).trim()) ||
    path.join(repoRoot, 'installer', 'dist', 'vrplike-signer-setup.exe');
  const dstDir = path.join(repoRoot, 'apps', 'web', 'public', 'downloads');
  const dst = path.join(dstDir, 'vrplike-signer-setup.exe');

  const srcStat = mustExistFile(src);
  if (srcStat.size < 10 * 1024 * 1024) {
    throw new Error(`Signer setup.exe looks too small (${formatBytes(srcStat.size)}). Expected a real installer binary (>10MB).`);
  }

  ensureDir(dstDir);
  fs.copyFileSync(src, dst);

  const dstStat = mustExistFile(dst);
  // eslint-disable-next-line no-console
  console.log(`[signer] published ${dst} (${formatBytes(dstStat.size)})`);
}

main();

