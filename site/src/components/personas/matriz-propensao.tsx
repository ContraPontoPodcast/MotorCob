import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loading, Notice, useAllowed } from '@/components/app-shell';
import { EscolhaCarteira } from '@/components/escolha-carteira';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, moneyBR, numberBR, supabase, type Row, type SegmentoEmUso } from '@/lib/supabase';
import { gerarIdEtapa, type Etapa } from '@/lib/estrategia';
import type { Persona } from '@/lib/personas';
import {
	FAIXAS, abordagemPersona, carteiraColetando, evidenciaCarteira, faixaPersona,
	fetchPropensaoCarteira, somarPorFaixa, somarSemFaixa, type LinhaPropensaoCarteira,
} from '@/lib/propensao';
import type { ResumoExecucao } from '@/lib/execucao';
import { FaixaBadge, PropensaoHelp } from '@/components/propensao/faixa-badge';
import { Info } from '@/components/glossario/info';

type Quadrante = {
	id: string;
	nome: string;
	alta: boolean;
	definida: boolean;
	personas: { persona: Persona; cor: string }[];
};

const QUADRANTES: Quadrante[] = [
	{ id: 'acelerar', nome: 'Acelerar', alta: true, definida: true, personas: [] },
	{ id: 'descobrir', nome: 'Descobrir rápido', alta: true, definida: false, personas: [] },
	{ id: 'manter', nome: 'Manter barato', alta: false, definida: true, personas: [] },
	{ id: 'economizar', nome: 'Economizar', alta: false, definida: false, personas: [] },
];

const PERSONA_CORES = ['#1F8A4C', '#A2552B', '#C62828', '#3B5BA9', '#7A4FB0', '#0E7C86'];

