// Guarda do tema escuro: acha fundo CLARO fixo (bg-white, bg-[#f…], hover:bg-[#f…], bg-green-50…) nos componentes da
// plataforma (.mc-platform) que o src/index.css não remapeia. No escuro, esse fundo fica branco no meio da tela (ex.: a
// linha da tabela de Clientes que virava branca no hover). Tela nova: use as variáveis (bg-[var(--base-cartao)],
// hover:bg-[var(--base-fill)], Pilula do DS…) ou acrescente o mapeamento no index.css.
// Só fundos: texto/borda têm contexto demais para uma regra barata sem falso positivo. Branco translúcido
// (bg-white/25 etc.) fica de fora: é sempre sobre fundo colorido (chip ativo, faixa de aviso).
//   node scripts/cores-claras.mjs   (também roda no npm test, por scripts/cores-claras.test.mjs)
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const COMPONENTES = join(RAIZ, 'src', 'components');
/** Fora da plataforma (site público, login, shadcn) — não ficam dentro de .mc-platform. */
const FORA = ['site-v5', 'site', 'auth', 'ui'];
/** Exceções conscientes: classe → motivo. Mantenha curto. */
export const PERMITIDAS = new Map([
	// (vazio: toda classe de fundo claro usada hoje tem mapeamento no index.css)
]);

const PALETA = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const RE_TW = new RegExp(`^bg-(?:white|(?:${PALETA})-(?:50|100|200))$`);
const RE_HEX = /^bg-\[#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]$/;

/** Luminância relativa aproximada (0 = preto, 1 = branco). */
export function luminancia(hex) {
	const h = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
	const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A classe (com variantes, ex. "hover:bg-[#f6fafb]") pinta fundo claro? */
export function fundoClaro(classe) {
	const base = classe.split(':').pop();
	if (RE_TW.test(base)) return true;
	const m = RE_HEX.exec(base);
	return !!m && luminancia(m[1]) > 0.8;
}

/** Nomes de classe citados nos seletores do CSS (desescapados: ".hover\:bg-\[\#fff\]" → "hover:bg-[#fff]"). */
export function classesDoCss(css) {
	const s = new Set();
	for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) s.add(m[1].replace(/\\(.)/g, '$1'));
	return s;
}

const arquivos = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => {
	const p = join(dir, d.name);
	if (d.isDirectory()) return dir === COMPONENTES && FORA.includes(d.name) ? [] : arquivos(p);
	return d.name.endsWith('.tsx') && !d.name.endsWith('.test.tsx') ? [p] : [];
});

/** [{ arquivo, linha, classe }] de fundo claro sem mapeamento no index.css nem exceção. */
export function achados({ css = readFileSync(join(RAIZ, 'src', 'index.css'), 'utf8'), lista = arquivos(COMPONENTES) } = {}) {
	const mapeadas = classesDoCss(css);
	const out = [];
	for (const arq of lista) {
		readFileSync(arq, 'utf8').split('\n').forEach((texto, i) => {
			for (const [classe] of texto.matchAll(/[\w:[\]#/.-]*bg-[\w[\]#/.-]+/g)) {
				if (fundoClaro(classe) && !mapeadas.has(classe) && !PERMITIDAS.has(classe)) out.push({ arquivo: relative(RAIZ, arq).split(sep).join('/'), linha: i + 1, classe });
			}
		});
	}
	return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const a = achados();
	for (const x of a) console.log(`${x.arquivo}:${x.linha}  ${x.classe}`);
	console.log(a.length ? `\n${a.length} fundo(s) claro(s) sem mapeamento para o tema escuro. Use as variáveis --base-* ou mapeie no src/index.css.` : 'cores-claras: 0 achados');
	process.exit(a.length ? 1 : 0);
}
