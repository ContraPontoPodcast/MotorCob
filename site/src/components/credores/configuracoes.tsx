import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Check, Copy, FileWarning, Settings, X } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading, useAllowed, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateBR, friendlyError, supabase, type Credor, type Row } from '@/lib/supabase';
import { toastError, ErrorDetail } from '@/components/error-detail';
import { AbCalendario } from '@/components/credores/calendario';
import { AbCanais, type CanalCodigo as CanalCodigoRow } from '@/components/credores/aba-canais';

type TipoArquivo = 'ocorrencia' | 'acordo' | 'baixa';
type MapeamentoArquivo = {
	id: string; empresa_id: string; credor_id: string; tipo: TipoArquivo;
	colunas: Record<string, string> | null; confirmado: boolean;
	sugerido: Record<string, string> | null; cabecalho: string[] | null;
	arquivo: string | null; visto_em: string | null; atualizado_em: string | null;
};
type ResultadoOcorrencia = 'cpc' | 'sem_contato' | 'terceiro' | 'opt_out';
type OcorrenciaCodigo = {
	id: string; empresa_id: string; credor_id: string; codigo: string;
	resultado: ResultadoOcorrencia | null; mapeado: boolean; sugerido: string | null;
	qtd: number; primeira_vez: string | null; ultima_vez: string | null; atualizado_em: string | null;
};

type CampoDef = { key: string; label: string; short: string; required: boolean; ident?: boolean };
const CAMPOS: Record<TipoArquivo, CampoDef[]> = {
	ocorrencia: [
		{ key: 'id_cliente', label: 'Cliente (código, contrato ou CPF)', short: 'Cliente', required: true },
		{ key: 'data', label: 'Data da ação', short: 'Data', required: true },
		{ key: 'resultado', label: 'Resultado/ocorrência', short: 'Resultado', required: true },
		{ key: 'canal', label: 'Canal', short: 'Canal', required: false },
		{ key: 'contato', label: 'Telefone/e-mail acionado', short: 'Contato', required: false },
	],
	acordo: [
		{ key: 'id_cliente', label: 'Cliente', short: 'Cliente', required: false, ident: true },
		{ key: 'id_contrato', label: 'Contrato', short: 'Contrato', required: false, ident: true },
		{ key: 'id_acordo', label: 'Número do acordo', short: 'Acordo', required: false },
		{ key: 'parcela', label: 'Parcela', short: 'Parcela', required: true },
		{ key: 'vencimento', label: 'Vencimento', short: 'Vencimento', required: true },
		{ key: 'valor', label: 'Valor da parcela', short: 'Valor', required: false },
	],
	baixa: [
		{ key: 'id_cliente', label: 'Cliente', short: 'Cliente', required: false, ident: true },
		{ key: 'id_contrato', label: 'Contrato', short: 'Contrato', required: false, ident: true },
		{ key: 'data', label: 'Data do pagamento', short: 'Data', required: true },
		{ key: 'valor', label: 'Valor pago', short: 'Valor', required: true },
		{ key: 'id_acordo', label: 'Número do acordo', short: 'Acordo', required: false },
		{ key: 'parcela', label: 'Parcela', short: 'Parcela', required: false },
		{ key: 'tipo', label: 'Tipo (quitação/parcial/parcela)', short: 'Tipo', required: false },
	],
};
const TIPO_LABEL: Record<TipoArquivo, string> = { ocorrencia: 'Ocorrência', acordo: 'Acordo', baixa: 'Pagamento' };
const SUGERIDO_LABEL: Record<string, string> = { cpc: 'CPC', terceiro: 'Número errado', opt_out: 'Não contatar', sem_contato: 'Sem contato', invalido: 'Número inválido (layout fixo; marque)', promessa: 'Promessa (layout fixo)', recusa: 'Recusa (layout fixo)', recado: 'Recado (layout fixo)' };
// Marcas que o banco aceita (ocorrencia_codigos.resultado). Sugestão fora delas (vinda do layout fixo do repositório,
// ex.: invalido, promessa) é só informação: não é aceita com um clique, o cliente marca.
const RESULTADOS_VALIDOS: readonly ResultadoOcorrencia[] = ['cpc', 'sem_contato', 'terceiro', 'opt_out'];
function sugestaoAceitavel(s: string | null): ResultadoOcorrencia | null {
	if (s == null) return 'sem_contato';
	return (RESULTADOS_VALIDOS as readonly string[]).includes(s) ? (s as ResultadoOcorrencia) : null;
}
const RESULTADO_OPTS: { value: 'cpc' | 'terceiro' | 'opt_out'; label: string }[] = [
	{ value: 'cpc', label: 'CPC' },
	{ value: 'terceiro', label: 'Número errado / de outra pessoa' },
	{ value: 'opt_out', label: 'Não contatar (opt-out)' },
];

