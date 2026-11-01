// Fluxo do agente virtual (SQL 58, 59 e 66): tipos da definição, nomes simples dos modos, catálogo dos blocos,
// textos das pendências, o "quadro por ramos" e os números do Desempenho. Sem imports: testado com
// `node --experimental-strip-types --test site/fluxo/fluxo.test.ts`.
// O banco é a fonte da verdade: quem decide se o fluxo vale é public.fluxo_voz_erros / fluxo_voz_pendencias /
// fluxo_voz_bloqueios (cópia fiel em voz/fluxo_validador.py). `validarLocal` aqui é só uma aproximação para o modo
// de demonstração (fixtures) e para marcar o quadro antes da resposta do banco; nunca libera nada sozinha.
// LGPD: nada aqui guarda nome, CPF ou telefone; o simulador usa o cliente de teste CLI-00001.

export type Modo = 'arvore' | 'cognicao' | 'generativo' | 'sistema';
export type TipoBloco = 'abertura' | 'identidade' | 'pergunta' | 'intencao' | 'generativa' | 'oferta' | 'retorno'
	| 'conector' | 'registrar' | 'link' | 'condicao' | 'transferir' | 'encerrar';
export type TipoSaida = 'normal' | 'devolve' | 'falha';
export interface Saida { rotulo: string; para: string; tipo: TipoSaida; quando: string }
export interface Bloco {
	id: string; tipo: TipoBloco; modo: Modo; x?: number; y?: number; titulo?: string; repetir_max?: number;
	params: Record<string, unknown>; saidas: Saida[];
}
export interface Definicao { esquema: 1; blocos: Bloco[] }
export type SituacaoVersao = 'rascunho' | 'aprovado_empresa' | 'em_uso' | 'arquivado';
export type TipoAgente = 'localizador' | 'negociador' | 'ambos';

/** Modos com nomes simples (decisão do dono); o nome antigo aparece só na gaveta, para quem já aprendeu. */
export const MODOS: Record<Modo, { nome: string; antigo: string; cor: string; desc: string }> = {
	arvore: { nome: 'Fala fixa', antigo: 'Árvore', cor: 'var(--base-texto-3)', desc: 'Fala roteirizada, opções e ramos. Previsível e auditável.' },
	cognicao: { nome: 'Entende e escolhe', antigo: 'Cognição', cor: '#2F6FD6', desc: 'Entende a intenção e os dados da fala e leva ao ramo certo. A fala continua roteirizada.' },
	generativo: { nome: 'Conversa livre (IA)', antigo: 'Generativo', cor: '#8A4FC4', desc: 'A IA conversa rumo a um objetivo, só com as ferramentas e os limites desta etapa. Devolve o controle ao roteiro pelas saídas.' },
	sistema: { nome: 'Sistema', antigo: 'Sem fala', cor: '#8E9AA6', desc: 'Chama API, testa condição ou registra. Não fala com a pessoa.' },
};

export const TIPOS_AGENTE: Record<TipoAgente, string> = { localizador: 'Localizador', negociador: 'Negociador', ambos: 'Localizador + Negociador' };
export const SITUACOES: Record<SituacaoVersao, { nome: string; tom: 'ok' | 'atencao' | 'neutro' | 'info' }> = {
	rascunho: { nome: 'rascunho', tom: 'info' },
	aprovado_empresa: { nome: 'aprovado pela empresa', tom: 'atencao' },
	em_uso: { nome: 'em uso', tom: 'ok' },
	arquivado: { nome: 'arquivado', tom: 'neutro' },
};

