import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { useAllowed } from '@/components/app-shell';
import { friendlyError, numberBR, supabase, type Row } from '@/lib/supabase';

type Cat = 'com_acao' | 'regra_esteira' | 'sem_contato' | 'encerrado';
type Filtro = 'todos' | 'com_acao' | 'regra_esteira' | 'sem_contato';

const CAT_COR: Record<Cat, string> = {
	com_acao: '#34C759',
	regra_esteira: '#FF9500',
	sem_contato: '#FF3B30',
	encerrado: '#AEAEB2',
};
const CAT_LEGENDA: Record<Cat, string> = {
	com_acao: 'Liberados para todos os canais',
	regra_esteira: 'Regra da esteira',
	sem_contato: 'Sem contato para os canais do dia',
	encerrado: 'Fora da cobrança',
};

function categorizar(motivo: string): Cat {
	const m = motivo.toLowerCase();
	if (m.startsWith('com ação')) return 'com_acao';
	if (m.includes('encerrad') || m.includes('fora da cobrança') || m.includes('quitad') || m.includes('liquid')) return 'encerrado';
	if (m.includes('sem contato') || m.includes('inválido') || m.includes('sem número') || m.includes('contato válido')) return 'sem_contato';
	return 'regra_esteira';
}

/** Motivos que o motor agrupa como "Sem estágio": o cliente não se encaixa
 *  em nenhum estágio do segmento (estágio desligado ou sem estágio para a
 *  situação dele). Texto novo do motor e os antigos equivalentes. */
function isSemEstagio(motivo: string): boolean {
	const m = motivo.toLowerCase().trim();
	return (
		m.startsWith('sem ação: sem estágio') ||
		m.startsWith('sem ação: a fase do cliente') ||
		m.startsWith('sem ação: acordo quebrado, mas a quebra')
	);
}

const FILTROS: { id: Filtro; label: string }[] = [
	{ id: 'todos', label: 'Todos' },
	{ id: 'com_acao', label: 'Em ação' },
	{ id: 'regra_esteira', label: 'Esteira' },
	{ id: 'sem_contato', label: 'Sem contato' },
];

