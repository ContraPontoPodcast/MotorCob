// Agente Voz/CX e Speech Analytics viraram áreas próprias do trilho (SPEC Canais §3.1 e §4.1). As telas mudaram de
// endereço, mas nada se perde: todo endereço antigo continua abrindo e leva ao novo com `replace`, mantendo a query e
// a âncora (links dos avisos do banco, favoritos, ⌘K antigo, links internos que ainda não foram trocados).
//
// Endereço antigo novo: acrescente em ANTIGAS_PARA_NOVAS (o teste confere que a rota antiga e a nova existem no
// routes.ts e que a antiga redireciona).

/** Base de cada área nova. */
export const ROTA_VOZ = '/voz';
export const ROTA_AGENTE = '/voz/agente';
export const ROTA_DISCAGEM = '/voz/discagem';
export const ROTA_LIGACOES = '/voz/ligacoes';
export const ROTA_TELEFONIA = '/voz/telefonia';
export const ROTA_SPEECH = '/speech-analytics';
export const ROTA_GRAVACOES = '/speech-analytics/gravacoes';
export const ROTA_ENTRADA_GRAVACOES = '/speech-analytics/entrada';

/** Gravações de um cliente (Speech Analytics › Gravações já filtrada). */
export const rotaGravacoesCliente = (idCliente: string) => `${ROTA_GRAVACOES}?cliente=${encodeURIComponent(idCliente)}`;
/** Ligações de um lote do agente. */
export const rotaLoteVoz = (id: string | number) => `${ROTA_LIGACOES}/${id}`;

/** Prefixo antigo → prefixo novo. Vale para a rota exata e para tudo abaixo dela ("/a/b" → "/x/b"). A ordem importa:
 *  o prefixo mais longo vem antes. */
export const ANTIGAS_PARA_NOVAS: readonly (readonly [string, string])[] = [
	['/canais/agente-virtual', ROTA_AGENTE],
	['/mensageria/voz/lotes', ROTA_LIGACOES],
	['/discagem', ROTA_DISCAGEM],
	['/envios/gravacoes-discador', ROTA_ENTRADA_GRAVACOES],
	['/gravacoes', ROTA_GRAVACOES],
	['/insights-voz', ROTA_SPEECH],
	['/voz/conexao', ROTA_TELEFONIA],
];

/** Endereço novo de um caminho antigo (sem query), ou null quando o caminho não mudou de lugar. */
export function rotaNova(pathname: string): string | null {
	const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	for (const [antiga, nova] of ANTIGAS_PARA_NOVAS) {
		if (caminho === antiga) return nova;
		if (caminho.startsWith(antiga + '/')) return nova + caminho.slice(antiga.length);
	}
	return null;
}

/** Destino completo do redirecionamento: caminho novo + query + âncora de antes. */
export function destinoRedirecionamento(pathname: string, search = '', hash = ''): string | null {
	const nova = rotaNova(pathname);
	return nova ? `${nova}${search}${hash}` : null;
}
