/**
 * SQL 85 · Identidade antes da dívida nas mensagens escritas (SMS, WhatsApp, RCS e e-mail).
 *
 * A mensagem chega inteira a quem estiver com o telefone ou a caixa de e-mail, antes de qualquer confirmação de
 * identidade (CDC art. 42; LGPD art. 6º, III). Cópia de motor/trava_identidade.py › motivos_mensagem e de
 * public.mensagem_revela_divida: os mesmos casos (tests/dados/mensagem_identidade_casos.json) rodam nos três.
 * No site é só AVISO: o texto é do cliente e o Salvar continua livre.
 */

// motor/trava_identidade.py › SENSIVEL (a trava B7 da voz), VARIAVEL_MENSAGEM e TERMO_MENSAGEM
const SENSIVEL = /\b(credor\w*|divida\w*|debito\w*|contrato\w*|saldo\w*|pendencia\w*|inadimpl\w*|atrasad\w*|em atraso|em aberto|fatura\w*|boleto\w*|cobranca\w*|valor (devido|da divida|do debito|em aberto|da parcela|total))\b|\{\{ *(credor|saldo|dias_atraso|vencimento|valor_minimo|parcelas_max|desconto_max|link_pagamento|oferta\.[a-z_]+) *\}\}/;
const VARIAVEL = /\{\{? *(saldo\w*|credor\w*|valor\w*|vencimento\w*|dias_atraso|qtd_parcelas\w*|contrato\w*|id_contrato|parcelas_max|desconto\w*|link_pagamento|oferta\.[a-z_]+) *\}\}?/;
const TERMO = /\b(parcela\w*|acordo\w*|negocia\w*|renegocia\w*|quita\w*|regulariz\w*|pagamento\w*|pague\w*|pagar|vencid\w*|devedor\w*|devendo|calote\w*)\b/;
/** Os padrões, para o teste conferir que são os mesmos do banco (public.mensagem_revela_divida). */
export const PADROES_MENSAGEM = { sensivel: SENSIVEL, variavel_mensagem: VARIAVEL, termo_mensagem: TERMO };
// a regra 2 da B7 (fala que cumprimenta e cita a dívida) já está coberta: qualquer termo sensível conta aqui

/** Minúsculo, sem acento e com um espaço só (o mesmo normal() do motor e o translate + lower do banco). */
export function normalMensagem(texto: string): string {
	return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/** O nome da empresa que envia vira {empresa}: "Alfa Cobrança" no nome não é a dívida. */
function semEmpresa(texto: string, empresa?: string | null): string {
	const t = normalMensagem(texto);
	const e = normalMensagem(empresa ?? '');
	return e.length >= 2 ? t.split(e).join('{empresa}') : t;
}

/** O que no texto conta a quem pegar o telefone que há dívida (para o aviso); vazio = mensagem neutra. */
export function trechosDivida(texto: string, empresa?: string | null): string[] {
	const t = semEmpresa(texto, empresa);
	const achados = new Set<string>();
	for (const re of [SENSIVEL, VARIAVEL, TERMO]) {
		for (const m of t.matchAll(new RegExp(re.source, 'g'))) achados.add(m[0]);
	}
	return [...achados];
}

export function mensagemRevelaDivida(texto: string, empresa?: string | null): boolean {
	return trechosDivida(texto, empresa).length > 0;
}

export const AVISO_IDENTIDADE = 'Este texto fala da dívida antes de confirmar quem recebe. A mensagem pode chegar a outra pessoa (CDC art. 42 e LGPD). Prefira um texto neutro, como "Olá, {primeiro_nome}. Você tem uma mensagem da sua empresa. Acesse: {link}", e deixe valor, parcela e credor para depois do link. Você pode salvar assim mesmo.';