interface SaidaPadrao { quando: string; rotulo: string; obrig?: boolean }
interface InfoTipo {
	nome: string; grupo: 'Conversa' | 'Integração' | 'Controle'; modos: Modo[]; final?: boolean;
	saidas: SaidaPadrao[]; params: () => Record<string, unknown>;
}
/** Os 13 blocos do esquema 1 (mesmas listas de public.fluxo_voz_erros). */
export const TIPOS: Record<TipoBloco, InfoTipo> = {
	abertura: { nome: 'Abertura', grupo: 'Conversa', modos: ['arvore'], saidas: [{ quando: 'titular', rotulo: 'Sou eu', obrig: true }, { quando: 'terceiro', rotulo: 'Não é a pessoa', obrig: true }], params: () => ({ fala: 'Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?' }) },
	identidade: { nome: 'Confirmar identidade', grupo: 'Conversa', modos: ['arvore', 'cognicao'], saidas: [{ quando: 'confirmou', rotulo: 'Confirmou', obrig: true }, { quando: 'nao_confirmou', rotulo: 'Não confirmou', obrig: true }, { quando: 'falhou', rotulo: 'Conector falhou' }], params: () => ({ fala: 'Para sua segurança, me confirma o dia e o mês do seu nascimento?', pergunta: 'dia_mes_nascimento', conector_id: null, tentativas: 2 }) },
	pergunta: { nome: 'Pergunta', grupo: 'Conversa', modos: ['arvore'], saidas: [{ quando: 'sem_resposta', rotulo: 'Sem resposta' }], params: () => ({ fala: 'Posso continuar?', tentativas: 1, opcoes: [{ codigo: 'sim', rotulo: 'Sim' }, { codigo: 'nao', rotulo: 'Não' }] }) },
	intencao: { nome: 'Entender intenção', grupo: 'Conversa', modos: ['cognicao'], saidas: [{ quando: 'nao_entendido', rotulo: 'Não entendi', obrig: true }], params: () => ({ fala: 'Como fica melhor para você resolver?', intencoes: ['quero_negociar', 'sem_dinheiro'], confianca_min: 0.7, tentativas: 2 }) },
	generativa: { nome: 'Conversa livre (IA)', grupo: 'Conversa', modos: ['generativo'], saidas: [{ quando: 'fechou_acordo', rotulo: 'Fechou acordo' }, { quando: 'sem_acordo', rotulo: 'Sem acordo' }, { quando: 'contestou', rotulo: 'Contestou' }, { quando: 'fora_alcada', rotulo: 'Fora da alçada' }], params: () => ({ objetivo: '', tom: ['cordial', 'frases_curtas', 'sem_giria', 'nao_pressiona'], max_turnos: 8, ferramentas: ['apresentar_oferta', 'consultar_base', 'transferir_humano', 'encerrar_chamada'], contrapropostas_max: 2 }) },
	oferta: { nome: 'Oferta', grupo: 'Conversa', modos: ['arvore', 'cognicao'], saidas: [{ quando: 'aceitou', rotulo: 'Aceitou', obrig: true }, { quando: 'quer_outra', rotulo: 'Quer outra condição' }, { quando: 'recusou', rotulo: 'Recusou', obrig: true }], params: () => ({ origem: 'carteira', fala: 'Consigo para você {{oferta.parcelas}} parcelas de {{oferta.valor_parcela}}. Fica bom?' }) },
	retorno: { nome: 'Agendar retorno', grupo: 'Conversa', modos: ['arvore', 'cognicao'], saidas: [{ quando: 'agendou', rotulo: 'Agendou', obrig: true }, { quando: 'nao_agendou', rotulo: 'Não agendou' }], params: () => ({ fala: 'Quando fica melhor eu ligar de novo?', dias_max: 7 }) },
	conector: { nome: 'Chamar conector', grupo: 'Integração', modos: ['sistema'], saidas: [{ quando: 'respondeu', rotulo: 'Respondeu', obrig: true }, { quando: 'falhou', rotulo: 'Falhou', obrig: true }], params: () => ({ conector_id: null, fala_espera: 'Um instante, por favor.' }) },
	registrar: { nome: 'Registrar promessa/acordo', grupo: 'Integração', modos: ['sistema'], saidas: [{ quando: 'registrado', rotulo: 'Registrado', obrig: true }, { quando: 'falhou', rotulo: 'Falhou', obrig: true }], params: () => ({ registra: 'promessa_motorcx', conectores: [] }) },
	link: { nome: 'Enviar link (SMS ou WhatsApp)', grupo: 'Integração', modos: ['arvore'], saidas: [{ quando: 'enviado', rotulo: 'Enviado', obrig: true }, { quando: 'falhou', rotulo: 'Não enviou' }], params: () => ({ canal: 'whatsapp_sms', fala: 'Acabei de mandar o link do pagamento.' }) },
	condicao: { nome: 'Condição', grupo: 'Controle', modos: ['sistema'], saidas: [{ quando: 'sim', rotulo: 'Sim', obrig: true }, { quando: 'nao', rotulo: 'Não', obrig: true }], params: () => ({ campo: 'ofertas_quantidade', op: '>=', valor: 1 }) },
	transferir: { nome: 'Transferir', grupo: 'Controle', modos: ['arvore'], final: true, saidas: [], params: () => ({ fala: 'Vou passar você para um atendente agora, só um instante.', motivo: 'pedido_humano' }) },
	encerrar: { nome: 'Encerrar', grupo: 'Controle', modos: ['arvore'], final: true, saidas: [], params: () => ({ fala: 'Obrigada pela atenção. Até logo.', resultado: 'cpc' }) },
};

export const ORDEM_TIPOS: TipoBloco[] = ['abertura', 'identidade', 'pergunta', 'intencao', 'generativa', 'oferta', 'retorno',
	'conector', 'registrar', 'link', 'condicao', 'transferir', 'encerrar'];

