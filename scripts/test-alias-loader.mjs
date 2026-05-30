// Synchronous resolve hook: maps the project's `@/*` path alias (and bare
// extensionless `@/` specifiers) to absolute `src/*` file URLs so Node's native
// TypeScript test runner resolves the same imports the Vite build uses.
//
// Uses module.registerHooks (synchronous) rather than the async register() API
// because --experimental-transform-types resolves modules synchronously, which
// bypasses async loader hooks. Loaded via --import in the `test` script.
//
// This file is test-only — it is NOT part of the game bundle.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const SRC = pathToFileURL(path.resolve(import.meta.dirname, '..', 'src') + '/').href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      let target = SRC + specifier.slice(2);
      if (!/\.[a-z]+$/i.test(target) && existsSync(new URL(target + '.ts'))) {
        target += '.ts';
      }
      return nextResolve(target, context);
    }
    return nextResolve(specifier, context);
  },
});
