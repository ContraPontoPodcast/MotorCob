// Renitência por situação, regra de discagem por sinalização, modo de discagem, Reenviar agora, Reciclar mailing e
// Contato por passada (SQL 65; protótipo funcional aprovado em 01/11/2026).
// Regras puras (sem React, sem Supabase): o site e site/resubmit/resubmit.test.ts usam as mesmas funções.
// O padrão MotorCX é o de public.discagem_padrao() (= motor/discagem.padrao_site(); o teste confere com o SQL).
// A edição da regra por sinalização, do modo de discagem e da reciclagem segue o redesign aprovado (renitencia-v2). O
// intervalo de cada situação é o rediscar.depois_min da regra por sinalização (um intervalo só, decisão do dono).
// Nenhum dado pessoal: a tela só mostra contagens.

export type Prioridade = 'topo' | 'normal' | 'fim';
export type AcaoDepois = 'proximo_telefone' | 'proximo_cliente' | 'finaliza';
export type RegraSituacao = { max_dia: number; conta_descanso: boolean };
export type RegraFalha = { aviso: number };
export type RegraSinal = {
	finaliza: boolean;
	rediscar: { ativo: boolean; depois_min: number; max: number; prioridade: Prioridade };
	depois: { acao: AcaoDepois; espera_min: number };
	ate: string;
};
export type Bloco<T> = Record<string, Partial<T>>;