const nowISO = () => new Date().toISOString();

export function CredorConfiguracoes() {
	const { empresa } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [searchParams] = useSearchParams();
	const params = useParams();
	const codigo = params.codigo ?? '';
	const tabParam = searchParams.get('tab');
	const [tab, setTab] = useState<'arquivos' | 'ocorrencias' | 'canais' | 'calendario'>(tabParam === 'ocorrencias' ? 'ocorrencias' : tabParam === 'canais' ? 'canais' : tabParam === 'calendario' ? 'calendario' : 'arquivos');
	const [credor, setCredor] = useState<Credor | null>(null);
	const [mapeamentos, setMapeamentos] = useState<MapeamentoArquivo[]>([]);
	const [codigos, setCodigos] = useState<OcorrenciaCodigo[]>([]);
	const [canalCodigos, setCanalCodigos] = useState<CanalCodigoRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [copyOpen, setCopyOpen] = useState(false);
	const [estrategias, setEstrategias] = useState<{ id: string; nome: string; padrao: boolean }[]>([]);
	const [estrBusy, setEstrBusy] = useState(false);
	const podeEditarCredores = usePermissao('editar_credores');

	async function reload() {
		if (!supabase || !empresa || !codigo) return;
		setLoading(true); setError('');
		const { data: cred, error: cerr } = await supabase.from('credores').select('*').eq('empresa_id', empresa.id).eq('codigo', codigo).maybeSingle();
		if (cerr) { setError(friendlyError()); setLoading(false); return; }
		setCredor(cred as Credor | null);
		if (!cred) { setMapeamentos([]); setCodigos([]); setLoading(false); return; }
		const cid = (cred as Credor).id;
		const [m, o, cc, es] = await Promise.all([
			supabase.from('mapeamento_arquivos').select('*').eq('credor_id', cid).order('tipo'),
			supabase.from('ocorrencia_codigos').select('*').eq('credor_id', cid),
			supabase.from('canal_codigos').select('*').eq('credor_id', cid),
			supabase.from('estrategias').select('id,nome,padrao,frente').eq('empresa_id', empresa.id).order('nome'),
		]);
		if (m.error || o.error || cc.error || es.error) { setError(friendlyError()); setLoading(false); return; }
		setMapeamentos((m.data ?? []) as MapeamentoArquivo[]);
		setCodigos((o.data ?? []) as OcorrenciaCodigo[]);
		setCanalCodigos((cc.data ?? []) as CanalCodigoRow[]);
		setEstrategias(((es.data ?? []) as Row[]).filter(r => r.frente !== 'motorcli') as unknown as { id: string; nome: string; padrao: boolean }[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id, codigo]);

	async function salvarEstrategiaCarteira(estrategiaId: string) {
		if (!supabase || !credor) return;
		setEstrBusy(true);
		const { error } = await supabase.from('credores').update({ estrategia_id: estrategiaId || null }).eq('id', credor.id);
		if (error) { toast.error(friendlyError(error)); setEstrBusy(false); return; }
		toast.success('Estratégia padrão da carteira atualizada · vale a partir da próxima lista.');
		setEstrBusy(false);
		void reload();
	}

	const pendenciasArquivos = mapeamentos.filter(m => !m.tipo.startsWith('canal_') && !m.confirmado).length;
	const pendenciasCodigos = codigos.filter(c => !c.mapeado).length;
	const pendenciasCanaisMap = mapeamentos.filter(m => m.tipo.startsWith('canal_') && !m.confirmado).length;
	const pendenciasCanaisCod = canalCodigos.filter(c => !c.mapeado).length;
	const pendenciasCanais = pendenciasCanaisMap + pendenciasCanaisCod;
	const totalPendencias = pendenciasArquivos + pendenciasCodigos + pendenciasCanais;

	if (!empresa) return <><PageHeading eyebrow="CONFIGURAÇÃO / CARTEIRAS" title="Configurações" description="Aponte as colunas e marque os CPCs." /><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (loading) return <><PageHeading eyebrow="CONFIGURAÇÃO / CARTEIRAS" title="Configurações" description="Aponte as colunas e marque os CPCs." /><Loading /></>;
	if (!credor) return <><PageHeading eyebrow="CONFIGURAÇÃO / CARTEIRAS" title="Configurações" description="Aponte as colunas e marque os CPCs." /><Notice>Credor não encontrado.</Notice></>;

	return (
		<div>
			<div className="mb-5 flex items-center gap-2 text-sm">
				<Link to="/credores" className="flex items-center gap-1 text-[#0F4C5C] hover:underline"><ArrowLeft size={15} /> Carteiras</Link>
				<span className="text-slate-300">/</span>
				<span className="font-semibold text-[#163943]">{credor.nome}</span>
			</div>
			<PageHeading
				eyebrow="CONFIGURAÇÃO / CARTEIRAS"
				title={`Configurações · ${credor.nome}`}
				description="Aponte, uma vez, para quais colunas o MotorCX olha nos arquivos e marque quais resultados de ocorrência são CPC."
				actions={canEdit ? <button onClick={() => setCopyOpen(true)} className="flex h-11 items-center gap-2 rounded-lg border border-[#0F4C5C] px-5 text-sm font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Copy size={16} /> Copiar de outra carteira</button> : null}
			/>
		<div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#dfe8ea] bg-white px-5 py-4">
			<span className="text-sm font-semibold text-[#163943]">Estratégia padrão da carteira</span>
			{podeEditarCredores ? (
				<select value={credor.estrategia_id ?? ''} onChange={e => salvarEstrategiaCarteira(e.target.value)} disabled={estrBusy} className="h-9 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:opacity-50">
					<option value="">Padrão da empresa</option>
					{estrategias.map(es => <option key={es.id} value={es.id}>{es.nome}</option>)}
				</select>
			) : (
				<span className="text-sm text-slate-600">{credor.estrategia_id ? (estrategias.find(e => e.id === credor.estrategia_id)?.nome ?? '—') : `Padrão da empresa${estrategias.find(e => e.padrao) ? ` (${estrategias.find(e => e.padrao)!.nome})` : ''}`}</span>
			)}
			<span className="text-xs text-slate-400">Vale para os segmentos desta carteira sem estratégia própria e para Demais clientes. Sem ela, vale o padrão da empresa.</span>
		</div>
			{totalPendencias > 0 && <div className="mb-6"><Notice variant="warning">{totalPendencias} pendência{totalPendencias > 1 ? 's' : ''} aguardando: {pendenciasArquivos > 0 && `${pendenciasArquivos} mapeamento${pendenciasArquivos > 1 ? 's' : ''} de arquivo`}{pendenciasArquivos > 0 && pendenciasCodigos > 0 && ' · '}{pendenciasCodigos > 0 && `${pendenciasCodigos} resultado${pendenciasCodigos > 1 ? 's' : ''} de ocorrência`}{(pendenciasArquivos > 0 || pendenciasCodigos > 0) && pendenciasCanais > 0 && ' · '}{pendenciasCanais > 0 && `${pendenciasCanais} de canal`}</Notice></div>}
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			<div className="mb-6 flex gap-1 border-b border-[#e5edef]">
				<button onClick={() => setTab('arquivos')} className={`rounded-t-lg px-5 py-2.5 text-sm font-semibold transition-colors ${tab === 'arquivos' ? 'border-b-2 border-[#0F4C5C] text-[#0F4C5C]' : 'text-slate-500 hover:text-[#0F4C5C]'}`}>Arquivos {pendenciasArquivos > 0 && <span className="ml-1 rounded-full bg-[#e9a23b] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendenciasArquivos}</span>}</button>
				<button onClick={() => setTab('ocorrencias')} className={`rounded-t-lg px-5 py-2.5 text-sm font-semibold transition-colors ${tab === 'ocorrencias' ? 'border-b-2 border-[#0F4C5C] text-[#0F4C5C]' : 'text-slate-500 hover:text-[#0F4C5C]'}`}>Ocorrências {pendenciasCodigos > 0 && <span className="ml-1 rounded-full bg-[#e9a23b] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendenciasCodigos}</span>}</button>
			<button onClick={() => setTab('canais')} className={`rounded-t-lg px-5 py-2.5 text-sm font-semibold transition-colors ${tab === 'canais' ? 'border-b-2 border-[#0F4C5C] text-[#0F4C5C]' : 'text-slate-500 hover:text-[#0F4C5C]'}`}>Canais {pendenciasCanais > 0 && <span className="ml-1 rounded-full bg-[#e9a23b] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendenciasCanais}</span>}</button>
				<button onClick={() => setTab('calendario')} className={`rounded-t-lg px-5 py-2.5 text-sm font-semibold transition-colors ${tab === 'calendario' ? 'border-b-2 border-[#0F4C5C] text-[#0F4C5C]' : 'text-slate-500 hover:text-[#0F4C5C]'}`}>Calendário</button>
			</div>

			{tab === 'arquivos'
				? <AbArquivos credor={credor} mapeamentos={mapeamentos} canEdit={canEdit} onSaved={() => void reload()} />
				: tab === 'ocorrencias'
				? <AbOcorrencias credor={credor} codigos={codigos} canEdit={canEdit} setCodigos={setCodigos} onSaved={() => void reload()} />
				: tab === 'canais'
				? <AbCanais credor={credor} mapeamentos={mapeamentos} canalCodigos={canalCodigos} canEdit={canEdit} onSaved={() => void reload()} />
				: <AbCalendario credor={credor} canEdit={canEdit} onSaved={() => void reload()} />}

			{copyOpen && <CopiarDialog credorAtual={credor} onClose={() => setCopyOpen(false)} onDone={(nome) => { setCopyOpen(false); toast.success(`Configurações copiadas de ${nome}`); void reload(); }} />}
		</div>
	);
}

function AbArquivos({ credor, mapeamentos, canEdit, onSaved }: {
	credor: Credor; mapeamentos: MapeamentoArquivo[]; canEdit: boolean; onSaved: () => void;
}) {
	const tipos: TipoArquivo[] = ['ocorrencia', 'acordo', 'baixa'];
	return (
		<div className="space-y-5">
			{tipos.map(tipo => {
				const m = mapeamentos.find(x => x.tipo === tipo) ?? null;
				return <CartaoArquivo key={tipo} credor={credor} tipo={tipo} mapeamento={m} canEdit={canEdit} onSaved={onSaved} />;
			})}
		</div>
	);
}

function CartaoArquivo({ credor, tipo, mapeamento, canEdit, onSaved }: {
	credor: Credor; tipo: TipoArquivo; mapeamento: MapeamentoArquivo | null; canEdit: boolean; onSaved: () => void;
}) {
	const campos = CAMPOS[tipo];
	const [editing, setEditing] = useState(!mapeamento?.confirmado);
	const [vals, setVals] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState('');

	useEffect(() => {
		if (!mapeamento) { setVals({}); setEditing(true); return; }
		const src = mapeamento.confirmado ? (mapeamento.colunas ?? {}) : (mapeamento.sugerido ?? mapeamento.colunas ?? {});
		const v: Record<string, string> = {};
		campos.forEach(c => { v[c.key] = (src as Record<string, string>)?.[c.key] ?? ''; });
		setVals(v);
		setEditing(!mapeamento.confirmado);
		setErr('');
	}, [mapeamento?.id, mapeamento?.confirmado]);

	const cabecalho = mapeamento?.cabecalho ?? [];
	const confirmado = mapeamento?.confirmado === true;

	function setVal(key: string, value: string) { setVals(prev => ({ ...prev, [key]: value })); }

	async function confirmar() {
		if (!supabase || !mapeamento) return;
		setErr('');
		const preenchidos: Record<string, string> = {};
		for (const c of campos) { const v = vals[c.key]?.trim(); if (v) preenchidos[c.key] = v; }
		for (const c of campos) { if (c.required && !preenchidos[c.key]) { setErr(`"${c.label}" é obrigatório.`); return; } }
		const idents = campos.filter(c => c.ident);
		if (idents.length && !idents.some(c => preenchidos[c.key])) { setErr('Informe pelo menos o Cliente ou o Contrato.'); return; }
		const used = Object.values(preenchidos);
		if (new Set(used).size !== used.length) { setErr('Uma coluna não pode ser usada em dois campos.'); return; }
		setBusy(true);
		const { error } = await supabase.from('mapeamento_arquivos').update({ colunas: preenchidos, confirmado: true, atualizado_em: nowISO() }).eq('id', mapeamento.id);
		if (error) { setErr(friendlyError()); setBusy(false); return; }
		toast.success('Colunas confirmadas · o MotorCX processa os arquivos em até 1 minuto');
		setBusy(false);
		onSaved();
	}

	const resumo = useMemo(() => {
		if (!mapeamento?.colunas) return '';
		return campos.filter(c => mapeamento.colunas![c.key]).map(c => `${c.short} = ${mapeamento.colunas![c.key]}`).join(' · ');
	}, [mapeamento, campos]);

	return (
		<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<h3 className="text-base font-semibold text-[#163943]">{TIPO_LABEL[tipo]}</h3>
					{mapeamento ? (confirmado
						? <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-bold text-[#2E7D32]"><Check size={12} /> Confirmado</span>
						: <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3df] px-2.5 py-0.5 text-[11px] font-bold text-[#9a631b]"><FileWarning size={12} /> Aguardando mapeamento — os arquivos esperam até você confirmar</span>)
					: null}
				</div>
				{mapeamento?.arquivo && <span className="text-xs text-slate-500">Último arquivo: <strong className="font-medium text-slate-600">{mapeamento.arquivo}</strong></span>}
			</div>

			{!mapeamento ? (
				<p className="rounded-lg bg-[#f5f8f9] px-4 py-5 text-sm text-slate-400">Ainda não chegou arquivo de {TIPO_LABEL[tipo].toLowerCase()}. Envie o primeiro em <Link to="/envios" className="font-semibold text-[#0F4C5C] underline">Enviar arquivos</Link> e volte aqui para apontar as colunas.</p>
			) : confirmado && !editing ? (
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-slate-600">{resumo || 'Nenhuma coluna apontada.'}</p>
					{canEdit && <button onClick={() => setEditing(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]">Alterar</button>}
				</div>
			) : (
				<div className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						{campos.map(c => {
							const val = vals[c.key] ?? '';
							const isSugestao = !confirmado && mapeamento?.sugerido?.[c.key] && val === mapeamento.sugerido[c.key];
							return (
								<div key={c.key}>
									<label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-600">
										{c.label}{c.required && <span className="text-[#C62828]">*</span>}{c.ident && !c.required && <span className="text-[10px] font-normal text-slate-400">(um destes)</span>}
										{isSugestao && <span className="text-[10px] font-normal italic text-slate-400">sugestão do MotorCX</span>}
									</label>
									<select value={val} disabled={!canEdit} onChange={e => setVal(c.key, e.target.value)} className="h-10 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]">
										<option value="">{c.required ? '— escolha a coluna —' : '— não tem —'}</option>
										{cabecalho.map(col => <option key={col} value={col}>{col}</option>)}
									</select>
								</div>
							);
						})}
					</div>
					{err && <p role="alert" className="text-sm text-[#C62828]">{err}</p>}
					{err && <ErrorDetail/>}
					{canEdit && (
						<div className="flex justify-end">
							<button onClick={confirmar} disabled={busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Confirmando...' : 'Confirmar colunas'}</button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}

function AbOcorrencias({ credor, codigos, canEdit, setCodigos, onSaved }: {
	credor: Credor; codigos: OcorrenciaCodigo[]; canEdit: boolean; setCodigos: React.Dispatch<React.SetStateAction<OcorrenciaCodigo[]>>; onSaved: () => void;
}) {
	const [busyId, setBusyId] = useState('');
	const [aceitando, setAceitando] = useState(false);

	const ordenados = useMemo(() => {
		return [...codigos].sort((a, b) => {
			if (a.mapeado !== b.mapeado) return a.mapeado ? 1 : -1;
			return b.qtd - a.qtd;
		});
	}, [codigos]);

	const nCpc = codigos.filter(c => c.resultado === 'cpc').length;
	const nNovos = codigos.filter(c => !c.mapeado).length;

	async function marcar(oc: OcorrenciaCodigo, resultado: 'cpc' | 'terceiro' | 'opt_out') {
		if (!supabase) return;
		const novo: ResultadoOcorrencia = oc.resultado === resultado ? 'sem_contato' : resultado;
		setCodigos(prev => prev.map(c => c.id === oc.id ? { ...c, resultado: novo, mapeado: true } : c));
		setBusyId(oc.id);
		const { error } = await supabase.from('ocorrencia_codigos').update({ resultado: novo, mapeado: true, atualizado_em: nowISO() }).eq('id', oc.id);
		if (error) { toastError(error); onSaved(); }
		setBusyId('');
	}

	async function aceitarSugestao(oc: OcorrenciaCodigo) {
		if (!supabase) return;
		const novo = sugestaoAceitavel(oc.sugerido);
		if (!novo) return;
		setCodigos(prev => prev.map(c => c.id === oc.id ? { ...c, resultado: novo, mapeado: true } : c));
		setBusyId(oc.id);
		const { error } = await supabase.from('ocorrencia_codigos').update({ resultado: novo, mapeado: true, atualizado_em: nowISO() }).eq('id', oc.id);
		if (error) { toastError(error); onSaved(); }
		setBusyId('');
	}

	async function aceitarTodosNovos() {
		if (!supabase) return;
		const novos = codigos.filter(c => !c.mapeado && sugestaoAceitavel(c.sugerido));
		if (!novos.length) return;
		if (!window.confirm(`Aceitar a sugestão do MotorCX para os ${novos.length} resultados novos?`)) return;
		setAceitando(true);
		for (const oc of novos) {
			const novo = sugestaoAceitavel(oc.sugerido) ?? 'sem_contato';
			const { error } = await supabase.from('ocorrencia_codigos').update({ resultado: novo, mapeado: true, atualizado_em: nowISO() }).eq('id', oc.id);
			if (error) { toastError(error); break; }
		}
		setAceitando(false);
		onSaved();
	}

	return (
		<div className="space-y-5">
			<div className="rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]">
				<p>Marque o que cada resultado significa. Sem marca = não é CPC (sem contato). Feito uma vez, vale para os próximos arquivos; resultado novo aparece aqui com o selo <strong>NOVO</strong> e as linhas dele esperam até você marcar.</p>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-slate-600"><strong>{codigos.length}</strong> resultados · <strong className="text-[#2E7D32]">{nCpc}</strong> contam como CPC{nNovos > 0 && <> · <strong className="text-[#9a631b]">{nNovos}</strong> novos para marcar</>}</p>
				{canEdit && nNovos > 0 && <button onClick={aceitarTodosNovos} disabled={aceitando} className="flex h-10 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3] disabled:opacity-50">{aceitando ? 'Aceitando...' : 'Aceitar as sugestões dos novos'}</button>}
			</div>

			{codigos.length === 0 ? <Empty>Nenhum resultado de ocorrência chegou ainda para este credor.</Empty> :
				<div className="overflow-x-auto rounded-xl border border-[#dfe8ea] bg-white">
					<table className="w-full min-w-[760px] text-left text-sm">
						<thead className="border-b border-[#e5edef] text-xs text-slate-400">
							<tr>
								<th className="px-4 py-3 font-medium">Resultado</th>
								<th className="px-4 py-3 font-medium">Linhas · Primeira · Última</th>
								<th className="px-4 py-3 font-medium">Sugestão do MotorCX</th>
								<th className="px-4 py-3 font-medium">Marca</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[#ecf0f1]">
							{ordenados.map(oc => (
								<tr key={oc.id} className={oc.mapeado ? '' : 'bg-[#fffbf0]'}>
									<td className="px-4 py-3">
										<div className="flex items-center gap-2">
											<span className="font-semibold text-[#163943]">{oc.codigo}</span>
											{!oc.mapeado && <span className="rounded-full bg-[#e9a23b] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Novo</span>}
										</div>
									</td>
									<td className="px-4 py-3 text-xs text-slate-500">
										<span className="font-semibold text-slate-600">{oc.qtd}</span> linhas
										<span className="block">Primeira: {dateBR(oc.primeira_vez)}</span>
										<span className="block">Última: {dateBR(oc.ultima_vez)}</span>
									</td>
									<td className="px-4 py-3 text-xs text-slate-400">{oc.sugerido ? SUGERIDO_LABEL[oc.sugerido] ?? oc.sugerido : '—'}</td>
									<td className="px-4 py-3">
										<div className="flex flex-wrap items-center gap-3">
											{RESULTADO_OPTS.map(opt => (
												<label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-xs">
													<input type="checkbox" checked={oc.resultado === opt.value} disabled={!canEdit || busyId === oc.id} onChange={() => marcar(oc, opt.value)} className="accent-[#0F4C5C]" />
													{opt.label}
												</label>
											))}
											{!oc.mapeado && canEdit && sugestaoAceitavel(oc.sugerido) && (
												<button onClick={() => aceitarSugestao(oc)} disabled={busyId === oc.id} className="text-xs font-semibold text-[#0F4C5C] underline hover:text-[#0d4252] disabled:opacity-50">aceitar sugestão</button>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>}
		</div>
	);
}

function CopiarDialog({ credorAtual, onClose, onDone }: {
	credorAtual: Credor; onClose: () => void; onDone: (nomeOrigem: string) => void;
}) {
	const { empresa, credores } = useMotorAuth();
	const [origemId, setOrigemId] = useState('');
	const [preview, setPreview] = useState<{ map: number; cod: number } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const origens = credores.filter(c => c.id !== credorAtual.id);

	useEffect(() => {
		if (!origemId || !supabase || !empresa) { setPreview(null); return; }
		let active = true;
		(async () => {
			const [m, o] = await Promise.all([
				supabase.from('mapeamento_arquivos').select('id', { count: 'exact', head: true }).eq('credor_id', origemId).eq('confirmado', true).not('tipo', 'like', 'canal_%'),
				supabase.from('ocorrencia_codigos').select('id', { count: 'exact', head: true }).eq('credor_id', origemId).eq('mapeado', true),
			]);
			if (!active) return;
			setPreview({ map: m.count ?? 0, cod: o.count ?? 0 });
		})();
		return () => { active = false; };
	}, [origemId, empresa?.id]);

	async function confirmar() {
		if (!supabase || !empresa || !origemId) return;
		setBusy(true); setError('');
		const origem = credores.find(c => c.id === origemId);
		const [m, o] = await Promise.all([
			supabase.from('mapeamento_arquivos').select('*').eq('credor_id', origemId).eq('confirmado', true).not('tipo', 'like', 'canal_%'),
			supabase.from('ocorrencia_codigos').select('*').eq('credor_id', origemId).eq('mapeado', true),
		]);
		if (m.error || o.error) { setError(friendlyError()); setBusy(false); return; }
		const mapRows = (m.data ?? []) as MapeamentoArquivo[];
		const codRows = (o.data ?? []) as OcorrenciaCodigo[];
		if (mapRows.length) {
			const toUpsert = mapRows.map(r => ({ empresa_id: empresa.id, credor_id: credorAtual.id, tipo: r.tipo, colunas: r.colunas, confirmado: true, atualizado_em: nowISO() }));
			const { error: me } = await supabase.from('mapeamento_arquivos').upsert(toUpsert, { onConflict: 'empresa_id,credor_id,tipo' });
			if (me) { setError(friendlyError()); setBusy(false); return; }
		}
		if (codRows.length) {
			const toUpsert = codRows.map(r => ({ empresa_id: empresa.id, credor_id: credorAtual.id, codigo: r.codigo, resultado: r.resultado, mapeado: true, atualizado_em: nowISO() }));
			const { error: oe } = await supabase.from('ocorrencia_codigos').upsert(toUpsert, { onConflict: 'empresa_id,credor_id,codigo' });
			if (oe) { setError(friendlyError()); setBusy(false); return; }
		}
		setBusy(false);
		onDone(origem?.nome ?? '');
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between">
					<h2 className="text-lg font-semibold">Copiar de outra carteira</h2>
					<button onClick={onClose} aria-label="Fechar"><X size={20} /></button>
				</div>
				<p className="mb-4 text-xs text-slate-500">Copia os mapeamentos confirmados e os resultados marcados do credor de origem para <strong>{credorAtual.nome}</strong>. Não apaga nada do credor atual.</p>
				{origens.length === 0 ? <p className="text-sm text-slate-500">Não há outros credores nesta empresa.</p> : <>
					<label className="mb-2 block text-xs font-semibold">Credor de origem</label>
					<select value={origemId} onChange={e => setOrigemId(e.target.value)} className="mb-4 h-11 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="">— escolha o credor —</option>
						{origens.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
					</select>
					{preview && <p className="mb-4 rounded-lg bg-[#f5f8f9] px-4 py-3 text-sm text-slate-600">{preview.map} mapeamento{preview.map !== 1 ? 's' : ''} de arquivo e {preview.cod} resultado{preview.cod !== 1 ? 's' : ''} de ocorrência</p>}
					{error && <p role="alert" className="mb-4 text-sm text-[#C62828]">{error}</p>}
					{error && <ErrorDetail/>}
					<div className="flex justify-end gap-3">
						<button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
						<button onClick={confirmar} disabled={!origemId || busy || (preview !== null && preview.map === 0 && preview.cod === 0)} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Copiando...' : 'Confirmar'}</button>
					</div>
				</>}
			</div>
		</div>
	);
}
