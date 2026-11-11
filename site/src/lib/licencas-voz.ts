// Robôs contratados (licenças) do Agente de voz: regras e contas da tela Contratação › Agente de voz (PR 3 do plano).
// O banco é a fonte da verdade: a gravação passa por salvar_licencas_voz (SQL 93) e a fatura por previa_fatura (SQL 98).
// Aqui fica só o que a tela precisa mostrar ANTES de salvar (prévia da fatura com o pro rata, franquia, limite real,
// overbooking e os avisos), com as mesmas contas do SQL 98: ciclo cheio = a licença do 1º dia do ciclo; mudança no
// meio do ciclo = (total novo − anterior) × dias restantes ÷ dias do ciclo, contando o dia da mudança.
// 1 robô = 1 conversa ao mesmo tempo com a IA (não é linha discando nem canal do tronco).

export type ModeloLicenca = 'por_robo' | 'valor_fechado';

/** Uma vigência de voz_licencas (linha de licencas_voz / voz_licencas_cliente). Datas em ISO (aaaa-mm-dd). */
export type Licenca = {
	id?: number;
	vigente_desde: string;
	robos: number;
	modelo: ModeloLicenca;
	preco_robo: number | null;
	valor_fechado: number | null;
	franquia_min_robo: number;
	transcricao_inclusa: boolean;
	fidelidade_meses?: number;
	fidelidade_ate?: string | null;
	fidelidade_min?: number;
};

export type LinhaPrevia = { item: string; descricao: string; quantidade: number; preco: number; valor: number };

export const FRANQUIA_PADRAO = 4000;
export const FIDELIDADES = [0, 6, 12, 24] as const;
export const NOME_ITEM = 'Agente virtual · robôs (licenças)';

const MS_DIA = 86_400_000;
const dia = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** Dias entre duas datas ISO (b − a). */
export const diasEntre = (a: string, b: string) => Math.round((dia(b) - dia(a)) / MS_DIA);
export function somarDias(iso: string, n: number): string {
	return new Date(dia(iso) + n * MS_DIA).toISOString().slice(0, 10);
}
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;
const robosTxt = (n: number) => `${n} ${n === 1 ? 'robô' : 'robôs'}`;

/** Total do mês da licença: por robô = robôs × preço; valor fechado = o total. */
export function totalMes(l: Pick<Licenca, 'modelo' | 'robos' | 'preco_robo' | 'valor_fechado'>): number {
	return l.modelo === 'valor_fechado' ? Number(l.valor_fechado ?? 0) : l.robos * Number(l.preco_robo ?? 0);
}

/** Preço equivalente por robô (valor fechado ÷ robôs). */
export function precoPorRobo(l: Pick<Licenca, 'modelo' | 'robos' | 'preco_robo' | 'valor_fechado'>): number {
	if (l.modelo === 'por_robo') return Number(l.preco_robo ?? 0);
	return l.robos > 0 ? Number(l.valor_fechado ?? 0) / l.robos : 0;
}

/** Ordem do banco: vigente_desde e, no mesmo dia, a gravação mais nova (id). */
function ordenar(lista: Licenca[]): Licenca[] {
	return lista.map((l, i) => ({ l, i })).sort((a, b) => a.l.vigente_desde.localeCompare(b.l.vigente_desde)
		|| Number(a.l.id ?? a.i) - Number(b.l.id ?? b.i)).map(x => x.l);
}

/** A licença que vale no dia (= licenca_voz_em): a última com vigente_desde <= dia. */
export function licencaEm(lista: Licenca[], diaIso: string): Licenca | null {
	const ok = ordenar(lista).filter(l => l.vigente_desde <= diaIso);
	return ok.length ? ok[ok.length - 1] : null;
}

/** Mudanças agendadas (começam depois do dia), da mais próxima para a mais distante. */
export function agendadas(lista: Licenca[], diaIso: string): Licenca[] {
	return ordenar(lista).filter(l => l.vigente_desde > diaIso);
}

type Segmento = Licenca & { de: string; ate: string; nd: number };

/** Vigências dentro de [inicio, fim] com os dias de cada uma (= segmentos_licenca_voz). */
export function segmentos(lista: Licenca[], inicio: string, fim: string): Segmento[] {
	const doInicio = licencaEm(lista, inicio);
	const l = ordenar(lista).filter(x => x === doInicio || (x.vigente_desde > inicio && x.vigente_desde <= fim));
	return l.map((x, i) => {
		const de = x.vigente_desde > inicio ? x.vigente_desde : inicio;
		const prox = l[i + 1];
		const ate = prox ? somarDias(prox.vigente_desde > inicio ? prox.vigente_desde : inicio, -1) : fim;
		return { ...x, de, ate, nd: Math.max(diasEntre(de, ate) + 1, 0) };
	});
}