export function MatrizPropensao({ personas }: { personas: Persona[] }) {
	const { empresa, credor } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const navigate = useNavigate();
	const [rows, setRows] = useState<LinhaPropensaoCarteira[] | null>(null);
	const [exec, setExec] = useState<ResumoExecucao | null>(null);
	const [segmentos, setSegmentos] = useState<SegmentoEmUso[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [pickerQuad, setPickerQuad] = useState<Quadrante | null>(null);

	useEffect(() => {
		if (!supabase || !empresa || !credor) { setRows(null); setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		(async () => {
			try {
				const [pr, ex, sg] = await Promise.all([
					fetchPropensaoCarteira(empresa.id, credor.id),
					supabase.from('execucoes').select('resumo').eq('empresa_id', empresa.id).eq('credor_id', credor.id).order('iniciada_em', { ascending: false }).limit(1),
					supabase.from('segmentos_em_uso').select('*').eq('credor_id', credor.id).eq('vinculado', true).order('ordem', { ascending: true }),
				]);
				if (!active) return;
				setRows(pr);
				const r = (ex.data?.[0] as Row | undefined)?.resumo as ResumoExecucao | null | undefined;
				setExec(r ?? null);
				if (sg.error) setError(friendlyError()); else setSegmentos((sg.data ?? []) as SegmentoEmUso[]);
			} catch (e) {
				if (!active) return;
				setError(friendlyError(e));
			} finally {
				if (active) setLoading(false);
			}
		})();
		return () => { active = false; };
	}, [empresa?.id, credor?.id]);

	const coletando = useMemo(() => carteiraColetando(exec, rows), [exec, rows]);
	const porFaixa = useMemo(() => somarPorFaixa(rows), [rows]);
	const semFaixa = useMemo(() => somarSemFaixa(rows), [rows]);
	const evidencia = useMemo(() => evidenciaCarteira(exec, rows), [exec, rows]);

	// Distribui personas nos quadrantes.
	const { quadrantes, semFaixaPersonas } = useMemo(() => {
		const qs = QUADRANTES.map(q => ({ ...q, personas: [] as { persona: Persona; cor: string }[] }));
		const sem: { persona: Persona; cor: string }[] = [];
		personas.forEach((p, i) => {
			const cor = PERSONA_CORES[i % PERSONA_CORES.length];
			const faixa = faixaPersona(p.propensao ?? null);
			const abord = abordagemPersona(p.maturidade ?? null);
			if (!faixa) { sem.push({ persona: p, cor }); return; }
			const q = qs.find(q => q.alta === (faixa === 'alta') && q.definida === (abord === 'definida'));
			if (q) q.personas.push({ persona: p, cor }); else sem.push({ persona: p, cor });
		});
		return { quadrantes: qs, semFaixaPersonas: sem };
	}, [personas]);

	function criarEstagio(q: Quadrante, seg: SegmentoEmUso) {
		if (!credor) return;
		const faixas = q.alta ? ['A', 'B', 'C'] : ['D', 'E'];
		const etapa: Etapa = {
			id: gerarIdEtapa(q.nome, []),
			nome: q.nome,
			ativo: true,
			condicoes: [
				{ campo: 'propensao', op: 'em', valor: faixas },
				{ campo: 'fase', op: 'em', valor: ['localizacao', 'cpc', 'giro', 'quebra'] },
			],
			referencia: { tipo: 'entrada' },
			de: 1,
			ate: 30,
			aviso: 'A Abordagem ainda não é campo do motor: este estágio pega todos os clientes dessas faixas, não só as personas do quadrante.',
		};
		sessionStorage.setItem('mc-rascunho-etapa', JSON.stringify({ credorId: credor.id, segmentoId: seg.cluster_id, etapa }));
		navigate(`/orquestracao?carteira=${credor.id}&segmento=${seg.cluster_id}&passo=estagios`);
	}

	function onClickCriar(q: Quadrante) {
		if (!credor) return;
		const ativos = segmentos.filter(s => s.em_uso);
		if (ativos.length === 0) { setPickerQuad(q); return; }
		if (ativos.length === 1) { criarEstagio(q, ativos[0]); return; }
		setPickerQuad(q);
	}

	if (!empresa) return null;
	if (!credor) return (
		<section className="mb-8 rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-6">
			<h2 className="mb-4 text-lg font-semibold text-[var(--base-texto)]">Matriz de propensão</h2>
			<EscolhaCarteira />
		</section>
	);
	if (loading) return (
		<section className="mb-8 rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-6">
			<h2 className="mb-4 text-lg font-semibold text-[var(--base-texto)]">Matriz de propensão</h2>
			<Loading />
		</section>
	);

	return (
		<section className="mb-8 rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-6">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--base-texto)]">Matriz de propensão <PropensaoHelp matriz /></h2>
				<div className="flex items-center gap-1.5">
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--base-texto-2)]">{evidencia}</span>
					<Info slug="evidencia" />
				</div>
			</div>

			{error && <div className="mb-4"><Notice>{error}</Notice></div>}

			{/* Faixa do topo: carteira por faixa de propensão */}
			<div className="mb-5 overflow-x-auto">
				<div className="flex min-w-[640px] gap-2">
					{FAIXAS.map(f => (
						<div key={f} className="flex-1 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-3">
							<div className="mb-2 flex items-center gap-1.5"><FaixaBadge faixa={f} size="sm" /><span className="text-[11px] font-semibold text-[var(--base-texto-2)]">Faixa {f}</span></div>
							<p className="text-[15px] font-bold text-[var(--base-texto)]">{numberBR(porFaixa[f].clientes)}</p>
							<p className="text-[10px] text-[var(--base-texto-3)]">clientes</p>
							<p className="mt-1 text-[11px] font-semibold text-[var(--base-texto-2)]">{moneyBR(porFaixa[f].valor)}</p>
							<p className="text-[10px] text-[var(--base-texto-3)]">valor esperado</p>
						</div>
					))}
					<div className="flex-1 rounded-lg border border-dashed border-[var(--base-borda)] bg-[var(--base-fill)] p-3">
						<div className="mb-2 flex items-center gap-1.5"><FaixaBadge faixa={null} size="sm" /><span className="text-[11px] font-semibold text-[var(--base-texto-2)]">Sem faixa</span></div>
						<p className="text-[15px] font-bold text-[var(--base-texto)]">{numberBR(semFaixa.clientes)}</p>
						<p className="text-[10px] text-[var(--base-texto-3)]">clientes</p>
						<p className="mt-1 text-[11px] font-semibold text-[var(--base-texto-2)]">{moneyBR(semFaixa.valor)}</p>
						<p className="text-[10px] text-[var(--base-texto-3)]">valor esperado</p>
					</div>
				</div>
			</div>

			{coletando ? (
				<div className="rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-6 text-center text-sm font-medium text-[var(--estado-atencao-texto)]">Ainda sem faixas nesta carteira.</div>
			) : (
				<>
					<div className="mb-3 rounded-lg bg-[var(--base-fill)] px-3 py-2 text-[11px] leading-relaxed text-[var(--base-texto-2)]">Eixo vertical: Propensão a pagamento (alta = A–C em cima, baixa = D–E embaixo). Eixo horizontal: Abordagem <Info slug="abordagem" />. <strong>Hoje a Abordagem mede o canal (maturidade da persona); contato e mensagem entram depois.</strong></div>
					<div className="grid gap-3 lg:grid-cols-2">
						{quadrantes.map(q => {
							const clientes = q.personas.reduce((s, { persona }) => s + (Number(persona.propensao?.clientes ?? persona.clientes) || 0), 0);
							const saldo = q.personas.reduce((s, { persona }) => s + (Number(persona.propensao?.saldo ?? 0) || 0), 0);
							const valor = q.personas.reduce((s, { persona }) => s + (Number(persona.propensao?.valor_esperado ?? 0) || 0), 0);
							return (
								<div key={q.id} className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-4">
									<div className="mb-2 flex items-center justify-between gap-2">
										<div>
											<span className="rounded-full bg-[var(--base-cartao)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--base-texto-2)]">sugestão</span>
											<h3 className="mt-1 text-[15px] font-bold text-[var(--base-texto)]">{q.nome}</h3>
											<p className="text-[10px] text-[var(--base-texto-3)]">{q.alta ? 'Propensão alta' : 'Propensão baixa'} · {q.definida ? 'Abordagem definida' : 'Aprendendo'}</p>
										</div>
									</div>
									<div className="mb-2 flex flex-wrap gap-4 text-[12px] text-[var(--base-texto-2)]">
										<span><strong className="text-[var(--base-texto)]">{numberBR(clientes)}</strong> clientes</span>
										<span><strong className="text-[var(--base-texto)]">{moneyBR(saldo)}</strong> saldo</span>
										<span><strong className="text-[var(--base-texto)]">{moneyBR(valor)}</strong> valor esperado</span>
									</div>
									{q.personas.length > 0 ? (
										<div className="flex flex-wrap gap-1.5">
											{q.personas.map(({ persona, cor }) => (
												<span key={persona.persona} className="inline-flex items-center gap-1 rounded-full border border-[var(--base-borda)] bg-[var(--base-cartao)] px-2 py-0.5 text-[11px] font-medium text-[var(--base-texto)]">
													<span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} />{persona.nome}
												</span>
											))}
										</div>
									) : <p className="text-[11px] text-[var(--base-texto-3)]">Nenhuma persona neste quadrante.</p>}
									{canEdit && (
										<button type="button" onClick={() => onClickCriar(q)} className="mt-3 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Criar estágio com estes clientes</button>
									)}
								</div>
							);
						})}
					</div>
					{semFaixaPersonas.length > 0 && (
						<p className="mt-3 text-[12px] text-[var(--base-texto-3)]">Sem faixa ainda: {semFaixaPersonas.map(p => p.persona.nome).join(', ')}.</p>
					)}
				</>
			)}

			{pickerQuad && (
				<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setPickerQuad(null)}>
					<div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-[var(--base-cartao)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
						<h3 className="mb-3 text-base font-semibold text-[var(--base-texto)]">Em qual segmento criar o estágio “{pickerQuad.nome}”?</h3>
						<div className="space-y-1.5">
							{segmentos.filter(s => s.em_uso).map(s => (
								<button key={s.cluster_id} type="button" onClick={() => { criarEstagio(pickerQuad, s); setPickerQuad(null); }} className="flex w-full items-center gap-2 rounded-lg border border-[var(--base-borda)] px-3 py-2 text-left text-sm font-medium text-[var(--base-texto)] hover:bg-[var(--base-fill)]">
									<span className="grid h-6 w-6 place-items-center rounded text-[10px] font-bold" style={{ backgroundColor: 'var(--area)', color: 'var(--area-ativo-texto)' }}>{s.codigo}</span>
									{s.nome}
								</button>
							))}
							{segmentos.filter(s => s.em_uso).length === 0 && <p className="text-[12px] text-[var(--base-texto-3)]">Esta carteira não tem segmentos em uso. Crie um segmento na Orquestração primeiro.</p>}
						</div>
						<button type="button" onClick={() => setPickerQuad(null)} className="mt-4 h-9 rounded-lg border border-[var(--base-borda)] px-4 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Cancelar</button>
					</div>
				</div>
			)}
		</section>
	);
}
