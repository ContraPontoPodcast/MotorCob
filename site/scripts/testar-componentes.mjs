// Testes de componente do site sem navegador: empacota site/fluxo/*.test.tsx com o esbuild (o alias @ = src, como no
// Vite) e roda com node --test. As dependências (react, react-dom/server, lucide-react…) ficam de fora do pacote e vêm do
// node_modules. Uso: npm test (a partir de site/).
import { build } from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pasta = join(raiz, 'fluxo');
const saida = join(raiz, 'node_modules', '.cache', 'testes-componentes');
mkdirSync(saida, { recursive: true });
const testes = readdirSync(pasta).filter(f => f.endsWith('.test.tsx'));
const gerados = [];
for (const t of testes) {
	const out = join(saida, t.replace(/\.tsx$/, '.mjs'));
	await build({
		entryPoints: [join(pasta, t)], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22',
		jsx: 'automatic', packages: 'external', alias: { '@': join(raiz, 'src') }, logLevel: 'error',
		define: { 'import.meta.env': '{"DEV":false,"PROD":true}' },
	});
	gerados.push(out);
}
const r = spawnSync(process.execPath, ['--test', ...gerados], { stdio: 'inherit', cwd: raiz });
process.exit(r.status ?? 1);
