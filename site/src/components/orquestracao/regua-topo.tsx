import { type Definicao, type Passos } from '@/lib/estrategia';
import { estagiosDaEstrategia } from '@/lib/estagios-regua';

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

/** Id da faixa da esteira (EstagioId) de um estágio da estratégia; etapa → null. */
export function faixaDoEstagio(id: string): EstagioId | null {
	if (id === 'preventivo' || id === 'quebra') return 'acordo';
	if (id === 'localizacao' || id === 'cpc' || id === 'giro') return id;
	return null;
}

/**
 * Os estágios da estratégia (os mesmos do passo Estágios: nomes, ordem, ligado/desligado) com o que o motor faz em
 * cada um. Fase abre a faixa dela no desenho abaixo; estágio próprio abre a régua dele.
 */
export function ReguaTopo({ def, selecionado, onEscolher, onEditar }: {
	def: Definicao;
	selecionado: string;
	onEscolher: (id: string) => void;
	onEditar: () => void;
}) {
	const estagios = estagiosDaEstrategia(def);
	const atual = estagios.find(e => e.id === selecionado) ?? estagios.find(e => e.ativo) ?? estagios[0];
	const faixa = atual ? faixaDoEstagio(atual.id) : null;
	return (
		<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4">
			<div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Estágios da estratégia">
				<span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Estágios</span>
				{estagios.map((e, i) => {
					const active = atual?.id === e.id;
					const alerta = e.regua === 'vazia';
					return (
						<button
							key={e.id}
							type="button"
							role="tab"
							aria-selected={active}
							onClick={() => onEscolher(e.id)}
							title={`${e.nome}: ${e.texto}`}
							className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? '' : 'border border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]'} ${!e.ativo ? 'opacity-50' : ''}`}
							style={active ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' } : undefined}
						>
							<span className="opacity-60">{i + 1}</span> {e.nome}
							{!e.ativo && <span className={`text-[10px] ${active ? 'opacity-70' : 'text-[var(--base-texto-3)]'}`}>· desligado</span>}
							{e.ativo && e.regua === 'padrao' && <span className={`text-[10px] ${active ? 'opacity-70' : 'text-[var(--base-texto-3)]'}`}>· padrão do motor</span>}
							{alerta && <span className={`text-[10px] ${active ? 'opacity-70' : 'text-[var(--estado-atencao-texto)]'}`}>· sem régua</span>}
						</button>
					);
				})}
			</div>
			{atual && (
				<div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--base-fill)] px-3 py-2">
					<p className="flex-1 text-[12px] leading-relaxed text-[var(--base-texto-2)]">
						<strong className="text-[var(--base-texto)]">{atual.nome}</strong> · {atual.texto}
						{faixa && atual.ativo && <> · {resumoEstagio(def, faixa)}</>}
					</p>
					<button type="button" onClick={onEditar} className="shrink-0 text-[12px] font-semibold text-[var(--destaque)] hover:underline">editar estágios</button>
				</div>
			)}
		</div>
	);
}