export const OPCOES = {
	pergunta_identidade: [['dia_mes_nascimento', 'Dia e mês de nascimento'], ['ano_nascimento', 'Ano de nascimento'], ['ultimos3_documento', '3 últimos dígitos do documento']],
	ferramentas: [['apresentar_oferta', 'Apresentar oferta'], ['registrar_promessa', 'Registrar promessa'], ['agendar_retorno', 'Agendar retorno'], ['consultar_base', 'Consultar a base de respostas'], ['transferir_humano', 'Transferir para humano (trava: sempre)'], ['encerrar_chamada', 'Encerrar a chamada']],
	tom: [['cordial', 'Cordial'], ['frases_curtas', 'Frases curtas'], ['sem_giria', 'Sem gíria'], ['nao_pressiona', 'Não pressiona'], ['formal', 'Formal']],
	origem_oferta: [['conector', 'Do CRM (conector Buscar ofertas)'], ['carteira', 'Da alçada da carteira']],
	registra: [['promessa_motorcx', 'Promessa no MotorCX'], ['acordo_crm', 'Acordo no CRM (conector)']],
	canal_link: [['whatsapp_sms', 'WhatsApp; se não entregar, SMS'], ['whatsapp', 'Só WhatsApp'], ['sms', 'Só SMS']],
	campo_condicao: [['ofertas_quantidade', 'Ofertas recebidas'], ['identidade_confirmada', 'Identidade confirmada'], ['dias_atraso', 'Dias de atraso'], ['saldo', 'Saldo'], ['tentativa_do_dia', 'Tentativa do dia']],
	op: [['=', '='], ['<>', '≠'], ['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥']],
	motivo_transferir: [['pedido_humano', 'Pediu um atendente'], ['cpc', 'Titular confirmado (CPC)'], ['ofertas_sem_acordo', 'Ofertas sem acordo'], ['fora_alcada', 'Fora da alçada'], ['contestacao', 'Contestação']],
	resultado_encerrar: [['promessa', 'Promessa'], ['retorno_agendado', 'Retorno agendado'], ['recusa', 'Recusa'], ['recado', 'Recado neutro (terceiro)'], ['cpc', 'CPC'], ['atendida_sem_cpc', 'Atendida sem CPC'], ['identidade_confirmada', 'Identidade confirmada']],
	entidades: [['data', 'Data'], ['valor', 'Valor'], ['parcelas', 'Parcelas'], ['hora', 'Hora']],
} as const;

export const VARIAVEIS = ['primeiro_nome', 'credor', 'saldo', 'dias_atraso', 'vencimento', 'link_pagamento', 'valor_minimo',
	'parcelas_max', 'desconto_max', 'assessoria', 'oferta.id', 'oferta.parcelas', 'oferta.valor_parcela', 'oferta.desconto_pct',
	'oferta.vencimento', 'oferta.valor_total', 'oferta.entrada'] as const;

/** Regras fixas (travas): nenhum fluxo desliga. */
export const TRAVAS: [string, string][] = [
	['Não fala de valor antes de confirmar a identidade.', 'O validador recusa um fluxo em que valor, oferta ou credor vem antes de Confirmar identidade em algum caminho. Na ligação, o executor também corta.'],
	['Nunca pede senha nem número de cartão.', 'Vale para a fala fixa e para a conversa livre: a resposta da IA passa por um filtro antes de virar voz.'],
	['Atende "não me ligue" na hora.', 'Em qualquer etapa e em qualquer modo: grava o opt-out e encerra.'],
	['Para terceiro, só recado neutro.', '"Peço que {{primeiro_nome}} retorne para a {{assessoria}}." Sem valor, sem credor, sem motivo.'],
	['Nunca passa da alçada.', 'Desconto, parcelas e entrada ficam dentro da alçada da carteira, também para as ofertas que vêm do CRM.'],
	['Transfere para humano a qualquer momento.', 'Por SIP, para o discador de vocês, com o ID do cliente e o motivo no cabeçalho.'],
	['A conversa livre nunca inventa oferta.', 'Só usa as ofertas que vieram do conector ou da alçada da carteira.'],
];

/** Nomes legíveis das travas que o executor registra (voz_fluxo_passos.trava, travas_voz()). */
export const NOMES_TRAVA: Record<string, string> = {
	nao_me_ligue: '"Não me ligue"', pedido_humano: 'Pediu humano', senha_cartao: 'Senha ou cartão', valor_antes_identidade: 'Valor antes de confirmar identidade',
	terceiro: 'Falar com terceiro', alcada: 'Valor fora da alçada', oferta_inventada: 'Oferta inventada', repeticao: 'Repetição',
};

