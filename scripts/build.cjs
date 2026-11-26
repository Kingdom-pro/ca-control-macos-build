const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'darwin') throw new Error('Для сборки CA Control требуется macOS с Xcode Command Line Tools.');
  const project = path.resolve(__dirname, '..');
  const source = path.join(project, 'native', 'local-services.swift');
  const output = path.join(project, 'build');
  fs.mkdirSync(output, { recursive: true });

  const binaries = ['arm64', 'x86_64'].map(arch => {
    const file = path.join(output, `ca-local-services-${arch}`);
    execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos12.0`, source, '-o', file], { stdio: 'inherit' });
    return file;
  });
  const universal = path.join(output, 'ca-local-services');
  execFileSync('/usr/bin/xcrun', ['lipo', '-create', ...binaries, '-output', universal], { stdio: 'inherit' });
  execFileSync('/usr/bin/xcrun', ['lipo', universal, '-verify_arch', 'arm64', 'x86_64'], { stdio: 'inherit' });

  const { build, Platform, Arch } = require('electron-builder');
  await build({ projectDir: project, targets: Platform.MAC.createTarget(['dmg'], Arch.universal) });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