export function PorQueHojeApple() {
	const { empresa, credor } = useMotorAuth();
	const navigate = useNavigate();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [rows, setRows] = useState<{ motivo: string; clientes: number; cat: Cat; semEstagio?: boolean; explicacao?: string }[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [filtro, setFiltro] = useState<Filtro>('todos');

	useEffect(() => {
		if (!supabase || !empresa || !credor) { setRows([]); setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		supabase
			.from('motivos_hoje')
			.select('motivo,clientes')
			.eq('empresa_id', empresa.id)
			.eq('credor_id', credor.id)
			.then(({ data, error }) => {
				if (!active) return;
				if (error) { setError(friendlyError()); setRows([]); }
				else {
					const raw = ((data ?? []) as Row[]).map(r => {
						const motivo = String(r.motivo ?? '');
						return { motivo, clientes: Number(r.clientes) || 0, cat: categorizar(motivo) };
					});
					const sem = raw.filter(r => isSemEstagio(r.motivo));
					if (sem.length > 0) {
						const totalSem = sem.reduce((n, r) => n + r.clientes, 0);
						const mergedRow = {
							motivo: 'Sem estágio',
							clientes: totalSem,
							cat: 'regra_esteira' as Cat,
							semEstagio: true,
							explicacao: 'não se encaixam em nenhum estágio do segmento (estágio desligado ou sem estágio para a situação deles)',
						};
						setRows([mergedRow, ...raw.filter(r => !isSemEstagio(r.motivo))]);
					} else {
						setRows(raw);
					}
				}
				setLoading(false);
			});
		return () => { active = false; };
	}, [empresa?.id, credor?.id]);

	const total = useMemo(() => rows.reduce((n, r) => n + r.clientes, 0), [rows]);
	const porCat = useMemo(() => {
		const m: Record<Cat, number> = { com_acao: 0, regra_esteira: 0, sem_contato: 0, encerrado: 0 };
		for (const r of rows) m[r.cat] += r.clientes;
		return m;
	}, [rows]);

	const lista = useMemo(() => {
		const filtradas = filtro === 'todos' ? rows : rows.filter(r => r.cat === filtro);
		return [...filtradas].sort((a, b) => {
			if (a.cat === 'com_acao' && b.cat !== 'com_acao') return -1;
			if (b.cat === 'com_acao' && a.cat !== 'com_acao') return 1;
			return b.clientes - a.clientes;
		});
	}, [rows, filtro]);

	const max = Math.max(1, ...lista.map(r => r.clientes));
	const pct = (v: number) => total ? Math.round((v / total) * 100) : 0;

	const cards: { label: string; valor: number; cor: string }[] = [
		{ label: 'Carteira avaliada', valor: total, cor: '#1D1D1F' },
		{ label: 'Com ação hoje', valor: porCat.com_acao, cor: '#248A3D' },
		{ label: 'Fora por regra da esteira', valor: porCat.regra_esteira, cor: '#FF9500' },
		{ label: 'Sem contato válido', valor: porCat.sem_contato, cor: '#FF3B30' },
	];

	if (!empresa || !credor) return null;

	return (
		<div className="space-y-6">
			{/* KPI cards */}
			<div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
				{cards.map(c => (
					<div key={c.label} className="rounded-2xl bg-[#F5F5F7] p-[18px_20px]">
						<div className="flex items-center gap-2">
							<span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.cor }} />
							<span className="text-[13px] text-[#6E6E73]">{c.label}</span>
						</div>
						<p className="mt-2 text-[30px] font-semibold leading-none tnum text-[#1D1D1F]">{numberBR(c.valor)}</p>
						<p className="mt-1.5 text-[13px] text-[#6E6E73] tnum">{pct(c.valor)}% do total</p>
					</div>
				))}
			</div>

			{/* Por que hoje */}
			<section className="rounded-2xl bg-white p-6 sm:p-7" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<h2 className="mb-4 text-[20px] font-semibold text-[#1D1D1F]">Por que hoje</h2>

				{/* Controle segmentado */}
				<div className="inline-flex items-center gap-0.5 rounded-[9px] bg-[#EEEEF0] p-0.5">
					{FILTROS.map(f => {
						const ativo = filtro === f.id;
						return (
							<button key={f.id} onClick={() => setFiltro(f.id)} className={`h-[30px] rounded-[7px] px-3 text-[13px] font-medium transition ${ativo ? 'bg-white text-[#1D1D1F] shadow-[0_1px_3px_rgba(0,0,0,.12)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
								{f.label}
							</button>
						);
					})}
				</div>

				{loading ? (
					<p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
				) : error ? (
					<p className="py-8 text-center text-[14px] text-[#FF3B30]">{error}</p>
				) : lista.length === 0 ? (
					<p className="py-8 text-center text-[14px] text-[#8E8E93]">Sem motivos para este filtro.</p>
				) : (
					<div className="mt-4 divide-y divide-[#F0F0F2]">
						{lista.map((r, i) => r.semEstagio ? (
							<div key={i} className="grid w-full items-center gap-2 py-3" style={{ gridTemplateColumns: '8px 1fr 160px 64px' }}>
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CAT_COR[r.cat] }} />
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<p className="text-[15px] font-medium text-[#1D1D1F]">{r.motivo}</p>
										{canEdit && (
											<button onClick={() => navigate(`/orquestracao?carteira=${credor!.id}&passo=estagios`)} className="shrink-0 rounded-md px-2.5 py-1 text-[12px] font-semibold hover:opacity-85" style={{ backgroundColor: 'var(--destaque)', color: 'var(--destaque-texto)' }}>Resolver</button>
										)}
									</div>
									<p className="mt-0.5 text-[13px] leading-snug text-[#6E6E73]">{r.explicacao}</p>
								</div>
								<div className="hidden h-1 w-full overflow-hidden rounded-full bg-[#E5E5EA] sm:block">
									<div className="h-full rounded-full" style={{ width: `${(r.clientes / max) * 100}%`, backgroundColor: CAT_COR[r.cat] }} />
								</div>
								<span className="text-right text-[15px] font-semibold tnum text-[#1D1D1F]">{numberBR(r.clientes)}</span>
							</div>
						) : (
							<button key={i} onClick={() => navigate(`/clientes?motivo=${encodeURIComponent(r.motivo)}`)} className="grid w-full items-center gap-2 py-3 text-left transition-colors hover:bg-[#F5F5F7]" style={{ gridTemplateColumns: '8px 1fr 160px 64px' }}>
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CAT_COR[r.cat] }} />
								<div className="min-w-0">
									<p className="truncate text-[15px] text-[#1D1D1F]">{r.motivo}</p>
									<p className="truncate text-[13px] text-[#6E6E73]">{CAT_LEGENDA[r.cat]}</p>
								</div>
								<div className="hidden h-1 w-full overflow-hidden rounded-full bg-[#E5E5EA] sm:block">
									<div className="h-full rounded-full" style={{ width: `${(r.clientes / max) * 100}%`, backgroundColor: CAT_COR[r.cat] }} />
								</div>
								<span className="text-right text-[15px] font-semibold tnum text-[#1D1D1F]">{numberBR(r.clientes)}</span>
							</button>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