// ---------------------------------------------------------------- blocos
export const ehFinal = (b: Pick<Bloco, 'tipo'>) => !!TIPOS[b.tipo]?.final;
export const numeroId = (id: string) => Number(id.replace(/^N/, '')) || 0;
export function proximoId(blocos: Pick<Bloco, 'id'>[]): string {
	return `N${blocos.reduce((m, b) => Math.max(m, numeroId(b.id)), 0) + 1}`;
}
export function tituloBloco(b: Bloco): string {
	return b.titulo?.trim() || TIPOS[b.tipo]?.nome || b.tipo;
}
/** Texto curto do que o bloco faz: a fala, o objetivo ou a ação de sistema. */
export function resumoBloco(b: Bloco): string {
	const p = b.params ?? {};
	if (typeof p.fala === 'string' && p.fala.trim()) return `"${p.fala.trim()}"`;
	if (typeof p.objetivo === 'string' && p.objetivo.trim()) return `Objetivo: ${p.objetivo.trim()}${p.max_turnos ? ` Até ${p.max_turnos} turnos.` : ''}`;
	if (b.tipo === 'conector') return typeof p.fala_espera === 'string' && p.fala_espera ? `Fala de espera: "${p.fala_espera}"` : 'Chama um conector do CRM.';
	if (b.tipo === 'condicao') return `${rotuloDe(OPCOES.campo_condicao, p.campo)} ${rotuloDe(OPCOES.op, p.op)} ${String(p.valor ?? '')}`;
	if (b.tipo === 'registrar') return rotuloDe(OPCOES.registra, p.registra);
	return '';
}
export function rotuloDe(lista: readonly (readonly [string, string])[], v: unknown): string {
	return lista.find(x => x[0] === v)?.[1] ?? String(v ?? '');
}

/** Saídas possíveis do bloco: (quando, rótulo sugerido, obrigatória). Pergunta e intenção dependem dos params. */
export function saidasPossiveis(b: Bloco): SaidaPadrao[] {
	const p = b.params ?? {};
	if (b.tipo === 'pergunta') {
		const ops = Array.isArray(p.opcoes) ? (p.opcoes as { codigo?: string; rotulo?: string }[]) : [];
		return [...ops.filter(o => o && o.codigo).map(o => ({ quando: String(o.codigo), rotulo: String(o.rotulo || o.codigo), obrig: true })), { quando: 'sem_resposta', rotulo: 'Sem resposta' }];
	}
	if (b.tipo === 'intencao') {
		const its = Array.isArray(p.intencoes) ? (p.intencoes as string[]) : [];
		return [...its.map(i => ({ quando: i, rotulo: i, obrig: true })), { quando: 'nao_entendido', rotulo: 'Não entendi', obrig: true }];
	}
	if (b.tipo === 'identidade') {
		const comCon = p.conector_id != null;
		return TIPOS.identidade.saidas.map(s => (s.quando === 'falhou' ? { ...s, obrig: comCon } : s));
	}
	return TIPOS[b.tipo]?.saidas ?? [];
}
export const tipoDaSaida = (b: Pick<Bloco, 'tipo'>, quando: string): TipoSaida => (b.tipo === 'generativa' ? 'devolve' : quando === 'falhou' ? 'falha' : 'normal');
export function saidasFaltando(b: Bloco): string[] {
	if (ehFinal(b)) return [];
	const tem = new Set(b.saidas.map(s => s.quando));
	return saidasPossiveis(b).filter(s => s.obrig && !tem.has(s.quando)).map(s => s.rotulo);
}

export function novoBloco(tipo: TipoBloco, blocos: Pick<Bloco, 'id'>[]): Bloco {
	const t = TIPOS[tipo];
	return { id: proximoId(blocos), tipo, modo: t.modos[t.modos.length - 1], params: t.params(), saidas: [] };
}
/** Troca o tipo-modo (no select da gaveta, só os modos que o tipo aceita). */
export const modosDoTipo = (tipo: TipoBloco): Modo[] => TIPOS[tipo]?.modos ?? [];

/** Remove o bloco e as saídas que apontavam para ele. */
export function removerBloco(d: Definicao, id: string): Definicao {
	return { ...d, blocos: d.blocos.filter(b => b.id !== id).map(b => ({ ...b, saidas: b.saidas.filter(s => s.para !== id) })) };
}
export function trocarBloco(d: Definicao, bloco: Bloco): Definicao {
	const ix = d.blocos.findIndex(b => b.id === bloco.id);
	return { ...d, blocos: ix < 0 ? [...d.blocos, bloco] : d.blocos.map((b, i) => (i === ix ? bloco : b)) };
}

// ---------------------------------------------------------------- quadro por ramos
export interface Ramo { nome: string; origem?: string; blocos: Bloco[]; tipo: 'principal' | 'ramo' | 'finais' | 'solto' }
/**
 * Quadro por ramos (decisão do dono): o caminho principal em cima, na ordem da conversa (da Abertura, sempre pela 1ª
 * saída que não é falha), e os ramos embaixo, cada um com o nome da saída que leva a ele. Finais (Transferir/Encerrar)
 * com mais de uma entrada ficam em "Finais compartilhados"; o que nenhum caminho alcança, em "Sem ligação".
 */
