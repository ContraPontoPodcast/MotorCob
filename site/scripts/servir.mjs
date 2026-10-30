// Serve o build/client como o Netlify: arquivo que existe sai como está; o resto abre o index.html (SPA).
// Uso: npm run build && npm run preview   (porta: PORT, padrão 4173)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'client');
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

createServer((req, res) => {
	const caminho = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
	let arquivo = path.join(raiz, path.normalize(caminho));
	if (!arquivo.startsWith(raiz) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) {
		arquivo = path.join(raiz, 'index.html');
	}
	res.writeHead(200, { 'Content-Type': tipos[path.extname(arquivo)] ?? 'application/octet-stream' });
	createReadStream(arquivo).pipe(res);
}).listen(porta, '127.0.0.1', () => console.log(`site em http://127.0.0.1:${porta}`));
