import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
	ArrowLeft, MoreHorizontal, Send, CheckCircle2, RotateCcw, UserCheck,
	Clock, Inbox, Users as UsersIcon, Search, X, Radar as RadarIcon, StickyNote,
} from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { useAreaLabel } from '@/components/tema-provider';
import { CANAL_NOME, CANAL_COR } from '@/lib/mensageria';
import {
	RADAR_CLASSES, RADAR_ORDEM, mascararDestino,
} from '@/lib/mensageria-produtos';
import { ResponderGrupo } from '@/components/mensageria/responder-grupo';

/** Canais atendidos nesta caixa única. */
const CANAIS_ATEND = ['sms', 'rcs', 'whatsapp'] as const;

type Fila = 'abertas' | 'sem_resp' | 'minhas' | 'aguardando';

/** Rótulo da situação da conversa. */
function sitConversa(c: Row): string {
	if (c.situacao === 'resolvida') return 'Resolvida';
	if (c.situacao === 'aguardando') return 'Aguardando cliente';
	if (c.situacao === 'aberta' && !c.responsavel) return 'Nova';
	return 'Em atendimento';
}

/** Minutos desde espera_desde (ou null). */
function esperaMin(esperaDesde: unknown): number | null {
	if (!esperaDesde) return null;
	const t = new Date(String(esperaDesde)).getTime();
	if (isNaN(t)) return null;
	return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

/** Hora HH:MM no fuso de São Paulo. */
function horaSP(v: unknown): string {
	if (!v) return '';
	try {
		return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(String(v)));
	} catch { return ''; }
}

/** Primeiro nome de um nome completo. */
function primeiroNome(nome: unknown): string {
	const n = String(nome ?? '').trim();
	if (!n) return '—';
	return n.split(/\s+/)[0];
}

type TimelineItem = {
	id: string;
	tipo: 'msg' | 'nota' | 'evento';
	ts: number;
	raw: Row;
};

