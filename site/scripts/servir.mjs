// Serve o build/client como o Netlify: arquivo que existe sai como está; o resto abre o index.html (SPA). Aplica os
// cabeçalhos do Netlify: os [[headers]] do netlify.toml e o build/client/_headers (a CSP gerada no build), para a
// prévia local ter as mesmas travas do site no ar (HSTS só tem efeito em HTTPS; aqui ele só vai no cabeçalho).
// Uso: npm run build && npm run preview   (porta: PORT, padrão 4173)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raiz = path.join(site, 'build', 'client');
const porta = Number(process.env.PORT ?? 4173);
const tipos = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
	'.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
	'.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

if (!existsSync(path.join(raiz, 'index.html'))) {
	console.error('build/client/index.html não existe: rode "npm run build" antes.');
	process.exit(1);
}

// [[headers]] do netlify.toml: for = "..." e as linhas Nome = "valor" de [headers.values]
function regrasDoToml(texto) {
	const regras = [];
	let atual = null;
	for (const linha of texto.split('\n')) {
		const l = linha.trim();
		if (l === '[[headers]]') { atual = { para: '', valores: {} }; regras.push(atual); continue; }
		if (l.startsWith('[') && l !== '[headers.values]') { atual = null; continue; }
		if (!atual) continue;
		const m = l.match(/^([A-Za-z0-9-]+)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/);
		if (!m) continue;
		const valor = JSON.parse(m[2]);
		if (m[1] === 'for') atual.para = valor; else atual.valores[m[1]] = valor;
	}
	return regras;
}
// build/client/_headers: caminho numa linha, "  Nome: valor" nas seguintes
function regrasDoHeaders(texto) {
	const regras = [];
	for (const linha of texto.split('\n')) {
		if (!linha.trim() || linha.trim().startsWith('#')) continue;
		if (!/^\s/.test(linha)) { regras.push({ para: linha.trim(), valores: {} }); continue; }
		const i = linha.indexOf(':');
		if (regras.length && i > 0) regras.at(-1).valores[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
	}
	return regras;
}
const regras = [
	...regrasDoToml(readFileSync(path.join(site, 'netlify.toml'), 'utf8')),
	...(existsSync(path.join(raiz, '_headers')) ? regrasDoHeaders(readFileSync(path.join(raiz, '_headers'), 'utf8')) : []),
];
const casa = (para, caminho) => para.endsWith('/*') ? caminho.startsWith(para.slice(0, -1)) : para === caminho;

createServer((req, res) => {
	const caminho = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
	let arquivo = path.join(raiz, path.normalize(caminho));
	if (!arquivo.startsWith(raiz) || !existsSync(arquivo) || statSync(arquivo).isDirectory()
		|| path.basename(arquivo) === '_headers') {
		arquivo = path.join(raiz, 'index.html');
	}
	const cab = { 'Content-Type': tipos[path.extname(arquivo)] ?? 'application/octet-stream' };
	for (const r of regras) if (casa(r.para, caminho)) Object.assign(cab, r.valores);
	res.writeHead(200, cab);
	createReadStream(arquivo).pipe(res);
}).listen(porta, '127.0.0.1', () => console.log(`site em http://127.0.0.1:${porta}`));