export function quadroPorRamos(d: Definicao): Ramo[] {
	const porId = new Map(d.blocos.map(b => [b.id, b]));
	const entradas = new Map<string, number>();
	for (const b of d.blocos) for (const s of b.saidas) if (porId.has(s.para) && s.para !== b.id) entradas.set(s.para, (entradas.get(s.para) ?? 0) + 1);
	const abertura = d.blocos.filter(b => b.tipo === 'abertura').sort((a, b) => numeroId(a.id) - numeroId(b.id))[0];
	const compartilhado = (id: string) => { const b = porId.get(id); return !!b && ehFinal(b) && (entradas.get(id) ?? 0) >= 2 && b.tipo !== 'abertura'; };
	const colocado = new Set<string>();
	const ramos: Ramo[] = [];
	const ordenadas = (b: Bloco) => [...b.saidas].sort((x, y) => Number(x.tipo === 'falha') - Number(y.tipo === 'falha'));
	const seguir = (inicio: Bloco): Bloco[] => {
		const lista: Bloco[] = [];
		let atual: Bloco | undefined = inicio;
		while (atual && !colocado.has(atual.id)) {
			colocado.add(atual.id); lista.push(atual);
			const prox: Saida | undefined = ordenadas(atual).find(s => porId.has(s.para) && !colocado.has(s.para) && !compartilhado(s.para));
			atual = prox ? porId.get(prox.para) : undefined;
		}
		return lista;
	};
	if (abertura) {
		ramos.push({ nome: 'Caminho principal', blocos: seguir(abertura), tipo: 'principal' });
		for (let i = 0; i < ramos.length; i++) {
			for (const b of ramos[i].blocos) {
				for (const s of ordenadas(b)) {
					const alvo = porId.get(s.para);
					if (!alvo || colocado.has(alvo.id) || compartilhado(alvo.id)) continue;
					const nome = s.tipo === 'falha' ? `Se ${tituloBloco(b)} falhar` : s.rotulo;
					ramos.push({ nome, origem: b.id, blocos: seguir(alvo), tipo: 'ramo' });
				}
			}
		}
	}
	const finais = d.blocos.filter(b => compartilhado(b.id) && !colocado.has(b.id));
	finais.forEach(b => colocado.add(b.id));
	if (finais.length) ramos.push({ nome: 'Finais compartilhados', blocos: finais.sort((a, b) => numeroId(a.id) - numeroId(b.id)), tipo: 'finais' });
	const soltos = d.blocos.filter(b => !colocado.has(b.id));
	if (soltos.length) ramos.push({ nome: 'Sem ligação', blocos: soltos.sort((a, b) => numeroId(a.id) - numeroId(b.id)), tipo: 'solto' });
	return ramos;
}
/** "Sou eu → N2" ou, para um final compartilhado, "Sou eu ↪ N13". */
export function textoSaida(s: Saida, compartilhados: Set<string>): string {
	return `${s.rotulo} ${compartilhados.has(s.para) ? '↪' : '→'} ${s.para}`;
}

/** Quanto do fluxo é feito em cada modo (gaveta do fluxo). Percentuais inteiros que somam 100. */
export function misturaModos(d: Definicao | null | undefined): { modo: Modo; pct: number }[] {
	const blocos = d?.blocos ?? [];
	if (!blocos.length) return [];
	const cont = new Map<Modo, number>();
	for (const b of blocos) cont.set(b.modo, (cont.get(b.modo) ?? 0) + 1);
	const lista = [...cont.entries()].map(([modo, n]) => ({ modo, pct: Math.floor((100 * n) / blocos.length), resto: (100 * n) % blocos.length }));
	let falta = 100 - lista.reduce((s, x) => s + x.pct, 0);
	for (const x of [...lista].sort((a, b) => b.resto - a.resto)) { if (falta <= 0) break; x.pct++; falta--; }
	return lista.sort((a, b) => b.pct - a.pct).map(({ modo, pct }) => ({ modo, pct }));
}
export function modoPredominante(d: Definicao | null | undefined): string {
	const m = misturaModos(d);
	if (!m.length) return 'Sem etapas';
	if (m[0].pct >= 60) return MODOS[m[0].modo].nome;
	return `Misto · ${m.slice(0, 2).map(x => MODOS[x.modo].nome.toLowerCase()).join(' e ')}`;
}