/** Recorte de credores.discagem que estas telas leem e escrevem (o resto do objeto é preservado). */
export type DiscagemRen = {
	tentativas_numero_dia?: number;
	tentativas_cliente_dia?: number | null;
	intervalo_min_minutos?: number;
	intervalo_ocupado_minutos?: number;
	descanso_nao_atende?: { ativo: boolean; n: number; em_dias: number; descansa_dias: number };
	descanso_recusa?: { ativo: boolean; dias: number };
	promessa_suspende?: { ativo: boolean; dias_sem_data: number };
	inexistente?: { ativo: boolean; modo?: 'so_voz' | 'invalida' } & Record<string, unknown>;
	nao_ligar?: { ativo: boolean };
	retorno_agendado?: { max_dias?: number } & Record<string, unknown>;
	chamadas_curtas?: { falha_conta?: boolean } & Record<string, unknown>;
	por_situacao?: Bloco<RegraSituacao>;
	falhas_tecnicas?: Bloco<RegraFalha>;
	por_sinalizacao?: Record<string, unknown> | null;
	modo_discagem?: Record<string, unknown> | null;
	reciclagem_auto?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------- situações e sinalizações
export type Curta = 'sempre' | 'duracao' | 'misto';
export const SITUACOES: { k: string; n: string; sinais: string; chaves: string; curta: Curta }[] = [
	{ k: 'maquina', n: 'Máquina', sinais: 'AMD: máquina ou saudação longa', chaves: 'maquina', curta: 'sempre' },
	{ k: 'nao_atendida', n: 'Não atendeu', sinais: 'tocou ≥ 15 s · SIP 487 · Q.850 19', chaves: 'nao_atendida', curta: 'sempre' },
	{ k: 'ocupado', n: 'Ocupado', sinais: 'SIP 486, 600 · Q.850 17', chaves: 'ocupado', curta: 'sempre' },
	{ k: 'caixa_postal', n: 'Caixa postal', sinais: 'desvio + máquina · anúncio da operadora', chaves: 'caixa_postal', curta: 'sempre' },
	{ k: 'desligou_sem_conversar', n: 'Desligou sem conversar', sinais: 'atendeu e desligou em menos de 5 s', chaves: 'desligou_sem_conversar', curta: 'duracao' },
	{ k: 'retorno_agendado', n: 'Atendeu e pediu retorno', sinais: 'o titular pediu outro horário', chaves: 'retorno_agendado', curta: 'duracao' },
	{ k: 'atendeu_desligou', n: 'Atendeu e desligou', sinais: 'desligou depois de começar a conversa', chaves: 'atendeu_desligou', curta: 'duracao' },
	{ k: 'numero_incorreto', n: 'Número incorreto', sinais: 'não existe (SIP 404, 410, 604) ou pessoa errada', chaves: 'numero_inexistente · atendida_terceiro_desconhece', curta: 'misto' },
];
export const FALHAS: { k: string; n: string; sinais: string; chaves: string; mudaHoje?: boolean }[] = [
	{ k: 'falha_operadora', n: 'Falha da operadora ou rota', sinais: 'SIP 3xx, 400–407, 5xx · Q.850 2, 3, 34–47', chaves: 'falha_operadora' },
	{ k: 'sem_credito', n: 'Sem crédito na operadora', sinais: 'SIP 402 · pausa a rota e alerta', chaves: 'falha_operadora (402)' },
	{ k: 'falha_rede', n: 'Falha da nossa rede', sinais: 'Asterisk ou SBC do MotorCX', chaves: 'falha_rede' },
	{ k: 'indisponivel', n: 'Fora de área ou desligado', sinais: 'SIP 408, 480 · Q.850 18, 20, 27', chaves: 'indisponivel', mudaHoje: true },
	{ k: 'bloqueio_originacao', n: 'Bloqueio de originação', sinais: 'Q.850 52/53 · SIP 608, 428, 436–438 · pausa a rota', chaves: 'bloqueio_originacao' },
	{ k: 'cancelada_discador', n: 'Cancelada antes do toque mínimo', sinais: 'menos de 15 s de toque', chaves: 'cancelada_discador' },
	{ k: 'abandonada', n: 'Abandonada (sem pessoa livre)', sinais: 'atendeu e não havia agente ou operador livre', chaves: 'abandonada' },
];
/** Linhas da regra por sinalização (as 8 situações com inexistente e pessoa errada separados, recado e as falhas). */
export const SINALIZACOES: { k: string; n: string }[] = [
	...SITUACOES.filter(s => s.k !== 'numero_incorreto').map(s => ({ k: s.k, n: s.n })),
	{ k: 'numero_inexistente', n: 'Número inexistente' }, { k: 'pessoa_errada', n: 'Pessoa errada' }, { k: 'recado', n: 'Recado' },
	...FALHAS.filter(f => f.k !== 'sem_credito' && f.k !== 'bloqueio_originacao').map(f => ({ k: f.k, n: f.n })),
];
export const SITUACOES_RENITENCIA = ['maquina', 'nao_atendida', 'ocupado', 'caixa_postal', 'desligou_sem_conversar', 'atendeu_desligou'];
export const NOME: Record<string, string> = Object.fromEntries([...SITUACOES, ...FALHAS, ...SINALIZACOES].map(s => [s.k, s.n]));
export const CURTA_TXT: Record<Curta, string> = {
	sempre: 'Sempre: não completada, máquina ou caixa postal',
	duracao: 'Se durar até 6 s desde o atendimento',
	misto: 'Inexistente: sempre · pessoa errada: até 6 s',
};
export const PRIORIDADES: Record<Prioridade, string> = { topo: 'Topo', normal: 'Normal', fim: 'Fim' };
export const DEPOIS: Record<AcaoDepois, string> = { proximo_telefone: 'Próximo telefone', proximo_cliente: 'Próximo cliente', finaliza: 'Finaliza o cliente' };
export const MOTIVO_FORA: Record<string, { n: string; t: string }> = {
	max_dia: { n: 'Já atingiram o máximo do dia', t: 'tentativas por número ou por cliente, contando as voltas' },
	fora_horario: { n: 'Fora do horário', t: 'a janela fecha antes de dar o intervalo da situação' },
	nao_ligar: { n: 'Pediram “não ligar”', t: 'pedido feito em ligação ou na lista da empresa' },
	promessa: { n: 'Têm promessa', t: 'prometeram hoje; a voz espera a data' },
	inexistente: { n: 'Número inexistente', t: 'a voz está suspensa no número (só a voz)' },
};
/** Mínimo de chamadas para mostrar percentual (contato_por_passada devolve nulo abaixo). */
export const MIN_CHAMADAS = 30;

// ---------------------------------------------------------------- padrão MotorCX (= public.discagem_padrao())
type Padrao = {
	tentativas_numero_dia: number; tentativas_numero_dia_regra_nova: number; tentativas_cliente_dia: number;
	intervalo_min_minutos: number; intervalo_ocupado_minutos: number;
	por_situacao: Record<string, RegraSituacao>; falhas_tecnicas: Record<string, RegraFalha>;
	por_sinalizacao: Record<string, RegraSinal>; sinalizacao_vertical: Record<string, AcaoDepois>;
	modo_discagem: Record<string, unknown>; reciclagem_auto: Record<string, unknown>;
	retorno_agendado: { max_dias: number }; chamadas_curtas: { falha_conta: boolean };
};
export const PADRAO: Padrao = {
	"tentativas_numero_dia": 2,
	"tentativas_numero_dia_regra_nova": 3,
	"tentativas_cliente_dia": 3,
	"intervalo_min_minutos": 120,
	"intervalo_ocupado_minutos": 15,
	"por_situacao": {
		"maquina": {
			"max_dia": 2,
			"conta_descanso": true
		},
		"nao_atendida": {
			"max_dia": 2,
			"conta_descanso": true
		},
		"ocupado": {
			"max_dia": 2,
			"conta_descanso": true
		},
		"caixa_postal": {
			"max_dia": 2,
			"conta_descanso": true
		},
		"desligou_sem_conversar": {
			"max_dia": 2,
			"conta_descanso": false
		},
		"atendeu_desligou": {
			"max_dia": 2,
			"conta_descanso": false
		}
	},
	"falhas_tecnicas": {
		"falha_operadora": {
			"aviso": 0.15
		},
		"sem_credito": {
			"aviso": 0.01
		},
		"falha_rede": {
			"aviso": 0.05
		},
		"indisponivel": {
			"aviso": 0.2
		},
		"bloqueio_originacao": {
			"aviso": 0.01
		},
		"cancelada_discador": {
			"aviso": 0.05
		},
		"abandonada": {
			"aviso": 0.03
		}
	},
	"por_sinalizacao": {
		"maquina": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 120,
				"max": 1,
				"prioridade": "fim"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:00"
		},
		"nao_atendida": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 60,
				"max": 2,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"ocupado": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 15,
				"max": 2,
				"prioridade": "topo"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"caixa_postal": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 120,
				"max": 1,
				"prioridade": "fim"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:00"
		},
		"desligou_sem_conversar": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 90,
				"max": 1,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:00"
		},
		"retorno_agendado": {
			"finaliza": true,
			"rediscar": {
				"ativo": false,
				"depois_min": 0,
				"max": 1,
				"prioridade": "topo"
			},
			"depois": {
				"acao": "finaliza",
				"espera_min": 0
			},
			"ate": "20:00"
		},
		"atendeu_desligou": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 120,
				"max": 1,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:00"
		},
		"numero_inexistente": {
			"finaliza": false,
			"rediscar": {
				"ativo": false,
				"depois_min": 0,
				"max": 1,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"pessoa_errada": {
			"finaliza": false,
			"rediscar": {
				"ativo": false,
				"depois_min": 0,
				"max": 1,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"recado": {
			"finaliza": true,
			"rediscar": {
				"ativo": false,
				"depois_min": 120,
				"max": 1,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:00"
		},
		"falha_operadora": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 30,
				"max": 1,
				"prioridade": "topo"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"falha_rede": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 30,
				"max": 1,
				"prioridade": "topo"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"indisponivel": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 30,
				"max": 1,
				"prioridade": "normal"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"cancelada_discador": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 30,
				"max": 1,
				"prioridade": "topo"
			},
			"depois": {
				"acao": "proximo_telefone",
				"espera_min": 0
			},
			"ate": "19:30"
		},
		"abandonada": {
			"finaliza": false,
			"rediscar": {
				"ativo": true,
				"depois_min": 0,
				"max": 1,
				"prioridade": "topo"
			},
			"depois": {
				"acao": "proximo_cliente",
				"espera_min": 0
			},
			"ate": "19:30"
		}
	},
	"sinalizacao_vertical": {
		"maquina": "proximo_telefone",
		"nao_atendida": "proximo_telefone",
		"caixa_postal": "proximo_telefone"
	},
	"modo_discagem": {
		"modo": "horizontal",
		"max_telefones_dia": 1,
		"ordem": "certificado",
		"telefone_ausente": "proximo",
		"spins": {
			"quantidade": 3,
			"intervalo_min": 120,
			"regras": [
				{
					"spin": 1,
					"telefone": "t1",
					"inicio": null
				},
				{
					"spin": 2,
					"telefone": "t2",
					"inicio": null
				},
				{
					"spin": 3,
					"telefone": "t3",
					"inicio": null
				}
			]
		}
	},
	"reciclagem_auto": {
		"ativo": false,
		"hora": "16:00",
		"sem_contato_pct": 60,
		"excluir": [
			"cpc",
			"recusa",
			"pessoa_errada",
			"retorno"
		]
	},
	"retorno_agendado": {
		"max_dias": 7
	},
	"chamadas_curtas": {
		"falha_conta": true
	}
};

// ---------------------------------------------------------------- valores efetivos (o que o motor e a VM usam)
export type Efetivo = {
	tnum: number; tcli: number;
	naOn: boolean; naN: number; naDias: number; naDesc: number;
	promessa: boolean; promDias: number; recusa: boolean; recusaDias: number; nl: boolean; falhaCurta: boolean;
	retornoDias: number; inexistente: 'so_voz' | 'invalida' | 'nao';
	ren: Record<string, RegraSituacao & { intervalo_minutos: number }>;
	tec: Record<string, RegraFalha & { religar_minutos: number }>;
	sinal: Record<string, RegraSinal> | null;
	modo: 'vertical' | 'horizontal' | null;
};

function mesclar<T>(base: T, mud: unknown): T {
	if (!mud || typeof mud !== 'object' || Array.isArray(mud)) return base;
	const out = { ...(base as Record<string, unknown>) };
	for (const [k, v] of Object.entries(mud as Record<string, unknown>)) {
		out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? mesclar(out[k], v) : v;
	}
	return out as T;
}

const SINAL_DA_SITUACAO: Record<string, string> = { numero_incorreto: 'numero_inexistente', sem_credito: 'falha_operadora' };

/** O que vale para a carteira: chave ausente = o de hoje (globais); com a regra por sinalização, o intervalo de cada
 *  situação é o rediscar.depois_min dela e as tentativas por número, 3 (se a carteira não disse). */
export function efetivo(d: DiscagemRen | null | undefined, travaTcli?: number): Efetivo {
	const x = d ?? {};
	const nova = x.por_sinalizacao != null || x.modo_discagem != null;
	const tnum = x.tentativas_numero_dia ?? (nova ? PADRAO.tentativas_numero_dia_regra_nova : PADRAO.tentativas_numero_dia);
	const im = x.intervalo_min_minutos ?? PADRAO.intervalo_min_minutos;
	const io = x.intervalo_ocupado_minutos ?? PADRAO.intervalo_ocupado_minutos;
	const modo = x.modo_discagem ? ((x.modo_discagem.modo as 'vertical' | 'horizontal' | undefined) ?? 'horizontal') : null;
	let sinal: Record<string, RegraSinal> | null = null;
	if (x.por_sinalizacao != null) {
		sinal = {};
		for (const [k, base] of Object.entries(PADRAO.por_sinalizacao)) {
			const b = modo === 'vertical' && PADRAO.sinalizacao_vertical[k] ? mesclar(base, { depois: { acao: PADRAO.sinalizacao_vertical[k] } }) : base;
			sinal[k] = mesclar(b, (x.por_sinalizacao as Record<string, unknown>)[k]);
		}
	}
	const intervalo = (k: string, glob: number) => sinal ? (sinal[SINAL_DA_SITUACAO[k] ?? k]?.rediscar.depois_min ?? glob) : glob;
	const ren: Efetivo['ren'] = {};
	for (const k of SITUACOES_RENITENCIA) {
		const p = x.por_situacao?.[k] ?? {};
		ren[k] = {
			intervalo_minutos: intervalo(k, k === 'ocupado' ? io : im),
			max_dia: Math.min(p.max_dia ?? tnum, tnum),
			conta_descanso: p.conta_descanso ?? PADRAO.por_situacao[k].conta_descanso,
		};
	}
	const tec: Efetivo['tec'] = {};
	for (const f of FALHAS) {
		const p = x.falhas_tecnicas?.[f.k] ?? {};
		tec[f.k] = { religar_minutos: intervalo(f.k, im), aviso: fracao(p.aviso) ?? PADRAO.falhas_tecnicas[f.k].aviso };
	}
	const dn = x.descanso_nao_atende;
	return {
		tnum, tcli: travaTcli ?? x.tentativas_cliente_dia ?? PADRAO.tentativas_cliente_dia,
		naOn: dn?.ativo ?? false, naN: dn?.n ?? 6, naDias: dn?.em_dias ?? 3, naDesc: dn?.descansa_dias ?? 7,
		promessa: x.promessa_suspende?.ativo ?? false, promDias: x.promessa_suspende?.dias_sem_data ?? 7,
		recusa: x.descanso_recusa?.ativo ?? false, recusaDias: x.descanso_recusa?.dias ?? 7,
		nl: x.nao_ligar?.ativo ?? true, falhaCurta: x.chamadas_curtas?.falha_conta ?? true,
		retornoDias: x.retorno_agendado?.max_dias ?? PADRAO.retorno_agendado.max_dias,
		inexistente: x.inexistente?.ativo === false ? 'nao' : x.inexistente?.modo === 'invalida' ? 'invalida' : 'so_voz',
		ren, tec, sinal, modo,
	};
}

function fracao(v: number | undefined): number | undefined {
	if (v == null) return undefined;
	return v > 1 ? v / 100 : v;
}

// ---------------------------------------------------------------- edição (só grava o que mudou do padrão)
type BlocoEditavel = 'por_situacao' | 'falhas_tecnicas';

/** Muda um campo de uma situação; igual ao padrão sai do bloco. */
export function mudarCampo(d: DiscagemRen, bloco: BlocoEditavel, k: string, campo: string, valor: unknown): DiscagemRen {
	const atual = { ...((d[bloco] ?? {}) as Record<string, Record<string, unknown>>) };
	const linha = { ...(atual[k] ?? {}) };
	const e = efetivo({ ...d, [bloco]: {} });
	const padrao = bloco === 'por_situacao' ? (e.ren[k] as Record<string, unknown>)[campo] : (e.tec[k] as Record<string, unknown>)[campo];
	if (valor === padrao) delete linha[campo]; else linha[campo] = valor;
	if (Object.keys(linha).length) atual[k] = linha; else delete atual[k];
	const out = { ...d };
	if (Object.keys(atual).length) out[bloco] = atual as never; else delete out[bloco];
	return out;
}

/** Volta uma linha ao padrão MotorCX (tira a situação do bloco). */
export function voltarLinha(d: DiscagemRen, bloco: BlocoEditavel, k: string): DiscagemRen {
	const atual = { ...((d[bloco] ?? {}) as Record<string, unknown>) };
	delete atual[k];
	const out = { ...d };
	if (Object.keys(atual).length) out[bloco] = atual as never; else delete out[bloco];
	return out;
}

export function linhaAlterada(d: DiscagemRen, bloco: BlocoEditavel, k: string): boolean {
	const b = d[bloco] as Record<string, object> | null | undefined;
	return !!b && !!b[k] && Object.keys(b[k]).length > 0;
}

// ---------------------------------------------------------------- resumo das mudanças (histórico de versões)
const LBL_LIM: [keyof Efetivo, string][] = [
	['tnum', 'Tentativas por número no dia'], ['tcli', 'Tentativas por cliente no dia'], ['naOn', 'Descanso por não atende'],
	['naN', 'Descanso: não atende seguidos'], ['naDias', 'Descanso: em até (dias)'], ['naDesc', 'Descanso: descansa (dias)'],
	['promessa', 'Promessa suspende ligações'], ['promDias', 'Promessa sem data: dias'], ['recusa', 'Descanso por recusa'],
	['recusaDias', 'Recusa: dias'], ['nl', 'Lista de “não ligar”'], ['falhaCurta', 'Falha técnica conta como curta'],
	['retornoDias', 'Retorno agendado: máx. dias'], ['inexistente', 'Número inexistente invalida'], ['modo', 'Modo de discagem'],
];
const LBL_F: Record<string, string> = { max_dia: 'máx. no dia', conta_descanso: 'conta no descanso', aviso: 'alerta (%)' };
const INV: Record<string, string> = { so_voz: 'só a voz, após 2 confirmações', invalida: 'todos os canais (regra antiga)', nao: 'não invalida' };
function fmt(v: unknown, campo?: string): string {
	if (v === true) return 'ligado';
	if (v === false) return 'desligado';
	if (v === null || v === undefined) return '—';
	if (campo === 'aviso' && typeof v === 'number') return `${Math.round(v * 100)}%`;
	return PRIORIDADES[v as Prioridade] ?? INV[v as string] ?? DEPOIS[v as AcaoDepois] ?? String(v);
}

/** Linhas "Seção › Situação › campo: antes → depois" entre duas regras. */
export function resumoMudancas(antes: DiscagemRen | null | undefined, depois: DiscagemRen | null | undefined): string[] {
	const a = efetivo(antes), b = efetivo(depois), out: string[] = [];
	for (const [k, n] of LBL_LIM) if (a[k] !== b[k]) out.push(`Limites › ${n}: ${fmt(a[k])} → ${fmt(b[k])}`);
	for (const k of SITUACOES_RENITENCIA) for (const f of ['max_dia', 'conta_descanso']) {
		const va = (a.ren[k] as Record<string, unknown>)[f], vb = (b.ren[k] as Record<string, unknown>)[f];
		if (va !== vb) out.push(`Renitência › ${NOME[k]} › ${LBL_F[f]}: ${fmt(va, f)} → ${fmt(vb, f)}`);
	}
	for (const s of FALHAS) {
		const va = a.tec[s.k].aviso, vb = b.tec[s.k].aviso;
		if (va !== vb) out.push(`Falhas técnicas › ${s.n} › alerta (%): ${fmt(va, 'aviso')} → ${fmt(vb, 'aviso')}`);
	}
	if (!!a.sinal !== !!b.sinal) out.push(`Regra por sinalização: ${a.sinal ? 'ligada' : 'a de hoje'} → ${b.sinal ? 'ligada' : 'a de hoje'}`);
	if (a.sinal && b.sinal) for (const s of SINALIZACOES) {
		const ra = a.sinal[s.k], rb = b.sinal[s.k];
		const pares: [string, unknown, unknown][] = [
			['finaliza o cliente', ra.finaliza, rb.finaliza], ['rediscar', ra.rediscar.ativo, rb.rediscar.ativo],
			['depois de (min)', ra.rediscar.depois_min, rb.rediscar.depois_min], ['rediscagens', ra.rediscar.max, rb.rediscar.max],
			['prioridade', ra.rediscar.prioridade, rb.rediscar.prioridade], ['depois', ra.depois.acao, rb.depois.acao],
			['espera (min)', ra.depois.espera_min, rb.depois.espera_min], ['horário limite', ra.ate, rb.ate],
		];
		for (const [n, va, vb] of pares) if (va !== vb) out.push(`Regra por sinalização › ${s.n} › ${n}: ${fmt(va)} → ${fmt(vb)}`);
	}
	if (JSON.stringify(antes?.modo_discagem ?? null) !== JSON.stringify(depois?.modo_discagem ?? null) && a.modo === b.modo) out.push('Modo de discagem: ajustes');
	if (JSON.stringify(antes?.reciclagem_auto ?? null) !== JSON.stringify(depois?.reciclagem_auto ?? null)) out.push('Reciclagem automática: ajustes');
	return out;
}

// ---------------------------------------------------------------- contato por passada
export type LinhaPassada = { passada: number; chamadas: number; contatos: number; taxa: number | null; curtas: number; curtas_pct: number | null; minutos_ia: number; custo_operadora: number; sem_custo: number };
export type PassadaCalc = LinhaPassada & { custo: number | null; cpc: number | null; acum: number; ok: boolean };

/** Custo = minuto de IA × preço (se a pessoa vê o preço) + telefonia estimada; por contato só com 30+ chamadas. */
export function calcularPassadas(linhas: LinhaPassada[], precoMinuto: number | null): PassadaCalc[] {
	let acum = 0;
	return [...linhas].sort((a, b) => a.passada - b.passada).map(l => {
		acum += l.contatos;
		const ok = l.chamadas >= MIN_CHAMADAS;
		const custo = precoMinuto != null ? l.minutos_ia * precoMinuto + l.custo_operadora : l.custo_operadora;
		return { ...l, ok, custo, cpc: ok && l.contatos > 0 ? custo / l.contatos : null, acum, taxa: ok ? l.taxa : null, curtas_pct: ok ? l.curtas_pct : null };
	});
}

/** Sugestão (quem decide é o cliente): a 1ª passada das voltas abaixo de 1,5% de contato ou custando mais de 3× o contato da 1ª. */
export function passadaRuim(rows: PassadaCalc[]): PassadaCalc | null {
	const p1 = rows.find(r => r.passada === 1);
	return rows.find(r => r.passada > 1 && r.ok && ((r.taxa ?? 0) < 1.5 || (r.cpc != null && p1?.cpc != null && r.cpc > 3 * p1.cpc))) ?? null;
}

// ---------------------------------------------------------------- ondas e reenvio
export type OndaVoz = { id: number; janela: string; tentativa: number; total: number; encerradas: number; situacao: string; abre_em: string | null; fecha_em: string | null; origem?: string | null; passada?: number | null; situacao_origem?: string | null; prioridade?: string | null; reenvio_id?: number | null };

export function nomeOnda(o: OndaVoz): { nome: string; detalhe: string } {
	const pri = o.prioridade ? ` · prioridade ${PRIORIDADES[o.prioridade as Prioridade]?.toLowerCase() ?? o.prioridade}` : '';
	if (o.origem === 'regua') return o.passada && o.passada > 1
		? { nome: `Retentativa · ${NOME[o.situacao_origem ?? ''] ?? 'sem contato'}`, detalhe: `${o.passada}ª tentativa` }
		: { nome: '1ª passada', detalhe: 'janela UF/DDD de cada número' };
	if (o.origem === 'spin') return { nome: `Spin ${o.passada ?? o.tentativa}`, detalhe: 'horizontal · passagem do mailing' };
	if (o.origem === 'rediscagem') return { nome: `Rediscagem · ${NOME[o.situacao_origem ?? ''] ?? '—'}`, detalhe: `regra por sinalização · ${o.passada ?? o.tentativa}ª tentativa${pri}` };
	if (o.origem === 'reciclagem') return { nome: 'Reciclagem do mailing', detalhe: 'tentativas zeradas, do começo' };
	if (o.origem === 'manual') return { nome: 'Reenvio manual', detalhe: `${NOME[o.situacao_origem ?? ''] ?? ''} · ${o.passada ?? o.tentativa}ª tentativa${pri}` };
	return { nome: o.janela, detalhe: `${o.tentativa}ª tentativa` };
}

export type Previa = { selecionados: number; volta: number; volta_outro_numero: number; espera_intervalo: number; fora: Record<string, number> };
export function totalFora(p: Previa | null): number {
	return p ? Object.values(p.fora ?? {}).reduce((t, n) => t + Number(n || 0), 0) : 0;
}

/** Chip "Falha técnica" do lote = todas as falhas técnicas. */
export const CHIPS_LOTE: { k: string; n: string; sits: string[] }[] = [
	...['nao_atendida', 'maquina', 'caixa_postal', 'ocupado', 'desligou_sem_conversar', 'atendeu_desligou', 'numero_incorreto'].map(k => ({ k, n: NOME[k], sits: [k] })),
	{ k: 'falha', n: 'Falha técnica', sits: FALHAS.map(f => f.k) },
];

// ================================================================ redesign aprovado (renitencia-v2): edição
// da regra por sinalização, do modo de discagem (vertical × horizontal com spins) e da reciclagem automática.
// Tudo continua dentro de credores.discagem: só o que difere do padrão MotorCX é gravado (o padrão do vertical troca
// o "depois" de máquina, não atendeu e caixa postal). Sem a chave, a VM de hoje (paridade).

/** Sem crédito e bloqueio de originação não são linhas: pausam a rota e alertam a equipe (regra fixa). */
export const TRAVA_SIN: Record<string, string> = {
	sem_credito: 'Sem crédito: pausa a rota e alerta a equipe na hora',
	bloqueio_originacao: 'Bloqueio: pausa a rota e alerta a equipe (alerta crítico)',
};
/** Inexistente e pessoa errada nunca rediscam o mesmo telefone; pediu retorno sempre finaliza (vale o agendamento). */
export const SEM_REDISCAR = ['numero_inexistente', 'pessoa_errada'];
export const LINHAS_SINAL = SINALIZACOES.filter(s => !FALHAS.some(f => f.k === s.k));
export const LINHAS_TEC = [...FALHAS.map(f => ({ k: f.k, n: f.n }))];

type Hoje = { finaliza?: boolean; rediscar?: boolean; depois_min?: number; acao?: AcaoDepois; txt: string };
const H_RED = (m: number, txt: string): Hoje => ({ finaliza: false, rediscar: true, depois_min: m, acao: 'proximo_cliente', txt });
/** O que a VM faz hoje em cada sinalização (voz/orquestrador/lote.py sem a regra nova: 2 por número, 120 min, 15 no ocupado). */
export const HOJE_SIN: Record<string, Hoje> = {
	maquina: H_RED(120, 'redisca em 120 min (2 por número); a lista segue'),
	nao_atendida: H_RED(120, 'redisca em 120 min (2 por número); a lista segue'),
	ocupado: H_RED(15, 'redisca em 15 min (2 por número); a lista segue'),
	caixa_postal: H_RED(120, 'redisca em 120 min (2 por número); a lista segue'),
	desligou_sem_conversar: { finaliza: true, txt: 'finaliza o cliente no dia' },
	retorno_agendado: { finaliza: true, txt: 'finaliza; vale o retorno agendado' },
	atendeu_desligou: { finaliza: true, txt: 'finaliza o cliente no dia' },
	numero_inexistente: { finaliza: false, rediscar: false, acao: 'proximo_telefone', txt: 'encerra o número; segue para o próximo da lista' },
	pessoa_errada: { finaliza: true, txt: 'finaliza o cliente no dia' },
	recado: { finaliza: true, txt: 'finaliza o cliente no dia' },
	falha_operadora: H_RED(120, 'redisca em 120 min; a lista segue'),
	falha_rede: H_RED(120, 'redisca em 120 min; a lista segue'),
	indisponivel: H_RED(120, 'redisca em 120 min; a lista segue'),
	cancelada_discador: H_RED(120, 'redisca em 120 min; a lista segue'),
	abandonada: { finaliza: true, txt: 'finaliza o cliente no dia' },
	sem_credito: { txt: 'redisca em 120 min, sem pausar a rota' },
	bloqueio_originacao: { txt: 'redisca em 120 min, sem pausar a rota' },
};

/** A regra que vale (ou o padrão, se a carteira ainda não usa a regra nova), já com o modo. */
export function sinalDaCarteira(d: DiscagemRen | null | undefined): { ativa: boolean; regras: Record<string, RegraSinal> } {
	const e = efetivo(d);
	if (e.sinal) return { ativa: true, regras: e.sinal };
	return { ativa: false, regras: efetivo({ ...(d ?? {}), por_sinalizacao: {} }).sinal! };
}

/** A linha muda o que a VM faz hoje? (badge "muda o hoje") */
export function mudaHoje(k: string, r: RegraSinal | null): boolean {
	const h = HOJE_SIN[k];
	if (!h || !r) return true;
	if (h.finaliza || r.finaliza) return !!h.finaliza !== !!r.finaliza;
	if (!!h.rediscar !== r.rediscar.ativo) return true;
	if (r.rediscar.ativo && (h.depois_min !== r.rediscar.depois_min || r.rediscar.max !== 1)) return true;
	return h.acao !== r.depois.acao;
}

function padraoLinha(modo: 'vertical' | 'horizontal' | null, k: string): RegraSinal {
	const base = PADRAO.por_sinalizacao[k];
	return modo === 'vertical' && PADRAO.sinalizacao_vertical[k] ? mesclar(base, { depois: { acao: PADRAO.sinalizacao_vertical[k] } }) : base;
}

function diferenca(base: Record<string, unknown>, v: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, x] of Object.entries(v)) {
		const b = base[k];
		if (x && typeof x === 'object' && !Array.isArray(x) && b && typeof b === 'object') {
			const sub = diferenca(b as Record<string, unknown>, x as Record<string, unknown>);
			if (Object.keys(sub).length) out[k] = sub;
		} else if (x !== b) out[k] = x;
	}
	return out;
}

