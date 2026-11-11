// Ritmo da discagem por carteira: Power ou Preditivo (PREDITIVO.md; SQL 107 a 110). credores.discagem › ritmo =
// { modo: 'power' | 'preditivo', razao (Power, 1,0–3,0), meta_abandono (Preditivo, 0,5–3 %), razao_max (1,0–3,0) }.
// Sem a chave = Power 1,0 (o de hoje: ninguém atende sem robô). O teto de abandono (3 %) é fixo. A VM aplica
// (voz/orquestrador/ritmo.py) e grava o que aconteceu em voz_ritmo_amostras (leitura: ritmo_voz_hoje).

export type ModoRitmo = 'power' | 'preditivo';
export type Ritmo = { modo: ModoRitmo; razao: number; meta_abandono: number; razao_max: number };

export const PADRAO_RITMO: Ritmo = { modo: 'power', razao: 1.0, meta_abandono: 1.0, razao_max: 3.0 };
export const TETO_ABANDONO = 3;
export const RAZAO_MAX_1A_SEMANA = 2.0;
export const RAZOES_POWER = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
export const RAZOES_MAX = [1.5, 2.0, 2.5, 3.0];
/** Power sugerido quando a carteira troca para Power acima de 1,0 (PREDITIVO.md Parte 4). */
export const POWER_SUGERIDO = 1.5;
/** Freios de chamadas curtas da VM (voz/orquestrador/curtas.py, SQL 109). */
export const CURTAS = { aviso: 70, corte: 80, linha: 800, empresa: 8000, linhaLiberada: 950, empresaLiberada: 9500 };
/** A mensagem de quem atende sem robô (infra/asterisk/README.md, sound:motorcx/sem-robo): neutra, sem dívida. */
export const MENSAGEM_ABANDONO = 'Olá! No momento não conseguimos continuar esta ligação. Vamos tentar de novo mais tarde. Obrigado.';

const faixa = (v: unknown, lo: number, hi: number, padrao: number) => {
	const n = typeof v === 'number' ? v : Number.NaN;
	return Number.isFinite(n) && n >= lo && n <= hi ? n : padrao;
};

/** O ritmo que vale na carteira (o que não for válido fica com o padrão, como o motor). */
export function ritmoDe(discagem: Record<string, unknown> | null | undefined): Ritmo {
	const r = (discagem?.ritmo ?? {}) as Record<string, unknown>;
	return {
		modo: r.modo === 'preditivo' ? 'preditivo' : 'power',
		razao: faixa(r.razao, 1, 3, PADRAO_RITMO.razao),
		meta_abandono: faixa(r.meta_abandono, 0.5, 3, PADRAO_RITMO.meta_abandono),
		razao_max: faixa(r.razao_max, 1, 3, PADRAO_RITMO.razao_max),
	};
}

/** O que vai para credores.discagem › ritmo: só o que difere do padrão (null = tira a chave). */
export function ritmoSaida(r: Ritmo): Partial<Ritmo> | null {
	const out: Partial<Ritmo> = {};
	if (r.modo !== PADRAO_RITMO.modo) out.modo = r.modo;
	if (r.modo === 'power' && r.razao !== PADRAO_RITMO.razao) out.razao = r.razao;
	if (r.modo === 'preditivo') {
		if (r.meta_abandono !== PADRAO_RITMO.meta_abandono) out.meta_abandono = r.meta_abandono;
		if (r.razao_max !== PADRAO_RITMO.razao_max) out.razao_max = r.razao_max;
	}
	return Object.keys(out).length ? out : null;
}