// ---------------------------------------------------------------- pendências (códigos do banco → texto)
export interface Pendencia { codigo: string; bloco?: string; texto: string; impede: boolean }
const TEXTOS: Record<string, string> = {
	esquema_invalido: 'A definição está fora do esquema do fluxo.',
	blocos_demais: 'O fluxo passa de 60 etapas.',
	id_invalido: 'Uma etapa está com código inválido.',
	id_repetido: 'Duas etapas com o mesmo código.',
	tipo_invalido: 'Tipo de etapa desconhecido.',
	bloco_invalido: 'Etapa com campo fora do esquema (título com mais de 60 caracteres ou repetição fora de 1 a 5).',
	identidade_generativa: 'Confirmar identidade não pode ser Conversa livre (IA).',
	modo_incompativel: 'Este modo não vale para este tipo de etapa.',
	params_invalidos: 'Falta preencher algum campo desta etapa (fala, opções ou escolhas).',
	fala_longa: 'Fala com mais de 500 caracteres.',
	generativo_sem_objetivo: 'A conversa livre precisa de um objetivo com pelo menos 20 caracteres.',
	generativo_sem_limite: 'Diga o limite de turnos da conversa livre (1 a 40).',
	ferramenta_invalida: 'Ferramenta fora da lista ou repetida.',
	transferir_humano_desligado: 'A conversa livre precisa da ferramenta "Transferir para humano" (trava fixa).',
	variavel_invalida: 'Usa uma variável {{ }} que não existe.',
	fala_pede_senha: 'A fala pede senha ou número de cartão (trava fixa: nunca).',
	saida_invalida: 'Uma saída está repetida ou fora das opções desta etapa.',
	final_com_saida: 'Transferir e Encerrar são finais: não têm saída.',
	sem_saida: 'Etapa sem saída. A conversa ficaria parada aqui.',
	saida_faltando: 'Falta uma saída obrigatória.',
	saida_inexistente: 'Uma saída aponta para uma etapa que não existe.',
	abertura_ausente: 'O fluxo precisa de uma etapa Abertura.',
	abertura_repetida: 'O fluxo tem mais de uma Abertura.',
	inalcancavel: 'Nenhum caminho chega a esta etapa.',
	terceiro_sem_recado: 'Quando atende outra pessoa, o fluxo tem de ir direto para Encerrar com recado neutro.',
	valor_antes_identidade: 'Fala de valor, oferta ou credor antes de Confirmar identidade em algum caminho.',
	ciclo_sem_limite: 'Há uma volta sem limite: defina "repetir no máximo" numa das etapas da volta.',
	identidade_sem_conferencia: 'Escolha o conector "Validar cadastro" do CRM: só ele confere a identidade.',
	conector_inativo: 'O conector desta etapa não foi escolhido ou não está ativo (testado pela equipe MotorCX).',
	conector_finalidade: 'O conector escolhido não tem a finalidade certa para esta etapa.',
	sem_alcada: 'A carteira não tem alçada cadastrada. Sem alçada, o agente não pode oferecer.',
	intencao_fora_catalogo: 'Usa uma intenção fora do catálogo.',
	caso_falhou: 'Um caso de teste guardado falhou nesta versão.',
	roleplay_ausente: 'Esta versão ainda não passou por personas.',
	roleplay_reprovadas: 'conversas com personas não chegaram ao resultado esperado.',
	roleplay_acordo_caiu: 'O acordo simulado caiu em relação à versão em uso.',
};
/** Código do banco ('sem_saida:N9', 'sem_alcada', 'roleplay_reprovadas:3') → texto da tela. Avisos do roleplay nunca impedem. */
export function explicar(codigo: string): Pendencia {
	const [base, arg] = codigo.split(':');
	const aviso = base.startsWith('roleplay_');
	const bloco = arg && /^N\d{1,3}$/.test(arg) ? arg : undefined;
	let texto = TEXTOS[base] ?? `Pendência: ${base.replace(/_/g, ' ')}.`;
	if (base === 'roleplay_reprovadas' && arg) texto = `${arg} ${texto}`;
	if (base === 'roleplay_acordo_caiu' && arg) texto = `O acordo simulado caiu ${arg} p.p. em relação à versão em uso.`;
	if (base === 'caso_falhou' && arg) texto = `O caso de teste #${arg} falhou nesta versão.`;
	return { codigo, bloco, texto, impede: !aviso };
}
export const impedem = (codigos: string[]) => codigos.map(explicar).filter(p => p.impede);

/** "Enviar para aprovação": desabilitado, com o motivo, enquanto houver pendência (decisão do dono). */
export function estadoEnvio(a: { situacao: SituacaoVersao; erros: string[]; sujo: boolean; podeEditar: boolean; validando?: boolean; enviadoEm?: string | null }): { ok: boolean; motivo: string } {
	if (!a.podeEditar) return { ok: false, motivo: 'Precisa da permissão Editar canais para enviar.' };
	if (a.situacao !== 'rascunho') return { ok: false, motivo: 'Só o rascunho vai para aprovação.' };
	if (a.sujo) return { ok: false, motivo: 'Salve o rascunho antes de enviar.' };
	if (a.validando) return { ok: false, motivo: 'Conferindo o fluxo…' };
	const n = impedem(a.erros).length;
	if (n > 0) return { ok: false, motivo: `${n} ${n === 1 ? 'pendência impede' : 'pendências impedem'} o envio.` };
	if (a.enviadoEm) return { ok: true, motivo: 'Já enviado. Enviar de novo avisa quem aprova outra vez.' };
	return { ok: true, motivo: '' };
}