export type CampoSinal = 'finaliza' | 'rediscar.ativo' | 'rediscar.depois_min' | 'rediscar.max' | 'rediscar.prioridade' | 'depois.acao' | 'depois.espera_min' | 'ate';

/** Muda um campo de uma sinalização. A primeira mudança liga a regra nova na carteira (por_sinalizacao). */
export function mudarSinal(d: DiscagemRen, k: string, campo: CampoSinal, valor: unknown): DiscagemRen {
	if (TRAVA_SIN[k]) return d;
	const { regras } = sinalDaCarteira(d);
	const linha = JSON.parse(JSON.stringify(regras[k])) as Record<string, Record<string, unknown> | unknown>;
	const [a, b] = campo.split('.');
	if (b) (linha[a] as Record<string, unknown>)[b] = valor; else linha[a] = valor;
	if (k === 'retorno_agendado') (linha as RegraSinal).finaliza = true;
	if (SEM_REDISCAR.includes(k)) (linha as RegraSinal).rediscar.ativo = false;
	const modo = efetivo(d).modo;
	const dif = diferenca(padraoLinha(modo, k) as unknown as Record<string, unknown>, linha as Record<string, unknown>);
	const ps = { ...((d.por_sinalizacao as Record<string, unknown> | null | undefined) ?? {}) };
	if (Object.keys(dif).length) ps[k] = dif; else delete ps[k];
	return { ...d, por_sinalizacao: ps };
}

