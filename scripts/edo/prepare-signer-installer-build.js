const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mustExistFile(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error(`Not a file: ${p}`);
  return st;
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');

  const buildDir = path.join(repoRoot, 'installer', 'build');
  ensureDir(buildDir);

  const agentSrc = path.join(repoRoot, 'apps', 'edo-signer-agent', 'dist-exe', 'vrplike-signer.exe');
  const trayHostSrc = path.join(repoRoot, 'installer', 'build', 'vrplike-signer-tray.exe');
  const icoSrc = path.join(repoRoot, 'apps', 'edo-signer-agent', 'assets', 'tray.ico');

  mustExistFile(agentSrc);
  mustExistFile(trayHostSrc);
  mustExistFile(icoSrc);

  copyFile(agentSrc, path.join(buildDir, 'vrplike-signer.exe'));
  copyFile(trayHostSrc, path.join(buildDir, 'vrplike-signer-tray.exe'));
  copyFile(icoSrc, path.join(buildDir, 'tray.ico'));

  // eslint-disable-next-line no-console
  console.log('[signer] installer build inputs prepared:', buildDir);
}

main();

