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

/** Modos com nomes simples (decisão do dono); o nome antigo aparece só na gaveta, para quem já aprendeu. As cores de
 * "Fala fixa" (cinza do texto) e "Sistema" (laranja) ficam bem diferentes no claro e no escuro (revisão U5). */
export const MODOS: Record<Modo, { nome: string; antigo: string; cor: string; desc: string }> = {
	arvore: { nome: 'Fala fixa', antigo: 'Árvore', cor: 'var(--base-texto-2)', desc: 'Fala roteirizada, opções e ramos. Previsível e auditável.' },
	cognicao: { nome: 'Entende e escolhe', antigo: 'Cognição', cor: '#2F6FD6', desc: 'Entende a intenção e os dados da fala e leva ao ramo certo. A fala continua roteirizada.' },
	generativo: { nome: 'Conversa livre (IA)', antigo: 'Generativo', cor: '#8A4FC4', desc: 'A IA conversa rumo a um objetivo, só com as ferramentas e os limites desta etapa. Devolve o controle ao roteiro pelas saídas.' },
	sistema: { nome: 'Sistema', antigo: 'Sem fala', cor: '#B8662F', desc: 'Chama API, testa condição ou registra. Não fala com a pessoa.' },
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

/**
 * As 7 travas (regras fixas): ficam no executor (voz/fluxo.py, docstring) e no validador (voz/fluxo_validador.py), não
 * no fluxo; nenhum fluxo desliga. É a lista única do site: a faixa do editor, a gaveta e o "Descrever" leem esta.
 * O texto diz só o que o código já garante hoje.
 */
export const TRAVAS: [string, string][] = [
	['Valor, oferta e credor só depois da identidade.', 'O validador recusa um fluxo em que valor, oferta ou credor vem antes de Confirmar identidade em algum caminho. Na ligação, o executor também troca a fala pelo recado neutro.'],
	['Nunca pede senha nem número de cartão.', 'Vale para a fala fixa e para a IA: a resposta passa por um filtro antes de virar voz. Se a pessoa oferecer, ouve: "O pagamento é sempre pelo link."'],
	['"Não me ligue" encerra na hora.', 'Em qualquer etapa e em qualquer modo: grava o opt-out e se despede.'],
	['Terceiro só ouve recado neutro.', '"Peço que {{primeiro_nome}} retorne para a {{assessoria}}." Sem valor, sem credor, sem motivo.'],
	['Nunca passa da alçada.', 'Desconto, parcelas e entrada ficam dentro da alçada da carteira, também para as ofertas que vêm do CRM.'],
	['"Quero falar com uma pessoa" transfere.', 'A qualquer momento, por SIP, para o discador de vocês, com o ID do cliente e o motivo. Sem atendente livre, a pessoa volta ao agente.'],
	['A IA só usa as ofertas que recebeu.', 'Só as ofertas do conector ou da alçada da carteira. Número fora delas é trocado antes de virar voz.'],
];

/**
 * "Em qualquer momento da ligação": o que o executor faz antes de qualquer etapa (voz/fluxo.py › _travas e
 * _tentar_de_novo). Só o que existe hoje; o que ainda não existe fica em SEMPRE_AINDA_NAO, dito como tal.
 */
export const SEMPRE: [string, string][] = [
	['"Não me ligue mais"', 'Grava o opt-out e encerra.'],
	['"Quero falar com uma pessoa"', 'Transfere para um atendente. Sem atendente livre, volta ao agente.'],
	['Fala senha ou número de cartão', '"Não precisa me passar senha nem número de cartão. O pagamento é sempre pelo link."'],
	['Resposta que o agente não entende', 'Pede de novo até as tentativas da etapa. Depois, segue a saída da etapa.'],
];
/** Casos que ainda não têm tratamento próprio no executor (plano do redesenho: B2 e B4). Mostrados como "ainda não". */
export const SEMPRE_AINDA_NAO = 'Ainda sem tratamento próprio: tema sensível (falecimento, doença, golpe), CPF dito pela pessoa, caixa postal e silêncio no meio da conversa. Hoje, tema sensível, CPF e caixa postal seguem o caminho da etapa; no silêncio, o agente espera a pessoa falar.';

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
/**
 * Nome de cada etapa para as setas (revisão U1: "Sou eu → Confirmar identidade" no lugar de "→ N2"). É o título da
 * etapa; quando duas etapas têm o mesmo nome, o código entra entre parênteses só nelas ("Encerrar (N12)").
 */
export function nomesEtapas(d: Definicao): Map<string, string> {
	const conta = new Map<string, number>();
	for (const b of d.blocos) { const t = tituloBloco(b); conta.set(t, (conta.get(t) ?? 0) + 1); }
	return new Map(d.blocos.map(b => { const t = tituloBloco(b); return [b.id, (conta.get(t) ?? 0) > 1 ? `${t} (${b.id})` : t]; }));
}
/** Título do ramo em linguagem de conversa: 'Se disser "Já paguei"', 'Se a conversa terminar em "Sem acordo"',
 * 'Se Buscar ofertas falhar'. O caminho principal, os finais e os soltos ficam com o nome de sempre. */
export function tituloRamo(r: Ramo, d: Definicao): string {
	if (r.tipo !== 'ramo' || /^Se /.test(r.nome)) return r.nome;
	const origem = d.blocos.find(b => b.id === r.origem);
	if (origem?.tipo === 'generativa') return `Se a conversa terminar em "${r.nome}"`;
	if (origem?.modo === 'sistema') return `Se der "${r.nome}"`;
	return `Se disser "${r.nome}"`;
}
// ---------------------------------------------------------------- roteiro (vista principal do editor)
/** Capítulo do roteiro: um trecho da conversa, lido de cima para baixo. */
export interface Capitulo {
	id: string; titulo: string; sub?: string;
	tipo: 'conversa' | 'ramo' | 'finais' | 'solto';
	/** Etapa de onde o ramo sai (só nos ramos). */
	origem?: string;
	blocos: Bloco[];
}
/** Etapas que já são o "caminho do acordo": a partir da 1ª delas, o caminho principal vira "Negociação". */
const TIPOS_NEGOCIACAO: readonly TipoBloco[] = ['conector', 'condicao', 'oferta', 'generativa', 'registrar', 'link', 'retorno'];
/**
 * O roteiro: o fluxo em capítulos, na ordem da conversa (revisão U1 e U17; SPEC §2.1). Deriva de `quadroPorRamos`, sem
 * campo novo na definição: o caminho principal se divide em "Começo da ligação" (até Confirmar identidade), "Motivo da
 * ligação" (o que vem antes da negociação) e "Negociação" (da 1ª etapa de conector, oferta, IA, registro, link ou
 * retorno em diante). Depois, um capítulo por ramo, com nome de conversa ('Se disser "Já paguei"'), os finais usados
 * por vários caminhos e o que nenhum caminho alcança. Cada etapa aparece uma vez só; uma volta é dita na seta.
 */
export function roteiro(d: Definicao): Capitulo[] {
	const nomes = nomesEtapas(d);
	const out: Capitulo[] = [];
	for (const r of quadroPorRamos(d)) {
		if (r.tipo === 'principal') {
			const ixId = r.blocos.findIndex(b => b.tipo === 'identidade');
			const fimComeco = ixId >= 0 ? ixId + 1 : 1;
			const resto = r.blocos.slice(fimComeco);
			const ixNeg = resto.findIndex(b => TIPOS_NEGOCIACAO.includes(b.tipo));
			const motivo = ixNeg < 0 ? resto : resto.slice(0, ixNeg);
			const negociacao = ixNeg < 0 ? [] : resto.slice(ixNeg);
			out.push({ id: 'comeco', titulo: 'Começo da ligação', sub: 'Quem atende e quem é a pessoa', tipo: 'conversa', blocos: r.blocos.slice(0, fimComeco) });
			if (motivo.length) out.push(motivo.every(ehFinal)
				? { id: 'fim', titulo: 'Fim da ligação', tipo: 'conversa', blocos: motivo }
				: { id: 'motivo', titulo: 'Motivo da ligação', sub: ixId >= 0 ? 'Só depois da identidade confirmada' : 'Depois da abertura', tipo: 'conversa', blocos: motivo });
			if (negociacao.length) out.push({ id: 'negociacao', titulo: 'Negociação', sub: 'Caminho do acordo', tipo: 'conversa', blocos: negociacao });
		} else if (r.tipo === 'ramo') {
			out.push({ id: `ramo-${r.origem ?? ''}-${r.blocos[0]?.id ?? ''}`, titulo: tituloRamo(r, d), sub: r.origem ? `A partir de ${nomes.get(r.origem)}` : undefined, tipo: 'ramo', origem: r.origem, blocos: r.blocos });
		} else if (r.tipo === 'finais') {
			out.push({ id: 'finais', titulo: 'Finais usados por vários caminhos', sub: 'Transferir e encerrar', tipo: 'finais', blocos: r.blocos });
		} else {
			out.push({ id: 'soltos', titulo: 'Etapas que nenhum caminho alcança', sub: 'Ligue uma resposta de outra etapa a elas, ou remova', tipo: 'solto', blocos: r.blocos });
		}
	}
	return out;
}
/** Número de cada etapa no roteiro (1, 2, 3…), na ordem de leitura. */
export function numerosRoteiro(caps: Capitulo[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const c of caps) for (const b of c.blocos) m.set(b.id, m.size + 1);
	return m;
}
/** Saída que volta a uma etapa já lida e fecha uma volta (ex.: "Quer outra condição" → Negociar, que pode chegar de
 * novo aqui): "volta" ou "volta; no máximo 2 vezes". Ir para uma etapa lida antes, sem volta, não é volta. */
export function textoVolta(s: Saida, de: string, numeros: Map<string, number>, d: Definicao): string {
	const a = numeros.get(de), b = numeros.get(s.para);
	if (a == null || b == null || b > a) return '';
	const porId = new Map(d.blocos.map(x => [x.id, x]));
	const vis = new Set([s.para]);
	const fila = [s.para];
	while (fila.length) for (const x of porId.get(fila.shift() as string)?.saidas ?? []) if (!vis.has(x.para)) { vis.add(x.para); fila.push(x.para); }
	if (!vis.has(de)) return '';
	const lim = d.blocos.find(x => x.id === s.para)?.repetir_max;
	return lim ? `volta; no máximo ${lim} ${lim === 1 ? 'vez' : 'vezes'}` : 'volta';
}
/**
 * "Se não entender": o que o executor faz hoje quando não entende a resposta (voz/fluxo.py › _tentar_de_novo e o
 * _ouvir_ de cada tipo). Pede de novo (tentativas − 1) vezes, com a fala de cada tipo, e depois segue a saída `quando`.
 * Só as etapas que ouvem a pessoa; a conversa com IA, o sistema e os finais, não. O silêncio ainda não tem tratamento
 * próprio (B2): hoje o executor ignora o turno sem fala.
 */
export function seNaoEntender(b: Bloco): { repete: number; fala: string; quando: string } | null {
	const p = b.params ?? {};
	const repete = Math.max(0, (Math.floor(Number(p.tentativas)) || 2) - 1);
	const FALA_REPETIR = 'Desculpe, pode repetir?';
	switch (b.tipo) {
		case 'abertura': return { repete, fala: 'Desculpe. Falo com {{primeiro_nome}}?', quando: 'terceiro' };
		case 'identidade': return { repete, fala: 'Desculpe, não entendi. Pode repetir, por exemplo, 15 de março?', quando: 'nao_confirmou' };
		case 'pergunta': return { repete, fala: typeof p.fala === 'string' && p.fala.trim() ? p.fala.trim() : FALA_REPETIR, quando: 'sem_resposta' };
		case 'intencao': return { repete, fala: FALA_REPETIR, quando: 'nao_entendido' };
		case 'oferta': return { repete, fala: FALA_REPETIR, quando: 'recusou' };
		case 'retorno': return { repete, fala: 'Pode me dizer um dia e um horário, por exemplo, sexta às 10h?', quando: 'nao_agendou' };
		default: return null;
	}
}
/** O que a etapa de sistema faz, em palavras (ela não fala com a pessoa). */
export function acaoSistema(b: Bloco): string {
	const p = b.params ?? {};
	if (b.tipo === 'conector') return `Chama um conector do CRM.${typeof p.fala_espera === 'string' && p.fala_espera.trim() ? ` Enquanto espera, diz: "${p.fala_espera.trim()}"` : ''}`;
	if (b.tipo === 'condicao') return `Confere: ${rotuloDe(OPCOES.campo_condicao, p.campo)} ${rotuloDe(OPCOES.op, p.op)} ${String(p.valor ?? '')}`;
	if (b.tipo === 'registrar') return `Registra: ${rotuloDe(OPCOES.registra, p.registra)}.`;
	return resumoBloco(b);
}
/** O fim de uma etapa final: "resultado: Promessa" (Encerrar) ou "transferida: Pediu um atendente" (Transferir). */
export function resultadoFinal(b: Bloco): string {
	if (b.tipo === 'encerrar') return `resultado: ${rotuloDe(OPCOES.resultado_encerrar, b.params?.resultado)}`;
	if (b.tipo === 'transferir') return `transferida: ${rotuloDe(OPCOES.motivo_transferir, b.params?.motivo)}`;
	return '';
}

/** Nome do destino de uma saída; destino que não existe mais aparece como tal (nunca o código cru). */
export const nomeDestino = (nomes: Map<string, string>, para: string) => nomes.get(para) ?? 'etapa que não existe mais';
/** "Sou eu → Confirmar identidade". */
export function textoSaida(s: Saida, nomes: Map<string, string>): string {
	return `${s.rotulo} → ${nomeDestino(nomes, s.para)}`;
}
/** Os caminhos que chegam a uma etapa ("Sou eu", de Abertura): o que fica sem destino se ela for removida. */
export function caminhosPara(d: Definicao, id: string): { de: string; rotulo: string }[] {
	return d.blocos.filter(b => b.id !== id).flatMap(b => b.saidas.filter(s => s.para === id).map(s => ({ de: b.id, rotulo: s.rotulo })));
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
	valor_antes_identidade: 'Esta etapa fala de valor, oferta ou credor e algum caminho chega aqui antes de Confirmar identidade.',
	ciclo_sem_limite: 'Há uma volta sem limite: defina "repetir no máximo" numa das etapas da volta.',
	identidade_sem_conferencia: 'Escolha o conector "Validar cadastro" do CRM ou configure a conferência pelo arquivo (Confirmar identidade): a IA nunca confere.',
	conector_inativo: 'O conector desta etapa não foi escolhido ou não está ativo (testado pela equipe MotorCX).',
	conector_finalidade: 'O conector escolhido não tem a finalidade certa para esta etapa.',
	sem_alcada: 'A carteira não tem alçada cadastrada. Sem alçada, o agente não pode oferecer.',
	intencao_fora_catalogo: 'Usa uma intenção fora do catálogo.',
	caso_falhou: 'Um caso de teste guardado falhou nesta versão.',
	roleplay_ausente: 'Esta versão ainda não passou por personas.',
	roleplay_reprovadas: 'conversas com personas não chegaram ao resultado esperado.',
	roleplay_acordo_caiu: 'O acordo simulado caiu em relação à versão em uso.',
};
/** "O que corrigir": o que fazer em cada pendência de etapa ou do fluxo (o texto de TEXTOS diz o quê; este, o como). */
const COMO_CORRIGIR: Record<string, string> = {
	sem_saida: 'Ligue as respostas desta etapa a uma próxima etapa, ou troque por Encerrar ou Transferir.',
	saida_faltando: 'Escolha para onde vai cada resposta obrigatória desta etapa.',
	saida_inexistente: 'Escolha de novo o destino da resposta: a etapa de antes foi removida.',
	inalcancavel: 'Ligue uma resposta de outra etapa a esta, ou remova a etapa.',
	valor_antes_identidade: 'Tire o credor, o valor e a oferta desta fala, ou ligue esta etapa só depois de "Confirmou" em Confirmar identidade. Se quem atende não for a pessoa, ela saberia de quem é a dívida (trava 1).',
	params_invalidos: 'Preencha a fala e as opções desta etapa.',
	generativo_sem_objetivo: 'Escreva o objetivo da conversa, como orientaria um bom negociador (pelo menos 20 caracteres).',
	transferir_humano_desligado: 'Ligue a ferramenta "Transferir para humano".',
	fala_pede_senha: 'Tire o pedido de senha ou de cartão da fala. O pagamento é sempre pelo link.',
	identidade_sem_conferencia: 'Escolha o conector "Validar cadastro" do CRM nesta etapa, ou configure a conferência pelo arquivo na aba Confirmar identidade.',
	conector_inativo: 'Escolha um conector ativo. Quem testa e ativa os conectores é a equipe MotorCX (Empresa › Integrações).',
	conector_finalidade: 'Escolha um conector com a finalidade desta etapa.',
	sem_alcada: 'Cadastre a alçada da carteira (desconto, parcelas e parcela mínima).',
	terceiro_sem_recado: 'Ligue "Não é a pessoa" da Abertura direto a Encerrar com recado neutro.',
	ciclo_sem_limite: 'Abra uma das etapas da volta e defina "repetir no máximo".',
	modo_incompativel: 'Escolha um modo que vale para este tipo de etapa.',
	fala_longa: 'Encurte a fala: ao telefone, frases curtas são mais bem entendidas.',
	caso_falhou: 'Abra Testar conversa e veja o caso de teste que falhou.',
};
export const comoCorrigir = (codigo: string): string => COMO_CORRIGIR[codigo.split(':')[0]] ?? '';
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
		for (const id of antesDaIdentidade(d, aberturas[0].id)) if (sensivel(porId.get(id) as Bloco)) out.add(`valor_antes_identidade:${id}`);
	}
	return [...out].sort();
}