export function voltarSinal(d: DiscagemRen, k: string): DiscagemRen {
	if (d.por_sinalizacao == null) return d;
	const ps = { ...(d.por_sinalizacao as Record<string, unknown>) };
	delete ps[k];
	return { ...d, por_sinalizacao: ps };
}

export function sinalAlterado(d: DiscagemRen, k: string): boolean {
	const ps = d.por_sinalizacao as Record<string, unknown> | null | undefined;
	return !!ps && ps[k] != null && Object.keys(ps[k] as object).length > 0;
}

const depTxt = (r: RegraSinal) => r.depois.acao === 'proximo_telefone' ? `próximo telefone${r.depois.espera_min ? ` em ${r.depois.espera_min} min` : ''}`
	: r.depois.acao === 'proximo_cliente' ? 'próximo cliente' : 'finaliza o cliente';

/** Uma frase por linha: o que acontece depois da tentativa. */
export function frase(k: string, r: RegraSinal, retornoDias: number): string {
	if (TRAVA_SIN[k]) return 'Pausa a rota e alerta a equipe na hora';
	if (k === 'retorno_agendado') return `Finaliza; liga de novo no horário pedido (até ${retornoDias} dias)`;
	if (r.finaliza) return 'Finaliza o cliente no dia';
	const fila = r.rediscar.prioridade === 'topo' ? ', topo da fila' : r.rediscar.prioridade === 'fim' ? ', fim da fila' : '';
	if (!r.rediscar.ativo || SEM_REDISCAR.includes(k)) return r.depois.acao === 'finaliza' ? 'Não redisca; finaliza o cliente' : `Não redisca; vai para o ${depTxt(r)}`;
	return `Redisca em ${r.rediscar.depois_min} min (até ${r.rediscar.max}×${fila}), depois ${depTxt(r)}`;
}