/** Linhas da licença na fatura do ciclo (= linhas_fatura_licenca_voz do SQL 98). */
export function linhasLicenca(lista: Licenca[], inicio: string, fim: string): LinhaPrevia[] {
	const dias = diasEntre(inicio, fim) + 1;
	const out: LinhaPrevia[] = [];
	let ant: Segmento | null = null;
	let n = 0;
	for (const s of segmentos(lista, inicio, fim).filter(x => x.nd > 0)) {
		const total = totalMes(s);
		if (!ant && s.de === inicio) {
			if (s.robos > 0) {
				out.push(s.modelo === 'valor_fechado'
					? { item: 'voz_licenca_robo', descricao: `${NOME_ITEM} · valor fechado, ${robosTxt(s.robos)}`, quantidade: 1, preco: Number(s.valor_fechado), valor: r2(Number(s.valor_fechado)) }
					: { item: 'voz_licenca_robo', descricao: `${NOME_ITEM} · ${robosTxt(s.robos)}`, quantidade: s.robos, preco: Number(s.preco_robo), valor: r2(total) });
			}
		} else {
			const antTotal = ant ? totalMes(ant) : 0;
			if (total !== antTotal) {
				n += 1;
				const rest = diasEntre(s.de, fim) + 1;
				const mesmoPreco = !!ant && ant.modelo === 'por_robo' && s.modelo === 'por_robo' && ant.preco_robo === s.preco_robo;
				const oque = !ant ? `início em ${ddmm(s.de)}, ${robosTxt(s.robos)}`
					: ant.robos !== s.robos ? `ajuste pro rata: de ${ant.robos} para ${s.robos} robôs desde ${ddmm(s.de)}`
						: `ajuste pro rata: preço novo desde ${ddmm(s.de)}`;
				out.push({
					item: `voz_licenca_robo_ajuste${n > 1 ? `_${n}` : ''}`,
					descricao: `${NOME_ITEM} · ${oque} (${rest} de ${dias} dias)`,
					quantidade: mesmoPreco ? r4((s.robos - ant!.robos) * rest / dias) : r4(rest / dias),
					preco: mesmoPreco ? Number(s.preco_robo) : total - antTotal,
					valor: r2((total - antTotal) * rest / dias),
				});
			}
		}
		ant = s;
	}
	return out;
}

/** Franquia de minutos de IA do ciclo: Σ robôs × franquia pelos dias de cada vigência (= licenca_voz_ciclo). */
export function franquiaCiclo(lista: Licenca[], inicio: string, fim: string): { tem: boolean; franquia: number; transcricao: boolean } {
	const dias = diasEntre(inicio, fim) + 1;
	const seg = segmentos(lista, inicio, fim).filter(s => s.nd > 0);
	return {
		tem: seg.some(s => s.robos > 0),
		franquia: Math.round(seg.reduce((t, s) => t + s.robos * s.franquia_min_robo * s.nd, 0) / dias),
		transcricao: seg.some(s => s.robos > 0 && s.transcricao_inclusa),
	};
}

/** Prévia do Agente de voz no ciclo, com a licença proposta: linhas da licença, plataforma e transcrição incluídas,
 *  franquia e excedente (pela projeção de minutos e o preço do minuto de IA), gestão de tronco e o total. */