// Trava 1 (valor_antes_identidade): cópia de voz/fluxo_validador.py (_alcance com "pular" e _sensivel), para o site
// avisar enquanto se edita. O banco continua decidindo (public.fluxo_voz_erros).
/** TIPOS_SENSIVEIS do validador: falar disso já é falar de valor ou oferta. */
const TIPOS_SENSIVEIS: readonly TipoBloco[] = ['oferta', 'generativa', 'registrar', 'link'];
/** VARIAVEIS_LIVRES do validador: as únicas que podem ser ditas antes da identidade. */
const VARIAVEIS_LIVRES = ['primeiro_nome', 'assessoria'];
export const VARIAVEIS_SENSIVEIS: readonly string[] = VARIAVEIS.filter(v => !VARIAVEIS_LIVRES.includes(v));
/** Nomes entre {{ }} na ordem (trechos_variaveis do validador: o conteúdo vai até o 1º "}" e precisa de "}}"). */
export function variaveisDoTexto(texto: string): string[] {
	const out: string[] = [];
	let p = 0, fecha = -1;
	while (p < texto.length - 1) {
		if (texto[p] === '{' && texto[p + 1] === '{') {
			if (fecha < p + 2) { fecha = texto.indexOf('}', p + 2); if (fecha < 0) break; }
			if (texto[fecha + 1] === '}') { out.push(texto.slice(p + 2, fecha).replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '')); p = fecha + 2; continue; }
		}
		p++;
	}
	return out;
}
/** Textos que viram fala ou orientam a IA (textos_do_bloco do validador). */
const textosDoBloco = (b: Bloco) => (['fala', 'fala_espera', 'objetivo'] as const).map(k => b.params?.[k]).filter((t): t is string => typeof t === 'string');
/** Variáveis sensíveis que a etapa diz (vazio = nenhuma). */
export const variaveisSensiveis = (b: Bloco) => [...new Set(textosDoBloco(b).flatMap(variaveisDoTexto).filter(v => VARIAVEIS_SENSIVEIS.includes(v)))];
/** A etapa fala de valor, oferta ou credor (pelo tipo ou por uma variável sensível)? */
export const sensivel = (b: Bloco) => TIPOS_SENSIVEIS.includes(b.tipo) || variaveisSensiveis(b).length > 0;
/** Etapas que a conversa alcança a partir da Abertura sem passar por "Confirmou" de uma Confirmar identidade. */
export function antesDaIdentidade(d: Definicao, inicio: string): Set<string> {
	const porId = new Map(d.blocos.map(b => [b.id, b]));
	const vis = new Set([inicio]);
	const fila = [inicio];
	while (fila.length) {
		const o = porId.get(fila.shift() as string);
		for (const s of o?.saidas ?? []) {
			if (o!.tipo === 'identidade' && s.quando === 'confirmou') continue;
			if (porId.has(s.para) && !vis.has(s.para)) { vis.add(s.para); fila.push(s.para); }
		}
	}
	return vis;
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

// ---------------------------------------------------------------- correções de um clique (PR4 do redesenho; SPEC §6, Q6)
// "O que corrigir" com botão: cada correção monta a definição nova e a lista do que muda (antes → depois), mostrada
// para a pessoa confirmar; depois vai pelo mesmo salvar_fluxo_voz de sempre, no rascunho. Só correções determinísticas
// e seguras: ligar a um final (Encerrar ou Transferir) uma resposta que não tem para onde ir, tirar da fala o que
// não pode ser dito antes da identidade, remover a etapa a que nenhum caminho chega (e que não leva a nada que alguém
// use), escolher o único conector ativo da finalidade certa, ligar a ferramenta "Transferir para humano". Nada aqui
// muda o validador: o banco (public.fluxo_voz_erros / fluxo_voz_pendencias) continua decidindo. Uma correção só é
// oferecida se, na validação local, ela some com a pendência e não cria outra.
// Casos compartilhados com o Python (voz/fluxo_validador.py): tests/dados/fluxo_correcoes_casos.json.

/** Conector como a correção precisa (ConectorRow tem estes campos). */
export interface ConectorInfo { id: number; nome: string; finalidade: string; situacao: string }
/** Uma linha do "antes → depois" mostrado antes de confirmar. */
export interface Mudanca { onde: string; antes: string; depois: string }
export interface Correcao {
	codigo: string; bloco?: string;
	/** Texto do botão ("Tirar o credor da abertura"). */
	botao: string;
	/** O que acontece, numa frase (vai para o aviso de sucesso). */
	resumo: string;
	mudancas: Mudanca[];
	/** Nota opcional embaixo do antes → depois. */
	nota?: string;
	definicao: Definicao;
}

/** Final para onde uma resposta sem destino pode ir sem risco. O que não está aqui (Confirmou, Aceitou, Fechou acordo,
 * opções de pergunta, intenções…) continua a conversa e precisa de uma decisão: sem botão. */
const FINAL_DA_SAIDA: Record<string, { tipo: 'encerrar'; resultado: string } | { tipo: 'transferir'; motivo?: string }> = {
	terceiro: { tipo: 'encerrar', resultado: 'recado' },
	agendou: { tipo: 'encerrar', resultado: 'retorno_agendado' },
	recusou: { tipo: 'encerrar', resultado: 'recusa' },
	nao_confirmou: { tipo: 'encerrar', resultado: 'atendida_sem_cpc' },
	registrado: { tipo: 'encerrar', resultado: 'promessa' },
	enviado: { tipo: 'encerrar', resultado: 'promessa' },
	nao_agendou: { tipo: 'transferir' },
	sem_resposta: { tipo: 'transferir' },
	nao_entendido: { tipo: 'transferir' },
	falhou: { tipo: 'transferir' },
	fora_alcada: { tipo: 'transferir', motivo: 'fora_alcada' },
	contestou: { tipo: 'transferir', motivo: 'contestacao' },
	sem_acordo: { tipo: 'transferir', motivo: 'ofertas_sem_acordo' },
};
/** Etapa final nova, quando o fluxo ainda não tem uma que sirva (fala neutra, sem variável sensível). */
const FINAL_NOVO: Record<string, { titulo: string; fala: string }> = {
	recado: { titulo: 'Encerrar · recado neutro', fala: 'Peço que {{primeiro_nome}} retorne para a {{assessoria}}. Obrigada.' },
	retorno_agendado: { titulo: 'Encerrar · retorno agendado', fala: 'Combinado, eu ligo nesse horário. Até lá!' },
	recusa: { titulo: 'Encerrar · recusa', fala: 'Tudo bem. Obrigada pela atenção. Até logo.' },
	atendida_sem_cpc: { titulo: 'Encerrar · sem identidade', fala: 'Obrigada pela atenção. Até logo.' },
	promessa: { titulo: 'Encerrar · acordo', fala: 'Combinado. Obrigada pela atenção. Até logo.' },
	transferir: { titulo: 'Transferir · atendente', fala: 'Vou passar você para um atendente agora, só um instante.' },
};

/** Liga cada resposta pedida ao final certo: usa um final que já existe (o mesmo resultado; para transferir, o motivo
 * certo ou o Transferir mais usado) e só cria um novo quando não há. null se alguma resposta não tem final seguro. */
function ligarAFinais(d: Definicao, id: string, quandos: string[]): { definicao: Definicao; mudancas: Mudanca[]; novas: string[]; ligacoes: string[] } | null {
	const bloco = d.blocos.find(b => b.id === id);
	if (!bloco || !quandos.length || quandos.some(q => !FINAL_DA_SAIDA[q])) return null;
	const nomesAntes = nomesEtapas(d);
	const entradas = (bid: string, blocos: Bloco[]) => blocos.reduce((n, b) => n + b.saidas.filter(s => s.para === bid).length, 0);
	let blocos = [...d.blocos];
	const novas: string[] = [];
	const destinos = new Map<string, string>();
	const antesDaId = (() => { const ab = d.blocos.find(b => b.tipo === 'abertura'); return ab ? antesDaIdentidade(d, ab.id) : new Set<string>(); })();
	for (const q of quandos) {
		const alvo = FINAL_DA_SAIDA[q];
		let achado: Bloco | undefined;
		if (alvo.tipo === 'encerrar') {
			achado = blocos.filter(b => b.tipo === 'encerrar' && b.params?.resultado === alvo.resultado && (alvo.resultado !== 'recado' || !variaveisSensiveis(b).length))
				.sort((a, b) => entradas(b.id, blocos) - entradas(a.id, blocos) || numeroId(a.id) - numeroId(b.id))[0];
		} else {
			const ts = blocos.filter(b => b.tipo === 'transferir').sort((a, b) => entradas(b.id, blocos) - entradas(a.id, blocos) || numeroId(a.id) - numeroId(b.id));
			achado = (alvo.motivo ? ts.find(b => b.params?.motivo === alvo.motivo) : undefined) ?? ts[0];
		}
		if (!achado) {
			const chave = alvo.tipo === 'encerrar' ? alvo.resultado : 'transferir';
			const novo = FINAL_NOVO[chave];
			achado = alvo.tipo === 'encerrar'
				? { id: proximoId(blocos), tipo: 'encerrar', modo: 'arvore', titulo: novo.titulo, params: { fala: novo.fala, resultado: alvo.resultado }, saidas: [] }
				: { id: proximoId(blocos), tipo: 'transferir', modo: 'arvore', titulo: novo.titulo, params: { fala: novo.fala, motivo: alvo.motivo ?? (antesDaId.has(id) ? 'pedido_humano' : 'cpc') }, saidas: [] };
			blocos = [...blocos, achado];
			novas.push(achado.id);
		}
		destinos.set(q, achado.id);
	}
	const possiveis = saidasPossiveis(bloco);
	const saidas = [...bloco.saidas.filter(s => !destinos.has(s.quando)), ...quandos.map(q => ({
		quando: q, rotulo: bloco.saidas.find(s => s.quando === q)?.rotulo ?? possiveis.find(s => s.quando === q)?.rotulo ?? q.replace(/_/g, ' '),
		para: destinos.get(q) as string, tipo: tipoDaSaida(bloco, q),
	}))];
	// mesma ordem das saídas possíveis (a de antes continua no lugar)
	const ordem = (q: string) => { const i = possiveis.findIndex(s => s.quando === q); return i < 0 ? possiveis.length : i; };
	saidas.sort((a, b) => ordem(a.quando) - ordem(b.quando));
	blocos = blocos.map(b => (b.id === id ? { ...b, saidas } : b));
	const definicao: Definicao = { ...d, blocos };
	const nomesDepois = nomesEtapas(definicao);
	const nomeEtapa = nomesAntes.get(id) ?? id;
	const mudancas = quandos.map(q => {
		const velha = bloco.saidas.find(s => s.quando === q);
		const para = destinos.get(q) as string;
		return {
			onde: `${nomeEtapa} · "${saidas.find(s => s.quando === q)?.rotulo}"`,
			antes: !velha ? 'sem destino' : nomesAntes.get(velha.para) ?? 'etapa que não existe mais',
			depois: `${nomesDepois.get(para)}${novas.includes(para) ? ' (etapa nova)' : ''}`,
		};
	});
	const ligacoes = quandos.map(q => `"${saidas.find(s => s.quando === q)?.rotulo}" a ${nomesDepois.get(destinos.get(q) as string)}`);
	return { definicao, mudancas, novas, ligacoes };
}

/** Palavras para as variáveis que não podem ser ditas antes da identidade. */
function palavraDaVariavel(v: string): string {
	if (v === 'credor') return 'o credor';
	if (v === 'saldo') return 'o saldo';
	if (v === 'dias_atraso') return 'os dias de atraso';
	if (v === 'vencimento') return 'o vencimento';
	if (v === 'link_pagamento') return 'o link de pagamento';
	if (v.startsWith('oferta.')) return 'a oferta';
	return 'o valor';
}
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/**
 * Tira de uma fala os trechos que citam uma variável sensível. O trecho é o pedaço entre pontuações (",", ".", "!",
 * "?", ";"): "Aqui é a Lia, da {{assessoria}}, em nome do {{credor}}. Falo com {{primeiro_nome}}?" perde
 * ", em nome do {{credor}}". null se não sobra fala (aí não há correção automática).
 */
export function tirarSensiveisDaFala(fala: string): string | null {
	// trechos que terminam em pontuação; "1.380,00" (pontuação entre dígitos) não corta
	const partes: string[] = [];
	let atual = '';
	for (let i = 0; i < fala.length; i++) {
		const ch = fala[i];
		atual += ch;
		const corta = ',.;!?'.includes(ch) && !(/[.,]/.test(ch) && /\d/.test(fala[i - 1] ?? '') && /\d/.test(fala[i + 1] ?? '')) && !',.;!?'.includes(fala[i + 1] ?? '');
		if (corta) { partes.push(atual); atual = ''; }
	}
	if (atual) partes.push(atual);
	const tem = (p: string) => variaveisDoTexto(p).some(v => VARIAVEIS_SENSIVEIS.includes(v));
	if (!partes.some(tem)) return fala;
	const fica: string[] = [];
	for (const p of partes) {
		if (!tem(p)) { fica.push(p); continue; }
		// o trecho sai; a pontuação final dele fica no anterior quando fecha frase ("." "?" "!")
		const fim = p.match(/[.;!?]+$/)?.[0];
		if (fim && fica.length && !/[.!?]\s*$/.test(fica[fica.length - 1])) fica[fica.length - 1] = fica[fica.length - 1].replace(/[,;]+\s*$/, '') + fim;
	}
	let out = fica.join('').replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/^[\s,.;!?]+/, '').trim();
	out = out.replace(/([.!?])\s*([,;])/g, '$1');
	if (!out || !/[\p{L}]/u.test(out.replace(/\{\{[^}]*\}\}/g, ''))) return null;
	return out.charAt(0).toUpperCase() + out.slice(1);
}