/** Os limites da carteira sempre cortam: a linha avisa quando. */
export function avisosSinal(k: string, r: RegraSinal, e: Pick<Efetivo, 'tnum' | 'tcli' | 'ren'>): string[] {
	const out: string[] = [];
	if (TRAVA_SIN[k] || r.finaliza || k === 'retorno_agendado') return out;
	if (r.rediscar.ativo && !SEM_REDISCAR.includes(k)) {
		const max = Math.min(e.ren[k]?.max_dia ?? e.tnum, e.tnum), cabe = Math.max(0, max - 1);
		if (cabe === 0) out.push(`não redisca: ${max} ${max === 1 ? 'tentativa' : 'tentativas'} por número`);
		else if (r.rediscar.max > cabe) out.push(`a régua corta em ${cabe}: ${max} tentativas por número`);
	}
	if (r.depois.acao === 'proximo_telefone' && e.tcli < 2) out.push('1 tentativa por cliente: não sobra para o próximo telefone');
	return out;
}

export function explicaDepois(r: RegraSinal, vertical: boolean): string {
	if (r.depois.acao === 'proximo_telefone') return vertical ? (r.depois.espera_min ? `o próximo telefone sai ${r.depois.espera_min} min depois` : '0 min = o próximo telefone sai logo') : 'puxa o próximo telefone deste cliente para o início do spin seguinte';
	if (r.depois.acao === 'proximo_cliente') return vertical ? 'volta aos outros telefones depois de abrir os clientes da vez' : 'o cliente volta no spin seguinte, pela regra do spin';
	return 'sai dos spins e voltas seguintes';
}

