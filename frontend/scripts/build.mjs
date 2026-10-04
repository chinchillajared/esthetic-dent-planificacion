// Genera dist/: copia los archivos públicos y las fuentes self-hosted, y compila
// Tailwind (con normalize.css incluido) en una hoja de estilos minificada.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const modules = join(root, 'node_modules');

const fonts = [
  ['@fontsource/cabin/files/cabin-latin-500-normal.woff2', 'cabin-500.woff2'],
  ['@fontsource/cabin/files/cabin-latin-600-normal.woff2', 'cabin-600.woff2'],
  ['@fontsource/cabin/files/cabin-latin-700-normal.woff2', 'cabin-700.woff2'],
  ['@fontsource/share-tech/files/share-tech-latin-400-normal.woff2', 'share-tech-400.woff2'],
];

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });

mkdirSync(join(dist, 'assets/fonts'), { recursive: true });
for (const [from, to] of fonts) {
  cpSync(join(modules, from), join(dist, 'assets/fonts', to));
}

execFileSync(
  process.execPath,
  [
    join(modules, '@tailwindcss/cli/dist/index.mjs'),
    '-i', join(root, 'src/styles/main.css'),
    '-o', join(dist, 'assets/css/app.css'),
    '--minify',
  ],
  { stdio: 'inherit', cwd: root },
);

console.log('Build listo en dist/');
