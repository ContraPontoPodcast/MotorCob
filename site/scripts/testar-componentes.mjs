// Testes de componentes do site (design system em src/components/ds): o esbuild compila cada *.test.tsx
// (com o atalho @/ do tsconfig) e o node:test roda o resultado. Sem navegador: renderiza com react-dom/server.
// npm test  (dentro de site/)
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const saida = join(raiz, 'node_modules', '.cache', 'testes-componentes');
const achar = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? achar(join(dir, d.name)) : d.name.endsWith('.test.tsx') ? [join(dir, d.name)] : []);
const testes = achar(join(raiz, 'src'));
if (!testes.length) { console.error('nenhum *.test.tsx em src/'); process.exit(1); }
rmSync(saida, { recursive: true, force: true });
await build({
	entryPoints: testes, outdir: saida, outbase: join(raiz, 'src'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
	jsx: 'automatic', packages: 'external', tsconfig: join(raiz, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
	define: { 'import.meta.env': '{"DEV":true}' }, logLevel: 'warning',
});
const arquivos = testes.map(t => join(saida, relative(join(raiz, 'src'), t).replace(/\.tsx$/, '.mjs')));
const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit', cwd: raiz });
process.exit(r.status ?? 1);
