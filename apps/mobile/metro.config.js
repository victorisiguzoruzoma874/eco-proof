// @ts-check
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * `packages/shared/src` is written for tsc's `node16` module resolution, where a
 * relative import ends in `.js` but resolves to the sibling `.ts` file (the
 * TypeScript ESM convention). tsc and esbuild/Vite (apps/capture) both understand
 * this; Metro does not, and fails the whole bundle with "Unable to resolve module
 * ./types.js" the moment it walks into shared code via the @shared/* aliases in
 * babel.config.js.
 *
 * Only relative specifiers are rewritten, so a real `.js` file inside node_modules
 * is untouched, and the rewrite is tried first with a fallback to the original
 * resolution so a genuine `.js` sibling (if one is ever added) still wins.
 */
const { resolveRequest: defaultResolveRequest } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const tsModuleName = moduleName.slice(0, -3) + ".ts";
    try {
      return (defaultResolveRequest ?? context.resolveRequest)(context, tsModuleName, platform);
    } catch {
      // Fall through to the original specifier below.
    }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
