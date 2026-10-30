import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

export const streamTimeout = 5_000;

/**
 * Modo SPA (ssr: false): este arquivo só roda no build, para gerar o
 * build/client/index.html com a casca do app (rota raiz). Nenhum servidor
 * executa isto em produção; o Netlify serve os arquivos estáticos.
 *
 * Espera tudo ficar pronto (onAllReady) para o HTML sair completo, inclusive o
 * fim do stream de dados que o React Router usa na hidratação.
 */
export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
) {
	return new Promise<Response>((resolve, reject) => {
		const partes: Buffer[] = [];
		const destino = new Writable({
			write(chunk, _encoding, callback) {
				partes.push(Buffer.from(chunk));
				callback();
			},
			final(callback) {
				clearTimeout(timeoutId);
				responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
				resolve(new Response(Buffer.concat(partes).toString('utf-8'), {
					headers: responseHeaders,
					status: responseStatusCode,
				}));
				callback();
			},
		});

		const { pipe, abort } = renderToPipeableStream(
			<ServerRouter context={routerContext} url={request.url} />,
			{
				onAllReady() {
					pipe(destino);
				},
				onShellError(error: unknown) {
					reject(error);
				},
				onError(error: unknown) {
					responseStatusCode = 500;
					console.error(error);
				},
			},
		);

		const timeoutId = setTimeout(() => abort(), streamTimeout + 1000);
	});
}