export function previaCiclo(p: {
	licencas: Licenca[]; inicio: string; fim: string;
	minutosIA: number; precoMinutoIA: number | null; minutosTranscricao: number; precoTranscricao: number | null;
	troncos: number; precoTronco: number | null;
}): { linhas: LinhaPrevia[]; total: number; franquia: number; excedente: number } {
	const linhas = linhasLicenca(p.licencas, p.inicio, p.fim);
	const fc = franquiaCiclo(p.licencas, p.inicio, p.fim);
	let excedente = 0;
	if (fc.tem) {
		linhas.push({ item: 'voz_plataforma', descricao: 'Agente virtual · plataforma · incluída nos robôs (licenças)', quantidade: 1, preco: 0, valor: 0 });
		excedente = Math.max(0, Math.round(p.minutosIA) - fc.franquia);
		linhas.push({ item: 'voz_minuto_ia_franquia', descricao: `Agente virtual · minuto de IA · franquia de ${fc.franquia.toLocaleString('pt-BR')} min (incluída nos robôs)`, quantidade: Math.min(Math.round(p.minutosIA), fc.franquia), preco: 0, valor: 0 });
		if (excedente > 0) {
			linhas.push({ item: 'voz_minuto_ia', descricao: `Agente virtual · minuto de IA · excedente da franquia · ${excedente.toLocaleString('pt-BR')} min`, quantidade: excedente, preco: p.precoMinutoIA ?? 0, valor: r2(excedente * (p.precoMinutoIA ?? 0)) });
		}
		if (p.minutosTranscricao > 0 || !fc.transcricao) {
			linhas.push(fc.transcricao
				? { item: 'voz_transcricao', descricao: 'Agente virtual · transcrição (incluída nos robôs)', quantidade: p.minutosTranscricao, preco: 0, valor: 0 }
				: { item: 'voz_transcricao', descricao: 'Agente virtual · transcrição · por minuto (fora da licença)', quantidade: p.minutosTranscricao, preco: p.precoTranscricao ?? 0, valor: r2(p.minutosTranscricao * (p.precoTranscricao ?? 0)) });
		}
	}
	if (p.troncos > 0 && p.precoTronco != null) {
		linhas.push({ item: 'gestao_tronco_sip', descricao: `Agente virtual · gestão de tronco · ${p.troncos} ${p.troncos === 1 ? 'tronco' : 'troncos'}`, quantidade: p.troncos, preco: p.precoTronco, valor: r2(p.troncos * p.precoTronco) });
	}
	return { linhas, total: r2(linhas.reduce((t, l) => t + l.valor, 0)), franquia: fc.franquia, excedente };
}

/** Limite real = o menor entre licenças, canais ativos do tronco e a parte do teto global (com o motivo). */
export function limiteReal(robos: number, canais: number | null, parteTeto: number | null): { limite: number; motivo: 'licencas' | 'tronco' | 'teto' } {
	let limite = robos;
	let motivo: 'licencas' | 'tronco' | 'teto' = 'licencas';
	if (canais != null && canais < limite) { limite = canais; motivo = 'tronco'; }
	if (parteTeto != null && parteTeto < limite) { limite = parteTeto; motivo = 'teto'; }
	return { limite: Math.max(0, limite), motivo };
}

/** Robôs vendidos no dia (todas as empresas, com a proposta no lugar da empresa) = robos_vendidos_voz + n. */
export function vendidoCom(todas: (Licenca & { empresa_id: number | string })[], empresaId: number | string, diaIso: string, robos: number): number {
	const porEmpresa = new Map<string, Licenca[]>();
	for (const l of todas) {
		const k = String(l.empresa_id);
		if (k === String(empresaId)) continue;
		porEmpresa.set(k, [...(porEmpresa.get(k) ?? []), l]);
	}
	let s = robos;
	for (const lista of porEmpresa.values()) s += licencaEm(lista, diaIso)?.robos ?? 0;
	return s;
}

export type Edicao = {
	robos: number; modelo: ModeloLicenca; preco: number | null; fechado: number | null; inicio: 'agora' | 'proximo';
	fidelidade: number; fidelidadeMin: number; franquia: number; transcricao: boolean; motivo: string;
};

/** Data em que a edição passa a valer: hoje (America/Sao_Paulo) ou o 1º dia do próximo ciclo. */
export const valeDesde = (ed: Pick<Edicao, 'inicio'>, hoje: string, proximoCiclo: string) => (ed.inicio === 'agora' ? hoje : proximoCiclo);

/** É redução (robôs, franquia ou transcrição)? Redução só vale no próximo ciclo (SQL 93). */
export function ehReducao(ed: Edicao, atual: Licenca | null): boolean {
	if (!atual) return false;
	return ed.robos < atual.robos || ed.franquia < atual.franquia_min_robo || (atual.transcricao_inclusa && !ed.transcricao);
}