/** "Uma etapa sem saída, uma inalcançável, um conector sem configurar e uma carteira sem alçada." */
export function resumoPendencias(codigos: string[]): string {
	const conta = new Map<string, number>();
	for (const c of codigos) { const k = c.split(':')[0]; conta.set(k, (conta.get(k) ?? 0) + 1); }
	const nome: Record<string, [string, string, 'um' | 'uma']> = {
		sem_saida: ['etapa sem saída', 'etapas sem saída', 'uma'], inalcancavel: ['etapa inalcançável', 'etapas inalcançáveis', 'uma'],
		conector_inativo: ['conector sem configurar', 'conectores sem configurar', 'um'], conector_finalidade: ['conector de outra finalidade', 'conectores de outra finalidade', 'um'],
		sem_alcada: ['carteira sem alçada', 'carteiras sem alçada', 'uma'], identidade_sem_conferencia: ['identidade sem conferência no CRM', 'identidades sem conferência no CRM', 'uma'],
		saida_faltando: ['saída faltando', 'saídas faltando', 'uma'], caso_falhou: ['caso de teste que falhou', 'casos de teste que falharam', 'um'],
		params_invalidos: ['etapa com campo faltando', 'etapas com campo faltando', 'uma'], valor_antes_identidade: ['valor antes da identidade', 'valores antes da identidade', 'um'],
	};
	const ordem = Object.keys(nome);
	const pos = (k: string) => (ordem.includes(k) ? ordem.indexOf(k) : ordem.length);
	const partes = [...conta.entries()].sort((a, b) => pos(a[0]) - pos(b[0])).map(([k, n]) => (nome[k] ? `${n === 1 ? nome[k][2] : n} ${nome[k][n === 1 ? 0 : 1]}` : `${n} ${k.replace(/_/g, ' ')}`));
	if (!partes.length) return '';
	const txt = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
	return txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
}

// ---------------------------------------------------------------- validação local (só aproximação)
/** Aproximação do validador do banco para o modo de demonstração e para marcar o quadro. O banco decide. */
export function validarLocal(d: Definicao): string[] {
	const out = new Set<string>();
	const ids = new Set(d.blocos.map(b => b.id));
	const aberturas = d.blocos.filter(b => b.tipo === 'abertura');
	if (!aberturas.length) out.add('abertura_ausente');
	if (aberturas.length > 1) out.add('abertura_repetida');
	for (const b of d.blocos) {
		if (!modosDoTipo(b.tipo).includes(b.modo)) out.add(`modo_incompativel:${b.id}`);
		if (ehFinal(b)) { if (b.saidas.length) out.add(`final_com_saida:${b.id}`); continue; }
		if (!b.saidas.length) { out.add(`sem_saida:${b.id}`); continue; }
		if (b.saidas.some(s => !ids.has(s.para))) out.add(`saida_inexistente:${b.id}`);
		if (saidasFaltando(b).length) out.add(`saida_faltando:${b.id}`);
		if (b.tipo === 'generativa') {
			const p = b.params;
			if (typeof p.objetivo !== 'string' || p.objetivo.trim().length < 20) out.add(`generativo_sem_objetivo:${b.id}`);
			if (!Array.isArray(p.ferramentas) || !p.ferramentas.includes('transferir_humano')) out.add(`transferir_humano_desligado:${b.id}`);
		}
	}
	if (aberturas.length === 1) {
		const alc = new Set([aberturas[0].id]);
		const fila = [aberturas[0].id];
		const porId = new Map(d.blocos.map(b => [b.id, b]));
		while (fila.length) {
			const b = porId.get(fila.shift() as string);
			for (const s of b?.saidas ?? []) if (porId.has(s.para) && !alc.has(s.para)) { alc.add(s.para); fila.push(s.para); }
		}
		for (const b of d.blocos) if (!alc.has(b.id)) out.add(`inalcancavel:${b.id}`);
	}
	return [...out].sort();
}