export const num = (v: number, casas = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${num(Number(v))}%`);

/** Uma frase do ritmo (resumo do cartão e do histórico). */
export function fraseRitmo(r: Ritmo): string {
	if (r.modo === 'preditivo') return `Preditivo · meta de abandono ${num(r.meta_abandono)}% (teto ${TETO_ABANDONO}%) · até ${num(r.razao_max)} por robô livre`;
	return r.razao <= 1 ? 'Power 1,0 · ninguém atende sem robô (progressivo)' : `Power ${num(r.razao)} · ${num(r.razao)} números por robô livre`;
}

/** As mudanças do ritmo para o "Salvar como vN" e o histórico ("Ritmo › campo: antes → depois"). */
export function resumoRitmo(antes: Record<string, unknown> | null | undefined, depois: Record<string, unknown> | null | undefined): string[] {
	const a = ritmoDe(antes), d = ritmoDe(depois), out: string[] = [];
	const nome = (m: ModoRitmo) => (m === 'power' ? 'Power' : 'Preditivo');
	if (a.modo !== d.modo) out.push(`Ritmo › Como o MotorCX disca: ${nome(a.modo)} → ${nome(d.modo)}`);
	if (d.modo === 'power' && a.razao !== d.razao) out.push(`Ritmo › Números por robô livre: ${num(a.razao)} → ${num(d.razao)}`);
	if (d.modo === 'preditivo' && a.meta_abandono !== d.meta_abandono) out.push(`Ritmo › Meta de abandono: ${num(a.meta_abandono)}% → ${num(d.meta_abandono)}%`);
	if (d.modo === 'preditivo' && a.razao_max !== d.razao_max) out.push(`Ritmo › Razão máxima: ${num(a.razao_max)} → ${num(d.razao_max)}`);
	return out;
}

/** O que ritmo_voz_hoje devolve (SQL 106/108). */
export type RitmoHoje = {
	totais: { discadas: number; atendidas_pessoa: number; abandonos: number; transf_sem_operador: number; curtas: number; atendimento_pct: number | null; abandono_pct: number | null; transf_sem_operador_pct: number | null; curtas_pct: number | null };
	ultima: { janela: string; modo: ModoRitmo; razao: number; razao_config?: number | null; estado?: EstadoRitmo; conversas: number; reservas: number; linhas: number } | null;
	janelas: { inicio: string; discadas: number; atendidas_pessoa: number; abandonos: number; curtas: number; razao: number; atendimento_pct: number | null; abandono_pct: number | null; curtas_pct: number | null }[];
	por_tronco: { tronco_id: number; bina: string | null; discadas: number; atendidas_pessoa: number; abandonos: number; curtas: number; abandono_pct: number | null; curtas_pct: number | null }[];
	abandono_30d: { atendidas_pessoa: number; abandonos: number; transf_sem_operador: number; abandono_pct: number | null } | null;
};
export type EstadoRitmo = 'normal' | 'aquecendo' | 'reduzido' | 'freado' | 'parado';

/** A frase de estado (Ligações e Visão geral; PREDITIVO.md 5.2). null = normal, nada a dizer. */
export function fraseEstado(estado: EstadoRitmo | undefined | null, razao?: number | null): { titulo: string; texto: string; tom: 'info' | 'atencao' | 'erro' } | null {
	switch (estado) {
		case 'aquecendo': return { titulo: 'Aquecendo', texto: `Discando 1 por robô até juntar ${AQUECIMENTO} atendimentos por pessoa nos últimos 7 dias. Depois o MotorCX passa a prever.`, tom: 'info' };
		case 'reduzido': return { titulo: 'Ritmo reduzido', texto: `As chamadas curtas passaram de ${CURTAS.aviso}% hoje. O MotorCX baixou para ${num(razao ?? 1)} por robô${(razao ?? 1) <= 1 ? '' : ' livre'}.`, tom: 'atencao' };
		case 'freado': return { titulo: 'Freado', texto: `O abandono passou de ${TETO_ABANDONO}% na última meia hora. O MotorCX está ligando com folga (ou 1 por robô até o fim do dia, se continuar).`, tom: 'atencao' };
		case 'parado': return { titulo: 'Linha parada hoje', texto: `Uma linha (ou a empresa) chegou ao limite de chamadas curtas (${CURTAS.corte}% com ${CURTAS.linha} ligações numa linha ou ${CURTAS.empresa.toLocaleString('pt-BR')} no total). Volta amanhã às 08:00.`, tom: 'erro' };
		default: return null;
	}
}
export const AQUECIMENTO = 200;

/** Linha do cartão fechado / Visão geral: "Preditivo · abandono hoje 0,8% (meta 1%, teto 3%)". */
export function resumoHoje(r: Ritmo, hoje: RitmoHoje | null): string {
	const modo = r.modo === 'preditivo' ? 'Preditivo' : `Power ${num(r.razao)}`;
	if (r.modo === 'preditivo' && hoje?.ultima?.estado === 'aquecendo') return `Preditivo · em aquecimento`;
	const ab = hoje?.totais.abandono_pct;
	return `${modo} · abandono hoje ${pct(ab)}${r.modo === 'preditivo' ? ` (meta ${num(r.meta_abandono)}%, teto ${TETO_ABANDONO}%)` : ` (teto ${TETO_ABANDONO}%)`}`;
}

/** Linhas necessárias para encher N robôs (aviso da página Robôs e o Preditivo): canais ≈ robôs × razão. */
export function canaisRecomendados(robos: number, razao: number): number {
	return Math.ceil(Math.max(0, robos) * Math.max(1, razao));
}

/** Página "Robôs e o Preditivo": exemplo ilustrativo com o contrato da empresa (proto-robos, tela 5). A ocupação média
 *  dos robôs de cada modo é a da simulação do PREDITIVO.md (3.4); cai quando o tronco não deixa abrir as linhas. */
export const MODOS_ILUSTRACAO = {
	power1: { nome: 'Power 1,0', razao: 1, uso: 0.35, texto: '1 linha por robô livre. Simples, mas os robôs ficam muito tempo esperando alguém atender.' },
	power2: { nome: 'Power 2,0', razao: 2, uso: 0.6, texto: '2 linhas por robô livre. Mais rápido; o teto de abandono segura se atender gente demais.' },
	preditivo: { nome: 'Preditivo', razao: 2.6, uso: 0.88, texto: 'O MotorCX calcula quantas linhas abrir pela chance de alguém atender (~12% em cobrança). Neste exemplo, 2,6 por robô livre.' },
} as const;
export type ModoIlustracao = keyof typeof MODOS_ILUSTRACAO;

export function ilustrarRobos(robos: number, canais: number, modo: ModoIlustracao) {
	const m = MODOS_ILUSTRACAO[modo];
	const ideal = canaisRecomendados(robos, m.razao);
	const linhas = Math.min(ideal, Math.max(0, canais));
	const conversando = robos <= 0 ? 0 : Math.min(robos, Math.max(1, Math.round(robos * m.uso * Math.min(1, linhas / Math.max(1, ideal)))));
	return { ideal, linhas, conversando, troncoSegura: linhas < ideal };
}
