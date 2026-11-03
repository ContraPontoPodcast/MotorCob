/**
 * Divisão de domínios (um só site no Netlify, com motorcob.online, motorcx.com.br e www.motorcx.com.br):
 * - motorcx.com.br: o site público (/, /como-decide, /solucoes/*, /seguranca, /demonstracao e /privacidade);
 * - motorcob.online: o sistema (login, cadastro, convites, app, console). /privacidade também fica aqui;
 * - www.motorcx.com.br: redireciona para motorcx.com.br (o canônico é sem www).
 * motorcx.online não passa pelo Netlify: a própria Hostinger o redireciona (301) para https://www.motorcx.com.br/,
 * que daqui vai para motorcx.com.br.
 *
 * Quem redireciona de verdade é o Netlify, com as regras por domínio que scripts/dominios.mjs gera no build
 * (build/client/_redirects, 301 preservando caminho e query). destinoCanonico() faz o mesmo no navegador, para a
 * navegação dentro do SPA (um <Link to="/"> no login, por exemplo), como o CanonicalDomain já fazia com o www.
 * Deploy Preview, localhost e qualquer outro endereço não são tocados.
 *
 * Sem dependências e sem atalhos de import: o scripts/dominios.mjs importa este arquivo direto no Node.
 */

export const ORIGEM_SISTEMA = 'https://motorcob.online';
export const ORIGEM_SITE = 'https://motorcx.com.br';

/** Caminhos do site público (o primeiro segmento; "" é a home). */
export const SEGMENTOS_PUBLICOS = ['', 'como-decide', 'solucoes', 'seguranca', 'demonstracao'];
/** Caminhos que ficam nos dois domínios. */
export const SEGMENTOS_DOS_DOIS = ['privacidade'];

const HOSTS_SISTEMA = ['motorcob.online', 'www.motorcob.online'];
const HOSTS_SITE = ['motorcx.com.br', 'www.motorcx.com.br'];

/** Primeiro segmento do caminho, sem barras ("/solucoes/voz" → "solucoes", "/" → ""). */
export function segmento(pathname: string): string {
	return pathname.replace(/^\/+/, '').split('/')[0] ?? '';
}

export function ehPublica(pathname: string): boolean {
	return SEGMENTOS_PUBLICOS.includes(segmento(pathname));
}

export function ehDosDois(pathname: string): boolean {
	return SEGMENTOS_DOS_DOIS.includes(segmento(pathname));
}

/**
 * Para onde mandar quem abriu `host` + `caminho` (com query e âncora), ou null se já está no lugar certo.
 * - motorcob.online e www: página pública → motorcx.com.br; www → motorcob.online;
 * - motorcx.com.br e www.motorcx.com.br: página do sistema → motorcob.online;
 *   o resto vai para motorcx.com.br (sem www).
 */
export function destinoCanonico(host: string, pathname: string, search = '', hash = ''): string | null {
	const resto = `${pathname}${search}${hash}`;
	if (HOSTS_SISTEMA.includes(host)) {
		if (ehPublica(pathname)) return `${ORIGEM_SITE}${resto}`;
		return host === 'motorcob.online' ? null : `${ORIGEM_SISTEMA}${resto}`;
	}
	if (HOSTS_SITE.includes(host)) {
		if (!ehPublica(pathname) && !ehDosDois(pathname)) return `${ORIGEM_SISTEMA}${resto}`;
		return host === 'motorcx.com.br' ? null : `${ORIGEM_SITE}${resto}`;
	}
	return null;
}

/** Os hosts de cada lado, para o gerador do _redirects. */
export const HOSTS = { sistema: HOSTS_SISTEMA, site: HOSTS_SITE };