const CAMPOS_FALA = ['fala', 'fala_espera'] as const;

/**
 * A correção de um clique para uma pendência ('sem_saida:N9', 'valor_antes_identidade:N1', 'terceiro_sem_recado'…),
 * ou null quando a correção não é determinística (precisa de uma decisão de quem edita) ou não deixaria o fluxo melhor.
 */
export function correcaoDe(d: Definicao, codigo: string, ctx: { conectores?: ConectorInfo[] } = {}): Correcao | null {
	const [base, arg] = codigo.split(':');
	const bloco = arg ? d.blocos.find(b => b.id === arg) : undefined;
	const nomes = nomesEtapas(d);
	const nome = bloco ? nomes.get(bloco.id) ?? bloco.id : '';
	let c: Omit<Correcao, 'codigo' | 'bloco'> | null = null;

	if ((base === 'sem_saida' || base === 'saida_faltando' || base === 'saida_inexistente') && bloco && !ehFinal(bloco)) {
		const possiveis = saidasPossiveis(bloco);
		const ids = new Set(d.blocos.map(b => b.id));
		let quandos: string[];
		if (base === 'sem_saida') {
			// a conversa livre termina em várias saídas; o "Fechou acordo" pede decisão: sem botão
			if (bloco.tipo === 'generativa' || possiveis.some(s => s.obrig && !FINAL_DA_SAIDA[s.quando])) return null;
			quandos = possiveis.filter(s => (s.obrig || s.quando !== 'falhou') && FINAL_DA_SAIDA[s.quando]).map(s => s.quando);
		} else if (base === 'saida_faltando') {
			const tem = new Set(bloco.saidas.map(s => s.quando));
			quandos = possiveis.filter(s => s.obrig && !tem.has(s.quando)).map(s => s.quando);
		} else {
			quandos = bloco.saidas.filter(s => !ids.has(s.para)).map(s => s.quando);
		}
		const r = ligarAFinais(d, bloco.id, quandos);
		if (r) c = {
			botao: r.ligacoes.length <= 2 ? `Ligar ${juntar(r.ligacoes)}` : `Ligar ${r.ligacoes.length} respostas a um final`,
			resumo: `${nome}: ${quandos.length === 1 ? 'a resposta agora vai' : 'as respostas agora vão'} para um final.`,
			mudancas: r.mudancas,
			nota: 'Final é Encerrar ou Transferir para um atendente: a ligação não fica parada. Dá para trocar o destino depois, na etapa.',
			definicao: r.definicao,
		};
	} else if (base === 'terceiro_sem_recado') {
		const ab = d.blocos.find(b => b.tipo === 'abertura');
		const r = ab ? ligarAFinais(d, ab.id, ['terceiro']) : null;
		if (r) c = {
			botao: `Ligar "Não é a pessoa" ao recado neutro`, resumo: 'Quem não é a pessoa agora só ouve o recado neutro e a ligação encerra.',
			mudancas: r.mudancas, nota: 'Trava 4: terceiro só ouve recado neutro, sem valor, sem credor e sem motivo.', definicao: r.definicao,
		};
	} else if (base === 'valor_antes_identidade' && bloco && !TIPOS_SENSIVEIS.includes(bloco.tipo)) {
		const vs = variaveisSensiveis(bloco);
		const params = { ...bloco.params };
		const mudancas: Mudanca[] = [];
		for (const k of CAMPOS_FALA) {
			const t = params[k];
			if (typeof t !== 'string') continue;
			const novo = tirarSensiveisDaFala(t);
			if (novo == null) return null;
			if (novo !== t) { params[k] = novo; mudancas.push({ onde: `${nome} · ${k === 'fala' ? 'o agente diz' : 'fala de espera'}`, antes: t, depois: novo }); }
		}
		if (mudancas.length) {
			const oque = juntar([...new Set(vs.map(palavraDaVariavel))]);
			c = {
				botao: `Tirar ${oque} ${bloco.tipo === 'abertura' ? 'da abertura' : 'desta fala'}`,
				resumo: `${nome}: ${oque} só aparece depois de confirmar a identidade.`,
				mudancas, nota: `Depois de "Confirmou" em Confirmar identidade, as etapas podem dizer ${oque} normalmente (trava 1).`,
				definicao: trocarBloco(d, { ...bloco, params }),
			};
		}
	} else if (base === 'inalcancavel' && bloco && bloco.tipo !== 'abertura' && !caminhosPara(d, bloco.id).length) {
		c = {
			botao: 'Remover a etapa', resumo: `${nome} saiu do rascunho.`,
			mudancas: [{ onde: nome, antes: 'no rascunho, mas nenhum caminho chega até ela', depois: 'removida' }],
			nota: 'Nenhuma ligação passa por esta etapa hoje: remover não muda nenhuma conversa. Se ela devia ser usada, cancele e ligue uma resposta de outra etapa a ela.',
			definicao: removerBloco(d, bloco.id),
		};
	} else if (base === 'transferir_humano_desligado' && bloco?.tipo === 'generativa') {
		const fe = Array.isArray(bloco.params?.ferramentas) ? (bloco.params.ferramentas as string[]) : [];
		c = {
			botao: 'Ligar "Transferir para humano"', resumo: `${nome}: "Transferir para humano" ligado.`,
			mudancas: [{ onde: `${nome} · ferramentas`, antes: 'sem "Transferir para humano"', depois: 'com "Transferir para humano" (sempre ligado)' }],
			nota: 'Trava 6: "quero falar com uma pessoa" transfere em qualquer momento.',
			definicao: trocarBloco(d, { ...bloco, params: { ...bloco.params, ferramentas: [...fe, 'transferir_humano'] } }),
		};
	} else if ((base === 'conector_inativo' || base === 'identidade_sem_conferencia') && bloco) {
		c = correcaoConector(d, bloco, nome, ctx.conectores ?? []);
	}
	if (!c) return null;
	// rede de segurança: a pendência some e nenhuma outra aparece (validação local)
	const antes = new Set(validarLocal(d));
	const depois = validarLocal(c.definicao);
	if (depois.some(e => !antes.has(e)) || (antes.has(codigo) && depois.includes(codigo))) return null;
	return { codigo, ...(arg ? { bloco: arg } : {}), ...c };
}

