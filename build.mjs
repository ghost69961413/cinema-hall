import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const outputDir = path.join(root, 'dist');
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(publicDir, outputDir, { recursive: true });

const configPath = path.join(outputDir, 'js', 'config.js');
const configSource = await readFile(configPath, 'utf8');
const buildEnv = {
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY: supabaseAnonKey
};
await writeFile(configPath, `window.CINEMA_BUILD_ENV = Object.freeze(${JSON.stringify(buildEnv)});\n${configSource}`);

console.log(`Static site built to ${path.relative(root, outputDir)}/`);
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase build variables are empty; this build will use the local demo/configuration mode.');
}
