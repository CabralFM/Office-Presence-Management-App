// Gera o SITE ESTÁTICO (modo local, sem servidor) em dist/.
//
//   npm run build:static
//
// O resultado é uma pasta com HTML/CSS/JS que pode ser publicada de graça em
// GitHub Pages, Cloudflare Pages, Netlify… Toda a lógica corre no celular.
//
// Decisão: usamos o esbuild para juntar a app, os módulos de src/core e a
// biblioteca de feriados num único app.js. Sem isto o navegador não saberia
// carregar 'date-holidays' (um pacote npm).

import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATS_URL_RE } from '../src/core/stats.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Os imports "./core/x.js" de public/ apontam, em produção, para src/core/x.js
// (no modo servidor o Express serve src/core em /core).
const coreAlias = {
  name: 'core-alias',
  setup(b) {
    b.onResolve({ filter: /^\.\/core\// }, (args) =>
      args.importer.startsWith(join(ROOT, 'public')) ? { path: join(ROOT, 'src', args.path) } : undefined,
    );
  },
};

const result = await build({
  entryPoints: [join(ROOT, 'public/app.js')],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
  minify: true,
  sourcemap: false,
  outfile: join(OUT, 'app.js'),
  plugins: [coreAlias],
  // config.js fica FORA do pacote: é um arquivo à parte no site, para o build poder
  // escrever nele o endereço das estatísticas (e o modo) sem recompilar a app.
  external: ['./config.js'],
  metafile: true,
  logLevel: 'warning',
});

for (const f of ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'config.js']) {
  await cp(join(ROOT, 'public', f), join(OUT, f));
}
// Estatísticas anónimas (opcional): o endereço vem da variável de ambiente
// PRESENCA_STATS_URL (no GitHub: Settings → Secrets and variables → Actions →
// Variables). Só se aceita um endereço de Google Apps Script.
const statsUrl = (process.env.PRESENCA_STATS_URL || '').trim();
if (statsUrl && !STATS_URL_RE.test(statsUrl)) {
  console.error(`PRESENCA_STATS_URL inválido (tem de ser https://script.google.com/macros/s/…/exec): ${statsUrl}`);
  process.exit(1);
}
const cfg = await readFile(join(OUT, 'config.js'), 'utf8');
await writeFile(join(OUT, 'config.js'), cfg.replace(/export const STATS_URL = '[^']*';/, `export const STATS_URL = '${statsUrl}';`));
console.log(statsUrl ? 'Estatísticas anónimas: ligadas.' : 'Estatísticas anónimas: desligadas (PRESENCA_STATS_URL vazio).');

// O GitHub Pages ignora pastas/arquivos começados por "_" sem isto.
await writeFile(join(OUT, '.nojekyll'), '');

// Versão do cache do service worker = data da build, para os celulares
// receberem a versão nova depois de cada publicação.
const sw = await readFile(join(OUT, 'sw.js'), 'utf8');
await writeFile(join(OUT, 'sw.js'), sw.replace(/const CACHE = '[^']+';/, `const CACHE = 'presenca-${Date.now()}';`));

const size = (await stat(join(OUT, 'app.js'))).size;
console.log(`Site estático gerado em dist/ (app.js: ${(size / 1024).toFixed(0)} KB, ${Object.keys(result.metafile.inputs).length} módulos).`);