export function Atendimento() {
	const { perfil, empresa, permissoes } = useMotorAuth();
	const areaLabel = useAreaLabel();
	const [searchParams, setSearchParams] = useSearchParams();
	const canalParam = searchParams.get('canal');

	const canAct = permissoes.includes('enviar_mensagens');
	const podeEditar = permissoes.includes('editar_canais') || permissoes.includes('gerenciar_usuarios');

	const [conversas, setConversas] = useState<Row[]>([]);
	const [metaMin, setMetaMin] = useState<number | null>(null);
	const [selId, setSelId] = useState<string | null>(null);
	const [timeline, setTimeline] = useState<TimelineItem[]>([]);
	const [rapidas, setRapidas] = useState<Row[]>([]);
	const [colegas, setColegas] = useState<Row[]>([]);
	const [outras, setOutras] = useState<Row[]>([]);
	// ?filtro=sem_dono (Início › Para hoje): abre nas conversas sem responsável.
	const [fila, setFila] = useState<Fila>(searchParams.get('filtro') === 'sem_dono' ? 'sem_resp' : 'abertas');
	const [fCanal, setFCanal] = useState<string>(canalParam && CANAIS_ATEND.includes(canalParam as typeof CANAIS_ATEND[number]) ? canalParam : 'all');
	const [fClasse, setFClasse] = useState<string>('all');
	const [busca, setBusca] = useState('');
	const [texto, setTexto] = useState('');
	const [tipoResp, setTipoResp] = useState<'cliente' | 'nota'>('cliente');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [transferOpen, setTransferOpen] = useState(false);
	const [mobileConv, setMobileConv] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [loading, setLoading] = useState(true);
	const [grupoOpen, setGrupoOpen] = useState(false);

	// Largura da tela (para o layout responsivo).
	useEffect(() => {
		function onResize() { setIsMobile(window.innerWidth < 760); }
		onResize();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// Mapa de responsável id → nome.
	const userMap = useMemo(() => {
		const m: Record<string, string> = {};
		for (const c of colegas) m[String(c.id)] = String(c.nome ?? '');
		if (perfil) m[String(perfil.id)] = String(perfil.nome ?? '');
		return m;
	}, [colegas, perfil]);

	// --- Carregadores ---
	const loadConversas = useCallback(async () => {
		if (!supabase || !empresa) { setConversas([]); return; }
		const { data } = await supabase.from('mensageria_conversas')
			.select('*')
			.eq('empresa_id', empresa.id)
			.in('canal', [...CANAIS_ATEND])
			.order('ultima_em', { ascending: false })
			.limit(200);
		setConversas((data ?? []) as Row[]);
	}, [empresa?.id]);

	const loadConfig = useCallback(async () => {
		if (!supabase || !empresa) { setMetaMin(null); return; }
		const { data } = await supabase.from('mensageria_config')
			.select('meta_resposta_min')
			.eq('empresa_id', empresa.id)
			.maybeSingle();
		const v = (data as Row | null)?.meta_resposta_min;
		setMetaMin(v == null ? null : Number(v));
	}, [empresa?.id]);

	const loadRapidas = useCallback(async () => {
		if (!supabase || !empresa) { setRapidas([]); return; }
		const { data } = await supabase.from('mensageria_respostas_rapidas')
			.select('*')
			.eq('empresa_id', empresa.id)
			.eq('ativo', true)
			.order('classe', { ascending: true });
		setRapidas((data ?? []) as Row[]);
	}, [empresa?.id]);

	const loadColegas = useCallback(async () => {
		if (!supabase || !empresa || !perfil) { setColegas([]); return; }
		const { data } = await supabase.from('perfis')
			.select('id,nome')
			.eq('empresa_id', empresa.id)
			.eq('ativo', true)
			.neq('id', perfil.id)
			.order('nome');
		setColegas((data ?? []) as Row[]);
	}, [empresa?.id, perfil?.id]);

	const loadTimeline = useCallback(async () => {
		if (!supabase || !selId) { setTimeline([]); return; }
		const [m, n, e] = await Promise.all([
			supabase.from('mensageria_conversa_mensagens').select('*').eq('conversa_id', selId).order('id'),
			supabase.from('mensageria_conversa_notas').select('*').eq('conversa_id', selId).order('id'),
			supabase.from('mensageria_conversa_eventos').select('*').eq('conversa_id', selId).order('id'),
		]);
		const items: TimelineItem[] = [];
		for (const r of (m.data ?? []) as Row[]) items.push({ id: `m${r.id}`, tipo: 'msg', ts: tsOf(r.criado_em ?? r.enviado_em), raw: r });
		for (const r of (n.data ?? []) as Row[]) items.push({ id: `n${r.id}`, tipo: 'nota', ts: tsOf(r.criado_em), raw: r });
		for (const r of (e.data ?? []) as Row[]) items.push({ id: `e${r.id}`, tipo: 'evento', ts: tsOf(r.criado_em), raw: r });
		items.sort((a, b) => a.ts - b.ts);
		setTimeline(items);
	}, [selId]);

	const loadOutras = useCallback(async () => {
		if (!supabase || !selId) { setOutras([]); return; }
		const sel = conversas.find(c => c.id === selId);
		if (!sel || !empresa) { setOutras([]); return; }
		const { data } = await supabase.from('mensageria_conversas')
			.select('*')
			.eq('empresa_id', empresa.id)
			.eq('id_cliente', sel.id_cliente)
			.neq('id', selId)
			.order('ultima_em', { ascending: false })
			.limit(20);
		setOutras((data ?? []) as Row[]);
	}, [selId, conversas, empresa?.id]);

	function tsOf(v: unknown): number {
		if (!v) return 0;
		const t = new Date(String(v)).getTime();
		return isNaN(t) ? 0 : t;
	}

	// --- Abertura e marcação como lida ---
	async function abrir(id: string) {
		setSelId(id);
		setMobileConv(true);
		setErro('');
		if (supabase) {
			try { await supabase.rpc('atualizar_conversa', { conversa: id, acao: 'lida' }); } catch { /* ignora */ }
		}
		void loadConversas();
	}

	// --- Ações ---
	async function acao(acao: 'assumir' | 'resolver' | 'reabrir' | 'aguardando') {
		if (!supabase || !selId) return;
		setErro('');
		const { error } = await supabase.rpc('atualizar_conversa', { conversa: selId, acao });
		if (error) { setErro(friendlyError(error)); return; }
		void loadConversas();
	}

	async function reclassificar(classe: string) {
		if (!supabase || !selId) return;
		setErro('');
		const { error } = await supabase.rpc('atualizar_conversa', { conversa: selId, acao: 'reclassificar', classe });
		if (error) { setErro(friendlyError(error)); return; }
		void loadConversas(); void loadTimeline();
	}

	async function enviar() {
		if (!supabase || !selId) return;
		if (tipoResp === 'cliente') {
			if (!texto.trim()) return;
			setBusy(true); setErro('');
			const { error } = await supabase.rpc('responder_conversa', { conversa: selId, texto: texto.trim() });
			setBusy(false);
			if (error) { setErro(friendlyError(error)); return; }
		} else {
			if (!texto.trim()) return;
			setBusy(true); setErro('');
			const { error } = await supabase.rpc('anotar_conversa', { conversa: selId, texto: texto.trim() });
			setBusy(false);
			if (error) { setErro(friendlyError(error)); return; }
		}
		setTexto('');
		void loadTimeline(); void loadConversas();
	}

	// --- Efeitos de carga inicial ---
	useEffect(() => {
		if (!empresa) { setLoading(false); return; }
		setLoading(true);
		void Promise.all([loadConversas(), loadConfig(), loadRapidas(), loadColegas()]).finally(() => setLoading(false));
	}, [loadConversas, loadConfig, loadRapidas, loadColegas, empresa?.id]);

	useEffect(() => { void loadTimeline(); }, [loadTimeline]);
	useEffect(() => { void loadOutras(); }, [loadOutras]);

	// --- Atualização a cada 15 s e ao voltar à aba ---
	useEffect(() => {
		function tick() {
			if (document.visibilityState !== 'visible') return;
			void loadConversas();
			if (selId) void loadTimeline();
		}
		const id = window.setInterval(tick, 15000);
		function onVis() { if (document.visibilityState === 'visible') tick(); }
		document.addEventListener('visibilitychange', onVis);
		return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
	}, [loadConversas, loadTimeline, selId]);

	// --- Filtro e ordenação da fila ---
	const filtradas = useMemo(() => {
		let list = conversas;
		if (fila === 'abertas') list = list.filter(c => c.situacao === 'aberta');
		else if (fila === 'sem_resp') list = list.filter(c => c.situacao === 'aberta' && !c.responsavel);
		else if (fila === 'minhas') list = list.filter(c => c.responsavel === perfil?.id && c.situacao !== 'resolvida');
		else if (fila === 'aguardando') list = list.filter(c => c.situacao === 'aguardando');
		if (fCanal !== 'all') list = list.filter(c => c.canal === fCanal);
		if (fClasse !== 'all') list = list.filter(c => c.classe === fClasse);
		if (busca.trim()) list = list.filter(c => String(c.id_cliente ?? '').toLowerCase().includes(busca.trim().toLowerCase()));
		// Ordem: cpc_negocio e alega_pagamento primeiro, depois espera_desde mais antiga, depois ultima_em.
		const prioridade = (cl: string) => (cl === 'cpc_negocio' ? 0 : cl === 'alega_pagamento' ? 1 : 2);
		return [...list].sort((a, b) => {
			const pa = prioridade(String(a.classe ?? ''));
			const pb = prioridade(String(b.classe ?? ''));
			if (pa !== pb) return pa - pb;
			const ea = tsOf(a.espera_desde) || 0;
			const eb = tsOf(b.espera_desde) || 0;
			if (ea !== eb) return ea - eb;
			return tsOf(a.ultima_em) - tsOf(b.ultima_em);
		});
	}, [conversas, fila, fCanal, fClasse, busca, perfil?.id]);

	const contagens = useMemo(() => ({
		abertas: conversas.filter(c => c.situacao === 'aberta').length,
		sem_resp: conversas.filter(c => c.situacao === 'aberta' && !c.responsavel).length,
		minhas: conversas.filter(c => c.responsavel === perfil?.id && c.situacao !== 'resolvida').length,
		aguardando: conversas.filter(c => c.situacao === 'aguardando').length,
	}), [conversas, perfil?.id]);

	// Conversas abertas sem resposta nossa do filtro (até 200) para o Responder em grupo.
	const grupoIds = useMemo(() => filtradas.filter(c => c.situacao === 'aberta').slice(0, 200).map(c => String(c.id)), [filtradas]);
	const grupoTemSms = useMemo(() => filtradas.some(c => c.situacao === 'aberta' && c.canal === 'sms'), [filtradas]);

	const sel = conversas.find(c => c.id === selId) ?? null;
	const selCanal = sel ? String(sel.canal) : '';
	const semVars = texto.replace(/\{\{[^}]+\}\}/g, '');
	const limiteChar = selCanal === 'sms' ? 160 : 1000;

	// Respostas rápidas: as da classe da conversa primeiro, até 4; depois "Mais".
	const rapidasOrdenadas = useMemo(() => {
		if (!sel) return rapidas;
		const cl = String(sel.classe ?? '');
		const daClasse = rapidas.filter(r => r.classe === cl);
		const demais = rapidas.filter(r => r.classe !== cl);
		return [...daClasse, ...demais];
	}, [rapidas, sel]);
	const [maisRapidas, setMaisRapidas] = useState(false);
	const rapidasVisiveis = maisRapidas ? rapidasOrdenadas : rapidasOrdenadas.slice(0, 4);

	// Tela travada para quem não tem enviar_mensagens.
	if (!canAct) {
		return (
			<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
				<div className="mb-6">
					<span className="mc-area-tag mb-1.5">{areaLabel}</span>
					<h1 className="mc-page-title text-[28px] font-bold leading-tight tracking-tight text-[#1D1D1F]">Caixa de atendimento</h1>
					<p className="mt-1 text-[14px] text-[#6E6E73]">{empresa?.nome ?? '—'} · SMS, RCS e WhatsApp</p>
				</div>
				<div className="mc-halo rounded-2xl bg-[#F5F5F7] px-6 py-16 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<Inbox className="mx-auto mb-4 text-[#8E8E93]" size={36} />
					<p className="text-[15px] text-[#1D1D1F]">Só quem pode enviar mensagens atende as conversas.</p>
					<p className="mt-1 text-[13px] text-[#8E8E93]">Fale com o Admin da sua empresa para liberar o acesso.</p>
				</div>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
				<div className="flex items-center gap-3 py-16 text-[14px] text-[#6E6E73]"><Clock className="animate-pulse" /> Carregando a caixa de atendimento...</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
			{/* Cabeçalho */}
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<span className="mc-area-tag mb-1.5">{areaLabel}</span>
					<h1 className="mc-page-title text-[28px] font-bold leading-tight tracking-tight text-[#1D1D1F]">Caixa de atendimento</h1>
					<p className="mt-1 text-[14px] text-[#6E6E73]">{empresa?.nome ?? '—'} · SMS, RCS e WhatsApp · atualiza a cada 15 s</p>
				</div>
			</div>

			{erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			<div className={`grid gap-4 ${isMobile && mobileConv ? 'grid-cols-1' : 'min-[760px]:grid-cols-[320px_1fr] min-[1180px]:grid-cols-[320px_1fr_300px]'}`}>
				{/* Coluna da fila */}
				<aside className={`${isMobile && mobileConv ? 'hidden' : ''} min-[760px]:block`}>
					<FilaCol
						conversas={filtradas}
						contagens={contagens}
						fila={fila}
						setFila={setFila}
						fCanal={fCanal}
						setFCanal={setFCanal}
						fClasse={fClasse}
						setFClasse={setFClasse}
						busca={busca}
						setBusca={setBusca}
						selId={selId}
						onAbrir={abrir}
						metaMin={metaMin}
						userMap={userMap}
						perfilId={perfil?.id}
						grupoCount={grupoIds.length}
						onResponderGrupo={() => setGrupoOpen(true)}
					/>
				</aside>

				{/* Coluna da conversa */}
				<section className={`${isMobile && !mobileConv ? 'hidden' : ''} min-[760px]:block`}>
					{isMobile && (
						<button onClick={() => setMobileConv(false)} className="mb-2 inline-flex items-center gap-1 text-[14px] font-medium text-[#0A60D0]"><ArrowLeft size={16} /> Voltar</button>
					)}
					<ConversaCol
						sel={sel}
						userMap={userMap}
						perfilId={perfil?.id}
						timeline={timeline}
						onAcao={acao}
						onReclassificar={reclassificar}
						onTransferir={() => setTransferOpen(true)}
						tipoResp={tipoResp}
						setTipoResp={setTipoResp}
						texto={texto}
						setTexto={setTexto}
						semVars={semVars}
						limiteChar={limiteChar}
						selCanal={selCanal}
						rapidasVisiveis={rapidasVisiveis}
						rapidasOrdenadas={rapidasOrdenadas}
						maisRapidas={maisRapidas}
						setMaisRapidas={setMaisRapidas}
						podeEditar={podeEditar}
						busy={busy}
						onEnviar={enviar}
					/>
				</section>

				{/* Painel do cliente (some abaixo de 1180 px) */}
				<aside className="hidden min-[1180px]:block">
					<PainelCliente sel={sel} outras={outras} onAbrir={abrir} />
				</aside>
			</div>

			{transferOpen && sel && (
				<TransferirModal
					colegas={colegas}
					selId={sel.id}
					onClose={() => setTransferOpen(false)}
					onDone={() => { setTransferOpen(false); void loadConversas(); void loadTimeline(); }}
				/>
			)}

			{grupoOpen && (
				<ResponderGrupo
					ids={grupoIds}
					temSms={grupoTemSms}
					onClose={() => setGrupoOpen(false)}
					onDone={() => { setGrupoOpen(false); void loadConversas(); }}
				/>
			)}
		</div>
	);
}

// ============================================================
// Coluna da fila
// ============================================================
function FilaCol(props: {
	conversas: Row[];
	contagens: Record<Fila, number>;
	fila: Fila;
	setFila: (f: Fila) => void;
	fCanal: string;
	setFCanal: (v: string) => void;
	fClasse: string;
	setFClasse: (v: string) => void;
	busca: string;
	setBusca: (v: string) => void;
	selId: string | null;
	onAbrir: (id: string) => void;
	metaMin: number | null;
	userMap: Record<string, string>;
	perfilId?: string;
	grupoCount: number;
	onResponderGrupo: () => void;
}) {
	const { conversas, contagens, fila, setFila, fCanal, setFCanal, fClasse, setFClasse, busca, setBusca, selId, onAbrir, metaMin, userMap, perfilId, grupoCount, onResponderGrupo } = props;
	const abas: { id: Fila; label: string }[] = [
		{ id: 'abertas', label: 'Abertas' },
		{ id: 'sem_resp', label: 'Sem resp.' },
		{ id: 'minhas', label: 'Minhas' },
		{ id: 'aguardando', label: 'Aguardando' },
	];
	return (
		<div className="rounded-2xl bg-white p-3" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			{/* Responder em grupo (só com filtro de classe ativo) */}
			{fClasse !== 'all' && (
				<button onClick={onResponderGrupo} disabled={grupoCount === 0} className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1D1D1F] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50 hover:opacity-85">
					<UsersIcon size={14} /> Responder em grupo{grupoCount > 0 ? ` · ${grupoCount}` : ''}
				</button>
			)}
			{/* Abas com contagem */}
			<div className="mb-2 grid grid-cols-4 gap-1">
				{abas.map(a => (
					<button key={a.id} onClick={() => setFila(a.id)} className={`rounded-lg px-1 py-1.5 text-center text-[11px] font-semibold transition ${fila === a.id ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#6E6E73] hover:bg-[#E8E8ED]'}`}>
						<span className="block leading-tight">{a.label}</span>
						<span className="block tnum text-[13px]">{contagens[a.id]}</span>
					</button>
				))}
			</div>

			{/* Filtros */}
			<div className="mb-2 space-y-1.5">
				<div className="flex gap-1.5">
					<select value={fCanal} onChange={e => setFCanal(e.target.value)} className="h-8 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[12px] outline-none">
						<option value="all">Todos os canais</option>
						<option value="sms">SMS</option>
						<option value="rcs">RCS</option>
						<option value="whatsapp">WhatsApp</option>
					</select>
					<select value={fClasse} onChange={e => setFClasse(e.target.value)} className="h-8 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[12px] outline-none">
						<option value="all">Todas as classes</option>
						{RADAR_ORDEM.map(cl => <option key={cl} value={cl}>{RADAR_CLASSES[cl].label}</option>)}
					</select>
				</div>
				<div className="relative">
					<Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
					<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por ID do cliente" className="h-8 w-full rounded-lg border border-[#D2D2D7] bg-white pl-8 pr-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
				</div>
			</div>

			{/* Lista */}
			<div className="max-h-[calc(100dvh-280px)] space-y-0.5 overflow-y-auto">
				{conversas.length === 0 ? (
					<p className="py-8 text-center text-[13px] text-[#8E8E93]">Nenhuma conversa nesta fila.</p>
				) : conversas.map(c => {
					const info = RADAR_CLASSES[String(c.classe ?? '')] ?? { label: String(c.classe ?? '—'), cor: '#8E8E93' };
					const esp = esperaMin(c.espera_desde);
					const naoLidas = Number(c.nao_lidas ?? 0);
					const respNome = c.responsavel ? (userMap[String(c.responsavel)] ?? String(c.responsavel_nome ?? '')) : '';
					const ehMinha = c.responsavel === perfilId;
					// Cor da espera.
					let espCor = '#8E8E93';
					if (metaMin != null && esp != null) {
						if (esp >= metaMin * 2) espCor = '#FF3B30';
						else if (esp >= metaMin) espCor = '#FF9500';
					}
					return (
						<button key={c.id} onClick={() => onAbrir(c.id)} className={`flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition ${selId === c.id ? 'bg-[#F5F5F7]' : 'hover:bg-[#F5F5F7]'}`}>
							<div className="flex items-center justify-between gap-1.5">
								<span className="flex items-center gap-1.5 truncate text-[13px] font-bold text-[#1D1D1F]">
									{naoLidas > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-[#0A60D0]" />}
									<span className="truncate">{c.destino_mascara ?? mascararDestino('')}</span>
								</span>
								<span className="shrink-0 text-[11px] text-[#8E8E93] tnum">{horaSP(c.ultima_em)}</span>
							</div>
							<div className="flex items-center gap-1.5">
								<span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: CANAL_COR[String(c.canal ?? '')] ?? '#8E8E93' }}>{CANAL_NOME[String(c.canal ?? '')] ?? c.canal}</span>
								<span className="text-[11px] font-medium" style={{ color: info.cor }}>{info.label}</span>
								{c.confianca != null && <span className="text-[10px] text-[#8E8E93]">{Math.round(Number(c.confianca) * 100)}%</span>}
								{esp != null && <span className="text-[10px] font-medium" style={{ color: metaMin != null ? espCor : '#8E8E93' }}>esperando {esp} min</span>}
							</div>
							<div className="flex items-center justify-between gap-1.5">
								<span className="truncate text-[11px] text-[#6E6E73]">{ultimaLinha(c)}</span>
								<span className="shrink-0 text-[10px] font-semibold" style={{ color: ehMinha ? '#248A3D' : respNome ? '#6E6E73' : '#0A60D0' }}>
									{!c.responsavel ? 'Nova' : ehMinha ? 'com você' : primeiroNome(respNome)}
								</span>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** Última mensagem de uma conversa (procura no campo ultima_msg / ultima_mensagem). */
function ultimaLinha(c: Row): string {
	const v = c.ultima_msg ?? c.ultima_mensagem ?? c.ultima_texto;
	if (v) return String(v);
	return String(c.id_cliente ?? '');
}

// ============================================================
// Coluna da conversa
// ============================================================
function ConversaCol(props: {
	sel: Row | null;
	userMap: Record<string, string>;
	perfilId?: string;
	timeline: TimelineItem[];
	onAcao: (a: 'assumir' | 'resolver' | 'reabrir' | 'aguardando') => void;
	onReclassificar: (classe: string) => void;
	onTransferir: () => void;
	tipoResp: 'cliente' | 'nota';
	setTipoResp: (v: 'cliente' | 'nota') => void;
	texto: string;
	setTexto: (v: string) => void;
	semVars: string;
	limiteChar: number;
	selCanal: string;
	rapidasVisiveis: Row[];
	rapidasOrdenadas: Row[];
	maisRapidas: boolean;
	setMaisRapidas: (v: boolean) => void;
	podeEditar: boolean;
	busy: boolean;
	onEnviar: () => void;
}) {
	const { sel, userMap, perfilId, timeline, onAcao, onReclassificar, onTransferir, tipoResp, setTipoResp, texto, setTexto, semVars, limiteChar, selCanal, rapidasVisiveis, rapidasOrdenadas, maisRapidas, setMaisRapidas, podeEditar, busy, onEnviar } = props;
	const [maisOpen, setMaisOpen] = useState(false);
	const maisRef = useRef<HTMLDivElement>(null);

	// Fecha o menu "Mais" ao clicar fora.
	useEffect(() => {
		if (!maisOpen) return;
		function onClick(e: MouseEvent) { if (maisRef.current && !maisRef.current.contains(e.target as Node)) setMaisOpen(false); }
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMaisOpen(false); }
		document.addEventListener('mousedown', onClick);
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
	}, [maisOpen]);

	if (!sel) {
		return (
			<div className="grid h-full min-h-[400px] place-items-center rounded-2xl bg-white p-8 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div>
					<Inbox className="mx-auto mb-3 text-[#8E8E93]" size={32} />
					<p className="text-[14px] text-[#6E6E73]">Selecione uma conversa à esquerda para atender.</p>
				</div>
			</div>
		);
	}

	const info = RADAR_CLASSES[String(sel.classe ?? '')] ?? { label: String(sel.classe ?? '—'), cor: '#8E8E93' };
	const respNome = sel.responsavel ? (userMap[String(sel.responsavel)] ?? String(sel.responsavel_nome ?? '')) : '';
	const ehMinha = sel.responsavel === perfilId;
	const resolvida = sel.situacao === 'resolvida';

	return (
		<div className="flex h-full flex-col rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			{/* Topo */}
			<div className="border-b border-[#E5E5EA] p-4">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="truncate text-[16px] font-bold text-[#1D1D1F]">{sel.destino_mascara ?? mascararDestino('')}</span>
							<span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: CANAL_COR[String(sel.canal ?? '')] ?? '#8E8E93' }}>{CANAL_NOME[String(sel.canal ?? '')] ?? sel.canal}</span>
							<span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: info.cor }}>{info.label}</span>
						</div>
						<p className="mt-0.5 truncate text-[12px] text-[#8E8E93] tnum">ID {sel.id_cliente ?? '—'}{sel.campanha ? ` · ${sel.campanha}` : ''} · {sitConversa(sel)}</p>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						{!sel.responsavel ? (
							<button onClick={() => onAcao('assumir')} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 text-[12px] font-medium text-white hover:opacity-85"><UserCheck size={13} /> Assumir</button>
						) : (
							<span className="text-[12px] text-[#6E6E73]">{ehMinha ? 'com você' : `com ${primeiroNome(respNome)}`}</span>
						)}
						<div className="relative" ref={maisRef}>
							<button onClick={() => setMaisOpen(!maisOpen)} aria-label="Mais ações" className="grid h-8 w-8 place-items-center rounded-full text-[#6E6E73] hover:bg-[#F5F5F7]"><MoreHorizontal size={16} /></button>
							{maisOpen && (
								<div className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-xl bg-white py-1 text-[#1D1D1F]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 12px 40px -8px rgba(0,0,0,.3)' }}>
									<button onClick={onTransferir} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#F5F5F7]"><UsersIcon size={14} /> Transferir para colega</button>
									<div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">Corrigir a classe</div>
									<div className="max-h-48 overflow-y-auto">
										{RADAR_ORDEM.map(cl => (
											<button key={cl} onClick={() => { setMaisOpen(false); onReclassificar(cl); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[#F5F5F7] ${sel.classe === cl ? 'font-semibold' : ''}`}>
												<span className="h-2 w-2 rounded-full" style={{ backgroundColor: RADAR_CLASSES[cl].cor }} /> {RADAR_CLASSES[cl].label}
											</button>
										))}
									</div>
									<div className="my-1 border-t border-[#E5E5EA]" />
									<button onClick={() => { setMaisOpen(false); onAcao('aguardando'); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#F5F5F7]"><Clock size={14} /> Marcar “Aguardando cliente”</button>
								</div>
							)}
						</div>
						{resolvida ? (
							<button onClick={() => onAcao('reabrir')} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><RotateCcw size={13} /> Reabrir</button>
						) : (
							<button onClick={() => onAcao('resolver')} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#34C759] px-3 text-[12px] font-medium text-white hover:opacity-85"><CheckCircle2 size={13} /> Resolver</button>
						)}
					</div>
				</div>
			</div>

			{/* Linha do tempo */}
			<div className="flex-1 space-y-2 overflow-y-auto p-4" style={{ maxHeight: 'calc(100dvh - 360px)' }}>
				{timeline.length === 0 ? (
					<p className="py-8 text-center text-[13px] text-[#8E8E93]">Sem mensagens ainda.</p>
				) : timeline.map(item => <TimelineRow key={item.id} item={item} userMap={userMap} />)}
			</div>

			{/* Responder */}
			<div className="border-t border-[#E5E5EA] p-3">
				<div className="mb-2 flex rounded-[10px] bg-[#F5F5F7] p-1">
					<button onClick={() => setTipoResp('cliente')} className={`flex-1 rounded-[8px] py-1.5 text-[12px] font-medium transition ${tipoResp === 'cliente' ? 'bg-white text-[#1D1D1F] font-semibold' : 'text-[#6E6E73]'}`}>Responder ao cliente</button>
					<button onClick={() => setTipoResp('nota')} className={`flex-1 rounded-[8px] py-1.5 text-[12px] font-medium transition ${tipoResp === 'nota' ? 'bg-white text-[#1D1D1F] font-semibold' : 'text-[#6E6E73]'}`}>Nota interna</button>
				</div>

				{tipoResp === 'cliente' && (
					<div className="mb-2 flex flex-wrap gap-1.5">
						{rapidasOrdenadas.length === 0 ? (
							<p className="text-[12px] text-[#8E8E93]">Sem respostas rápidas. {podeEditar && <a href={`/mensageria/${selCanal}/config`} className="text-[#0A60D0] hover:underline">Criar em Configurar</a>}</p>
						) : (
							<>
								{rapidasVisiveis.map(r => (
									<button key={r.id} onClick={() => setTexto(String(r.texto ?? ''))} className="rounded-full border border-[#D2D2D7] px-2.5 py-1 text-[12px] text-[#1D1D1F] hover:bg-[#F5F5F7]">{String(r.nome ?? r.texto ?? '').slice(0, 30)}</button>
								))}
								{rapidasOrdenadas.length > 4 && (
									<button onClick={() => setMaisRapidas(!maisRapidas)} className="rounded-full px-2.5 py-1 text-[12px] font-medium text-[#0A60D0] hover:underline">{maisRapidas ? 'Menos' : 'Mais'}</button>
								)}
							</>
						)}
					</div>
				)}

				{tipoResp === 'nota' && (
					<p className="mb-2 rounded-lg border border-dashed border-[#FFE08A] bg-[#FFF8E1] px-2.5 py-1.5 text-[11px] text-[#9a631b]"><StickyNote size={11} className="mr-1 inline" /> Só a equipe da empresa vê. Não vai para o cliente.</p>
				)}

				<textarea
					value={texto}
					onChange={e => setTexto(e.target.value)}
					rows={2}
					placeholder={tipoResp === 'nota' ? 'Escreva uma nota interna...' : 'Digite a resposta...'}
					className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40"
				/>
				<div className="mt-2 flex items-center justify-between gap-2">
					<span className="text-[11px] text-[#8E8E93]">
						{tipoResp === 'cliente' ? (
							selCanal === 'sms' ? `Sai como SMS, no preço do SMS · ${semVars.length}/${limiteChar}` : selCanal === 'rcs' ? 'Sai como RCS · cobrada por mensagem' : selCanal === 'whatsapp' ? 'Sai como WhatsApp' : `${semVars.length}/${limiteChar}`
						) : 'Nota interna'}
					</span>
					<button onClick={onEnviar} disabled={busy || !texto.trim()} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white disabled:opacity-50 hover:opacity-85"><Send size={14} /> Enviar</button>
				</div>
			</div>
		</div>
	);
}

function TimelineRow({ item, userMap }: { item: TimelineItem; userMap: Record<string, string> }) {
	const r = item.raw;
	if (item.tipo === 'evento') {
		return (
			<div className="flex items-center justify-center">
				<span className="rounded-full bg-[#F5F5F7] px-3 py-1 text-[11px] text-[#8E8E93]">{String(r.texto ?? r.descricao ?? '')}</span>
			</div>
		);
	}
	if (item.tipo === 'nota') {
		return (
			<div className="flex justify-center">
				<div className="max-w-[80%] rounded-xl border border-dashed border-[#FFE08A] bg-[#FFF8E1] px-3 py-2">
					<div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#9a631b]"><StickyNote size={11} /> Nota interna · {primeiroNome(userMap[String(r.autor ?? r.autor_id ?? '')] ?? r.autor_nome)}</div>
					<p className="whitespace-pre-wrap text-[13px] text-[#1D1D1F]">{String(r.texto ?? '')}</p>
					<p className="mt-0.5 text-[10px] text-[#9a631b]">{horaSP(r.criado_em)}</p>
				</div>
			</div>
		);
	}
	// mensagem
	const isOut = r.direcao === 'saida';
	const info = r.classe ? RADAR_CLASSES[String(r.classe)] : null;
	return (
		<div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
			<div className={`max-w-[78%] rounded-2xl px-3 py-2 ${isOut ? 'text-[#1D1D1F]' : 'bg-[#F5F5F7] text-[#1D1D1F]'}`} style={isOut ? { backgroundColor: 'color-mix(in srgb, var(--area) 14%, var(--base-cartao))' } : undefined}>
				{!isOut && info && <span className="mb-1 block text-[11px] font-semibold" style={{ color: info.cor }}>{info.label}{r.confianca != null ? ` · ${Math.round(Number(r.confianca) * 100)}%` : ''}</span>}
				<p className="whitespace-pre-wrap text-[14px] leading-snug">{String(r.texto ?? '')}</p>
				{!isOut && r.justificativa && <p className="mt-1 flex items-center gap-1 text-[11px] text-[#6E6E73]"><RadarIcon size={10} /> Radar: {String(r.justificativa)}</p>}
				{!isOut && r.origem_radar && <p className="mt-0.5 text-[10px] text-[#8E8E93]">{r.origem_radar === 'ia' ? 'IA' : 'Regras'}</p>}
				{isOut && (
					<p className="mt-1 text-[10px] text-[#8E8E93]">
						{r.estado === 'pendente' ? 'Na fila' : r.estado === 'enviada' ? 'Enviada' : `Não enviada: ${r.motivo ?? ''}`}
						{r.autor_nome || r.respondida_por ? ` · ${primeiroNome(r.autor_nome ?? r.respondida_por)}` : ''}
					</p>
				)}
				<p className={`mt-0.5 text-[10px] ${isOut ? 'text-[#8E8E93]' : 'text-[#8E8E93]'}`}>{horaSP(r.criado_em ?? r.enviado_em)}</p>
			</div>
		</div>
	);
}

// ============================================================
// Painel do cliente
// ============================================================
function PainelCliente({ sel, outras, onAbrir }: { sel: Row | null; outras: Row[]; onAbrir: (id: string) => void }) {
	if (!sel) {
		return (
			<div className="rounded-2xl bg-white p-4 text-center text-[13px] text-[#8E8E93]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				Selecione uma conversa.
			</div>
		);
	}
	const info = RADAR_CLASSES[String(sel.classe ?? '')] ?? { label: String(sel.classe ?? '—'), cor: '#8E8E93' };
	const origem = sel.origem === 'ia' ? 'IA' : sel.origem === 'regras' ? 'Regras' : (sel.origem_radar === 'ia' ? 'IA' : 'Regras');
	return (
		<div className="space-y-3">
			<div className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Cliente</h3>
				<dl className="space-y-1.5 text-[13px]">
					<Linha label="ID" value={String(sel.id_cliente ?? '—')} />
					<Linha label="Número" value={String(sel.destino_mascara ?? mascararDestino(''))} />
					<Linha label="Campanha" value={String(sel.campanha ?? '—')} />
					<Linha label="Canal" value={CANAL_NOME[String(sel.canal ?? '')] ?? String(sel.canal ?? '—')} />
					{sel.canal === 'rcs' && sel.sessao_ate && <Linha label="Sessão RCS" value={`até ${horaSP(sel.sessao_ate)}`} />}
				</dl>
			</div>

			<div className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Classe pelo Radar</h3>
				<div className="flex items-center gap-2">
					<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: info.cor }} />
					<span className="text-[14px] font-semibold" style={{ color: info.cor }}>{info.label}</span>
					{sel.confianca != null && <span className="text-[12px] text-[#8E8E93]">{Math.round(Number(sel.confianca) * 100)}% de confiança</span>}
				</div>
				<p className="mt-1 text-[12px] text-[#8E8E93]">Origem: {origem}</p>
			</div>

			<div className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Outras conversas deste cliente</h3>
				{outras.length === 0 ? (
					<p className="text-[12px] text-[#8E8E93]">Nenhuma em outro canal.</p>
				) : (
					<div className="space-y-1">
						{outras.map(c => {
							const ci = RADAR_CLASSES[String(c.classe ?? '')] ?? { label: String(c.classe ?? '—'), cor: '#8E8E93' };
							return (
								<button key={c.id} onClick={() => onAbrir(c.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[#F5F5F7]">
									<span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: CANAL_COR[String(c.canal ?? '')] ?? '#8E8E93' }}>{CANAL_NOME[String(c.canal ?? '')] ?? c.canal}</span>
									<span className="flex-1 truncate text-[12px] text-[#1D1D1F]">{ci.label}</span>
									<span className="text-[11px] text-[#8E8E93] tnum">{horaSP(c.ultima_em)}</span>
								</button>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function Linha({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<dt className="text-[#8E8E93]">{label}</dt>
			<dd className="truncate text-right font-medium text-[#1D1D1F]">{value}</dd>
		</div>
	);
}

// ============================================================
// Modal de transferência
// ============================================================
function TransferirModal({ colegas, selId, onClose, onDone }: { colegas: Row[]; selId: string; onClose: () => void; onDone: () => void }) {
	const [colega, setColega] = useState('');
	const [nota, setNota] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	async function transferir() {
		if (!supabase || !colega) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('transferir_conversa', { conversa: selId, colega, nota: nota.trim() || null });
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		onDone();
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
			<div className="w-full max-w-[420px] rounded-2xl bg-white p-5" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Transferir conversa</h2>
					<button onClick={onClose} className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={18} /></button>
				</div>
				<label className="mb-1 block text-[13px] font-medium text-[#1D1D1F]">Colega</label>
				<select value={colega} onChange={e => setColega(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
					<option value="">Escolha um colega</option>
					{colegas.map(c => <option key={c.id} value={c.id}>{String(c.nome)}</option>)}
				</select>
				{colegas.length === 0 && <p className="mt-1 text-[12px] text-[#8E8E93]">Nenhum colega com permissão de envio nesta empresa.</p>}
				<label className="mb-1 mt-3 block text-[13px] font-medium text-[#1D1D1F]">Nota (opcional)</label>
				<textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} placeholder="Contexto para o colega..." className="w-full rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
				{erro && <p className="mt-2 text-[13px] text-[#FF3B30]">{erro}</p>}
				<div className="mt-4 flex justify-end gap-2">
					<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
					<button onClick={transferir} disabled={busy || !colega} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">Transferir</button>
				</div>
			</div>
		</div>
	);
}