/** Bloqueios que a tela mostra antes de deixar revisar (o banco confere de novo ao salvar). */
export function bloqueios(ed: Edicao, atual: Licenca | null, inicioDe: string): string[] {
	const b: string[] = [];
	if (!Number.isInteger(ed.robos) || ed.robos < 0 || ed.robos > 5000) b.push('Robôs: de 0 a 5.000.');
	if (ed.modelo === 'por_robo' && !(Number(ed.preco) > 0)) b.push('Informe o preço por robô.');
	if (ed.modelo === 'valor_fechado' && !(Number(ed.fechado) > 0)) b.push('Informe o valor fechado por mês.');
	if (ed.modelo === 'valor_fechado' && ed.robos === 0) b.push('Valor fechado precisa de pelo menos 1 robô.');
	if (!Number.isInteger(ed.franquia) || ed.franquia < 0 || ed.franquia > 1_000_000) b.push('Franquia por robô: de 0 a 1.000.000 min.');
	if (ed.inicio === 'agora' && ehReducao(ed, atual)) b.push('Redução (robôs, franquia ou transcrição) vale só a partir do próximo ciclo.');
	if (atual?.fidelidade_ate && atual.fidelidade_ate >= inicioDe) {
		if (ed.robos < Number(atual.fidelidade_min ?? 0)) b.push(`Fidelidade até ${dataBR(atual.fidelidade_ate)} com mínimo de ${atual.fidelidade_min} robôs: não dá para reduzir abaixo disso antes do fim.`);
		if (ed.fidelidade === 0) b.push(`Fidelidade até ${dataBR(atual.fidelidade_ate)}: não dá para tirar antes do fim.`);
		if (ed.fidelidadeMin < Number(atual.fidelidade_min ?? 0)) b.push('A fidelidade que está correndo só se mantém ou estende (mínimo de robôs).');
	}
	if (ed.fidelidade > 0 && (ed.fidelidadeMin < 0 || ed.fidelidadeMin > ed.robos)) b.push(`Mínimo de robôs na fidelidade: de 0 a ${ed.robos}.`);
	const m = ed.motivo.trim().length;
	if (m < 5 || m > 300) b.push('Escreva o motivo da mudança (5 a 300 letras).');
	return b;
}

/** Avisos dos riscos conhecidos (não bloqueiam). */
export function avisos(p: { ed: Edicao; atual: Licenca | null; lista: Licenca[]; hoje: string; proximoCiclo: string }): string[] {
	const { ed, atual, lista, hoje, proximoCiclo } = p;
	const out: string[] = [];
	const d = valeDesde(ed, hoje, proximoCiclo);
	const futuras = agendadas(lista, d);
	if (futuras.length) {
		const f = futuras[0];
		out.push(`Já existe uma mudança agendada para ${dataBR(f.vigente_desde)} (${robosTxt(f.robos)}). Ela continua valendo e, a partir dessa data, substitui o que você gravar agora. Se o novo valor tem de seguir depois dela, grave também uma mudança para o próximo ciclo.`);
	}
	if (ed.inicio === 'agora' && atual) {
		const novo = totalMes({ modelo: ed.modelo, robos: ed.robos, preco_robo: ed.preco, valor_fechado: ed.fechado });
		const precoMudou = ed.modelo !== atual.modelo || (ed.modelo === 'por_robo' ? ed.preco !== atual.preco_robo : ed.fechado !== atual.valor_fechado);
		if (precoMudou) out.push('O preço novo vale desde hoje: a fatura deste ciclo cobra cada preço pelos dias em que valeu (ajuste pro rata).');
		if (novo < totalMes(atual)) out.push('O total do mês fica menor a partir de hoje: a fatura deste ciclo traz um crédito pro rata pelos dias restantes.');
	}
	return out;
}

export function dataBR(iso: string | null | undefined): string {
	if (!iso) return '—';
	return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Licença a partir de uma linha do banco (licencas_voz / voz_licencas_cliente). */
export function deLinha(r: Record<string, unknown>): Licenca {
	return {
		id: r.id == null ? undefined : Number(r.id),
		vigente_desde: String(r.vigente_desde ?? '').slice(0, 10),
		robos: Number(r.robos ?? 0),
		modelo: (String(r.modelo ?? 'por_robo') === 'valor_fechado' ? 'valor_fechado' : 'por_robo'),
		preco_robo: r.preco_robo == null ? null : Number(r.preco_robo),
		valor_fechado: r.valor_fechado == null ? null : Number(r.valor_fechado),
		franquia_min_robo: Number(r.franquia_min_robo ?? FRANQUIA_PADRAO),
		transcricao_inclusa: r.transcricao_inclusa !== false,
		fidelidade_meses: Number(r.fidelidade_meses ?? 0),
		fidelidade_ate: r.fidelidade_ate == null ? null : String(r.fidelidade_ate).slice(0, 10),
		fidelidade_min: Number(r.fidelidade_min ?? 0),
	};
}
