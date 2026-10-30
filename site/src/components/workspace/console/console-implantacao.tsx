import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms } from './console-perms';
import { LigarEnvioRealButton } from './ligar-envio-real';

type ImplRow = {
	empresa_id: string;
	nome: string;
	criada_em: string | null;
	total: number;
	feitos: number;
	proximo: string | null;
	ultima_atividade: string | null;
	pedido_em: string | null;
	vendedor_id: string | null;
};

type Passo = {
	ordem: number;
	passo: string;
	grupo: string;
	titulo: string;
	feito: boolean;
	pulado: boolean;
	da_equipe: boolean;
};

const GRUPO_LABEL: Record<string, string> = {
	conta: 'Sua conta',
	empresa: 'Empresa',
	cobranca: 'Cobrança',
	jornada: 'Jornada do Cliente',
	mensageria: 'Mensageria',
};
const GRUPO_ORDEM = ['conta', 'empresa', 'cobranca', 'jornada', 'mensageria'];

function num(r: Row | undefined, k: string): number {
	if (!r) return 0;
	const v = r[k];
	return typeof v === 'number' ? v : Number(v ?? 0);
}
function str(r: Row | undefined, k: string): string {
	if (!r) return '';
	const v = r[k];
	return v == null ? '' : String(v);
}

/** Dias desde a última atividade ("hoje" quando 0). */
function diasParada(ultima: string | null): string {
	if (!ultima) return '—';
	const diff = Date.now() - new Date(ultima).getTime();
	const dias = Math.floor(diff / 86400000);
	if (dias <= 0) return 'hoje';
	if (dias === 1) return 'há 1 dia';
	return `há ${dias} dias`;
}

/** Situação da empresa em implantação. */
function situacao(row: ImplRow): { label: string; cor: string; bg: string } {
	if (row.pedido_em) return { label: 'Pediu envio real', cor: '#9a631b', bg: '#FFF7E8' };
	const dias = row.ultima_atividade ? Math.floor((Date.now() - new Date(row.ultima_atividade).getTime()) / 86400000) : 0;
	if (dias > 7) return { label: 'Parada', cor: '#FF3B30', bg: '#FFE8E6' };
	return { label: 'Em implantação', cor: '#6E6E73', bg: '#F5F5F7' };
}