/** Conector inativo ou não escolhido: escolhe o único conector ativo da finalidade certa; no registro de acordo, tira o
 * conector extra (boleto ou link) que ainda não está ativo, se o do acordo está. Sem um único candidato: sem botão. */
function correcaoConector(d: Definicao, bloco: Bloco, nome: string, conectores: ConectorInfo[]): Omit<Correcao, 'codigo' | 'bloco'> | null {
	const ativo = (id: unknown) => conectores.find(c => c.id === id && c.situacao === 'ativo');
	const rotulo = (id: unknown) => { const c = conectores.find(x => x.id === id); return c ? `${c.nome}${c.situacao !== 'ativo' ? ` (${c.situacao})` : ''}` : 'nenhum escolhido'; };
	const unico = (fins: string[]) => { const xs = conectores.filter(c => c.situacao === 'ativo' && fins.includes(c.finalidade)); return xs.length === 1 ? xs[0] : null; };
	const p = bloco.params ?? {};
	if (bloco.tipo === 'registrar' && p.registra === 'acordo_crm') {
		const cs = (Array.isArray(p.conectores) ? p.conectores : []).filter(x => x != null);
		const ficam = cs.filter(ativo);
		const temLink = d.blocos.some(b => b.tipo === 'link');
		if (ficam.length && ficam.length < cs.length) return {
			botao: temLink ? 'Usar o link do MotorCX por enquanto' : 'Tirar o conector inativo desta etapa',
			resumo: `${nome}: só com os conectores ativos.`,
			mudancas: [{ onde: `${nome} · conectores`, antes: cs.map(rotulo).join(' + '), depois: ficam.map(rotulo).join(' + ') }],
			nota: `Quem ativa conector é a equipe MotorCX, depois de testar com o CRM.${temLink ? ' Enquanto isso, o link de pagamento sai pela etapa "Enviar link".' : ''} Quando ele for ativado, dá para escolher de novo na etapa.`,
			definicao: trocarBloco(d, { ...bloco, params: { ...p, conectores: ficam } }),
		};
		const um = !ficam.length ? unico(['registrar_acordo']) : null;
		if (um) return {
			botao: `Usar "${um.nome}"`, resumo: `${nome}: conector "${um.nome}".`,
			mudancas: [{ onde: `${nome} · conector do acordo`, antes: cs.length ? cs.map(rotulo).join(' + ') : 'nenhum escolhido', depois: um.nome }],
			nota: 'É o único conector ativo para registrar acordo.', definicao: trocarBloco(d, { ...bloco, params: { ...p, conectores: [um.id] } }),
		};
		return null;
	}
	const fins = bloco.tipo === 'identidade' ? ['validar_cadastro'] : bloco.tipo === 'oferta' && p.origem === 'conector' ? ['buscar_ofertas'] : null;
	if (!fins || ativo(p.conector_id)) return null;
	const um = unico(fins);
	if (!um) return null;
	let nova = trocarBloco(d, { ...bloco, params: { ...p, conector_id: um.id } });
	const mudancas: Mudanca[] = [{ onde: `${nome} · conector`, antes: rotulo(p.conector_id), depois: um.nome }];
	// com o conector, "Conector falhou" passa a ser obrigatória na identidade: vai para um atendente
	const b2 = nova.blocos.find(b => b.id === bloco.id) as Bloco;
	const faltam = saidasFaltando(b2).length ? saidasPossiveis(b2).filter(s => s.obrig && !b2.saidas.some(x => x.quando === s.quando)).map(s => s.quando) : [];
	if (faltam.length) {
		const r = ligarAFinais(nova, bloco.id, faltam);
		if (!r) return null;
		nova = r.definicao; mudancas.push(...r.mudancas);
	}
	return {
		botao: `Usar "${um.nome}"`, resumo: `${nome}: conector "${um.nome}".`, mudancas,
		nota: `É o único conector ativo de ${bloco.tipo === 'identidade' ? '"Validar cadastro"' : '"Buscar ofertas"'}. Só o CRM confere; nunca a IA.`,
		definicao: nova,
	};
}