// ---------------------------------------------------------------- modo de discagem
export type TelSpin = 't1' | 't2' | 't3' | 't4' | 't5' | 'nao_tentado' | 'historico';
export type Modo = {
	modo: 'vertical' | 'horizontal'; max_telefones_dia: number; ordem: 'certificado' | 'carga' | 'historico';
	telefone_ausente: 'proximo' | 'pula';
	spins: { quantidade: number; intervalo_min: number; regras: { spin: number; telefone: TelSpin; inicio: string | null }[] };
};
export const MODOS: Record<Modo['modo'], string> = { vertical: 'Vertical', horizontal: 'Horizontal' };
export const ORDENS: Record<Modo['ordem'], string> = { certificado: 'Certificado primeiro', carga: 'Ordem da carga', historico: 'Melhor horário pelo histórico' };
export const TEL_SPIN: Record<TelSpin, string> = { t1: 'Telefone 1', t2: 'Telefone 2', t3: 'Telefone 3', t4: 'Telefone 4', t5: 'Telefone 5', nao_tentado: 'Próximo não tentado', historico: 'Melhor telefone pelo histórico' };
export const AUSENTE: Record<Modo['telefone_ausente'], string> = { proximo: 'Vai para o próximo disponível', pula: 'Pula o spin' };

/** O modo que vale (ou o padrão MotorCX, se a carteira não salvou: aí a VM faz o de hoje). */
export function modoDaCarteira(d: DiscagemRen | null | undefined): { ativo: boolean; m: Modo } {
	const base = PADRAO.modo_discagem as unknown as Modo;
	const x = d?.modo_discagem as Partial<Modo> | null | undefined;
	if (!x) return { ativo: false, m: JSON.parse(JSON.stringify(base)) };
	const { spins, ...resto } = x;
	const sp: Record<string, unknown> = { ...(spins ?? {}) };
	delete sp.regras;
	const m = mesclar(base, { ...resto, spins: sp }) as Modo;
	const q = m.spins.quantidade;
	const regras = Array.from({ length: q }, (_, i) => {
		const r = x.spins?.regras?.find(y => y.spin === i + 1);
		return { spin: i + 1, telefone: (r?.telefone ?? (i < 5 ? `t${i + 1}` : 'nao_tentado')) as TelSpin, inicio: r?.inicio ?? null };
	});
	return { ativo: true, m: { ...m, spins: { ...m.spins, regras } } };
}

/** Grava o modo inteiro (só as chaves que a validação conhece). Mudar o modo também ajusta o "depois" padrão. */
export function mudarModo(d: DiscagemRen, f: (m: Modo) => Modo): DiscagemRen {
	const m = f(JSON.parse(JSON.stringify(modoDaCarteira(d).m)) as Modo);
	m.spins.quantidade = Math.min(10, Math.max(1, m.spins.quantidade));
	m.spins.regras = Array.from({ length: m.spins.quantidade }, (_, i) => m.spins.regras[i] ?? { spin: i + 1, telefone: (i < 5 ? `t${i + 1}` : 'nao_tentado') as TelSpin, inicio: null })
		.map((r, i) => ({ spin: i + 1, telefone: r.telefone, inicio: r.inicio || null }));
	return { ...d, modo_discagem: m as unknown as Record<string, unknown> };
}

