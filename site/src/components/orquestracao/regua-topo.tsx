import { type Definicao, type Passos } from '@/lib/estrategia';

/** Estágios da régua, na ordem de prioridade do motor. */
export const ESTAGIOS = [
	{ id: 'localizacao', faixa: 'localizacao', nome: 'Cliente novo' },
	{ id: 'cpc', faixa: 'cpc', nome: 'Deu CPC' },
	{ id: 'giro', faixa: 'giro', nome: 'Não CPC' },
	{ id: 'acordo', faixa: 'acordo', nome: 'Acordo' },
] as const;

export type EstagioId = (typeof ESTAGIOS)[number]['id'];

function normPassos(p: unknown): Passos {
	if (!p || typeof p !== 'object') return {};
	const out: Passos = {};
	for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
		if (Array.isArray(v)) out[k] = v as never;
	}
	return out;
}

/** Diz se uma faixa com passos tem alguma ação de público geral. */
function passosTemAcao(passos: Passos | undefined): boolean {
	if (!passos) return false;
	for (const arr of Object.values(passos)) {
		if (arr.some(a => a.canal && a.canal !== 'sem_acao')) return true;
	}
	return false;
}

export type StatusEstagio = { ativo: boolean; temRegua: boolean };

/** Status de cada estágio a partir da definição. */
export function statusEstagios(def: Definicao): Record<EstagioId, StatusEstagio> {
	const locAtivo = def.localizacao?.ativo !== false;
	const cpcAtivo = def.cpc?.ativo !== false;
	const giroAtivo = def.giro?.ativo !== false;
	const prevAtivo = def.preventivo?.ativo !== false;
	const quebraAtivo = def.quebra?.ativo !== false;
	return {
		localizacao: { ativo: locAtivo, temRegua: locAtivo && passosTemAcao(normPassos(def.localizacao?.passos)) },
		cpc: { ativo: cpcAtivo, temRegua: cpcAtivo && (def.cpc?.ordem?.some(a => a.canal) ?? false) },
		giro: { ativo: giroAtivo, temRegua: giroAtivo && passosTemAcao(normPassos(def.giro?.passos)) },
		acordo: { ativo: prevAtivo || quebraAtivo, temRegua: (prevAtivo && passosTemAcao(normPassos(def.preventivo?.passos))) || (quebraAtivo && passosTemAcao(normPassos(def.quebra?.passos))) },
	};
}

/** Linha de resumo de um estágio: "Quem entra: … · de X a Y dias, contando … · sai: … → …". */
export function resumoEstagio(def: Definicao, id: EstagioId): string {
	const ncp = def.localizacao?.dias_sem_contato_para_ncp ?? 8;
	const intervaloCpa = def.cpc?.intervalo_cpa ?? 1;
	const intervaloCpb = def.cpc?.intervalo_cpb ?? 1;
	const tentCpc = def.cpc?.tentativas_por_canal ?? 3;
	const ciclo = def.giro?.ciclo_dias ?? 8;
	const maxCiclos = def.giro?.max_ciclos ?? 3;
	const diasEstoque = def.quebra?.dias_para_estoque ?? 6;
	const carencia = def.quebra?.carencia ?? 0;
	if (id === 'localizacao') {
		if (def.localizacao?.ativo === false) return 'Desligada: clientes novos não recebem ação.';
		return `Quem entra: clientes novos · de 1 a ${ncp - 1} dias, contando da entrada · sai: D+${ncp} sem CPC → Não CPC`;
	}
	if (id === 'cpc') {
		if (def.cpc?.ativo === false) return 'Desligada: quem deu CPC não recebe ação.';
		return `Quem entra: quem deu CPC · CPC A a cada ${intervaloCpa} dia${intervaloCpa > 1 ? 's' : ''}, CPC B a cada ${intervaloCpb} dia${intervaloCpb > 1 ? 's' : ''}, ${tentCpc} tentativas por canal · sai: sem resposta → CPC B; esgota os canais → Não CPC`;
	}
	if (id === 'giro') {
		if (def.giro?.ativo === false) return 'Desligada: clientes Não CPC não recebem ação.';
		return `Quem entra: não CPC · ciclo de ${ciclo} dias × ${maxCiclos} · sai: ao fim dos ciclos, espera novo enriquecimento`;
	}
	// acordo
	const prevAtivo = def.preventivo?.ativo !== false;
	const quebraAtivo = def.quebra?.ativo !== false;
	if (!prevAtivo && !quebraAtivo) return 'Desligada: clientes em acordo não recebem ação.';
	const partes: string[] = ['Quem entra: clientes em acordo'];
	if (prevAtivo) partes.push('preventivo antes do vencimento');
	if (quebraAtivo) partes.push(`quebra após ${carencia > 0 ? `D+${carencia + 1}` : 'o vencimento'}`);
	partes.push(`sai: quebra sem pagamento → volta ao estoque como CPC A em ${diasEstoque} dia${diasEstoque > 1 ? 's' : ''}`);
	return partes.join(' · ');
}

export function ReguaTopo({ def, estagioAtivo, onEstagio, canEdit, onEditar }: {
	def: Definicao;
	estagioAtivo: EstagioId;
	onEstagio: (id: EstagioId) => void;
	canEdit: boolean;
	onEditar: () => void;
}) {
	const status = statusEstagios(def);
	return (
		<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4">
			<div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
				<span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Estágios</span>
				{ESTAGIOS.map(e => {
					const st = status[e.id];
					const active = estagioAtivo === e.id;
					return (
						<button
							key={e.id}
							type="button"
							onClick={() => onEstagio(e.id)}
							className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? '' : 'border border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]'} ${!st.ativo ? 'opacity-50' : ''}`}
							style={active ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' } : undefined}
						>
							{e.nome}
							{!st.temRegua && <span className={`text-[10px] ${active ? 'opacity-70' : 'text-[var(--base-texto-3)]'}`}>· sem régua</span>}
						</button>
					);
				})}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--base-fill)] px-3 py-2">
				<p className="flex-1 text-[12px] leading-relaxed text-[var(--base-texto-2)]">{resumoEstagio(def, estagioAtivo)}</p>
				<button type="button" onClick={onEditar} className="shrink-0 text-[12px] font-semibold text-[var(--destaque)] hover:underline">editar</button>
			</div>
		</div>
	);
}
