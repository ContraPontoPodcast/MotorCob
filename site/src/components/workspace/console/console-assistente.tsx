import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
	Loader2, MessageSquare, CheckCircle2, ThumbsUp, FileText, AlertOctagon, Clock,
	Plus, Pencil, Trash2, ArrowUp, ArrowDown, FlaskConical, ExternalLink, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms } from './console-perms';
import { PainelEdicao } from '@/components/comuns/painel-edicao';
import { TabelaResponsiva, type LinhaTabela } from '@/components/comuns/tabela-responsiva';
import { useAssistente } from '@/components/workspace/assistente/assistente-context';
import { ACOES_OPCOES, TELAS_OPCOES, nomeTela, temDadoPessoal } from '@/lib/assistente-console';

type Aba = 'painel' | 'resolver' | 'respostas' | 'sugestoes';

const PERIODOS = [7, 30, 90] as const;

function num(r: Row | undefined | null, k: string): number {
	if (!r) return 0;
	const v = r[k];
	return typeof v === 'number' ? v : Number(v ?? 0);
}
function str(r: Row | undefined | null, k: string): string {
	if (!r) return '';
	const v = r[k];
	return v == null ? '' : String(v);
}
function arr(r: Row | undefined | null, k: string): Row[] {
	if (!r) return [];
	const v = r[k];
	return Array.isArray(v) ? (v as Row[]) : [];
}
/** Extrai a lista de ids de uma linha da fila do Assistente (campo `ids`, não `id`). */
function rowIds(r: Row | undefined | null): string[] {
	if (!r) return [];
	const v = (r as Row).ids;
	if (Array.isArray(v)) return v.map(x => String(x));
	if (v == null || v === '') return [];
	return [String(v)];
}
function money(v: number): string {
	return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Mapa local id→rótulo (para a coluna Tela da lista de respostas).
const ACAO_LABEL_LOCAL: Record<string, string> = Object.fromEntries(ACOES_OPCOES.map(a => [a.id, a.label]));

export function ConsoleAssistentePage() {
	const { isMaster } = useConsolePerms();
	const [aba, setAba] = useState<Aba>('painel');
	const [podeResponder, setPodeResponder] = useState<boolean | null>(null);
	const [preset, setPreset] = useState<{ pergunta: string; tela: string; ids?: string[] } | null>(null);

	useEffect(() => {
		if (!supabase) return;
		let active = true;
		(async () => {
			const { data } = await supabase.rpc('pode_responder_assistente');
			if (!active) return;
			setPodeResponder(!!data);
		})();
		return () => { active = false; };
	}, []);

	const abas: { id: Aba; label: string; todos: boolean }[] = [
		{ id: 'painel', label: 'Painel', todos: true },
		{ id: 'resolver', label: 'Para resolver', todos: false },
		{ id: 'respostas', label: 'Respostas da equipe', todos: false },
		{ id: 'sugestoes', label: 'Sugestões', todos: false },
	];

	return (
		<ConsoleShell>
			{/* Abas */}
			<div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1 no-scrollbar">
				{abas.map(a => {
					const bloqueada = !a.todos && podeResponder === false;
					return (
						<button
							key={a.id}
							onClick={() => setAba(a.id)}
							className={`flex shrink-0 items-center gap-1.5 rounded-[9px] px-4 py-2 text-[14px] font-medium transition-colors ${aba === a.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}
						>
							{a.label}
							{bloqueada && <Lock size={12} className="text-[#8E8E93]" />}
						</button>
					);
				})}
			</div>

			{aba !== 'painel' && podeResponder === false && (
				<div className="mb-4 flex items-start gap-2 rounded-xl bg-[#F5F5F7] px-4 py-3 text-[14px] text-[#6E6E73]">
					<Lock size={16} className="mt-0.5 shrink-0" /> Quem cuida das respostas do Assistente é o Atendimento.
				</div>
			)}

			{aba === 'painel' && <PainelTab isMaster={isMaster} />}
			{aba === 'resolver' && podeResponder && (
				<ResolverTab onResponderNaBase={(p) => { setPreset(p); setAba('respostas'); }} />
			)}
			{aba === 'respostas' && podeResponder && (
				<RespostasTab preset={preset} onLimparPreset={() => setPreset(null)} />
			)}
			{aba === 'sugestoes' && podeResponder && <SugestoesTab />}
		</ConsoleShell>
	);
}

// ============================== PAINEL ==============================

function PainelTab({ isMaster }: { isMaster: boolean }) {
	const [dias, setDias] = useState<number>(30);
	const [dados, setDados] = useState<Row | null>(null);
	const [config, setConfig] = useState<Row | null>(null);
	const [custoMes, setCustoMes] = useState<Row | null>(null);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true); setErro('');
		try {
			const [painel, cfg, cm] = await Promise.all([
				supabase.rpc('assistente_painel', { dias }),
				supabase.from('assistente_config').select('teto_mensal_brl,cotacao_dolar,cotacao_fonte,cotacao_em,modelo').maybeSingle(),
				supabase.rpc('assistente_custo_mes'),
			]);
			if (painel.error) throw painel.error;
			setDados(Array.isArray(painel.data) ? (painel.data[0] ?? null) : (painel.data as Row | null));
			setConfig((cfg.data as Row | null) ?? null);
			setCustoMes(Array.isArray(cm.data) ? (cm.data[0] ?? null) : (cm.data as Row | null));
		} catch (e) {
			setErro(friendlyError(e));
			setDados(null);
		} finally { setLoading(false); }
	}
	useEffect(() => { void reload(); }, [dias]);

	if (loading) return <p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;
	if (erro) return <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>;
	if (!dados) return <p className="py-12 text-center text-[14px] text-[#8E8E93]">Sem dados.</p>;

	const custoBrl = custoMes ? num(custoMes, 'brl') : 0;
	const custoTeto = custoMes ? num(custoMes, 'teto') : 0;
	const custoPct = custoMes ? num(custoMes, 'pct') : 0;
	const semCotacao = !config || config.cotacao_dolar == null || config.cotacao_dolar === '';
	const tempoMedioSeg = Math.round(num(dados, 'tempo_medio_ms') / 1000);

	const temas = arr(dados, 'temas');
	const telas = arr(dados, 'telas');
	const maxTema = temas.reduce((m, t) => Math.max(m, num(t, 'total')), 0) || 1;

	return (
		<div className="space-y-6">
			{/* Período */}
			<div className="flex items-center gap-2">
				<span className="text-[14px] font-semibold text-[#1D1D1F]">Período</span>
				<div className="flex items-center gap-1 rounded-[12px] bg-[#F5F5F7] p-1">
					{PERIODOS.map(p => (
						<button key={p} onClick={() => setDias(p)} className={`rounded-[9px] px-4 py-1.5 text-[14px] font-medium transition-colors ${dias === p ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{p} dias</button>
					))}
				</div>
			</div>

			{/* Cartões */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
				<Kpi icon={MessageSquare} titulo="Perguntas" valor={num(dados, 'perguntas').toLocaleString('pt-BR')} sub={`${num(dados, 'pessoas')} ${num(dados, 'pessoas') === 1 ? 'pessoa' : 'pessoas'} · ${num(dados, 'empresas')} ${num(dados, 'empresas') === 1 ? 'empresa' : 'empresas'}`} />
				<Kpi icon={CheckCircle2} titulo="Respondidas" valor={`${num(dados, 'respondidas_pct').toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`} sub={`${num(dados, 'sem_resposta')} ${num(dados, 'sem_resposta') === 1 ? 'sem resposta' : 'sem respostas'}`} />
				<Kpi icon={ThumbsUp} titulo="Aprovação" valor={`${num(dados, 'aprovacao_pct').toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`} sub={`👍 sobre avaliadas (${num(dados, 'avaliadas')})`} />
				<Kpi icon={FileText} titulo="Viraram chamado" valor={num(dados, 'viraram_chamado').toLocaleString('pt-BR')} />
				<Kpi icon={AlertOctagon} titulo="Fora do ar" valor={num(dados, 'fora_do_ar').toLocaleString('pt-BR')} sub="falhas nossas" valorCor={num(dados, 'fora_do_ar') > 0 ? '#FF3B30' : undefined} />
				<CustoCard brl={custoBrl} teto={custoTeto} pct={custoPct} semCotacao={semCotacao} />
			</div>
			<p className="-mt-3 flex items-center gap-1.5 text-[12px] text-[#8E8E93]">
				<Clock size={12} /> Tempo médio de resposta: {tempoMedioSeg.toLocaleString('pt-BR')} s
			</p>

			<div className="grid gap-4 lg:grid-cols-2">
				{/* Temas mais perguntados */}
				<section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
					<h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Temas mais perguntados</h2>
					{temas.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhum tema no período.</p> : (
						<div className="space-y-2.5">
							{temas.map((t, i) => {
								const total = num(t, 'total');
								const pct = Math.round((total / maxTema) * 100);
								return (
									<div key={i} className="flex items-center gap-3">
										<span className="w-32 shrink-0 truncate text-[13px] text-[#1D1D1F]">{str(t, 'tema') || '—'}</span>
										<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#F5F5F7]">
											<div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--area)' }} />
										</div>
										<span className="w-8 shrink-0 text-right text-[13px] font-semibold tnum text-[#1D1D1F]">{total}</span>
									</div>
								);
							})}
						</div>
					)}
				</section>

				{/* Telas com mais dúvida sem resposta */}
				<section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
					<h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Telas com mais dúvida sem resposta</h2>
					{telas.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhuma tela no período.</p> : (
						<TabelaResponsiva
							cabecalho={['Tela', 'Perguntas', 'Sem resposta %']}
							destaque={[0, 2]}
							linhas={telas.map((t) => {
								const pct = num(t, 'sem_resposta_pct');
								return {
									celulas: [
										<span key="t" className="text-[#1D1D1F]">{nomeTela(str(t, 'tela'))}</span>,
										<span key="p" className="tnum text-[#6E6E73]">{num(t, 'perguntas')}</span>,
										<span key="s" className="tnum font-semibold" style={{ color: pct > 20 ? '#FF3B30' : '#1D1D1F' }}>{pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>,
									],
								};
							})}
						/>
					)}
				</section>
			</div>

			{isMaster && <ConfigAssistente config={config} onSalvo={reload} />}
		</div>
	);
}

function Kpi({ icon: Icon, titulo, valor, sub, valorCor }: { icon: typeof MessageSquare; titulo: string; valor: string; sub?: string; valorCor?: string }) {
	return (
		<div className="rounded-2xl bg-[#F5F5F7] p-5">
			<div className="mb-1 flex items-center gap-1.5 text-[#6E6E73]">
				<Icon size={14} /> <span className="text-[13px]">{titulo}</span>
			</div>
			<p className="text-[22px] font-bold tracking-tight tnum" style={{ color: valorCor ?? 'var(--base-texto)' }}>{valor}</p>
			{sub && <p className="mt-0.5 text-[12px] text-[#8E8E93] tnum">{sub}</p>}
		</div>
	);
}

function CustoCard({ brl, teto, pct, semCotacao }: { brl: number; teto: number; pct: number; semCotacao: boolean }) {
	const cor = pct >= 100 ? '#FF3B30' : pct >= 80 ? '#FF9500' : '#34C759';
	return (
		<div className="rounded-2xl bg-[#F5F5F7] p-5">
			<div className="mb-1 flex items-center gap-1.5 text-[#6E6E73]">
				<span className="text-[13px]">Custo no mês</span>
			</div>
			{semCotacao ? (
				<p className="text-[15px] font-semibold text-[#8E8E93]">aguardando a cotação do Banco Central (o motor busca uma vez por dia)</p>
			) : (
				<>
					<p className="text-[22px] font-bold tracking-tight tnum" style={{ color: 'var(--base-texto)' }}>{money(brl)}</p>
					<p className="mt-0.5 text-[12px] text-[#8E8E93] tnum">teto {money(teto)} · {pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</p>
					<div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E5E5EA]">
						<div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: cor }} />
					</div>
				</>
			)}
		</div>
	);
}

function ConfigAssistente({ config, onSalvo }: { config: Row | null; onSalvo: () => void }) {
	const tetoAtual = num(config, 'teto_mensal_brl');
	const cotacaoAtual = config?.cotacao_dolar == null || config.cotacao_dolar === '' ? '' : String(config.cotacao_dolar);
	const cotacaoEm = str(config, 'cotacao_em');
	const [teto, setTeto] = useState(String(tetoAtual || ''));
	const [cotacao, setCotacao] = useState(cotacaoAtual);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [sucesso, setSucesso] = useState('');
	const [resetSignal, setResetSignal] = useState(0);

	useEffect(() => { setTeto(String(tetoAtual || '')); setCotacao(cotacaoAtual); }, [tetoAtual, cotacaoAtual]);

	const tetoMudou = teto !== String(tetoAtual || '');
	const cotacaoMudou = cotacao !== cotacaoAtual;
	const podeSalvar = (tetoMudou || cotacaoMudou) && teto.trim() !== '';

	const resumo = (
		<div className="space-y-2">
			<div className="rounded-lg border border-[#E5E5EA] px-3 py-2">
				<p className="text-[12px] text-[#6E6E73]">Teto do mês</p>
				<p className="text-[14px] font-medium text-[#1D1D1F]">{tetoAtual ? money(tetoAtual) : '—'}</p>
			</div>
			<div className="rounded-lg border border-[#E5E5EA] px-3 py-2">
				<p className="text-[12px] text-[#6E6E73]">Cotação do dólar</p>
				<p className="text-[14px] font-medium text-[#1D1D1F]">
					{cotacaoAtual ? `R$ ${Number(cotacaoAtual).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${cotacaoEm ? ` · PTAX de ${cotacaoEm}` : ''}` : 'Banco Central'}
				</p>
			</div>
			<p className="text-[13px] leading-relaxed text-[#8E8E93]">Com o teto atingido, o Assistente responde só com as Respostas da equipe e o Suporte até virar o mês.</p>
		</div>
	);

	const form = (
		<div className="space-y-4">
			<label className="block">
				<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Teto do mês (R$)</span>
				<input value={teto} onChange={e => setTeto(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
			</label>
			<label className="block">
				<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Cotação do dólar (vazio = Banco Central)</span>
				<input value={cotacao} onChange={e => setCotacao(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} inputMode="decimal" placeholder="PTAX" className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
			</label>
		</div>
	);

	const revisao = (
		<div className="space-y-2 text-[13px]">
			{tetoMudou && <p>Teto: <strong className="text-[#1D1D1F]">{teto ? money(Number(teto)) : '—'}</strong></p>}
			{cotacaoMudou && <p>Cotação: <strong className="text-[#1D1D1F]">{cotacao ? `R$ ${Number(cotacao).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : 'Banco Central'}</strong></p>}
		</div>
	);

	async function salvar() {
		if (!supabase) return;
		setBusy(true); setErro(''); setSucesso('');
		try {
			const tetoNum = Number(teto) || 0;
			const cotNum = cotacao.trim() === '' ? null : Number(cotacao);
			const { error } = await supabase.rpc('salvar_assistente_config', { teto: tetoNum, cotacao: cotNum });
			if (error) throw error;
			setSucesso('Configuração salva.');
			setResetSignal(s => s + 1);
			onSalvo();
		} catch (e) {
			setErro(friendlyError(e));
		} finally { setBusy(false); }
	}

	return (
		<PainelEdicao
			titulo="Teto do mês e cotação do dólar"
			podeEditar
			motivoBloqueio="Só o Master edita"
			resumo={resumo}
			form={form}
			revisao={revisao}
			podeRevisar={podeSalvar}
			podeSalvar={podeSalvar}
			salvando={busy}
			erro={erro}
			sucesso={sucesso}
			onSalvar={salvar}
			resetSignal={resetSignal}
		/>
	);
}

// ============================== PARA RESOLVER ==============================

const RESOLUCAO_TABS: { id: 'nova' | 'base_completada' | 'virou_chamado' | 'ignorada'; label: string }[] = [
	{ id: 'nova', label: 'Novas' },
	{ id: 'base_completada', label: 'Base completada' },
	{ id: 'virou_chamado', label: 'Viraram chamado' },
	{ id: 'ignorada', label: 'Ignoradas' },
];

function ResolverTab({ onResponderNaBase }: { onResponderNaBase: (p: { pergunta: string; tela: string; ids?: string[] }) => void }) {
	const [resolucao, setResolucao] = useState<'nova' | 'base_completada' | 'virou_chamado' | 'ignorada'>('nova');
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [ignorando, setIgnorando] = useState<string | null>(null);
	const [motivo, setMotivo] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true); setErro('');
		try {
			const { data, error } = await supabase.rpc('assistente_fila', { resolucao, dias: 30 });
			if (error) throw error;
			setRows((data ?? []) as Row[]);
		} catch (e) {
			setErro(friendlyError(e));
			setRows([]);
		} finally { setLoading(false); }
	}
	useEffect(() => { void reload(); }, [resolucao]);

	function resolverBase(r: Row) {
		onResponderNaBase({ pergunta: str(r, 'pergunta'), tela: str(r, 'tela'), ids: rowIds(r) });
	}

	async function ignorar(r: Row, key: string) {
		const ids = rowIds(r);
		if (!supabase || !motivo.trim() || ids.length === 0) return;
		setErro('');
		try {
			const { error } = await supabase.rpc('resolver_perguntas_assistente', { ids, resolucao: 'ignorada', motivo: motivo.trim() });
			if (error) throw error;
			setMotivo(''); setIgnorando(null);
			toast.success('Pergunta ignorada.');
			void reload();
		} catch (e) {
			setErro(friendlyError(e));
		}
	}

	function motivoLabel(m: string): string {
		const map: Record<string, string> = {
			nao_respondeu: 'não respondeu',
			errado: 'está errado',
			dificil: 'difícil de entender',
			sem_acesso: 'não tenho essa tela',
		};
		return map[m] ?? m;
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1 no-scrollbar">
				{RESOLUCAO_TABS.map(t => (
					<button key={t.id} onClick={() => setResolucao(t.id)} className={`shrink-0 rounded-[9px] px-4 py-1.5 text-[14px] font-medium transition-colors ${resolucao === t.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{t.label}</button>
				))}
			</div>

			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{loading ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				rows.length === 0 ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Nada aqui.</p> :
					<div className="space-y-3">
						{rows.map(r => {
							const motivoVal = str(r, 'motivo');
							const ehSemResposta = !motivoVal;
							const key = rowIds(r).join(',') || str(r, 'pergunta');
							return (
								<div key={key} className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<p className="text-[15px] font-medium text-[#1D1D1F]">{str(r, 'pergunta')}</p>
											<p className="mt-0.5 text-[13px] text-[#8E8E93]">{nomeTela(str(r, 'tela'))}</p>
											<div className="mt-2 flex flex-wrap items-center gap-2">
												<span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: ehSemResposta ? '#FFF7E8' : '#FFE8E6', color: ehSemResposta ? '#9a631b' : '#FF3B30' }}>
													{ehSemResposta ? 'sem resposta' : `👎 ${motivoLabel(motivoVal)}`}
												</span>
												<span className="text-[12px] text-[#8E8E93] tnum">Repetiu {num(r, 'repetiu')}× · {num(r, 'empresas')} {num(r, 'empresas') === 1 ? 'empresa' : 'empresas'}</span>
											</div>
										</div>
										<div className="flex shrink-0 flex-wrap items-center gap-2">
											{resolucao === 'virou_chamado' && r.chamado_id ? (
												<Link to={`/suporte/${r.chamado_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] bg-white px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><ExternalLink size={13} /> Ver chamado</Link>
											) : (
												<>
													<button onClick={() => resolverBase(r)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85"><Plus size={13} /> Responder na base</button>
													<button onClick={() => { setIgnorando(prev => prev === key ? null : key); setMotivo(''); }} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] bg-white px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Ignorar</button>
												</>
											)}
										</div>
									</div>
									{ignorando === key && (
										<div className="mt-3 rounded-lg bg-[#F5F5F7] p-3">
											<label className="block">
												<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Motivo (obrigatório)</span>
												<input value={motivo} onChange={e => setMotivo(e.target.value)} className="h-9 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Por que ignorar?" />
											</label>
											<div className="mt-2 flex justify-end gap-2">
												<button onClick={() => { setIgnorando(null); setMotivo(''); }} className="h-8 rounded-lg border border-[#D2D2D7] px-3 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
												<button onClick={() => ignorar(r, key)} disabled={!motivo.trim()} className="h-8 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">Ignorar</button>
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>}
		</div>
	);
}

// ============================== RESPOSTAS DA EQUIPE ==============================

type RespostaForm = { pergunta: string; resposta: string; passos: string[]; tela: string; frente: string; ativa: boolean };

const FRENTE_OPCOES = [
	{ id: 'todas', label: 'Todas' },
	{ id: 'motorcob', label: 'Cobrança' },
	{ id: 'motorcli', label: 'Jornada do Cliente' },
];

function RespostasTab({ preset, onLimparPreset }: { preset: { pergunta: string; tela: string; ids?: string[] } | null; onLimparPreset: () => void }) {
	const { abrirGaveta, perguntar } = useAssistente();
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [editando, setEditando] = useState<Row | null>(null);
	const [novo, setNovo] = useState(false);

	async function reload() {
		if (!supabase) return;
		setLoading(true); setErro('');
		try {
			const { data, error } = await supabase.from('assistente_respostas').select('*').order('atualizado_em', { ascending: false });
			if (error) throw error;
			setRows((data ?? []) as Row[]);
		} catch (e) {
			setErro(friendlyError(e));
			setRows([]);
		} finally { setLoading(false); }
	}
	useEffect(() => { void reload(); }, []);

	// Preset vindo de "Responder na base": abre o formulário novo preenchido.
	useEffect(() => {
		if (preset) { setNovo(true); setEditando(null); }
	}, [preset]);

	if (novo || editando) {
	async function aoSalvar() {
		if (preset?.ids && preset.ids.length && supabase) {
			try { await supabase.rpc('resolver_perguntas_assistente', { ids: preset.ids, resolucao: 'base_completada' }); } catch { /* ignora */ }
		}
		setNovo(false); setEditando(null); onLimparPreset(); void reload();
	}
		return <RespostaFormCard editando={editando} preset={preset} onFechar={() => { setNovo(false); setEditando(null); onLimparPreset(); }} onSalvo={aoSalvar} />;
	}

	async function testar(pergunta: string) {
		abrirGaveta();
		await perguntar(pergunta, 'conversa');
	}

	async function toggleAtiva(r: Row) {
		if (!supabase) return;
		try {
			const { error } = await supabase.from('assistente_respostas').update({ ativa: !r.ativa }).eq('id', r.id);
			if (error) throw error;
			void reload();
		} catch (e) { toast.error(friendlyError(e)); }
	}

	async function excluir(r: Row) {
		if (!supabase) return;
		if (!confirm('Excluir esta resposta?')) return;
		try {
			const { error } = await supabase.from('assistente_respostas').delete().eq('id', r.id);
			if (error) throw error;
			void reload();
		} catch (e) { toast.error(friendlyError(e)); }
	}

	const linhas: LinhaTabela[] = rows.map(r => {
		const ap = num(r, 'aprovacoes');
		const rep = num(r, 'reprovacoes');
		const tot = ap + rep;
		const telaLabel = str(r, 'tela') ? (ACAO_LABEL_LOCAL[str(r, 'tela')] ?? str(r, 'tela')) : '—';
		const frenteLabel = FRENTE_OPCOES.find(f => f.id === str(r, 'frente'))?.label ?? (str(r, 'frente') || '—');
		return {
			celulas: [
				<span key="p" className="font-medium text-[#1D1D1F]">{str(r, 'pergunta')}</span>,
				<span key="t" className="text-[#6E6E73]">{telaLabel}</span>,
				<span key="f" className="text-[#6E6E73]">{frenteLabel}</span>,
				<span key="u" className="tnum text-[#6E6E73]">{num(r, 'usos')}</span>,
				<span key="a" className="tnum text-[#1D1D1F]">{tot > 0 ? `${Math.round((ap / tot) * 100)}%` : '—'}</span>,
				<span key="s" className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.ativa ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{r.ativa ? 'Ativa' : 'Inativa'}</span>,
				<div key="x" className="flex items-center justify-end gap-1">
					<button onClick={() => testar(str(r, 'pergunta'))} title="Testar a pergunta" className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] hover:bg-[#F5F5F7]"><FlaskConical size={14} /></button>
					<button onClick={() => setEditando(r)} title="Editar" className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] hover:bg-[#F5F5F7]"><Pencil size={14} /></button>
					<button onClick={() => toggleAtiva(r)} title={r.ativa ? 'Desativar' : 'Ativar'} className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] hover:bg-[#F5F5F7]"><Lock size={14} /></button>
					<button onClick={() => excluir(r)} title="Excluir" className="grid h-7 w-7 place-items-center rounded-full text-[#FF3B30] hover:bg-[#FFE8E6]"><Trash2 size={14} /></button>
				</div>,
			],
		};
	});

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-[13px] text-[#6E6E73]">Vale em até 1 minuto, sem publicar a função. Fica na Auditoria.</p>
				<button onClick={() => setNovo(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85"><Plus size={15} /> Nova resposta</button>
			</div>
			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}
			{loading ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				rows.length === 0 ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Nenhuma resposta ainda.</p> :
					<section className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
						<TabelaResponsiva
							cabecalho={['Pergunta', 'Tela', 'Frente', 'Usada', '👍', 'Ativa', '']}
							destaque={[0, 4, 5]}
							linhas={linhas}
						/>
					</section>}
		</div>
	);
}

function RespostaFormCard({ editando, preset, onFechar, onSalvo }: { editando: Row | null; preset: { pergunta: string; tela: string; ids?: string[] } | null; onFechar: () => void; onSalvo: () => void }) {
	const inicial: RespostaForm = editando ? {
		pergunta: str(editando, 'pergunta'),
		resposta: str(editando, 'resposta'),
		passos: Array.isArray(editando.passos) ? (editando.passos as unknown[]).map(String) : [],
		tela: str(editando, 'tela'),
		frente: str(editando, 'frente') || 'todas',
		ativa: editando.ativa !== false,
	} : {
		pergunta: preset?.pergunta ?? '',
		resposta: '',
		passos: [],
		tela: preset?.tela ?? '',
		frente: 'todas',
		ativa: true,
	};
	const [form, setForm] = useState<RespostaForm>(inicial);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	function set(campo: keyof RespostaForm, v: string | boolean | string[]) { setForm(prev => ({ ...prev, [campo]: v })); }

	const dadoPessoal = temDadoPessoal(form.pergunta) || temDadoPessoal(form.resposta) || form.passos.some(p => temDadoPessoal(p));
	const perguntaOk = form.pergunta.trim().length >= 5 && form.pergunta.trim().length <= 200;
	const respostaOk = form.resposta.trim().length >= 1 && form.resposta.trim().length <= 1500;
	const podeSalvar = perguntaOk && respostaOk && !dadoPessoal && !busy;

	async function salvar() {
		if (!supabase || !podeSalvar) return;
		setBusy(true); setErro('');
		try {
			const payload = {
				pergunta: form.pergunta.trim(),
				resposta: form.resposta.trim(),
				passos: form.passos.map(p => p.trim()).filter(Boolean).slice(0, 6),
				tela: form.tela || null,
				frente: form.frente,
				ativa: form.ativa,
			};
			if (editando) {
				const { error } = await supabase.from('assistente_respostas').update(payload).eq('id', editando.id);
				if (error) throw error;
			} else {
				const { error } = await supabase.from('assistente_respostas').insert(payload);
				if (error) throw error;
			}
			onSalvo();
		} catch (e) {
			setErro(friendlyError(e));
		} finally { setBusy(false); }
	}

	return (
		<section className="rounded-2xl bg-white p-5" style={{ boxShadow: cardShadow }}>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h2 className="text-[16px] font-semibold text-[#1D1D1F]">{editando ? 'Editar resposta' : 'Nova resposta'}</h2>
				<button onClick={onFechar} className="text-[13px] font-medium text-[#6E6E73] hover:text-[#1D1D1F]">Cancelar</button>
			</div>

			<div className="space-y-4">
				<label className="block">
					<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Pergunta (como o cliente escreve, 5 a 200)</span>
					<textarea value={form.pergunta} onChange={e => set('pergunta', e.target.value)} rows={2} maxLength={200} className="w-full resize-none rounded-lg border border-[#D2D2D7] bg-white px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]" />
				</label>
				<label className="block">
					<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Resposta (até 1500, sem markdown)</span>
					<textarea value={form.resposta} onChange={e => set('resposta', e.target.value)} rows={5} maxLength={1500} className="w-full resize-none rounded-lg border border-[#D2D2D7] bg-white px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]" />
				</label>
				<div>
					<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Passos (até 6)</span>
					<div className="space-y-2">
						{form.passos.map((p, i) => (
							<div key={i} className="flex items-center gap-2">
								<span className="text-[12px] font-semibold text-[#8E8E93] tnum">{i + 1}.</span>
								<input value={p} onChange={e => set('passos', form.passos.map((x, j) => j === i ? e.target.value : x))} className="h-9 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]" />
								<button onClick={() => set('passos', form.passos.filter((_, j) => j !== i))} className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] hover:bg-[#F5F5F7]"><Trash2 size={13} /></button>
							</div>
						))}
						{form.passos.length < 6 && (
							<button onClick={() => set('passos', [...form.passos, ''])} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Plus size={13} /> Passo</button>
						)}
					</div>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Tela relacionada</span>
						<select value={form.tela} onChange={e => set('tela', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-2 text-[14px] outline-none focus:border-[#1D1D1F]">
							<option value="">Nenhuma</option>
							{ACOES_OPCOES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
						</select>
					</label>
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Frente</span>
						<select value={form.frente} onChange={e => set('frente', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-2 text-[14px] outline-none focus:border-[#1D1D1F]">
							{FRENTE_OPCOES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
						</select>
					</label>
				</div>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={form.ativa} onChange={e => set('ativa', e.target.checked)} className="h-4 w-4 accent-[#1D1D1F]" />
					<span className="text-[14px] text-[#1D1D1F]">Ativa</span>
				</label>
			</div>

			{dadoPessoal && <p className="mt-3 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">Sem dado pessoal nem preço na resposta.</p>}
			{erro && <p className="mt-3 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">{erro}</p>}
			<p className="mt-3 text-[13px] text-[#8E8E93]">Vale em até 1 minuto, sem publicar a função. Fica na Auditoria.</p>

			<div className="mt-4 flex justify-end gap-3">
				<button onClick={onFechar} className="h-9 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
				<button onClick={salvar} disabled={!podeSalvar} className="flex h-9 items-center gap-2 rounded-lg bg-[#1D1D1F] px-5 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy && <Loader2 size={13} className="animate-spin" />} Salvar</button>
			</div>
		</section>
	);
}

// ============================== SUGESTÕES ==============================

function SugestoesTab() {
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [novaTela, setNovaTela] = useState('');
	const [novaPergunta, setNovaPergunta] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true); setErro('');
		try {
			const { data, error } = await supabase.from('assistente_sugestoes').select('*').order('tela').order('ordem');
			if (error) throw error;
			setRows((data ?? []) as Row[]);
		} catch (e) {
			setErro(friendlyError(e));
			setRows([]);
		} finally { setLoading(false); }
	}
	useEffect(() => { void reload(); }, []);

	// Agrupa por tela.
	const grupos = useMemo(() => {
		const m = new Map<string, Row[]>();
		for (const r of rows) {
			const t = str(r, 'tela');
			if (!m.has(t)) m.set(t, []);
			m.get(t)!.push(r);
		}
		return Array.from(m.entries());
	}, [rows]);

	async function criar() {
		if (!supabase || !novaTela || novaPergunta.trim().length < 5) return;
		setErro('');
		try {
			const ativasTela = rows.filter(r => str(r, 'tela') === novaTela && r.ativo).length;
			if (ativasTela >= 3) { toast.error('Já há 3 sugestões ativas nesta tela.'); return; }
			const ordem = rows.filter(r => str(r, 'tela') === novaTela).length;
			const { error } = await supabase.from('assistente_sugestoes').insert({ tela: novaTela, pergunta: novaPergunta.trim(), ativo: true, ordem });
			if (error) throw error;
			setNovaPergunta(''); setNovaTela('');
			void reload();
		} catch (e) { setErro(friendlyError(e)); }
	}

	async function toggleAtiva(r: Row) {
		if (!supabase) return;
		setErro('');
		try {
			if (!r.ativo) {
				const ativasTela = rows.filter(x => str(x, 'tela') === str(r, 'tela') && x.ativo).length;
				if (ativasTela >= 3) { toast.error('Já há 3 sugestões ativas nesta tela.'); return; }
			}
			const { error } = await supabase.from('assistente_sugestoes').update({ ativo: !r.ativo }).eq('id', r.id);
			if (error) throw error;
			void reload();
		} catch (e) { setErro(friendlyError(e)); }
	}

	async function excluir(r: Row) {
		if (!supabase) return;
		try {
			const { error } = await supabase.from('assistente_sugestoes').delete().eq('id', r.id);
			if (error) throw error;
			void reload();
		} catch (e) { setErro(friendlyError(e)); }
	}

	async function mover(r: Row, dir: -1 | 1) {
		if (!supabase) return;
		const grupo = rows.filter(x => str(x, 'tela') === str(r, 'tela')).sort((a, b) => num(a, 'ordem') - num(b, 'ordem'));
		const idx = grupo.findIndex(x => x.id === r.id);
		const troca = grupo[idx + dir];
		if (!troca) return;
		try {
			await Promise.all([
				supabase.from('assistente_sugestoes').update({ ordem: num(r, 'ordem') }).eq('id', troca.id),
				supabase.from('assistente_sugestoes').update({ ordem: num(troca, 'ordem') }).eq('id', r.id),
			]);
			void reload();
		} catch (e) { setErro(friendlyError(e)); }
	}

	return (
		<div className="space-y-4">
			<p className="text-[13px] text-[#6E6E73]">Aparecem em “Nesta tela” na gaveta; tela sem sugestão própria usa as da tela de cima.</p>
			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{/* Nova sugestão */}
			<section className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
				<h2 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">Nova sugestão</h2>
				<div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
					<select value={novaTela} onChange={e => setNovaTela(e.target.value)} className="h-10 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[14px] outline-none focus:border-[#1D1D1F]">
						<option value="">Tela...</option>
						{TELAS_OPCOES.map(t => <option key={t.rota} value={t.rota}>{t.nome}</option>)}
					</select>
					<input value={novaPergunta} onChange={e => setNovaPergunta(e.target.value)} maxLength={120} placeholder="Pergunta (5 a 120)" className="h-10 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]" />
					<button onClick={criar} disabled={!novaTela || novaPergunta.trim().length < 5} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50"><Plus size={15} /> Adicionar</button>
				</div>
			</section>

			{loading ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				grupos.length === 0 ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Nenhuma sugestão ainda.</p> :
					<div className="space-y-4">
						{grupos.map(([tela, itens]) => {
							const ordenados = itens.sort((a, b) => num(a, 'ordem') - num(b, 'ordem'));
							const ativas = itens.filter(r => r.ativo).length;
							return (
								<section key={tela} className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
									<div className="mb-3 flex items-center justify-between gap-2">
										<h3 className="text-[15px] font-semibold text-[#1D1D1F]">{nomeTela(tela)}</h3>
										<span className="text-[12px] text-[#8E8E93] tnum">{ativas} de 3 ativas</span>
									</div>
									<div className="space-y-2">
										{ordenados.map((r, i) => (
											<div key={r.id} className="flex items-center gap-2 rounded-lg border border-[#F0F0F2] px-3 py-2">
												<div className="flex flex-col">
													<button onClick={() => mover(r, -1)} disabled={i === 0} className="grid h-4 w-5 place-items-center text-[#8E8E93] hover:text-[#1D1D1F] disabled:opacity-30"><ArrowUp size={13} /></button>
													<button onClick={() => mover(r, 1)} disabled={i === ordenados.length - 1} className="grid h-4 w-5 place-items-center text-[#8E8E93] hover:text-[#1D1D1F] disabled:opacity-30"><ArrowDown size={13} /></button>
												</div>
												<span className="flex-1 text-[14px] text-[#1D1D1F]">{str(r, 'pergunta')}</span>
												<button onClick={() => toggleAtiva(r)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.ativo ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{r.ativo ? 'Ativa' : 'Inativa'}</button>
												<button onClick={() => excluir(r)} className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] hover:bg-[#FFE8E6] hover:text-[#FF3B30]"><Trash2 size={14} /></button>
											</div>
										))}
									</div>
								</section>
							);
						})}
					</div>}
		</div>
	);
}
