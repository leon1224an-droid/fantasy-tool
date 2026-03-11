/**
 * Postinstall patch for expo-font's ExpoFontLoader.web.js.
 *
 * Root cause: registerWebModule() checks moduleImplementation.name to get
 * the module name.  expo-font passes a factory function, which Terser inlines
 * as an anonymous class/function expression during the production build,
 * stripping the name — so .name === '' (falsy) — causing the runtime error
 * "Module implementation must be a class".
 *
 * Fix: replace the entire registerWebModule() call with a direct export of the
 * ExpoFontLoader plain object.  The server-side branch already does this, and
 * all font loading/unloading logic lives on the object itself.  Skipping
 * registerWebModule only means ExpoFontLoader won't be registered in
 * globalThis.expo.modules, which is fine — nothing in our app reads it from there.
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

// Already patched by this script
if (content.includes('// PATCHED: bypass registerWebModule')) {
  console.log('patch-expo-font: already patched, nothing to do');
  process.exit(0);
}

// Original pattern — the broken ternary that calls registerWebModule
const OLD = `const toExport = isServer
    ? ExpoFontLoader
    : // @ts-expect-error: registerWebModule calls \`new\` on the module implementation.
        // Normally that'd be a class but that doesn't work on server, so we use a function instead.
        // TS doesn't like that but we don't need it to be a class.
        registerWebModule(createExpoFontLoader, 'ExpoFontLoader');`;

// Replacement — skip registerWebModule entirely, export the plain object directly.
// This mirrors the server-side branch and avoids the class-name check that Terser breaks.
const NEW = `// PATCHED: bypass registerWebModule — Terser strips class names in production
// builds causing registerWebModule's !name check to throw at runtime.
const toExport = ExpoFontLoader;`;

if (!content.includes(OLD)) {
  // Try a looser match in case whitespace differs across expo-font versions
  const LOOSE_MARKER = "registerWebModule(createExpoFontLoader, 'ExpoFontLoader')";
  if (!content.includes(LOOSE_MARKER)) {
    console.warn(
      'patch-expo-font: expected pattern not found — expo-font version may have changed.'
    );
    console.warn('File:', filePath);
    // Exit 0 so the install itself does not fail; the build will surface any real error.
    process.exit(0);
  }

  // Looser replacement: find the whole toExport block and replace it
  const looseOldRegex = /const toExport\s*=\s*isServer[\s\S]*?registerWebModule\(createExpoFontLoader,\s*'ExpoFontLoader'\);/;
  if (!looseOldRegex.test(content)) {
    console.warn('patch-expo-font: regex did not match, skipping');
    process.exit(0);
  }
  content = content.replace(looseOldRegex, NEW);
} else {
  content = content.replace(OLD, NEW);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('patch-expo-font: ✓ patched ExpoFontLoader.web.js (bypassed registerWebModule)');
