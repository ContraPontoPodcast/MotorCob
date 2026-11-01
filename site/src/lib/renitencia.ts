// Renitência por situação, regra de discagem por sinalização, modo de discagem, Reenviar agora, Reciclar mailing e
// Contato por passada (SQL 65; protótipo funcional aprovado em 01/11/2026).
// Regras puras (sem React, sem Supabase): o site e site/resubmit/resubmit.test.ts usam as mesmas funções.
// O padrão MotorCX é o de public.discagem_padrao() (= motor/discagem.padrao_site(); o teste confere com o SQL).
// A edição da regra por sinalização, do modo de discagem e da reciclagem chega com o redesign aprovado: até lá a tela
// mostra o que vale e grava só o que já editava (limites, máximo por situação, descanso e alertas). O intervalo de
// cada situação é o rediscar.depois_min da regra por sinalização (um intervalo só, decisão do dono).
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
