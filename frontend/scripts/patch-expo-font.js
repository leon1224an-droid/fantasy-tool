/**
 * Postinstall patch for expo-font's ExpoFontLoader.web.js.
 *
 * Problem: registerWebModule() (from expo-modules-core) calls `new` on its
 * first argument, so it must be a class.  expo-font ships `createExpoFontLoader`
 * as a plain factory function that returns an object literal — this causes the
 * runtime error "Module implementation must be a class" in Expo web builds.
 *
 * Fix: replace the factory function with a class whose constructor copies all
 * methods from the plain object onto `this` via Object.assign.  Because none of
 * the original methods reference `this`, they work identically after the copy.
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/expo-font/build/ExpoFontLoader.web.js'
);

if (!fs.existsSync(filePath)) {
  console.log('patch-expo-font: file not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

const OLD = `function createExpoFontLoader() {\n    return ExpoFontLoader;\n}`;
const NEW = `class createExpoFontLoader {\n    constructor() {\n        Object.assign(this, ExpoFontLoader);\n    }\n}`;

if (content.includes(NEW)) {
  console.log('patch-expo-font: already patched, nothing to do');
  process.exit(0);
}

if (!content.includes(OLD)) {
  console.warn(
    'patch-expo-font: expected pattern not found — expo-font version may have changed.'
  );
  console.warn('File:', filePath);
  // Exit 0 so the install itself does not fail; the build will surface any real error.
  process.exit(0);
}

content = content.replace(OLD, NEW);
fs.writeFileSync(filePath, content, 'utf8');
console.log('patch-expo-font: ✓ patched ExpoFontLoader.web.js');