/** Índice (1…) do telefone de cada spin, para o desenho e os avisos. */
export function idxSpins(m: Modo): number[] {
	const usados: number[] = [];
	return m.spins.regras.slice(0, m.spins.quantidade).map(r => {
		let i = 1;
		if (r.telefone[0] === 't') i = Number(r.telefone.slice(1));
		else if (r.telefone === 'nao_tentado') { while (usados.includes(i)) i++; }
		usados.push(i);
		return i;
	});
}

export function telefonesDia(m: Modo): number {
	return m.modo === 'vertical' ? m.max_telefones_dia : Math.max(1, ...idxSpins(m));
}

/** Avisos do spin rate: spins acima das tentativas por cliente e telefone repetido acima das tentativas por número. */
export function avisosSpin(m: Modo, tnum: number, tcli: number): { efetivos: number; avisos: string[]; obs: [string, boolean][] } {
	const idx = idxSpins(m), efet = Math.min(m.spins.quantidade, tcli), usos: Record<number, number[]> = {};
	idx.forEach((i, s) => { if (s < efet) (usos[i] = usos[i] ?? []).push(s + 1); });
	const avisos: string[] = [];
	if (m.spins.quantidade > tcli) avisos.push(`Spin rate ${m.spins.quantidade} é maior que as ${tcli} tentativas por cliente no dia: só os ${tcli} primeiros spins saem.`);
	for (const [i, l] of Object.entries(usos)) if (l.length > tnum) avisos.push(`Telefone ${i} aparece em ${l.length} spins, mas o limite é ${tnum} por número: ${l.slice(tnum).map(x => `spin ${x}`).join(', ')} não ${l.length - tnum > 1 ? 'saem' : 'sai'} para ele.`);
	const obs = idx.map((i, s): [string, boolean] => {
		if (s >= tcli) return [`não sai: teto de ${tcli} tentativas por cliente`, true];
		if ((usos[i] ?? []).indexOf(s + 1) >= tnum) return [`não sai: telefone ${i} já usou ${tnum} tentativas`, true];
		const r = m.spins.regras[s].telefone;
		if (r === 'historico') return ['o telefone com mais contato no horário; sem histórico, certificado primeiro', false];
		if (r === 'nao_tentado') return ['o primeiro telefone que ainda não foi discado hoje', false];
		return [i > 1 ? `quem não tem o telefone ${i}: ${m.telefone_ausente === 'pula' ? 'pula este spin' : 'próximo disponível'}` : '1ª passada: todos os clientes', false];
	});
	return { efetivos: efet, avisos, obs };
}

/** Curtas previstas com q spins: média das curtas medidas de cada passada (Contato por passada), pesando as
 *  passadas seguintes pelo que sobra sem contato. Sem medida, null. */
export function curtasComSpins(q: number, curtasPorPassada: (number | null)[]): number | null {
	const med = curtasPorPassada.filter((x): x is number => x != null);
	if (!med.length) return null;
	let n = 0, p = 0;
	for (let k = 0; k < q; k++) {
		const v = curtasPorPassada[k] ?? med[med.length - 1];
		const w = Math.pow(0.62, k);
		n += v * w; p += w;
	}
	return n / p;
}

// ---------------------------------------------------------------- reciclagem automática
export type RecAuto = { ativo: boolean; hora: string; sem_contato_pct: number; excluir: string[] };
export const EXCLUSOES: { k: string; n: string; t: string }[] = [
	{ k: 'cpc', n: 'CPC ou acordo', t: 'falou com o titular ou fechou acordo' },
	{ k: 'promessa', n: 'Promessa', t: 'prometeu pagar' },
	{ k: 'recusa', n: 'Recusa', t: 'recusou negociar' },
	{ k: 'pessoa_errada', n: 'Pessoa errada', t: 'o número não é do cliente' },
	{ k: 'retorno', n: 'Retorno agendado', t: 'mantém o horário pedido' },
];
export const TRAVADAS: { k: string; n: string; t: string }[] = [
	{ k: 'nao_ligar', n: 'Não ligar', t: 'pedido do titular; nunca volta' },
	{ k: 'inexistente', n: 'Número inexistente', t: 'a voz fica suspensa no número' },
];

export function recDaCarteira(d: DiscagemRen | null | undefined): RecAuto {
	return mesclar(PADRAO.reciclagem_auto as unknown as RecAuto, d?.reciclagem_auto ?? {});
}

export function mudarRec(d: DiscagemRen, patch: Partial<RecAuto>): DiscagemRen {
	const r = { ...recDaCarteira(d), ...patch };
	r.excluir = EXCLUSOES.map(x => x.k).filter(k => r.excluir.includes(k));
	const igual = JSON.stringify(r) === JSON.stringify(recDaCarteira({}));
	const out = { ...d };
	if (igual) delete out.reciclagem_auto; else out.reciclagem_auto = r as unknown as Record<string, unknown>;
	return out;
}

// ---------------------------------------------------------------- antes e depois (modal de salvar)
export type ItemDiff = { onde: string; antes: string; depois: string };
export function diffItens(antes: DiscagemRen | null | undefined, depois: DiscagemRen | null | undefined): ItemDiff[] {
	return resumoMudancas(antes, depois).map(x => {
		const m = /^(.*): (.*) → (.*)$/.exec(x);
		return m ? { onde: m[1], antes: m[2], depois: m[3] } : { onde: x, antes: '', depois: '' };
	});
}

export function detalhesModoRec(antes: DiscagemRen | null | undefined, depois: DiscagemRen | null | undefined): string[] {
	const out: string[] = [];
	const a = modoDaCarteira(antes), b = modoDaCarteira(depois);
	if (a.ativo !== b.ativo) out.push(`Modo de discagem: ${a.ativo ? 'salvo' : 'o de hoje'} → ${b.ativo ? 'salvo' : 'o de hoje'}`);
	if (a.ativo || b.ativo) {
		const pares: [string, unknown, unknown][] = [
			['telefones por cliente no dia', a.m.max_telefones_dia, b.m.max_telefones_dia], ['ordem dos telefones', ORDENS[a.m.ordem], ORDENS[b.m.ordem]],
			['spin rate', a.m.spins.quantidade, b.m.spins.quantidade], ['intervalo entre spins (min)', a.m.spins.intervalo_min, b.m.spins.intervalo_min],
			['cliente sem o telefone do spin', AUSENTE[a.m.telefone_ausente], AUSENTE[b.m.telefone_ausente]],
		];
		if (a.m.modo !== b.m.modo) pares.unshift(['modo', MODOS[a.m.modo], MODOS[b.m.modo]]);
		for (const [n, x, y] of pares) if (x !== y) out.push(`Modo de discagem › ${n}: ${x} → ${y}`);
		const q = Math.max(a.m.spins.quantidade, b.m.spins.quantidade);
		for (let i = 0; i < q; i++) {
			const ra = a.m.spins.regras[i], rb = b.m.spins.regras[i];
			const ta = ra ? `${TEL_SPIN[ra.telefone]}${ra.inicio ? ` · ${ra.inicio}` : ''}` : '—', tb = rb ? `${TEL_SPIN[rb.telefone]}${rb.inicio ? ` · ${rb.inicio}` : ''}` : '—';
			if (ta !== tb) out.push(`Modo de discagem › spin ${i + 1}: ${ta} → ${tb}`);
		}
	}
	const ra = recDaCarteira(antes), rb = recDaCarteira(depois);
	const nm = (l: string[]) => l.length ? l.map(k => EXCLUSOES.find(x => x.k === k)?.n ?? k).join(', ') : 'só as travadas';
	const rp: [string, string, string][] = [
		['ligada', ra.ativo ? 'ligada' : 'desligada', rb.ativo ? 'ligada' : 'desligada'], ['horário', ra.hora, rb.hora],
		['sem contato a partir de (%)', String(ra.sem_contato_pct), String(rb.sem_contato_pct)], ['ficam de fora', nm(ra.excluir), nm(rb.excluir)],
	];
	for (const [n, x, y] of rp) if (x !== y) out.push(`Reciclagem automática › ${n}: ${x} → ${y}`);
	return out;
}