export function ConsoleImplantacaoPage() {
	const { membros } = useConsolePerms();
	const [rows, setRows] = useState<ImplRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [expandida, setExpandida] = useState<string | null>(null);
	const [passos, setPassos] = useState<Passo[]>([]);
	const [passosLoading, setPassosLoading] = useState(false);
	const [passosErro, setPassosErro] = useState('');

	// Mapa vendedor_id → nome (da equipe).
	const vendedorMap = useMemo(() => {
		const m: Record<string, string> = {};
		membros.forEach(mb => { m[mb.id] = mb.nome; });
		return m;
	}, [membros]);

	async function reload() {
		if (!supabase) return;
		setLoading(true);
		const { data, error: rpcError } = await supabase.rpc('implantacao_empresas');
		if (rpcError) { setError(friendlyError(rpcError)); setLoading(false); return; }
		setError('');
		setRows(((data ?? []) as Row[]).map(r => ({
			empresa_id: String(r.empresa_id ?? r.id ?? ''),
			nome: String(r.nome ?? ''),
			criada_em: (r.criada_em as string | null) ?? null,
			total: num(r, 'total'),
			feitos: num(r, 'feitos'),
			proximo: (r.proximo as string | null) ?? null,
			ultima_atividade: (r.ultima_atividade as string | null) ?? null,
			pedido_em: (r.pedido_em as string | null) ?? null,
			vendedor_id: (r.vendedor_id as string | null) ?? null,
		})));
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	async function verPassos(empresaId: string) {
		if (expandida === empresaId) { setExpandida(null); return; }
		setExpandida(empresaId);
		setPassos([]); setPassosErro(''); setPassosLoading(true);
		if (!supabase) { setPassosLoading(false); return; }
		const { data, error: rpcError } = await supabase.rpc('primeiros_passos', { empresa: empresaId });
		setPassosLoading(false);
		if (rpcError) { setPassosErro(friendlyError(rpcError)); return; }
		setPassos(((data ?? []) as Passo[]).sort((a, b) => a.ordem - b.ordem));
	}

	const pedidosAbertos = rows.filter(r => r.pedido_em).length;

	return (
		<ConsoleShell>
			{error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			<section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
				{loading ? (
					<p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
				) : rows.length === 0 ? (
					<p className="py-10 text-center text-[14px] text-[#8E8E93]">Nenhuma empresa em implantação. Empresa nova aparece aqui até terminar os primeiros passos.</p>
				) : (
					<>
						{/* Desktop */}
						<div className="hidden overflow-x-auto lg:block">
							<table className="w-full min-w-[920px] border-collapse text-left text-[14px]">
								<thead>
									<tr className="border-b border-[#E5E5EA] text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
										<th className="py-2 pr-4 font-semibold">Empresa</th>
										<th className="py-2 pr-4 font-semibold">Situação</th>
										<th className="py-2 pr-4 font-semibold">Passos</th>
										<th className="py-2 pr-4 font-semibold">Próximo passo</th>
										<th className="py-2 pr-4 font-semibold">Parada há</th>
										<th className="py-2 pr-4 font-semibold">Responsável</th>
										<th className="py-2 text-right font-semibold">Ação</th>
									</tr>
								</thead>
								<tbody>
									{rows.map(r => {
										const sit = situacao(r);
										const pct = r.total > 0 ? Math.round((r.feitos / r.total) * 100) : 0;
										const exp = expandida === r.empresa_id;
										return (
											<RowFragment
												key={r.empresa_id}
												r={r}
												sit={sit}
												pct={pct}
												exp={exp}
												vendedor={r.vendedor_id ? vendedorMap[r.vendedor_id] ?? '—' : '—'}
												onVerPassos={() => void verPassos(r.empresa_id)}
												onDone={() => void reload()}
												passos={passos}
												passosLoading={passosLoading}
												passosErro={passosErro}
											/>
										);
									})}
								</tbody>
							</table>
						</div>

						{/* Celular: cartões */}
						<div className="space-y-3 lg:hidden">
							{rows.map(r => {
								const sit = situacao(r);
								const pct = r.total > 0 ? Math.round((r.feitos / r.total) * 100) : 0;
								const exp = expandida === r.empresa_id;
								return (
									<MobileCard
										key={r.empresa_id}
										r={r}
										sit={sit}
										pct={pct}
										exp={exp}
										vendedor={r.vendedor_id ? vendedorMap[r.vendedor_id] ?? '—' : '—'}
										onVerPassos={() => void verPassos(r.empresa_id)}
										onDone={() => void reload()}
										passos={passos}
										passosLoading={passosLoading}
										passosErro={passosErro}
									/>
								);
							})}
						</div>
					</>
				)}
			</section>
		</ConsoleShell>
	);
}

/** Próximo passo com prazo do pedido (vermelho se atrasado). */
function ProximoPasso({ r }: { r: ImplRow }) {
	if (r.pedido_em) {
		const diffMin = Math.floor((Date.now() - new Date(r.pedido_em).getTime()) / 60000);
		const atrasado = diffMin > 60;
		const atrasoMin = diffMin - 60;
		return (
			<span className="text-[13px] text-[#1D1D1F]">
				Ligar o envio real · pedido há {diffMin} min{' '}
				{atrasado
					? <span className="font-semibold text-[#FF3B30]">atrasado {atrasoMin} min</span>
					: <span className="text-[#8E8E93]">(prazo 1 h)</span>}
			</span>
		);
	}
	return <span className="text-[13px] text-[#1D1D1F]">{r.proximo ?? '—'}</span>;
}

/** Barra verde fina + "feitos de total". */
function BarraPassos({ feitos, total, pct }: { feitos: number; total: number; pct: number }) {
	return (
		<div className="flex items-center gap-2">
			<div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#F0F0F2]">
				<div className="h-full rounded-full bg-[#34C759]" style={{ width: `${pct}%` }} />
			</div>
			<span className="text-[12px] text-[#6E6E73] tnum">{feitos} de {total}</span>
		</div>
	);
}

/** Lista de passos (só leitura) — expandida na linha. */
function PassosLista({ passos, loading, erro }: { passos: Passo[]; loading: boolean; erro: string }) {
	if (loading) return <p className="px-4 py-3 text-[13px] text-[#8E8E93]">Carregando passos...</p>;
	if (erro) return <p className="px-4 py-3 text-[13px] text-[#FF3B30]">{erro}</p>;
	if (passos.length === 0) return <p className="px-4 py-3 text-[13px] text-[#8E8E93]">Sem passos.</p>;

	const grupos: Record<string, Passo[]> = {};
	passos.forEach(p => { (grupos[p.grupo] ??= []).push(p); });
	const lista = GRUPO_ORDEM.filter(g => grupos[g]).map(g => ({ grupo: g, itens: grupos[g] }));

	return (
		<div className="space-y-3 px-4 py-3">
			{lista.map(g => (
				<div key={g.grupo}>
					<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">{GRUPO_LABEL[g.grupo] ?? g.grupo}</p>
					<div className="space-y-1">
						{g.itens.map(p => {
							const feito = p.feito || p.pulado;
							return (
								<div key={p.passo} className="flex items-center gap-2.5">
									<span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${feito ? 'bg-[#34C759] text-white' : p.da_equipe ? 'border-2 border-dashed border-[#D2D2D7]' : 'border-2 border-[#D2D2D7]'}`}>
										{feito && <Check size={10} />}
									</span>
									<span className={`text-[13px] ${feito ? 'text-[#8E8E93] line-through' : 'text-[#1D1D1F]'}`}>{p.titulo}</span>
									{p.da_equipe && !feito && <span className="rounded-full bg-[#F5F5F7] px-1.5 py-0.5 text-[10px] font-medium text-[#8E8E93]">da equipe</span>}
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

function RowFragment({ r, sit, pct, exp, vendedor, onVerPassos, onDone, passos, passosLoading, passosErro }: {
	r: ImplRow;
	sit: { label: string; cor: string; bg: string };
	pct: number;
	exp: boolean;
	vendedor: string;
	onVerPassos: () => void;
	onDone: () => void;
	passos: Passo[];
	passosLoading: boolean;
	passosErro: string;
}) {
	return (
		<>
			<tr className="border-b border-[#F0F0F2] align-top">
				<td className="py-3 pr-4">
					<p className="font-semibold text-[#1D1D1F]">{r.nome}</p>
					{r.criada_em && <p className="text-[12px] text-[#8E8E93]">criada {dateTimeBR(r.criada_em)}</p>}
				</td>
				<td className="py-3 pr-4">
					<span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>
				</td>
				<td className="py-3 pr-4"><BarraPassos feitos={r.feitos} total={r.total} pct={pct} /></td>
				<td className="py-3 pr-4"><ProximoPasso r={r} /></td>
				<td className="py-3 pr-4 text-[13px] text-[#6E6E73]">{diasParada(r.ultima_atividade)}</td>
				<td className="py-3 pr-4 text-[13px] text-[#6E6E73]">{vendedor}</td>
				<td className="py-3 text-right">
					{r.pedido_em ? (
						<LigarEnvioRealButton empresaId={r.empresa_id} empresaNome={r.nome} onDone={onDone} size="sm" />
					) : (
						<button onClick={onVerPassos} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0A60D0] hover:underline">
							{exp ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Ver passos
						</button>
					)}
				</td>
			</tr>
			{exp && (
				<tr className="border-b border-[#F0F0F2] bg-[#FAFAFB]">
					<td colSpan={7}>
						<PassosLista passos={passos} loading={passosLoading} erro={passosErro} />
					</td>
				</tr>
			)}
		</>
	);
}

function MobileCard({ r, sit, pct, exp, vendedor, onVerPassos, onDone, passos, passosLoading, passosErro }: {
	r: ImplRow;
	sit: { label: string; cor: string; bg: string };
	pct: number;
	exp: boolean;
	vendedor: string;
	onVerPassos: () => void;
	onDone: () => void;
	passos: Passo[];
	passosLoading: boolean;
	passosErro: string;
}) {
	return (
		<div className="rounded-xl border border-[#E5E5EA] p-4">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-[15px] font-semibold text-[#1D1D1F]">{r.nome}</p>
					<span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>
				</div>
			</div>
			<div className="mt-3"><BarraPassos feitos={r.feitos} total={r.total} pct={pct} /></div>
			<div className="mt-3 space-y-1.5">
				<div>
					<p className="text-[11px] text-[#8E8E93]">Próximo passo</p>
					<ProximoPasso r={r} />
				</div>
				<div className="flex items-center justify-between">
					<span className="text-[12px] text-[#8E8E93]">Parada há</span>
					<span className="text-[13px] text-[#1D1D1F]">{diasParada(r.ultima_atividade)}</span>
				</div>
				<div className="flex items-center justify-between">
					<span className="text-[12px] text-[#8E8E93]">Responsável</span>
					<span className="text-[13px] text-[#1D1D1F]">{vendedor}</span>
				</div>
			</div>
			<div className="mt-3 border-t border-[#F0F0F2] pt-3">
				{r.pedido_em ? (
					<LigarEnvioRealButton empresaId={r.empresa_id} empresaNome={r.nome} onDone={onDone} size="sm" />
				) : (
					<button onClick={onVerPassos} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0A60D0] hover:underline">
						{exp ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Ver passos
					</button>
				)}
			</div>
			{exp && (
				<div className="mt-3 rounded-lg bg-[#FAFAFB]">
					<PassosLista passos={passos} loading={passosLoading} erro={passosErro} />
				</div>
			)}
		</div>
	);
}
