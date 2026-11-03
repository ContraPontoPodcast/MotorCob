// Redirecionamentos por domínio, gerados no build (npm run build) em build/client/_redirects. O Netlify lê o
// _redirects ANTES das regras do netlify.toml (onde ficam o www do motorcob.online e o fallback do SPA).
// A divisão (src/lib/dominios.ts):
//   motorcx.com.br   → site público; as rotas do sistema vão para motorcob.online (301, mesmo caminho e query);
//   motorcob.online  → sistema; as rotas do site público vão para motorcx.com.br (301, mesmo caminho e query);
//   www.motorcx.com.br → motorcx.com.br (o canônico é sem www; rota do sistema segue dali, 2º 301).
// motorcx.online não está no Netlify: a Hostinger já o manda (301) para https://www.motorcx.com.br/.
// As rotas do sistema saem do src/routes.ts (o primeiro segmento de cada route('...')): rota nova no app já entra
// sozinha. O Netlify repassa a query string em todo 301; o "!" (force) vale mesmo onde há arquivo (a home).
// Uso: node --experimental-strip-types scripts/dominios.mjs   (depois do react-router build)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, ORIGEM_SISTEMA, ORIGEM_SITE, SEGMENTOS_DOS_DOIS, SEGMENTOS_PUBLICOS } from '../src/lib/dominios.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Primeiros segmentos de todas as rotas do routes.ts (sem repetir, na ordem). */
export function segmentosDasRotas(routesTs) {
	const out = [];
	for (const m of routesTs.matchAll(/\broute\(\s*'([^']+)'/g)) {
		const s = m[1].replace(/^\/+/, '').split('/')[0];
		if (s && !s.startsWith(':') && s !== '*' && !out.includes(s)) out.push(s);
	}
	return out;
}

/** As rotas do sistema: tudo que não é do site público nem dos dois. */
export function segmentosDoSistema(routesTs) {
	return segmentosDasRotas(routesTs).filter(s => !SEGMENTOS_PUBLICOS.includes(s) && !SEGMENTOS_DOS_DOIS.includes(s));
}

/** As linhas do _redirects (de, para, status). */
export function regras(routesTs) {
	const sistema = segmentosDoSistema(routesTs);
	const linhas = [];
	const par = (de, para) => linhas.push([de, para, '301!']);
	const [motorcx, ...outros] = HOSTS.site;
	// www.motorcx.com.br: tudo para motorcx.com.br (mesmo caminho e query).
	for (const host of outros) { linhas.push(`# ${host}`); par(`https://${host}/*`, `${ORIGEM_SITE}/:splat`); }
	// motorcx.com.br: as rotas do sistema vão para motorcob.online; o resto ele mesmo serve.
	linhas.push(`# ${motorcx}`);
	for (const s of sistema) { par(`https://${motorcx}/${s}`, `${ORIGEM_SISTEMA}/${s}`); par(`https://${motorcx}/${s}/*`, `${ORIGEM_SISTEMA}/${s}/:splat`); }
	// Domínios do sistema: as páginas do site público vão para motorcx.com.br.
	for (const host of HOSTS.sistema) {
		linhas.push(`# ${host}`);
		for (const s of SEGMENTOS_PUBLICOS) {
			if (!s) { par(`https://${host}/`, `${ORIGEM_SITE}/`); continue; }
			par(`https://${host}/${s}`, `${ORIGEM_SITE}/${s}`); par(`https://${host}/${s}/*`, `${ORIGEM_SITE}/${s}/:splat`);
		}
	}
	return linhas;
}

export function texto(routesTs) {
	return '# Gerado por site/scripts/dominios.mjs no build (não edite): redirecionamentos por domínio.\n'
		+ '# As outras regras (www do motorcob.online e o fallback do SPA) estão no netlify.toml.\n'
		+ regras(routesTs).map(l => (typeof l === 'string' ? `\n${l}` : l.join('  '))).join('\n') + '\n';
}

export function gerar(dirBuild = path.join(raiz, 'build', 'client')) {
	const routesTs = readFileSync(path.join(raiz, 'src', 'routes.ts'), 'utf8');
	const arq = path.join(dirBuild, '_redirects');
	if (existsSync(arq)) throw new Error('build/client/_redirects já existe (veio de public/?): junte as regras aqui');
	const t = texto(routesTs);
	writeFileSync(arq, t);
	return t.split('\n').filter(l => l && !l.startsWith('#')).length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(`build/client/_redirects: ${gerar()} regra(s) por domínio`);
}
