#!/usr/bin/env node
// patch-package cannot patch a dependency's package.json, and this one change is required:
// the fork declares codegenConfig but ships no generated spec, so RN autolinking emits a
// CMake add_subdirectory() for a codegen dir that never exists and the Android build fails.
//
// Run after every `npm install`, together with `npx patch-package`.
const fs = require('fs');
const p = require.resolve('@nikhil-cephei/ffmpeg-kit-react-native/package.json');
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
if (pkg.codegenConfig) {
  delete pkg.codegenConfig;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  console.log('[ffmpeg-fork] removed codegenConfig from', p);
} else {
  console.log('[ffmpeg-fork] codegenConfig already removed');
}