// ---------------------------------------------------------------- desempenho (voz_fluxo_metricas_dia, só contagens)
export interface MetricaBloco { bloco_id: string; chegaram: number; saidas: Record<string, number>; turnos_medio?: number | null }
/** Soma os dias: por bloco, quem chegou, por qual saída saiu e os turnos médios ponderados. */
export function somarMetricas(linhas: MetricaBloco[]): Map<string, MetricaBloco> {
	const m = new Map<string, MetricaBloco & { _t: number }>();
	for (const l of linhas) {
		const a = m.get(l.bloco_id) ?? { bloco_id: l.bloco_id, chegaram: 0, saidas: {}, turnos_medio: null, _t: 0 };
		a.chegaram += Number(l.chegaram) || 0;
		for (const [k, v] of Object.entries(l.saidas ?? {})) a.saidas[k] = (a.saidas[k] ?? 0) + (Number(v) || 0);
		if (l.turnos_medio != null) a._t += Number(l.turnos_medio) * (Number(l.chegaram) || 0);
		m.set(l.bloco_id, a);
	}
	for (const a of m.values()) a.turnos_medio = a.chegaram && a._t ? Math.round((10 * a._t) / a.chegaram) / 10 : null;
	return m;
}
export interface Kpis { atendidas: number; identidade: number; acordos: number; transferidas: number; taxaIdentidade: number | null; taxaAcordo: number | null; taxaTransferidas: number | null }
export function kpisDoFluxo(d: Definicao, m: Map<string, MetricaBloco>): Kpis {
	const soma = (f: (b: Bloco) => number) => d.blocos.reduce((s, b) => s + f(b), 0);
	const chegou = (b: Bloco) => m.get(b.id)?.chegaram ?? 0;
	const saiu = (b: Bloco, q: string) => m.get(b.id)?.saidas?.[q] ?? 0;
	const atendidas = soma(b => (b.tipo === 'abertura' ? chegou(b) : 0));
	const identidade = soma(b => (b.tipo === 'identidade' ? saiu(b, 'confirmou') : 0));
	const registros = soma(b => (b.tipo === 'registrar' ? saiu(b, 'registrado') : 0));
	const acordos = registros || soma(b => (b.tipo === 'encerrar' && b.params?.resultado === 'promessa' ? chegou(b) : 0));
	const transferidas = soma(b => (b.tipo === 'transferir' ? chegou(b) : 0));
	const div = (a: number, b: number) => (b > 0 ? a / b : null);
	return { atendidas, identidade, acordos, transferidas, taxaIdentidade: div(identidade, atendidas), taxaAcordo: div(acordos, identidade), taxaTransferidas: div(transferidas, atendidas) };
}
/** Taxa de resultado do fluxo: negociador = acordos ÷ identidade confirmada; localizador = transferidas ÷ atendidas. */
export function taxaResultado(tipo: TipoAgente, k: Kpis): number | null {
	return tipo === 'localizador' ? k.taxaTransferidas : k.taxaAcordo;
}
export interface DegrauFunil { bloco: Bloco; chegaram: number; pctAtendidas: number | null; saidas: { rotulo: string; para: string | null; n: number }[]; sairamAqui: number }
/** Funil do caminho principal: quantos chegaram em cada etapa e por onde saíram os que não seguiram. */
export function funil(d: Definicao, m: Map<string, MetricaBloco>): DegrauFunil[] {
	const principal = quadroPorRamos(d).find(r => r.tipo === 'principal')?.blocos ?? [];
	const atendidas = kpisDoFluxo(d, m).atendidas;
	return principal.filter(b => !ehFinal(b)).map((b, i, arr) => {
		const mb = m.get(b.id);
		const segue = arr[i + 1]?.id;
		const saidas = Object.entries(mb?.saidas ?? {}).map(([q, n]) => {
			const s = b.saidas.find(x => x.quando === q);
			return { rotulo: s?.rotulo ?? q.replace(/_/g, ' '), para: s?.para ?? null, n: Number(n) || 0 };
		}).filter(s => s.para !== segue).sort((a, c) => c.n - a.n);
		return { bloco: b, chegaram: mb?.chegaram ?? 0, pctAtendidas: atendidas ? (mb?.chegaram ?? 0) / atendidas : null, saidas, sairamAqui: saidas.reduce((s, x) => s + x.n, 0) };
	});
}

// ---------------------------------------------------------------- formatos
export const pctTxt = (v: number | null | undefined, casas = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
export const ppTxt = (a: number | null, b: number | null) => (a == null || b == null ? '' : `${a >= b ? '+' : '−'}${Math.abs((a - b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`);
export const nTxt = (v: unknown) => Math.round(Number(v ?? 0)).toLocaleString('pt-BR');
export function dataCurta(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
}
/** CSV só com códigos e contagens (Exportar do Desempenho). Separador ";" como o resto do MotorCX. */
export function csv(linhas: (string | number | null)[][]): string {
	const cel = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
	return linhas.map(l => l.map(cel).join(';')).join('\n');
}

// ---------------------------------------------------------------- testes e personas
/** Mesma regra de public.falas_teste_voz_ok e do simulador: 1 a 300 caracteres, sem 9+ dígitos seguidos e sem @. */
export const falaOk = (t: string) => t.length >= 1 && t.length <= 300 && !/[0-9]{9,}/.test(t) && !t.includes('@');
/** Opções de conversas por persona no roleplay (rodar_roleplay_voz: 1 a 20 por persona, até 200 no lote). */
export const QTDS_ROLEPLAY = [5, 10, 20] as const;
export const totalRoleplay = (personas: number, n: number) => personas * n;
export const roleplayValido = (personas: number, n: number) => personas >= 1 && personas <= 10 && n >= 1 && n <= 20 && personas * n <= 200;
export const DIFICULDADE = ['', 'Fácil', 'Fácil', 'Média', 'Difícil', 'Difícil'];
/** Nome do anexo seguro para o Storage (sem 10+ dígitos seguidos, que o banco recusa). */
export function nomeAnexo(nome: string, sufixo: string): string {
	const base = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/[0-9]{6,}/g, d => d.slice(0, 5)).slice(-80);
	return `${sufixo}_${base || 'anexo'}`;
}
