// esbuild.config.mjs — no obfuscation
import esbuild from 'esbuild';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const outDir  = path.join(__dirname, 'dist');
const meta    = (await fs.readFile(path.join(__dirname, 'meta.userscript.js'), 'utf8')).trim() + '\n';
await fs.mkdir(outDir, { recursive: true });

// Version from the userscript header, injected into the bundle so the mod
// always reports its real version (GM_info gives the LOADER's version when
// the script is loaded via @require file://).
const modVersion = meta.match(/^\/\/ @version\s+(\S+)/m)?.[1] ?? '0.0.0';

async function writeOutput(code) {
  const filename = isWatch ? 'quinoa-ws.dev.user.js' : 'quinoa-ws.min.user.js';
  const file = path.join(outDir, filename);
  await fs.writeFile(file, meta + code, 'utf8');
  console.log('✅ Built ->', file);
}

// esbuild >=0.17 dropped the onRebuild callback from ctx.watch(); rebuilds
// are now surfaced via a plugin's onEnd hook instead.
const writeOnEndPlugin = {
  name: 'write-output',
  setup(build) {
    build.onEnd((result) => {
      const code = result.outputFiles?.[0]?.text;
      if (!code) {
        console.error('❌ Rebuild produced no output');
        return;
      }
      writeOutput(code).catch(console.error);
    });
  },
};

const baseOptions = {
  entryPoints: [path.join(__dirname, 'src', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,             // minify en prod, pas en watch
  sourcemap: isWatch ? 'inline' : false,
  legalComments: 'none',
  write: false,                 // on récupère le bundle en mémoire
  logLevel: 'info',
  define: { __ARIES_MOD_VERSION__: JSON.stringify(modVersion) },
  plugins: isWatch ? [writeOnEndPlugin] : [],
};

async function buildBundle() {
  const result = await esbuild.build(baseOptions);
  const bundled = result.outputFiles?.[0]?.text;
  if (!bundled) throw new Error('No outputFiles from esbuild');
  return bundled;
}

async function buildAll() {
  const code = await buildBundle();
  await writeOutput(code);
}

if (isWatch) {
  const ctx = await esbuild.context(baseOptions);
  await ctx.watch();
  console.log('👀 Watching… (Ctrl+C to quit)');
} else {
  await buildAll();
}
