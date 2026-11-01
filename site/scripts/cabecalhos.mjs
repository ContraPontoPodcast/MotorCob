// Content-Security-Policy do site, gerada no build (npm run build) em build/client/_headers, que o Netlify aplica
// junto com os [[headers]] do netlify.toml (lá ficam HSTS, X-Frame-Options e os outros fixos).
// Por que no build e não no netlify.toml: o index.html do modo SPA do React Router tem scripts inline (contexto do
// roteador e o import do entry, com o hash dos arquivos no nome), que mudam a cada build. Com o hash SHA-256 de cada
// um na política, o navegador só roda ESSES scripts inline: nada de 'unsafe-inline' em script-src.
// Origens (levantadas do código e do build):
//   Supabase do site (VITE_SUPABASE_URL): API REST, Auth, Storage (URL assinada), Edge Functions (inclusive a API
//     pública em /functions/v1/api) em https, e Realtime em wss;
//   storage.googleapis.com: gravação (áudio) e transcrição (JSON) por URL assinada V4 da Edge Function gravacoes;
//   data: e blob: em imagem (prévia da foto da conta), mídia ("Ouvir a voz" é data:audio) e worker (Realtime);
//   estilos: 'unsafe-inline' porque bibliotecas (Radix/react-remove-scroll) criam <style> na hora; fontes do sistema.
// Uso: node scripts/cabecalhos.mjs   (depois do react-router build; lê build/client/index.html)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Hash 'sha256-…' do conteúdo de cada <script> inline (sem src) do HTML, na ordem, sem repetir. */
export function hashesInline(html) {
	const out = [];
	for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
		if (/\bsrc\s*=/i.test(m[1])) continue;
		const h = `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`;
		if (!out.includes(h)) out.push(h);
	}
	return out;
}

/** A política (uma linha) para o Supabase do site e os hashes dos scripts inline. */
export function politica(supabaseUrl, hashes) {
	const u = new URL(supabaseUrl);
	if (u.protocol !== 'https:') throw new Error(`VITE_SUPABASE_URL precisa ser https: ${supabaseUrl}`);
	const sb = `https://${u.host}`;
	const gcs = 'https://storage.googleapis.com';
	return [
		"default-src 'self'",
		`script-src 'self' ${hashes.join(' ')}`.trim(),
		"style-src 'self' 'unsafe-inline'",
		`img-src 'self' data: blob: ${sb}`,
		"font-src 'self' data:",
		`connect-src 'self' ${sb} wss://${u.host} ${gcs}`,
		`media-src 'self' data: blob: ${gcs}`,
		"worker-src 'self' blob:",
		"manifest-src 'self'",
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		'upgrade-insecure-requests',
	].join('; ');
}

/** VITE_SUPABASE_URL do ambiente do build; sem ele, o do [build.environment] do netlify.toml (o que vai ao ar). */
export function supabaseDoBuild(env = process.env) {
	if (env.VITE_SUPABASE_URL) return env.VITE_SUPABASE_URL;
	const toml = readFileSync(path.join(raiz, 'netlify.toml'), 'utf8');
	const m = toml.match(/^\s*VITE_SUPABASE_URL\s*=\s*"([^"]+)"/m);
	if (!m) throw new Error('VITE_SUPABASE_URL não definido (nem no ambiente nem no netlify.toml)');
	return m[1];
}

export function gerar(dirBuild = path.join(raiz, 'build', 'client'), env = process.env) {
	const html = readFileSync(path.join(dirBuild, 'index.html'), 'utf8');
	const hashes = hashesInline(html);
	const csp = politica(supabaseDoBuild(env), hashes);
	const texto = `# Gerado por site/scripts/cabecalhos.mjs no build (não edite): CSP com os hashes dos scripts inline do index.html.\n`
		+ `# Os outros cabeçalhos (HSTS, X-Frame-Options...) estão no netlify.toml.\n/*\n  Content-Security-Policy: ${csp}\n`;
	writeFileSync(path.join(dirBuild, '_headers'), texto);
	return { csp, hashes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { hashes } = gerar();
	console.log(`build/client/_headers: Content-Security-Policy com ${hashes.length} script(s) inline por hash`);
}