/** Tudo o que muda entre duas regras (resumo do histórico e o antes/depois do salvar). */
export function mudancasCompletas(antes: DiscagemRen | null | undefined, depois: DiscagemRen | null | undefined): string[] {
	const ta = efetivo(antes).tnum, tb = efetivo(depois).tnum;
	// o máximo por situação que só acompanhou as tentativas por número não é mudança à parte
	const soTeto = (x: string) => { const m = /^Renitência › .* › máx\. no dia: (\d+) → (\d+)$/.exec(x); return !!m && Number(m[1]) === ta && Number(m[2]) === tb; };
	return [...resumoMudancas(antes, depois).filter(x => x !== 'Modo de discagem: ajustes' && x !== 'Reciclagem automática: ajustes' && !x.startsWith('Limites › Modo de discagem') && !soTeto(x)),
		...detalhesModoRec(antes, depois)];
}
export function itensCompletos(antes: DiscagemRen | null | undefined, depois: DiscagemRen | null | undefined): ItemDiff[] {
	return mudancasCompletas(antes, depois).map(x => {
		const m = /^(.*): (.*) → (.*)$/.exec(x);
		return m ? { onde: m[1], antes: m[2], depois: m[3] } : { onde: x, antes: '', depois: '' };
	});
}

// ---------------------------------------------------------------- prévia com o dia de ontem (Resubmit)
export type SemContatoDia = { situacao: string; numeros: number };
export type LinhaPrevia = { k: string; semContato: number; voltam: number; contatos: number };
const SIT_SINAL: Record<string, string> = { numero_incorreto: 'numero_inexistente', sem_credito: 'falha_operadora' };

/** Quantos dos sem contato de ontem voltariam pela regra em edição e quantos contatos a mais isso daria, pela
 *  taxa de contato da 2ª passada de cada situação (Contato por passada; sem medida, a da 2ª passada geral). Teto:
 *  a janela do dia e os limites por número. */
export function previaOntem(sem: SemContatoDia[], d: DiscagemRen, taxa2: Record<string, number | null>, taxaGeral: number | null): { linhas: LinhaPrevia[]; voltam: number; contatos: number; semContato: number; hojeVoltam: number; hojeContatos: number } {
	const e = efetivo(d), { regras } = sinalDaCarteira(d);
	const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
	const linhas: LinhaPrevia[] = [];
	let voltam = 0, contatos = 0, total = 0, hojeV = 0, hojeC = 0;
	for (const s of sem) {
		const c = Number(s.numeros) || 0;
		total += c;
		const k = SIT_SINAL[s.situacao] ?? s.situacao, r = regras[k], tx = (taxa2[s.situacao] ?? taxaGeral ?? 0) / 100;
		let v = 0;
		if (TRAVA_SIN[s.situacao] || !r || s.situacao === 'retorno_agendado') v = 0;
		else if (!r.finaliza) {
			const max = Math.min(e.ren[s.situacao]?.max_dia ?? e.tnum, e.tnum), cabe = Math.max(0, max - 1);
			const red = r.rediscar.ativo && !SEM_REDISCAR.includes(k) ? Math.min(r.rediscar.max, cabe) : 0;
			const fit = Math.min(1, Math.max(0, (minutos(r.ate) - 8 * 60 - r.rediscar.depois_min) / (12 * 60)));
			// cada rediscagem a mais pega só quem seguiu sem contato (≈ 45% voltam de novo)
			v = (red > 0 ? c * fit * (1 + 0.45 * (red - 1)) : 0) + (r.depois.acao === 'proximo_telefone' ? c * 0.3 : 0);
		}
		const h = HOJE_SIN[k];
		const hv = h?.rediscar ? c * Math.min(1, Math.max(0, (20 * 60 - 8 * 60 - (h.depois_min ?? 120)) / (12 * 60))) : 0;
		hojeV += hv; hojeC += hv * tx;
		voltam += v; contatos += v * tx;
		if (c > 0) linhas.push({ k: s.situacao, semContato: c, voltam: Math.round(v), contatos: Math.round(v * tx) });
	}
	return { linhas: linhas.sort((a, b) => b.voltam - a.voltam), voltam: Math.round(voltam), contatos: Math.round(contatos), semContato: total, hojeVoltam: Math.round(hojeV), hojeContatos: Math.round(hojeC) };
}

// ---------------------------------------------------------------- prévia da reciclagem (previa_reciclagem_voz)
export type PreviaReciclagem = {
	base: number; volta: number; chamadas: number; ondas: number; duracao_min: number; por_hora: number;
	resta_min: number; cabe_pct: number; cabe_na_janela: boolean; janela_fonte: 'uf_ddd' | 'faixa_legal';
	janelas: { abre: string; fecha: string; ufs: string[]; clientes: number; resta_min: number; cabe_pct: number }[];
	excluir_efetivo: string[]; fora: Record<string, number>; curtas_previstas: number;
	curtas: { previstas: number; fracao_prevista: number; hoje: { chamadas: number; curtas: number; fracao: number | null }; fracao_depois: number | null; aviso: number; acima_do_aviso: boolean };
};
export const MOTIVO_FORA_REC: Record<string, { n: string; t: string }> = {
	max_dia: { n: 'Já atingiram o máximo do dia', t: 'o limite por cliente continua o de hoje' },
	cpc: { n: 'CPC ou acordo', t: 'exclusão escolhida' }, promessa: { n: 'Promessa', t: 'exclusão escolhida ou a promessa suspende ligações' },
	recusa: { n: 'Recusa', t: 'exclusão escolhida' }, pessoa_errada: { n: 'Pessoa errada', t: 'exclusão escolhida' },
	retorno: { n: 'Retorno agendado', t: 'mantém o horário pedido' }, nao_ligar: { n: 'Não ligar', t: 'travado: nunca volta' },
	inexistente: { n: 'Número inexistente', t: 'travado: a voz fica suspensa' },
};
export function duracao(min: number): string {
	const m = Math.max(0, Math.round(min));
	return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
