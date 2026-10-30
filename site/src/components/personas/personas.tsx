import { useEffect, useState } from 'react';
import { Check, ChevronDown, Sparkles, Star, X } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateTimeBR, friendlyError, moneyBR, numberBR, pctBR, supabase } from '@/lib/supabase';
import { CANAL_COR, nomeCanal, type Persona, type Sugestao } from '@/lib/personas';
import { SuasPersonas } from '@/components/personas/suas-personas';
import { ModelosMotorCob } from '@/components/personas/modelos-motorcob';
import { ComoMotorCobMede } from '@/components/personas/como-motorcob-mede';
import { MedidorMaturidade } from '@/components/personas/medidor-maturidade';
import { MatrizPropensao } from '@/components/personas/matriz-propensao';

export function Personas() {
	const { empresa, credor } = useMotorAuth();
	const canDecide = useAllowed(['admin', 'planejamento']);
	const [personas, setPersonas] = useState<Persona[]>([]);
	const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState('');
	const [historicoOpen, setHistoricoOpen] = useState(false);
	const [vista, setVista] = useState<'cartoes' | 'matriz'>(() => {
		if (typeof window === 'undefined') return 'cartoes';
		return localStorage.getItem('mc-personas-vista') === 'matriz' ? 'matriz' : 'cartoes';
	});
	useEffect(() => { try { localStorage.setItem('mc-personas-vista', vista); } catch { /* noop */ } }, [vista]);

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true); setError('');
		let pq = supabase.from('personas').select('*').eq('empresa_id', empresa.id);
		let sq = supabase.from('sugestoes').select('*').eq('empresa_id', empresa.id);
		if (credor) { pq = pq.eq('credor_id', credor.id); sq = sq.eq('credor_id', credor.id); }
		const [p, s] = await Promise.all([pq.order('clientes', { ascending: false }), sq.order('criada_em', { ascending: false })]);
		if (p.error || s.error) { setError(friendlyError()); setLoading(false); return; }
		setPersonas((p.data ?? []) as Persona[]);
		setSugestoes((s.data ?? []) as Sugestao[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id, credor?.id]);

	async function decidir(id: string, status: 'aprovada' | 'recusada') {
		if (!supabase) return;
		setBusy(id);
		const { error } = await supabase.from('sugestoes').update({ status, decidida_em: new Date().toISOString() }).eq('id', id);
		if (error) setError(friendlyError()); else { setError(''); void reload(); }
		setBusy('');
	}

	const pendentes = sugestoes.filter(s => s.status === 'pendente');
	const decididas = sugestoes.filter(s => s.status !== 'pendente');
	const caracteristicas = personas.find(p => p.caracteristicas?.length)?.caracteristicas ?? [];
	const ultimaAtualizacao = personas.reduce((m, p) => (p.atualizado_em && p.atualizado_em > m ? p.atualizado_em : m), '');

	if (!empresa) return (
		<>
			<PageHeading eyebrow="INTELIGÊNCIA / PERSONAS" title="Personas" description="Clientes parecidos respondem pelos mesmos canais. O MotorCX aprende com as ocorrências e escolhe, para cada cliente, o canal que mais dá CPC por real gasto." />
			<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
		</>
	);
	if (loading) return (
		<>
			<PageHeading eyebrow="INTELIGÊNCIA / PERSONAS" title="Personas" description="Clientes parecidos respondem pelos mesmos canais. O MotorCX aprende com as ocorrências e escolhe, para cada cliente, o canal que mais dá CPC por real gasto." />
			<Loading />
		</>
	);

	return (
		<>
			<PageHeading eyebrow="INTELIGÊNCIA / PERSONAS" title="Personas" description="Clientes parecidos respondem pelos mesmos canais. O MotorCX aprende com as ocorrências e escolhe, para cada cliente, o canal que mais dá CPC por real gasto." actions={
				<div className="inline-flex items-center gap-0.5 rounded-[9px] bg-[var(--base-fill)] p-0.5">
					<button onClick={() => setVista('cartoes')} className={`h-8 rounded-[7px] px-3 text-[13px] font-medium transition ${vista === 'cartoes' ? 'bg-[var(--base-cartao)] text-[var(--base-texto)] shadow-[0_1px_3px_rgba(0,0,0,.12)]' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}>Cartões</button>
					<button onClick={() => setVista('matriz')} className={`h-8 rounded-[7px] px-3 text-[13px] font-medium transition ${vista === 'matriz' ? 'bg-[var(--base-cartao)] text-[var(--base-texto)] shadow-[0_1px_3px_rgba(0,0,0,.12)]' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}>Matriz</button>
				</div>
			} />

			<ComoMotorCobMede caracteristicas={caracteristicas} />
			{ultimaAtualizacao && <p className="mb-6 text-[11px] text-slate-400">Última atualização das personas: {dateTimeBR(ultimaAtualizacao)}</p>}

			<SuasPersonas />

			<ModelosMotorCob />

			{vista === 'matriz' && <MatrizPropensao personas={personas} />}
			{vista === 'cartoes' && (
				<>
					{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			{/* Sugestões pendentes */}
			{pendentes.length > 0 && (
				<div className="mb-6 space-y-3">
					{pendentes.map(s => {
						const d = s.dados;
						const evDe = d.evidencia?.[d.de];
						const evPara = d.evidencia?.[d.para];
						return (
							<div key={s.id} className="rounded-xl border border-[#f0d49a] bg-[#fff7e8] p-5">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<p className="max-w-[640px] text-sm font-medium text-[#5a3d10]">{s.texto}</p>
									<span className="shrink-0 rounded-full bg-[#fde9c4] px-2.5 py-0.5 text-[11px] font-bold text-[#9a631b]">Afeta {numberBR(d.clientes)} clientes</span>
								</div>

								<div className="mt-4 grid gap-3 sm:grid-cols-2">
									<EvidenciaCanal titulo={`Hoje · ${nomeCanal(d.de)}`} ev={evDe} />
									<EvidenciaCanal titulo={`Sugerido · ${nomeCanal(d.para)}`} ev={evPara} destaque />
								</div>

								<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
									<span className="text-sm font-semibold text-[#2E7D32]">Ganho estimado: +{numberBR(d.ganho_cpc_por_rodada)} CPCs por rodada</span>
									{canDecide ? (
										<div className="flex gap-2">
											<button onClick={() => decidir(s.id, 'aprovada')} disabled={busy === s.id} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#2E7D32] px-4 text-xs font-semibold text-white hover:bg-[#256528] disabled:opacity-50"><Check size={15}/> Aprovar</button>
											<button onClick={() => decidir(s.id, 'recusada')} disabled={busy === s.id} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-50"><X size={15}/> Recusar</button>
										</div>
									) : <span className="text-[11px] text-slate-400">Só admin e planejamento decidem.</span>}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Histórico decididas */}
			{decididas.length > 0 && (
				<div className="mb-6 rounded-xl border border-[#dfe8ea] bg-white">
					<button type="button" onClick={() => setHistoricoOpen(v => !v)} className="flex w-full items-center justify-between px-5 py-4 text-left">
						<span className="text-sm font-bold text-[#163943]">Decididas ({decididas.length})</span>
						<ChevronDown size={18} className={`text-slate-400 transition-transform ${historicoOpen ? 'rotate-180' : ''}`} />
					</button>
					{historicoOpen && (
						<div className="divide-y divide-[#ecf0f1] border-t border-[#ecf0f1]">
							{decididas.map(s => (
								<div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
									<span className="min-w-0 flex-1 truncate text-slate-600">{s.texto}</span>
									<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${s.status === 'aprovada' ? 'bg-green-100 text-[#2E7D32]' : s.status === 'aplicada' ? 'bg-[#eaf2f3] text-[#0F4C5C]' : 'bg-red-100 text-[#C62828]'}`}>
										{s.status === 'aprovada' ? 'Aprovada · entra na rotina de amanhã como um segmento novo na Orquestração.' : s.status === 'aplicada' ? 'Aplicada' : 'Recusada'}
									</span>
									<span className="shrink-0 text-[11px] text-slate-400">{dateTimeBR(s.decidida_em ?? s.criada_em)}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* Lista de personas */}
			{personas.length === 0 ? (
				<div className="rounded-xl border border-dashed border-[#cbd9dd] bg-white px-6 py-12 text-center">
					<Sparkles className="mx-auto mb-3 text-[#e9a23b]" size={28} />
					<p className="text-sm text-slate-500">As personas aparecem depois de algumas semanas de ocorrências (CPC sim/não). Até lá, ★ usa a média da carteira.</p>
				</div>
			) : (
				<div>
					<h2 className="mb-4 text-lg font-semibold text-[#163943]">Personas da inteligência MotorCX</h2>
					<div className="grid gap-5 lg:grid-cols-2">
						{personas.map((p, i) => <PersonaCard key={p.persona} persona={p} cor={PERSONA_CORES[i % PERSONA_CORES.length]} />)}
					</div>
				</div>
					)}
				</>
			)}
		</>
	);
}

function EvidenciaCanal({ titulo, ev, destaque }: { titulo: string; ev?: { taxa_cpc: number; tentativas: number; custo_por_cpc: number }; destaque?: boolean }) {
	return (
		<div className={`rounded-lg border p-3 ${destaque ? 'border-[#0F4C5C] bg-[#f0f6f7]' : 'border-[#e2eaec] bg-white'}`}>
			<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{titulo}</p>
			{!ev ? <p className="text-xs text-slate-400">Sem dados.</p> : (
				<dl className="grid grid-cols-3 gap-2 text-center">
					<div><dt className="text-[10px] text-slate-400">Taxa CPC</dt><dd className="text-sm font-bold text-[#0F4C5C]">{pctBR(ev.taxa_cpc)}</dd></div>
					<div><dt className="text-[10px] text-slate-400">Tentativas</dt><dd className="text-sm font-bold text-slate-700">{numberBR(ev.tentativas)}</dd></div>
					<div><dt className="text-[10px] text-slate-400">Custo/CPC</dt><dd className="text-sm font-bold text-slate-700">{moneyBR(ev.custo_por_cpc)}</dd></div>
				</dl>
			)}
		</div>
	);
}

function PersonaCard({ persona, cor }: { persona: Persona; cor: string }) {
	const ranking = persona.ranking ?? [];
	const maxTaxa = ranking.reduce((m, r) => Math.max(m, Number(r.taxa_cpc ?? 0)), 0) || 1;
	const m = persona.maturidade;
	const maturidadeVazia = !m || Object.keys(m).length === 0;
	const naoFormada = m?.persona_formada === false;

	return (
		<section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="mb-1 flex items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-base font-semibold text-[#1D1D1F]"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cor }} />{persona.nome}</h3>
				<span className="shrink-0 rounded-full bg-[#F5F5F7] px-2.5 py-0.5 text-[11px] font-bold text-[#1D1D1F]">{numberBR(persona.clientes)} clientes</span>
			</div>
			{persona.condicoes?.length > 0 && (
				<p className="mb-3 text-xs text-slate-400">{persona.condicoes.map(c => `${c.campo} ${c.valor}`).join(' · ')}</p>
			)}

			{/* Medidor de maturidade */}
			{maturidadeVazia ? (
				<p className="mb-4 rounded-lg bg-[#f5f8f9] px-3 py-2 text-[11px] text-slate-400">Maturidade disponível após a próxima rotina.</p>
			) : naoFormada ? (
				<div className="mb-4 rounded-lg border border-[#f0d49a] bg-[#fff7e8] px-3 py-2 text-[11px] leading-relaxed text-[#9a631b]">Ainda não há volume para separar a carteira em personas. Por enquanto ★/☆ usam o ranking da carteira toda.</div>
			) : (
				<MedidorMaturidade maturidade={m!} nome={persona.nome} cor={cor} />
			)}

			{ranking.length === 0 ? <p className="py-4 text-center text-xs text-slate-400">Sem ranking de canais.</p> : (
				<div className="space-y-3">
					{ranking.map((r, i) => {
						const cor = CANAL_COR[r.canal] ?? '#475569';
						const tent = Number(r.tentativas ?? 0);
						const ev: 'pouca' | 'previa' | 'firme' = r.evidencia ?? (tent < 30 ? 'pouca' : tent < 100 ? 'previa' : 'firme');
						const evConf = EV_CONF[ev];
						const largura = Math.max(4, (Number(r.taxa_cpc ?? 0) / maxTaxa) * 100);
						const peso = r.peso_proprio ?? null;
						const pesoPct = peso == null ? null : Math.max(0, Math.min(100, peso * 100));
						const ehMelhor = i === 0;
						const ehSegundo = i === 1;
						return (
							<div key={`${r.canal}-${i}`}>
								<div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
									<span className="flex items-center gap-1.5 font-medium text-slate-700">
										<span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cor }} />
										{nomeCanal(r.canal)}
										{ehMelhor && <span className="inline-flex items-center gap-0.5 rounded-full bg-[#fff3df] px-1.5 py-0.5 text-[9px] font-bold text-[#9a631b]"><Star size={9}/> Melhor canal</span>}
										{ehSegundo && <span className="inline-flex items-center gap-0.5 rounded-full bg-[#eef3f4] px-1.5 py-0.5 text-[9px] font-bold text-slate-500">☆ 2º melhor</span>}
										<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: `${evConf.cor}1a`, color: evConf.cor }} title={evConf.txt}>{evConf.txt}</span>
									</span>
									<span className="flex items-center gap-3 text-slate-500">
										<span>{pctBR(r.taxa_cpc)}</span>
										<span>{moneyBR(r.custo_por_cpc)}</span>
										<span className="text-slate-400">{numberBR(tent)} tent.</span>
									</span>
								</div>
								{/* Barra de taxa de CPC */}
								<div className="h-2 w-full overflow-hidden rounded-full bg-[#f1f5f6]">
									<div className="h-full rounded-full" style={{ width: `${largura}%`, backgroundColor: cor }} />
								</div>
								{/* Barra "quem decide hoje": peso próprio × média da carteira */}
								{pesoPct != null && (
									<div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#eef3f4]" title={`Hoje ${numberBR(pesoPct)}% desta taxa vem dos clientes desta persona e ${numberBR(100 - pesoPct)}% da média da carteira.`}>
										<div className="flex h-full">
											<div className="h-full" style={{ width: `${pesoPct}%`, backgroundColor: cor }} />
											<div className="h-full flex-1" style={{ borderTop: '6px dashed #cbd5db' }} />
										</div>
									</div>
								)}
								{pesoPct != null && (
									<div className="mt-0.5 flex items-center justify-between text-[9px] text-slate-400">
										<span><span className="inline-block h-1.5 w-1.5 rounded-sm align-middle" style={{ backgroundColor: cor }} /> dados da persona {numberBR(pesoPct)}%</span>
										<span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-3 border-t border-dashed border-[#cbd5db]" /> média da carteira {numberBR(100 - pesoPct)}%</span>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

const EV_CONF: Record<'pouca' | 'previa' | 'firme', { cor: string; txt: string }> = {
	pouca: { cor: '#94a3a8', txt: '< 30 tentativas' },
	previa: { cor: '#FF9500', txt: 'em formação' },
	firme: { cor: '#248A3D', txt: 'evidência firme' },
};

const PERSONA_CORES = ['#1F8A4C', '#A2552B', '#C62828', '#3B5BA9', '#7A4FB0', '#0E7C86'];
