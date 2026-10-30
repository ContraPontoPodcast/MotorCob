import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, Copy, Grid3x3, Pencil, Plus, Printer, RotateCcw, X } from 'lucide-react';
import { Empty, Loading, Notice, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, numberBR, supabase, type Cluster, type Credor, type PersonaUsuario, type Row, type SegmentoCarteira, type SegmentoEmUso } from '@/lib/supabase';
import { definicaoVazia, gerarIdEtapa, isFaseId, isVazia, migrarEtapas, ordemStages, playbookDefinicao, validarEtapas, type Definicao, type Estrategia, type Etapa } from '@/lib/estrategia';
import { fetchPropensaoCarteira, carteiraColetando, type LinhaPropensaoCarteira } from '@/lib/propensao';
import { Info } from '@/components/glossario/info';
import { removerMensagensCanaisSemMensagem } from '@/lib/mensagem-dia';
import { DesenhoDaEsteira } from '@/components/estrategias/desenho-esteira';
import { LeaveGuardDialog } from '@/components/estrategias/leave-guard-dialog';
import { ClusterForm, type Coluna } from '@/components/clusters/cluster-form';
import { ReenquadramentoButton, type ReenquadramentoHandle } from '@/components/reenquadramento/reenquadramento-button';
import { PersonasDaCarteira, limparPersonas, normalizarDefinicao } from '@/components/orquestracao/personas-carteira';
import { ExportarButton } from '@/components/estrategias/exportar-button';
import { computarResumoFicha } from '@/components/estrategias/ficha-estrategia';
import { EstagiosEditor } from '@/components/orquestracao/estagios-editor';
import { EtapaReguaEditor } from '@/components/orquestracao/etapa-regua-editor';
import { TravasTabela } from '@/components/orquestracao/travas-tabela';
import { VisaoGeral } from '@/components/orquestracao/visao-geral';
import { ReguaTopo, type EstagioId } from '@/components/orquestracao/regua-topo';
import { UsarReguaModal, copiarReguaEstagio } from '@/components/orquestracao/usar-regua-modal';
import { EscolhaCarteira } from '@/components/escolha-carteira';
import { CopiarCarteiraModal } from '@/components/orquestracao/copiar-carteira-modal';
import { TresCaminhos, CopiarSegmentoModal } from '@/components/orquestracao/tres-caminhos';
import { ModelosModal } from '@/components/estrategias/modelos-modal';
import { PassosBar, type PassoId, type PassoState } from '@/components/orquestracao/passos-bar';

const calculadoLabel: Record<string, string> = { saldo: 'Saldo total', dias_atraso: 'Dias de atraso', qtd_contratos: 'Quantidade de contratos' };
const opPhrase: Record<string, string> = { '=': 'é', '!=': 'é diferente de', '>': '>', '>=': '≥', '<': '<', '<=': '≤', em: 'está entre', nao_em: 'não está entre', contem: 'contém', vazio: 'está vazio', preenchido: 'está preenchido' };

function condFrase(c: Cluster | null): string {
	if (!c || !c.condicoes || c.condicoes.length === 0) return 'Sem condições (vale para todos)';
	const label = (campo: string) => calculadoLabel[campo] ?? campo;
	const valStr = (v: unknown) => Array.isArray(v) ? v.join(', ') : String(v ?? '');
	return c.condicoes.map(cd => {
		const op = opPhrase[cd.op] ?? cd.op;
		if (cd.op === 'vazio' || cd.op === 'preenchido') return `${label(cd.campo)} ${op}`;
		return `${label(cd.campo)} ${op} ${valStr(cd.valor)}`;
	}).join(' e ');
}

function travasResumo(def: Definicao): string {
	const t = def.travas ?? {};
	const parts: string[] = [];
	if (t.acoes_dia != null) parts.push(`${t.acoes_dia} ações/dia`);
	if (t.intervalo_horas != null) parts.push(`intervalo ${t.intervalo_horas}h`);
	if (t.de || t.ate) parts.push(`horário ${t.de ?? '—'}–${t.ate ?? '—'}`);
	if (t.discador != null) parts.push(`discador ${t.discador ? 'liberado' : 'bloqueado'}`);
	return parts.length ? parts.join(' · ') : 'Sem travas próprias (segue as faixas de segurança)';
}

export function Orquestracao() {
	const { empresa, credor, credores, selectCredor } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [segmentos, setSegmentos] = useState<SegmentoEmUso[]>([]);
	const [clustersMap, setClustersMap] = useState<Record<string, Cluster>>({});
	const [estrategias, setEstrategias] = useState<Estrategia[]>([]);
	const [colunas, setColunas] = useState<Coluna[]>([]);
	const [personasUsuario, setPersonasUsuario] = useState<PersonaUsuario[]>([]);
	const [contagens, setContagens] = useState<Record<string, number>>({});
	const [semPersona, setSemPersona] = useState(0);
	const [semEstagio, setSemEstagio] = useState(0);
	const [semEstagioSeg, setSemEstagioSeg] = useState(0);
	const [modelosMap, setModelosMap] = useState<Record<string, string[]>>({});
	const [montarOpen, setMontarOpen] = useState(false);
	const [searchParams, setSearchParams] = useSearchParams();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState('');
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Cluster | null>(null);
	const [estagioAtivo, setEstagioAtivo] = useState<EstagioId>('localizacao');
	const [etapaReguaId, setEtapaReguaId] = useState<string | null>(null);
	const [usarReguaOpen, setUsarReguaOpen] = useState(false);
	const [guardarModelo, setGuardarModelo] = useState(false);
	const [travasOpen, setTravasOpen] = useState(false);
	const [forma, setForma] = useState<'raias' | 'fluxo'>(() => {
		if (typeof window === 'undefined') return 'raias';
		try { return localStorage.getItem('mc-orq-forma') === 'fluxo' ? 'fluxo' : 'raias'; } catch { return 'raias'; }
	});
	useEffect(() => { try { localStorage.setItem('mc-orq-forma', forma); } catch { /* noop */ } }, [forma]);
	const [copiarOpen, setCopiarOpen] = useState(false);
	const [modelosOpen, setModelosOpen] = useState(false);
	const [copiarSegOpen, setCopiarSegOpen] = useState(false);
	const [maisOpen, setMaisOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [detalheOpen, setDetalheOpen] = useState(false);
	const [pausadosOpen, setPausadosOpen] = useState(false);

	// carteiras que usam o segmento
	const [carteiras, setCarteiras] = useState<Record<string, { usa: boolean; ativo: boolean }>>({});
	const [cartDirty, setCartDirty] = useState(false);
	const [savingCart, setSavingCart] = useState(false);
	const [matrixOpen, setMatrixOpen] = useState(false);
	const [enqRows, setEnqRows] = useState<Row[]>([]);
	const [demaisAtivo, setDemaisAtivo] = useState(true);

	// editor de estratégia
	const [def, setDef] = useState<Definicao>({});
	// Definição carregada do banco (após migrar "janela"): base para preservar chaves
	// que a tela não mostra (ex.: recencia_horas, whatsapp, calendario) ao salvar.
	const [defCarregada, setDefCarregada] = useState<Definicao>({});
	const [propensaoRows, setPropensaoRows] = useState<LinhaPropensaoCarteira[] | null>(null);
	const [propensaoExec, setPropensaoExec] = useState<import('@/lib/execucao').ResumoExecucao | null>(null);
	const [propensaoError, setPropensaoError] = useState('');
	const [estrNome, setEstrNome] = useState('');
	const [estrId, setEstrId] = useState<string | null>(null);
	const [estrDirty, setEstrDirty] = useState(false);
	const [savingEstr, setSavingEstr] = useState(false);
	const [estrError, setEstrError] = useState('');
	const [pendingSegment, setPendingSegment] = useState<string | null>(null);
	const [copiaPendente, setCopiaPendente] = useState(false);
	const [compartilhada, setCompartilhada] = useState(false);
	const [copiadoDe, setCopiadoDe] = useState<string | null>(null);
	const blocker = useBlocker(({ currentLocation, nextLocation }) => estrDirty && currentLocation.pathname !== nextLocation.pathname);
	const reenqRef = useRef<ReenquadramentoHandle>(null);
	const routeBlocked = blocker.state === 'blocked';
	const leaveOpen = routeBlocked || pendingSegment !== null;

	// Medição da barra da Orquestração para grudar a paleta do editor logo abaixo.
	const barRef = useRef<HTMLDivElement>(null);
	const [barH, setBarH] = useState(0);
	const [isDesktop, setIsDesktop] = useState(false);
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(min-width: 1024px)');
		const update = () => setIsDesktop(mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	}, []);
	useEffect(() => {
		if (!barRef.current || typeof ResizeObserver === 'undefined') return;
		const el = barRef.current;
		const ro = new ResizeObserver(() => { setBarH(el.offsetHeight); });
		ro.observe(el);
		setBarH(el.offsetHeight);
		return () => ro.disconnect();
	}, []);
	const stickyTop = isDesktop ? 44 + barH : 44;

	function selecionar(id: string) {
		if (estrDirty) { setPendingSegment(id); return; }
		setSelectedId(id);
	}

	async function leaveSalvar() {
		const ok = await salvarEstrategia();
		if (!ok) { if (routeBlocked) blocker.reset(); setPendingSegment(null); return; }
		if (routeBlocked) blocker.proceed();
		else if (pendingSegment) { const id = pendingSegment; setPendingSegment(null); setSelectedId(id); }
	}
	function leaveSairSemSalvar() {
		setEstrDirty(false); setCopiaPendente(false);
		if (routeBlocked) blocker.proceed();
		else if (pendingSegment) { const id = pendingSegment; setPendingSegment(null); setSelectedId(id); }
	}
	function leaveCancelar() {
		if (routeBlocked) blocker.reset();
		setPendingSegment(null);
	}

	async function reload() {
		if (!supabase || !empresa || !credor) return;
		setLoading(true); setError('');
		const [s, cl, e, p, emp, eq, pm] = await Promise.all([
			supabase.from('segmentos_em_uso').select('*').eq('credor_id', credor.id).eq('vinculado', true).order('ordem', { ascending: true }),
			supabase.from('clusters').select('*').eq('empresa_id', empresa.id),
			supabase.from('estrategias').select('*').eq('empresa_id', empresa.id).order('nome'),
			supabase.from('personas_usuario').select('*').eq('credor_id', credor.id).eq('ativo', true).order('ordem', { ascending: true }),
			supabase.from('empresas').select('colunas_base').eq('id', empresa.id).maybeSingle(),
			supabase.from('enquadramento').select('persona_usuario,cluster,estrategia,na_carga,clientes,estado').eq('empresa_id', empresa.id).eq('credor_id', credor.id),
			supabase.from('personas_modelo').select('nome,canais_sugeridos'),
		]);
		if (s.error || cl.error || e.error) { setError(friendlyError()); setLoading(false); return; }
		const segs = (s.data ?? []) as SegmentoEmUso[];
		setSegmentos(segs);
		const cmap: Record<string, Cluster> = {};
		(cl.data ?? []).forEach((c: Row) => { cmap[c.id as string] = c as unknown as Cluster; });
		setClustersMap(cmap);
		setEstrategias((e.data ?? []) as Estrategia[]);
		setPersonasUsuario((p.data ?? []) as PersonaUsuario[]);
		const cb = (emp.data as Row | null)?.colunas_base;
		setColunas(Array.isArray(cb?.colunas) ? cb.colunas : []);
		const mapCont: Record<string, number> = {};
		let sem = 0;
		(eq.data ?? []).forEach((r: Row) => {
			const nome = (r.persona_usuario as string | null)?.trim();
			const n = Number(r.clientes) || 0;
			if (nome) mapCont[nome] = (mapCont[nome] ?? 0) + n; else sem += n;
		});
		setContagens(mapCont);
		setSemPersona(sem);
		void contarSemEstagio().then(setSemEstagio);
		setEnqRows((eq.data ?? []) as Row[]);
		const mm: Record<string, string[]> = {};
		(pm.data ?? []).forEach((r: Row) => { if (r.nome) mm[r.nome as string] = Array.isArray(r.canais_sugeridos) ? r.canais_sugeridos as string[] : []; });
		setModelosMap(mm);
		if (!selectedId && segs.length) setSelectedId(segs[0].cluster_id);
		setLoading(false);
	}
	/** Conta clientes sem estágio em estado_cliente (motivo_hoje começando por
	 *  "sem ação: sem estágio" e os textos antigos equivalentes). head/count só
	 *  de contagem; filtra empresa_id, credor_id, na_carga não falso e, quando
	 *  informado, cluster_atual = código do segmento. */
	async function contarSemEstagio(clusterCodigo?: string | null): Promise<number> {
		if (!supabase || !empresa || !credor) return 0;
		let q = supabase
			.from('estado_cliente')
			.select('*', { count: 'exact', head: true })
			.eq('empresa_id', empresa.id)
			.eq('credor_id', credor.id)
			.neq('na_carga', false)
			.or('motivo_hoje.ilike."sem ação: sem estágio%",motivo_hoje.ilike."sem ação: a fase do cliente%",motivo_hoje.ilike."sem ação: acordo quebrado, mas a quebra%"');
		if (clusterCodigo) q = q.eq('cluster_atual', clusterCodigo);
		const { count, error } = await q;
		if (error) { friendlyError(error); return 0; }
		return count ?? 0;
	}
	useEffect(() => { void reload(); }, [empresa?.id, credor?.id]);
	useEffect(() => {
		if (!empresa || !credor) { setPropensaoRows(null); setPropensaoExec(null); setPropensaoError(''); return; }
		let active = true;
		(async () => {
			let rows: LinhaPropensaoCarteira[] | null = null;
			let erro = '';
			try {
				rows = await fetchPropensaoCarteira(empresa.id, credor.id);
			} catch (e) {
				// erro real (não é SQL 48 ausente, que devolve null sem lançar):
				// captura a mensagem e mostra no lugar dos erros de carregamento.
				erro = friendlyError(e);
				rows = null;
			}
			const ex = supabase ? await supabase.from('execucoes').select('resumo').eq('empresa_id', empresa.id).eq('credor_id', credor.id).order('iniciada_em', { ascending: false }).limit(1) : { data: [] as Row[] };
			if (!active) return;
			setPropensaoRows(rows);
			setPropensaoError(erro);
			const r = (ex.data?.[0] as Row | undefined)?.resumo as import('@/lib/execucao').ResumoExecucao | null | undefined;
			setPropensaoExec(r ?? null);
		})();
		return () => { active = false; };
	}, [empresa?.id, credor?.id]);
	useEffect(() => { setDemaisAtivo(credor?.demais_ativo ?? true); }, [credor?.id, credor?.demais_ativo]);

	useEffect(() => {
		if (searchParams.get('montar') === '1' && personasUsuario.length > 0 && canEdit) {
			setMontarOpen(true);
			setSearchParams(prev => { prev.delete('montar'); return prev; }, { replace: true });
		}
	}, [searchParams, personasUsuario.length, canEdit, setSearchParams]);

	useEffect(() => {
		if (!supabase || !empresa || !selectedId || selectedId === 'demais') { setCarteiras({}); setCartDirty(false); return; }
		let active = true;
		(async () => {
			const { data } = await supabase.from('segmentos_carteira').select('*').eq('empresa_id', empresa.id).eq('cluster_id', selectedId);
			if (!active) return;
			const map: Record<string, { usa: boolean; ativo: boolean }> = {};
			(data ?? []).forEach((r: Row) => { map[r.credor_id as string] = { usa: true, ativo: !!r.ativo }; });
			setCarteiras(map);
			setCartDirty(false);
		})();
		return () => { active = false; };
	}, [selectedId, empresa?.id]);

	const selected = selectedId && selectedId !== 'demais' ? (clustersMap[selectedId] ?? null) : null;
	const selectedSeg = selectedId && selectedId !== 'demais' ? segmentos.find(s => s.cluster_id === selectedId) ?? null : null;
	const isDemais = selectedId === 'demais';
	const padrao = estrategias.find(e => e.padrao) ?? null;
	// A estratégia que vale vem da coluna estrategia_id da view segmentos_em_uso (nunca clusters.estrategia_id).
	const estrategiaAtual = isDemais
		? (estrategias.find(e => e.id === credor?.estrategia_id) ?? padrao ?? null)
		: estrategias.find(e => e.id === (selectedSeg?.estrategia_id ?? null)) ?? padrao ?? null;

	const inUseCodes = useMemo(() => new Set(segmentos.filter(s => s.em_uso).map(s => s.codigo)), [segmentos]);
	const demaisCount = useMemo(() => {
		if (enqRows.length === 0) return null;
		let n = 0;
		for (const r of enqRows) {
			if (!r.na_carga) continue;
			const est = (r.estrategia as string | null) ?? '';
			const cl = (r.cluster as string | null) ?? '';
			const c = Number(r.clientes) || 0;
			if (!demaisAtivo) { if (est === 'Demais clientes (desligado)') n += c; }
			else { if (!inUseCodes.has(cl)) n += c; }
		}
		return n;
	}, [enqRows, inUseCodes, demaisAtivo]);

	const countBySeg = useMemo(() => {
		const m: Record<string, number> = {};
		for (const r of enqRows) {
			if (!r.na_carga) continue;
			const cl = (r.cluster as string | null) ?? '';
			m[cl] = (m[cl] ?? 0) + (Number(r.clientes) || 0);
		}
		return m;
	}, [enqRows]);

	const contagemEstadoSeg = useMemo(() => {
		const m: Record<string, number> = { LOC: 0, CPA: 0, CPB: 0, NCP: 0, PRE: 0, QBR: 0 };
		const codigo = selectedSeg?.codigo ?? (selectedId && !isDemais ? clustersMap[selectedId]?.codigo : null);
		if (!codigo) return m;
		for (const r of enqRows) {
			if (!r.na_carga) continue;
			if ((r.cluster as string | null) !== codigo) continue;
			const est = (r.estado as string | null) ?? '';
			if (est in m) m[est] += Number(r.clientes) || 0;
		}
		return m;
	}, [enqRows, selectedId, selectedSeg, clustersMap, isDemais]);

	const propensaoSegRows = useMemo(() => {
		if (!propensaoRows) return null;
		const codigo = selectedSeg?.codigo ?? (selectedId && !isDemais ? clustersMap[selectedId]?.codigo : null);
		if (!codigo) return [];
		return propensaoRows.filter(r => (r.cluster ?? null) === codigo);
	}, [propensaoRows, selectedId, selectedSeg, clustersMap, isDemais]);
	const propensaoColetando = useMemo(() => carteiraColetando(propensaoExec, propensaoRows), [propensaoExec, propensaoRows]);

	// Rascunho de estágio criado a partir da Matriz de propensão (sessionStorage).
	useEffect(() => {
		if (typeof window === 'undefined') return;
		if (!credor || !selectedId || selectedId === 'demais' || !estrId) return;
		const raw = sessionStorage.getItem('mc-rascunho-etapa');
		if (!raw) return;
		let draft: { credorId: string; segmentoId: string; etapa: Etapa };
		try { draft = JSON.parse(raw); } catch { return; }
		if (draft.credorId !== credor.id || draft.segmentoId !== selectedId) return;
		setDef(prev => {
			const existentes = (prev.etapas ?? []).map(e => e.id);
			if (existentes.includes(draft.etapa.id)) return prev;
			const id = gerarIdEtapa(draft.etapa.nome, existentes);
			const etapa = { ...draft.etapa, id };
			const etapas = [...(prev.etapas ?? []), etapa];
			const baseOrdem = prev.ordem_etapas ?? ordemStages(prev);
			const ordem = [etapa.id, ...baseOrdem.filter(o => o !== etapa.id)];
			return { ...prev, etapas, ordem_etapas: ordem };
		});
		setEstrDirty(true);
		goStep('estagios');
		sessionStorage.removeItem('mc-rascunho-etapa');
		toast(`Estágio “${draft.etapa.nome}” criado como rascunho. Revise e clique em Salvar.`);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [estrId, selectedId, credor?.id]);

	function onMontarRegua(stageId: string) {
		if (isFaseId(stageId)) {
			setEtapaReguaId(null);
			const estagio = (stageId === 'preventivo' || stageId === 'quebra') ? 'acordo' : stageId;
			setEstagioAtivo(estagio as EstagioId);
		} else setEtapaReguaId(stageId);
		goStep('regua');
	}

	async function toggleDemais() {
		if (!supabase || !credor) return;
		const novo = !demaisAtivo;
		if (!novo && !window.confirm('Os clientes que não caem em nenhum segmento em uso deixam de receber ações a partir da próxima rotina. Continuar?')) return;
		setBusy('demais');
		setDemaisAtivo(novo);
		const { error } = await supabase.from('credores').update({ demais_ativo: novo }).eq('id', credor.id);
		if (error) { setError(friendlyError()); setDemaisAtivo(!novo); }
		else { toast.success('Vale a partir da próxima rotina (em até 1 minuto)'); void reload(); }
		setBusy('');
	}

	useEffect(() => {
		const { def: migrada, mudou } = migrarEtapas(estrategiaAtual?.definicao ?? {});
		setDef(migrada);
		setDefCarregada(migrada);
		setEstrNome(estrategiaAtual?.nome ?? '');
		setEstrId(estrategiaAtual?.id ?? null);
		setEstrDirty(mudou); setEstrError(''); setCopiadoDe(null); setCopiaPendente(false);
		setCompartilhada(!!(selectedSeg?.compartilhada_com));
	}, [selectedId, estrategiaAtual?.id]);

	async function toggleEmUso(seg: SegmentoEmUso) {
		if (!supabase || !empresa || !credor) return;
		setBusy(seg.cluster_id);
		const novoAtivo = !seg.em_uso;
		const cl = clustersMap[seg.cluster_id];
		if (cl?.credor_id) {
			await supabase.from('clusters').update({ credor_id: null }).eq('id', seg.cluster_id);
		}
		const { error } = await supabase.from('segmentos_carteira').upsert(
			{ empresa_id: empresa.id, cluster_id: seg.cluster_id, credor_id: credor.id, ativo: novoAtivo },
			{ onConflict: 'cluster_id,credor_id' },
		);
		if (error) setError(friendlyError()); else { toast.success('Vale a partir da próxima rotina'); void reload(); }
		setBusy('');
	}

	async function tirarDaCarteira(seg: SegmentoEmUso) {
		if (!supabase || !credor) return;
		if (!window.confirm(`Tirar o segmento ${seg.nome} da carteira ${credor.nome}? Ele continua nas outras carteiras.`)) return;
		setBusy(seg.cluster_id);
		const { error } = await supabase.from('segmentos_carteira').delete().eq('cluster_id', seg.cluster_id).eq('credor_id', credor.id);
		if (error) setError(friendlyError()); else { toast.success('Vale a partir da próxima rotina'); setDetalheOpen(false); void reload(); }
		setBusy('');
	}

	async function salvarCarteiras() {
		if (!supabase || !empresa || !selectedId || selectedId === 'demais') return;
		setSavingCart(true);
		await supabase.from('clusters').update({ credor_id: null }).eq('id', selectedId);
		const credAtivos = credores.filter(c => c.ativo);
		const toUpsert: SegmentoCarteira[] = [];
		const toDelete: string[] = [];
		for (const c of credAtivos) {
			const st = carteiras[c.id];
			if (st?.usa) toUpsert.push({ empresa_id: empresa.id, cluster_id: selectedId, credor_id: c.id, ativo: st.ativo });
			else if (st) toDelete.push(c.id);
		}
		if (toUpsert.length) {
			const { error } = await supabase.from('segmentos_carteira').upsert(toUpsert, { onConflict: 'cluster_id,credor_id' });
			if (error) { setError(friendlyError()); setSavingCart(false); return; }
		}
		for (const cid of toDelete) {
			await supabase.from('segmentos_carteira').delete().eq('cluster_id', selectedId).eq('credor_id', cid);
		}
		setCartDirty(false);
		toast.success('Vale a partir da próxima rotina');
		setSavingCart(false);
		void reload();
	}

	async function toggleClusterAtivo() {
		if (!supabase || !selected) return;
		setBusy('ativo');
		const { error } = await supabase.from('clusters').update({ ativo: !selected.ativo }).eq('id', selected.id);
		if (error) setError(friendlyError()); else { toast.success('Vale a partir da próxima rotina'); void reload(); }
		setBusy('');
	}

	/** Separa a estratégia compartilhada: cria uma cópia só desta carteira.
	 *  Sempre com o 3º argumento (definição): sem ele a rpc copia a atual ou grava {}. */
	async function separarEstrategia() {
		if (!supabase || !credor || !selectedSeg) return;
		setBusy('separar');
		const { data, error } = await supabase.rpc('separar_estrategia', { segmento: selectedSeg.cluster_id, carteira: credor.id, definicao: def as unknown as Record<string, unknown> });
		if (error || !data) { setError(friendlyError()); setBusy(''); return; }
		const novoId = typeof data === 'string' ? data : (data as Row)?.id ?? (data as Row)?.nova_estrategia_id;
		toast.success('Estratégia separada só para esta carteira.');
		setBusy('');
		void reload();
	}

	/** Aplica uma definição neste segmento+carteira via separar_estrategia (sempre com definição). */
	async function aplicarNoSegmento(defAplicar: Definicao, toastMsg?: string) {
		if (!supabase || !credor || !selectedSeg) return;
		setBusy('separar');
		const { error } = await supabase.rpc('separar_estrategia', { segmento: selectedSeg.cluster_id, carteira: credor.id, definicao: defAplicar as unknown as Record<string, unknown> });
		if (error) { setError(friendlyError()); setBusy(''); return; }
		toast.success(toastMsg ?? 'Estratégia criada só para esta carteira.');
		setBusy('');
		goStep('estagios');
		void reload();
	}

	async function salvarEstrategia(): Promise<boolean> {
		if (!supabase || !empresa) return false;
		setSavingEstr(true); setEstrError('');
		const erros = validarEtapas(def);
		if (erros.length) {
			setEstrError(`Corrija os estágios antes de salvar: ${erros.map(e => e.nome || e.id).join(', ')}.`);
			setSavingEstr(false);
			toast.error('Há estágios com campos inválidos. Revise no passo Estágios.');
			goStep('estagios');
			return false;
		}
		const idsValidos = new Set(personasUsuario.map(p => p.id));
		const defLimpa = removerMensagensCanaisSemMensagem(normalizarDefinicao(limparPersonas(def, idsValidos), personasUsuario.map(p => p.id)));
		// Preserva chaves que a tela não mostra (ex.: recencia_horas, whatsapp, calendario):
		// parte da definição carregada do banco (após migrar "janela") e sobrescreve só
		// o que a tela editou. Dentro de cada fase, as subchaves não editadas (ex.: orcamento,
		// travas, carencia) já vêm preservadas pelas funções de limpeza (spread ...def.<fase>).
		const limpo: Definicao = { ...defCarregada, ...defLimpa };

		// NUNCA grave definicao = {} (o motor lê {} como o playbook inteiro).
		if (!limpo.localizacao && !limpo.cpc && !limpo.giro && !limpo.preventivo && !limpo.quebra && !(limpo.etapas && limpo.etapas.length)) {
			const v = definicaoVazia();
			limpo.localizacao = v.localizacao; limpo.cpc = v.cpc; limpo.giro = v.giro; limpo.preventivo = v.preventivo; limpo.quebra = v.quebra;
		}

		// Cópia de outra carteira: sempre cria estratégia nova só desta carteira.
		if (copiaPendente && selectedSeg && credor) {
			const { data, error } = await supabase.rpc('separar_estrategia', { segmento: selectedSeg.cluster_id, carteira: credor.id, definicao: limpo as unknown as Record<string, unknown> });
			if (error) { setEstrError(friendlyError()); setSavingEstr(false); return false; }
			setCopiaPendente(false); setEstrDirty(false);
			toast.success('Nova estratégia criada só para esta carteira · o MotorCX reenquadra em até 1 minuto', { action: { label: 'Reenquadrar agora', onClick: () => reenqRef.current?.pedir() } });
			void reload(); setSavingEstr(false); return true;
		}

		if (!estrId) { setEstrError('Nenhuma estratégia selecionada.'); setSavingEstr(false); return false; }
		// Se compartilhada e editando para as duas, confirma.
		if (compartilhada && !copiaPendente) {
			if (!window.confirm('Esta estratégia também vale na outra carteira. Salvar muda nas duas. Continuar?')) { setSavingEstr(false); return false; }
		}
		const { error } = await supabase.from('estrategias').update({ nome: estrNome.trim() || 'Estratégia', definicao: limpo as unknown as Record<string, unknown> }).eq('id', estrId);
		if (error) { setEstrError(friendlyError()); setSavingEstr(false); return false; }
		setEstrDirty(false); setCopiaPendente(false);
		if (guardarModelo) {
			const baseNome = estrNome.trim() || 'Estratégia';
			let nomeModelo = `${baseNome} (modelo)`;
			let n = 2;
			const nomesExistentes = new Set(estrategias.map(e => e.nome));
			while (nomesExistentes.has(nomeModelo)) { nomeModelo = `${baseNome} (modelo ${n})`; n++; }
			const { error: mErr } = await supabase.from('estrategias').insert({ empresa_id: empresa.id, nome: nomeModelo, descricao: 'Modelo da empresa', definicao: limpo as unknown as Record<string, unknown>, padrao: false });
			if (mErr) { setEstrError(friendlyError()); setSavingEstr(false); return false; }
			setGuardarModelo(false);
			toast.success(`Modelo "${nomeModelo}" criado em “Da sua empresa”.`);
		}
		toast.success(`Estratégia de ${credor?.nome ?? 'carteira'} salva. Vale na próxima lista do dia.`, { action: { label: 'Reenquadrar agora', onClick: () => reenqRef.current?.pedir() } });
		void reload(); setSavingEstr(false); return true;
	}

	const emUso = segmentos.filter(s => s.em_uso);
	const pausados = segmentos.filter(s => !s.em_uso);
	const credAtivos = credores.filter(c => c.ativo);

	// --- Moldura dos passos: estado na URL (?passo, ?carteira, ?segmento) ---
	const passoParam = searchParams.get('passo') as PassoId | null;
	const carteiraParam = searchParams.get('carteira');
	const segmentoParam = searchParams.get('segmento');
	const [vinculosPorCluster, setVinculosPorCluster] = useState<Record<string, number>>({});
	const [carteiraStats, setCarteiraStats] = useState<Record<string, { segmentos: number; clientes: number }>>({});
	const defaultPasso: PassoId = (!loading && credor && estrategias.length > 0 && emUso.length > 0) ? 'estagios' : 'segmentos';
	const passo: PassoId = passoParam ?? defaultPasso;
	function goStep(p: PassoId) {
		setSearchParams(prev => { prev.set('passo', p); return prev; });
	}
	// ?carteira=<id> diferente do contexto → troca a carteira (mesmo seletor de hoje).
	// Os ids das carteiras são números; o parâmetro da URL é texto — compare como texto.
	useEffect(() => {
		if (!carteiraParam || credores.length === 0) return;
		const found = credores.find(c => String(c.id) === carteiraParam);
		if (found && String(credor?.id) !== String(found.id)) selectCredor(found.id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [carteiraParam, credores.length, credor?.id]);
	// ?segmento=<id> → seleciona o segmento (respeita o leave guard de hoje).
	// cluster_id é número; o parâmetro da URL é texto — converta antes de comparar.
	// O valor especial "demais" continua como texto.
	useEffect(() => {
		if (!segmentoParam) return;
		if (segmentoParam === 'demais') { if (selectedId !== 'demais') selecionar('demais'); return; }
		const numId = Number(segmentoParam);
		const seg = segmentos.find(s => Number(s.cluster_id) === numId);
		if (seg && Number(seg.cluster_id) !== Number(selectedId)) selecionar(seg.cluster_id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [segmentoParam, segmentos.length]);
	// Contagem de clientes sem estágio do segmento escolhido (passo 3).
	useEffect(() => {
		if (!credor || !selectedId || selectedId === 'demais') { setSemEstagioSeg(0); return; }
		const seg = segmentos.find(s => String(s.cluster_id) === String(selectedId));
		const codigo = seg?.codigo ?? clustersMap[selectedId]?.codigo;
		if (!codigo) { setSemEstagioSeg(0); return; }
		let active = true;
		(async () => {
			const n = await contarSemEstagio(codigo);
			if (active) setSemEstagioSeg(n);
		})();
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedId, credor?.id, segmentos.length]);
	// Conta em quantas carteiras cada segmento está vinculado (aviso do formulário).
	useEffect(() => {
		if (!supabase || !empresa) { setVinculosPorCluster({}); return; }
		let active = true;
		(async () => {
			const { data } = await supabase.from('segmentos_carteira').select('cluster_id').eq('empresa_id', empresa.id);
			if (!active) return;
			const m: Record<string, number> = {};
			(data ?? []).forEach((r: Row) => { const cid = r.cluster_id as string; m[cid] = (m[cid] ?? 0) + 1; });
			setVinculosPorCluster(m);
		})();
		return () => { active = false; };
	}, [empresa?.id]);
	// Estatísticas por carteira (passo 1): segmentos ativos e clientes na carga.
	useEffect(() => {
		if (!supabase || !empresa) { setCarteiraStats({}); return; }
		let active = true;
		(async () => {
			const [sc, eq] = await Promise.all([
				supabase.from('segmentos_carteira').select('credor_id,ativo').eq('empresa_id', empresa.id),
				supabase.from('enquadramento').select('credor_id,na_carga,clientes').eq('empresa_id', empresa.id),
			]);
			if (!active) return;
			const stats: Record<string, { segmentos: number; clientes: number }> = {};
			(sc.data ?? []).forEach((r: Row) => {
				const cid = r.credor_id as string;
				if (!stats[cid]) stats[cid] = { segmentos: 0, clientes: 0 };
				if (r.ativo) stats[cid].segmentos += 1;
			});
			(eq.data ?? []).forEach((r: Row) => {
				const cid = r.credor_id as string;
				if (!stats[cid]) stats[cid] = { segmentos: 0, clientes: 0 };
				if (r.na_carga) stats[cid].clientes += Number(r.clientes) || 0;
			});
			setCarteiraStats(stats);
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	// --- Estados dos passos (linhas de estado de cada cartão) ---
	const fasesKeys = ['localizacao', 'cpc', 'giro', 'preventivo', 'quebra'] as const;
	const mAtivas = fasesKeys.filter(f => { const o = (def as Record<string, unknown>)[f] as Record<string, unknown> | undefined; return o && o.ativo !== false; }).length;
	const nComRegua = fasesKeys.filter(f => {
		const o = (def as Record<string, unknown>)[f] as Record<string, unknown> | undefined;
		return o && o.ativo !== false && o.passos && Object.keys(o.passos as object).length > 0;
	}).length;
	const segComEstr = emUso.filter(s => s.estrategia_id).length;
	const segSemEstr = emUso.length - segComEstr;
	const est3Base = emUso.length === 0 ? 'falta criar segmentos' : segSemEstr > 0 ? `falta em ${segSemEstr} segmento${segSemEstr > 1 ? 's' : ''}` : `${emUso.length} estágio${emUso.length > 1 ? 's' : ''}`;
	const semEstagioExibir = (selectedId && selectedId !== 'demais') ? semEstagioSeg : semEstagio;
	const est3 = semEstagioExibir > 0 ? `${est3Base} · ≈ ${numberBR(semEstagioExibir)} sem estágio` : est3Base;
	const stepStates: PassoState[] = [
		{ id: 'carteira', numero: 1, pergunta: 'De quem?', titulo: 'Carteira', estado: credor?.nome ?? 'escolher', completo: !!credor },
		{ id: 'segmentos', numero: 2, pergunta: 'Quem?', titulo: 'Segmentos', estado: emUso.length > 0 ? `${emUso.length} segmento${emUso.length > 1 ? 's' : ''}` : 'falta criar', completo: emUso.length > 0 },
		{ id: 'estagios', numero: 3, pergunta: 'Em que estágio?', titulo: 'Estágios', estado: est3, completo: emUso.length > 0 && segSemEstr === 0 },
		{ id: 'regua', numero: 4, pergunta: 'O que fazer?', titulo: 'Régua', estado: estrId ? `${nComRegua} de ${mAtivas} estágios com régua` : 'sem régua', completo: !!estrId && !estrDirty },
		{ id: 'revisar', numero: 5, pergunta: 'Pronto?', titulo: 'Revisar e salvar', estado: estrDirty ? 'falta salvar' : estrId ? 'salvo' : '—', completo: !!estrId && !estrDirty },
	];

	function aplicarCopiar(newDef: Definicao, origemNome: string, droppedPersonas: boolean) {
		setDef(newDef);
		setEstrDirty(true);
		setCopiaPendente(true);
		setCopiadoDe(origemNome);
		goStep('regua');
		toast.success(`Copiado de ${origemNome}. Revise e clique em Salvar para valer.`);
		if (droppedPersonas) toast('As raias de personas da origem eram de outra carteira e não foram copiadas — o público geral vem completo.');
	}

	/** Copia a régua de um estágio a partir de outra estratégia da empresa. */
	function aplicarReguaOrigem(d: Definicao) {
		setDef(copiarReguaEstagio(def, d, estagioAtivo));
		setEstrDirty(true);
	}

	// --- Botão neutro (contorno) usado na barra e na gaveta ---
	const btnNeutroCls = 'flex items-center gap-1.5 rounded-lg border h-9 px-3 text-xs font-semibold transition-colors border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]';

	/** Fileira de segmentos da carteira (seletor dos passos 3, 4 e 5). */
	function renderSeletorSegmentos() {
		return (
			<div className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto pb-1">
				{emUso.map(s => {
					const active = selectedId === s.cluster_id;
					const count = countBySeg[s.codigo] ?? 0;
					return (
						<button key={s.cluster_id} onClick={() => selecionar(s.cluster_id)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? '' : 'border border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]'}`} style={active ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' } : undefined}>
							<span className={`grid h-5 w-5 place-items-center rounded text-[10px] font-bold ${active ? 'bg-white/25' : 'bg-[var(--base-fill)] text-[var(--base-texto)]'}`}>{s.codigo}</span>
							<span className="max-w-[120px] truncate">{s.nome}</span>
							<span className={active ? 'opacity-70' : 'text-[var(--base-texto-3)]'}>· {numberBR(count)}</span>
							{s.estrategia_propria && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? 'bg-white/25' : 'bg-[var(--estado-pronto-fundo)] text-[var(--estado-pronto-texto)]'}`} title="Estratégia própria desta carteira">própria</span>}
							{active && compartilhada && <span className="h-2 w-2 rounded-full bg-[var(--estado-atencao)]" title="Estratégia compartilhada" />}
						</button>
					);
				})}
				{pausados.length > 0 && (
					<div className="relative shrink-0">
						<button onClick={() => setPausadosOpen(v => !v)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${pausadosOpen ? 'border-[var(--base-borda)] bg-[var(--base-fill)]' : 'border-[var(--base-borda)] text-[var(--base-texto-2)]'} hover:bg-[var(--base-fill)]`}>
							{selectedId && pausados.find(p => p.cluster_id === selectedId) ? pausados.find(p => p.cluster_id === selectedId)!.nome : <>Pausados ({pausados.length})</>}
							<ChevronDown size={13} />
						</button>
						{pausadosOpen && (
							<>
								<button className="fixed inset-0 z-[60] cursor-default" onClick={() => setPausadosOpen(false)} aria-hidden />
								<div className="absolute left-0 top-9 z-[70] w-56 rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-1 shadow-lg">
									{pausados.map(s => {
										const active = selectedId === s.cluster_id;
										const count = countBySeg[s.codigo] ?? 0;
										return (
											<button key={s.cluster_id} onClick={() => { selecionar(s.cluster_id); setPausadosOpen(false); }} className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-semibold ${active ? 'bg-[var(--base-fill)] text-[var(--base-texto)]' : 'text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]'}`}>
												<span className="grid h-5 w-5 place-items-center rounded bg-[var(--base-fill)] text-[10px] font-bold text-[var(--base-texto-2)]">{s.codigo}</span>
												<span className="flex-1 truncate">{s.nome}</span>
												<span className="text-[var(--base-texto-3)]">{numberBR(count)}</span>
											</button>
										);
									})}
								</div>
							</>
						)}
					</div>
				)}
				<button onClick={() => selecionar('demais')} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${isDemais ? '' : 'border border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]'} ${!demaisAtivo ? 'opacity-60' : ''}`} style={isDemais ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' } : undefined}>
					<span className="text-[10px]">··</span> Demais {demaisCount !== null && <span className="opacity-70">· {numberBR(demaisCount)}</span>}
				</button>
				<button onClick={() => setDetalheOpen(true)} disabled={!selectedId} className={`${btnNeutroCls} shrink-0 disabled:opacity-40`}>Detalhes</button>
			</div>
		);
	}

	if (!empresa) return <>
		<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)]">
			<div className="flex items-center gap-3 px-4 py-2.5">
				<h1 className="text-[20px] font-semibold" style={{ fontWeight: 650 }}>Orquestração</h1>
			</div>
		</div>
		<div className="mt-4"><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></div>
	</>;

	return (
		<>
			{/* ===== Barra da Orquestração (duas linhas) ===== */}
			<div ref={barRef} className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] lg:sticky lg:top-[44px] lg:z-20">
				{/* Linha 1 */}
				<div className="flex flex-wrap items-center gap-3 border-b border-[var(--base-borda)] px-4 py-2.5">
					<h1 className="text-[20px] font-semibold" style={{ fontWeight: 650 }}>Orquestração</h1>
					{/* ? ajuda */}
					<div className="relative">
						<button onClick={() => setHelpOpen(v => !v)} className="grid h-7 w-7 place-items-center rounded-full border border-[var(--base-borda)] text-[15px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]" aria-label="O que é a Orquestração">?</button>
						{helpOpen && (
							<>
								<button className="fixed inset-0 z-[60] cursor-default" onClick={() => setHelpOpen(false)} aria-hidden />
								<div className="absolute left-0 top-9 z-[70] w-[320px] rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4 text-[13px] leading-relaxed text-[var(--base-texto-2)] shadow-lg">
									Cada cliente da carga cai num segmento. O MotorCX vê em que momento ele está — Novo, CPC A, Não CPC, Acordo — e aplica a regra desse momento. Quem deu CPC segue no contato principal e no canal do CPC.
									<p className="mt-2 font-medium text-[var(--base-texto)]">Tudo abaixo é desta carteira: segmentos, estratégia, etapas e travas.</p>
								</div>
							</>
						)}
					</div>
					{/* Seletor de carteira — único lugar onde se escolhe a carteira nesta tela */}
					{credAtivos.length > 0 && (
						<div className="relative">
							<label className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] pl-3 pr-7 text-[13px] font-medium text-[var(--base-texto)]">
								<span className="text-[var(--base-texto-3)]">Carteira</span>
								<select aria-label="Carteira" value={credor?.id ?? ''} onChange={e => selectCredor(e.target.value || null)} className="h-9 max-w-[190px] appearance-none bg-transparent text-[13px] font-medium outline-none">
									{credAtivos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
								</select>
								<ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--base-texto-3)]" />
							</label>
						</div>
					)}
					<div className="ml-auto flex items-center gap-2">
						{/* Reenquadramento compacto (montado sempre; mostra andamento) */}
						<div className="[&_button]:!h-9 [&_button]:!px-3 [&_button]:!text-[13px]"><ReenquadramentoButton ref={reenqRef} onConcluido={() => void reload()} /></div>
						{/* Estado */}
						{estrId && (
							<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${estrDirty ? 'bg-[var(--estado-atencao-fundo)] text-[var(--estado-atencao-texto)]' : 'bg-[var(--estado-pronto-fundo)] text-[var(--estado-pronto-texto)]'}`}>
								<span className={`h-2 w-2 rounded-full ${estrDirty ? 'bg-[var(--estado-atencao)]' : 'bg-[var(--estado-pronto)]'}`} />
								{estrDirty ? 'Alterações não salvas' : 'Tudo salvo'}
							</span>
						)}
						{/* Salvar */}
						{canEdit && estrId && (
							<button type="button" onClick={() => void salvarEstrategia()} disabled={savingEstr} className="flex h-9 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold text-[var(--destaque-texto)] disabled:opacity-50" style={{ backgroundColor: 'var(--destaque)' }}>
								{estrDirty && <span className="h-2 w-2 rounded-full bg-[var(--estado-atencao)]" />}
								{savingEstr ? 'Salvando...' : estrDirty ? 'Salvar alterações' : 'Salvar'}
							</button>
						)}
						{/* Revisar e salvar */}
						{canEdit && estrId && !estrDirty && (
							<button type="button" onClick={() => goStep('revisar')} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--base-borda)] px-4 text-[13px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)]">Revisar e salvar</button>
						)}
						{/* ⋯ */}
						<div className="relative">
							<button onClick={() => setMaisOpen(v => !v)} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]" aria-label="Mais ações">⋯</button>
							{maisOpen && (
								<>
									<button className="fixed inset-0 z-[60] cursor-default" onClick={() => setMaisOpen(false)} aria-hidden />
									<div className="absolute right-0 top-10 z-[70] w-60 rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-1 shadow-lg">
										{canEdit && estrId && <button type="button" onClick={() => { setMaisOpen(false); setCopiarOpen(true); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Copy size={12} className="mr-1 inline" /> Copiar de outra carteira</button>}
										{canEdit && estrId && <button type="button" onClick={() => { setMaisOpen(false); setDef(playbookDefinicao()); toast('Padrão MotorCX carregado.'); setEstrDirty(true); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Começar do padrão MotorCX</button>}
										{canEdit && estrId && <button type="button" onClick={() => { setMaisOpen(false); setMontarOpen(true); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Montar esteira pelas personas</button>}
										<div className="my-1 border-t border-[var(--base-borda)]" />
										{canEdit && estrId && <button type="button" onClick={() => { setMaisOpen(false); setMatrixOpen(true); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Grid3x3 size={12} className="mr-1 inline" /> Ver segmentos em todas as carteiras</button>}
										{canEdit && <button type="button" onClick={() => { setMaisOpen(false); reenqRef.current?.pedir(); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><RotateCcw size={12} className="mr-1 inline" /> Reenquadrar agora</button>}
										<button type="button" onClick={() => { setMaisOpen(false); window.print(); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Printer size={12} className="mr-1 inline" /> Imprimir / PDF</button>
									</div>
								</>
							)}
						</div>
					</div>
				</div>
				{/* Moldura dos passos */}
				{credor && !loading && (
					<div className="border-t border-[var(--base-borda)] p-3">
						<PassosBar passo={passo} steps={stepStates} onStep={goStep} />
					</div>
				)}
			</div>

			{/* Sem carteira escolhida */}
			{!credor && credores.length > 1 && <div className="mt-4"><EscolhaCarteira /></div>}
			{!credor && credores.length <= 1 && <div className="mt-4"><Loading /></div>}
			{credor && loading && <div className="mt-4"><Loading /></div>}
			{credor && error && <div className="mt-4"><Notice>{error}</Notice></div>}
			{credor && !loading && propensaoError && <div className="mt-4"><Notice>{propensaoError}</Notice></div>}

			{/* ===== Passo 1 — Carteira ===== */}
			{credor && !loading && passo === 'carteira' && (
				<div className="mt-4 space-y-4">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{credAtivos.map(c => {
							const ativo = c.id === credor.id;
							const st = carteiraStats[c.id];
							return (
								<button key={c.id} type="button" onClick={() => selectCredor(c.id)} className={`flex flex-col rounded-xl border p-4 text-left transition ${ativo ? 'bg-[var(--destaque-suave)]' : 'bg-[var(--base-cartao)] hover:bg-[var(--base-fill)]'}`} style={ativo ? { borderColor: 'var(--destaque)' } : { borderColor: 'var(--base-borda)' }}>
									<div className="flex items-center justify-between gap-2">
										<span className="text-[15px] font-bold text-[var(--base-texto)]">{c.nome}</span>
										{ativo && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>atual</span>}
									</div>
									<span className="mt-1 text-[11px] text-[var(--base-texto-3)]">{c.entrada_carga === 'api' ? 'Carga por API' : 'Carga por arquivo'}</span>
									<div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--base-texto-2)]">
										<span>{numberBR(st?.clientes ?? 0)} clientes</span>
										<span>{st && st.segmentos > 0 ? `${st.segmentos} segmento${st.segmentos > 1 ? 's' : ''}` : 'vazia'}</span>
									</div>
								</button>
							);
						})}
					</div>
					<p className="text-[12px] text-[var(--base-texto-3)]">Cadastrar carteira nova fica em Configurações › Carteiras.</p>
					<div className="flex justify-end">
						<button type="button" onClick={() => goStep('segmentos')} className="flex h-9 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Continuar: quem vamos cobrar?</button>
					</div>
				</div>
			)}

			{/* ===== Passo 2 — Segmentos ===== */}
			{credor && !loading && passo === 'segmentos' && (
				<div className="mt-4 space-y-3">
					{!demaisAtivo && emUso.length === 0 && (
						<div className="flex items-center gap-2 rounded-xl border border-[var(--estado-erro)] bg-[var(--estado-erro-fundo)] px-4 py-3 text-sm font-semibold text-[var(--estado-erro-texto)]"><AlertTriangle size={16} /> Nenhum cliente desta carteira recebe ação: ligue um segmento ou os Demais clientes</div>
					)}
					{emUso.length === 0 ? (
						<TresCaminhos
							aviso={<div className="rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-2.5 text-sm font-medium text-[var(--estado-atencao-texto)]">Esta carteira ainda não tem segmentos em uso.</div>}
							disabled={!canEdit}
							onCriarDoZero={() => { setEditing(null); setFormOpen(true); }}
							onCopiar={() => { if (selectedSeg && estrId) setCopiarOpen(true); else toast('Crie um segmento primeiro para copiar de outra carteira.'); }}
							onModelo={() => { if (selectedSeg) setModelosOpen(true); else toast('Crie um segmento primeiro para usar um modelo.'); }}
						/>
					) : (
						<>
							<div className="flex items-center justify-between gap-2">
								<h2 className="text-[15px] font-bold text-[var(--base-texto)]">Segmentos da carteira</h2>
								{canEdit && <button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className={btnNeutroCls}><Plus size={14} /> Segmento</button>}
							</div>
							<div className="space-y-2">
								{emUso.map(s => {
									const cl = clustersMap[s.cluster_id];
									const count = countBySeg[s.codigo] ?? 0;
									return (
										<div key={s.cluster_id} className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4">
											<div className="flex flex-wrap items-start justify-between gap-2">
												<div className="flex items-center gap-2">
													<span className="grid h-7 w-7 place-items-center rounded-md text-[11px] font-bold" style={{ backgroundColor: 'var(--area)', color: 'var(--area-ativo-texto)' }}>{s.codigo}</span>
													<div>
														<p className="text-[14px] font-bold text-[var(--base-texto)]">{s.nome}</p>
														<p className="text-[11px] text-[var(--base-texto-3)]">{numberBR(count)} clientes</p>
													</div>
												</div>
												<div className="flex flex-wrap items-center gap-2">
													{s.estrategia_propria && <span className="rounded-full bg-[var(--estado-pronto-fundo)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--estado-pronto-texto)]">própria</span>}
													{s.compartilhada_com && <span className="rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--estado-atencao-texto)]">compartilhada</span>}
													{!s.estrategia_propria && !s.compartilhada_com && <span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--base-texto-3)]">sem estratégia própria</span>}
													{canEdit && cl && <button type="button" onClick={() => { setEditing(cl); setFormOpen(true); }} className={btnNeutroCls}><Pencil size={13} /> Editar</button>}
													<button type="button" onClick={() => { selecionar(s.cluster_id); goStep('estagios'); }} className="flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Estágios</button>
												</div>
											</div>
											<div className="mt-2 flex flex-wrap gap-1.5">
												{cl?.condicoes && cl.condicoes.length > 0 ? cl.condicoes.map((cd, i) => {
													const label = calculadoLabel[cd.campo] ?? cd.campo;
													const op = opPhrase[cd.op] ?? cd.op;
													const valStr = Array.isArray(cd.valor) ? cd.valor.join(', ') : String(cd.valor ?? '');
													return <span key={i} className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[11px] text-[var(--base-texto-2)]">{label} {op}{cd.op !== 'vazio' && cd.op !== 'preenchido' ? ` ${valStr}` : ''}</span>;
												}) : <span className="text-[11px] italic text-[var(--base-texto-3)]">Sem condições (vale para todos)</span>}
											</div>
										</div>
									);
								})}
							</div>
						</>
					)}
				</div>
			)}

			{/* ===== Passos 3, 4 e 5 — editor da estratégia ===== */}
			{credor && !loading && (passo === 'estagios' || passo === 'regua' || passo === 'revisar') && (
				<>
					{renderSeletorSegmentos()}
					{!selectedId && <div className="mt-4"><Empty>Escolha um segmento acima.</Empty></div>}
					{selectedId && !estrategiaAtual && (
						<div className="mt-4"><Empty>Nenhuma estratégia cadastrada. {canEdit && 'Crie a primeira.'}</Empty></div>
					)}
					{selectedId && estrategiaAtual && (isDemais && !credor?.estrategia_id && !padrao) && (
						<div className="mt-4"><Empty>Este credor ainda não tem uma estratégia padrão.</Empty></div>
					)}
					{selectedId && estrategiaAtual && !(isDemais && !credor?.estrategia_id && !padrao) && (
						<>
							{/* Aviso de estratégia compartilhada */}
							{compartilhada && selectedSeg?.compartilhada_com && canEdit && (
								<div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-2.5 text-sm">
									<span className="font-medium text-[var(--estado-atencao-texto)]">Esta estratégia também vale na carteira <strong>{selectedSeg.compartilhada_com}</strong>. Mudar aqui muda lá.</span>
									<div className="ml-auto flex gap-2">
										<button onClick={() => void separarEstrategia()} disabled={busy === 'separar'} className={btnNeutroCls}>{busy === 'separar' ? 'Separando...' : 'Separar só para esta carteira'}</button>
										<button onClick={() => setCompartilhada(false)} className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--estado-atencao-texto)] px-4 text-xs font-semibold text-[var(--estado-atencao-texto)] hover:bg-[var(--estado-atencao-fundo)]">Editar para as duas</button>
									</div>
								</div>
							)}
							{copiadoDe && (
								<div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-3 text-sm font-medium text-[var(--estado-atencao-texto)]"><Copy size={15} /> Copiado de <strong>{copiadoDe}</strong>. Revise e clique em Salvar para valer.</div>
							)}
							<div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--base-fill)] px-4 py-3">
								<span className="text-[13px] font-semibold text-[var(--base-texto-3)]">{passo === 'estagios' ? `Estágios de ${selectedSeg?.nome ?? 'Demais'}` : passo === 'regua' ? `O que fazer em “${selectedSeg?.nome ?? 'Demais'}”` : 'Revisar e salvar'}</span>
						{passo === 'estagios' && <Info slug="estagio-de-cobranca" />}
								<input value={estrNome} onChange={e => { setEstrNome(e.target.value); setEstrDirty(true); }} disabled={!canEdit} className="h-9 flex-1 min-w-[180px] rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 text-sm font-medium text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:bg-transparent disabled:border-transparent" />
								{estrategiaAtual.padrao && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--estado-atencao-fundo)] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[var(--estado-atencao-texto)]">Padrão</span>}
								{isVazia(def) && <span className="text-xs italic text-[var(--base-texto-3)]">Seguindo o padrão MotorCX</span>}
								<ExportarButton
									dados={{ nome: estrNome || 'Estratégia', empresaNome: empresa?.nome ?? '', credorNome: credor?.nome ?? '', segmentos: isDemais ? [] : segmentos.filter(s => s.estrategia_id === estrId).map(s => s.nome), def, personas: personasUsuario, contagens, resumo: computarResumoFicha(def, personasUsuario) }}
									credorId={credor?.id}
									estrId={estrId}
								/>
							</div>

							<div className="mt-4">
								{passo === 'estagios' && (selectedSeg && !selectedSeg.estrategia_propria && !isDemais
									? <TresCaminhos
										aviso={<div className="rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-2.5 text-sm font-medium text-[var(--estado-atencao-texto)]">{selectedSeg.estrategia_id ? 'Este segmento segue hoje a estratégia do segmento' + (selectedSeg.compartilhada_com ? ' (compartilhada com ' + selectedSeg.compartilhada_com + ').' : '.') : 'Sem estratégia, este segmento segue a estratégia padrão da carteira/empresa ou, sem ela, a régua padrão do motor.'}</div>}
										disabled={!canEdit}
										onCriarDoZero={() => void aplicarNoSegmento(definicaoVazia())}
										onCopiar={() => setCopiarSegOpen(true)}
										onModelo={() => setModelosOpen(true)}
									/>
									: <EstagiosEditor def={def} setDef={(d) => { setDef(d); setEstrDirty(true); }} canEdit={canEdit} colunas={colunas} semEstagio={semEstagioExibir} contagemEstado={contagemEstadoSeg} onMontarRegua={onMontarRegua} propensaoSegRows={propensaoSegRows} propensaoColetando={propensaoColetando} propensaoError={propensaoError} />)}
								{passo === 'regua' && etapaReguaId && (
								<EtapaReguaEditor def={def} setDef={(d) => { setDef(d); setEstrDirty(true); }} etapaId={etapaReguaId} canEdit={canEdit} onVoltar={() => { setEtapaReguaId(null); goStep('estagios'); }} />
							)}
							{passo === 'regua' && !etapaReguaId && (
									<>
										<ReguaTopo def={def} estagioAtivo={estagioAtivo} onEstagio={setEstagioAtivo} canEdit={canEdit} onEditar={() => goStep('estagios')} />
										<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
											<div className="flex gap-1 rounded-lg bg-[var(--base-fill)] p-1">
												<button type="button" onClick={() => setForma('raias')} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${forma === 'raias' ? 'bg-[var(--base-texto)] text-[var(--base-cartao)]' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}>Raias</button>
												<button type="button" onClick={() => setForma('fluxo')} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${forma === 'fluxo' ? 'bg-[var(--base-texto)] text-[var(--base-cartao)]' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}>Fluxo</button>
											</div>
											{canEdit && <button type="button" onClick={() => setUsarReguaOpen(true)} className={btnNeutroCls}>Usar a régua de…</button>}
										</div>
										<PersonasDaCarteira personas={personasUsuario} contagens={contagens} semPersona={semPersona} def={def} modelosMap={modelosMap} canEdit={canEdit} montarOpen={montarOpen} setMontarOpen={setMontarOpen} estrId={estrId} onSaved={() => void reload()} />
										<DesenhoDaEsteira def={def} setDef={(d) => { setDef(d); setEstrDirty(true); }} canEdit={canEdit} onSalvar={() => void salvarEstrategia()} saving={savingEstr} personas={personasUsuario} contagens={contagens} estrId={estrId} dirty={estrDirty} stickyTop={stickyTop} forma={forma} onFormaChange={setForma} focusFaixa={estagioAtivo === 'acordo' ? 'acordo' : estagioAtivo} />
										<div className="mt-4 rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)]">
											<button type="button" onClick={() => setTravasOpen(v => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
												<div className="min-w-0">
													<span className="text-[13px] font-bold text-[var(--base-texto)]">Regras de contato desta régua</span>
													<p className="mt-0.5 truncate text-[11px] text-[var(--base-texto-2)]">{travasResumo(def)}</p>
												</div>
												<ChevronDown size={16} className="shrink-0 text-[var(--base-texto-3)] transition-transform" style={{ transform: travasOpen ? 'rotate(180deg)' : 'none' }} />
											</button>
											{travasOpen && <div className="border-t border-[var(--base-borda)] p-4"><TravasTabela def={def} setDef={(d) => { setDef(d); setEstrDirty(true); }} canEdit={canEdit} /></div>}
										</div>
										<div className="mt-4 flex flex-wrap items-center justify-between gap-2">
											<button type="button" onClick={() => goStep('estagios')} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--base-borda)] px-4 text-[13px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)]">Voltar: estágios</button>
											<button type="button" onClick={() => goStep('revisar')} className="flex h-9 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Continuar: revisar</button>
										</div>
										<UsarReguaModal open={usarReguaOpen} onClose={() => setUsarReguaOpen(false)} estrategias={estrategias} estrIdAtual={estrId} estagio={estagioAtivo} onAplicar={aplicarReguaOrigem} />
									</>
								)}
								{passo === 'revisar' && (
									<>
										<VisaoGeral
											def={def}
											personas={personasUsuario}
											credor={credor}
											segmentos={emUso}
											countBySeg={countBySeg}
											demaisCount={demaisCount}
											semEstagio={semEstagio}
											canEdit={canEdit}
											guardarModelo={guardarModelo}
											setGuardarModelo={setGuardarModelo}
											onSalvar={() => void salvarEstrategia()}
											saving={savingEstr}
											estrDirty={estrDirty}
											onVerEstagios={() => goStep('estagios')}
											onMontarAgora={() => goStep('regua')}
										/>
									</>
								)}
							</div>

							{estrError && <div className="mt-4"><Notice>{estrError}</Notice></div>}
						</>
					)}
				</>
			)}

			{/* ===== Gaveta "Detalhes do segmento" ===== */}
			{detalheOpen && selectedId && (
				<div className="fixed inset-0 z-[80] flex justify-end" onClick={() => setDetalheOpen(false)}>
					<div className="absolute inset-0 bg-black/40" />
					<div role="dialog" aria-modal="true" aria-label="Detalhes do segmento" className="relative flex h-full w-full max-w-[440px] flex-col bg-[var(--base-cartao)] shadow-xl" onClick={e => e.stopPropagation()}>
						{/* topo */}
						<div className="flex items-center gap-3 border-b border-[var(--base-borda)] px-5 py-4">
							<span className="grid h-8 w-8 place-items-center rounded-md text-xs font-bold" style={{ backgroundColor: 'var(--area)', color: 'var(--area-ativo-texto)' }}>{isDemais ? '··' : selectedSeg?.codigo}</span>
							<div className="min-w-0 flex-1">
								<h2 className="truncate text-base font-semibold text-[var(--base-texto)]">{isDemais ? 'Demais clientes' : selectedSeg?.nome}</h2>
							</div>
							{isDemais && !demaisAtivo && <span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--base-texto-3)]">Pausado</span>}
							{!isDemais && selectedSeg?.estrategia_propria && <span className="rounded-full bg-[var(--estado-pronto-fundo)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--estado-pronto-texto)]">Própria desta carteira</span>}
							{!isDemais && compartilhada && <span className="rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--estado-atencao-texto)]">Compartilhada</span>}
							<button onClick={() => setDetalheOpen(false)} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--base-texto-3)] hover:bg-[var(--base-fill)]"><X size={18} /></button>
						</div>
						{/* corpo */}
						<div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
							{/* Quem entra */}
							<div>
								<p className="text-[11px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Quem entra</p>
								<p className="mt-2 text-sm text-[var(--base-texto-2)]">{isDemais ? (demaisAtivo ? 'Todos os clientes que não caem em nenhum segmento acima.' : 'Quem não cai em nenhum segmento fica sem ação (acordos continuam).') : condFrase(selected)}</p>
								{!isDemais && canEdit && selected && <button onClick={() => { setEditing(selected); setFormOpen(true); }} className={`${btnNeutroCls} mt-3`}><Pencil size={14} /> Editar condições</button>}
							</div>

							{/* Demais: toggle */}
							{isDemais && canEdit && (
								<div className="flex items-center justify-between rounded-lg border border-[var(--base-borda)] px-3 py-2.5">
									<span className="text-sm font-medium text-[var(--base-texto)]">Em uso nesta carteira</span>
									<button role="switch" aria-label="Demais clientes em uso nesta carteira" aria-checked={demaisAtivo} disabled={busy === 'demais'} onClick={toggleDemais} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${demaisAtivo ? 'bg-[var(--estado-pronto)]' : 'bg-[var(--base-texto-3)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${demaisAtivo ? 'left-[18px]' : 'left-0.5'}`} /></button>
								</div>
							)}

							{/* Carteiras que usam este segmento */}
							{!isDemais && (
								<div className="border-t border-[var(--base-borda)] pt-5">
									<div className="mb-3 flex items-center justify-between">
										<h3 className="text-sm font-bold text-[var(--base-texto)]">Carteiras que usam este segmento</h3>
										{canEdit && cartDirty && <button onClick={salvarCarteiras} disabled={savingCart} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--destaque-texto)] disabled:opacity-50" style={{ backgroundColor: 'var(--destaque)' }}>{savingCart ? 'Salvando...' : 'Salvar'}</button>}
									</div>
									<div className="space-y-1.5">
										{credAtivos.map(c => {
											const st = carteiras[c.id] ?? { usa: false, ativo: false };
											return (
												<div key={c.id} className="flex items-center gap-3 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] px-3 py-2">
													{canEdit ? (
														<label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={st.usa} onChange={e => { setCarteiras(prev => ({ ...prev, [c.id]: { usa: e.target.checked, ativo: prev[c.id]?.ativo ?? true } })); setCartDirty(true); }} className="accent-[var(--area)]" /> <span className="font-medium text-[var(--base-texto)]">{c.nome}</span></label>
													) : (
														<span className="flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${st.usa ? 'bg-[var(--estado-pronto)]' : 'bg-[var(--base-texto-3)]'}`} /> <span className="font-medium text-[var(--base-texto)]">{c.nome}</span></span>
													)}
													{st.usa && canEdit && (
														<label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--base-texto-2)]">Em uso
															<button role="switch" aria-checked={st.ativo} onClick={() => { setCarteiras(prev => ({ ...prev, [c.id]: { usa: true, ativo: !prev[c.id]?.ativo } })); setCartDirty(true); }} className={`relative h-5 w-9 rounded-full transition-colors ${st.ativo ? 'bg-[var(--estado-pronto)]' : 'bg-[var(--base-texto-3)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${st.ativo ? 'left-[18px]' : 'left-0.5'}`} /></button>
														</label>
													)}
													{st.usa && !canEdit && <span className="ml-auto text-xs text-[var(--base-texto-2)]">{st.ativo ? 'Em uso' : 'Pausado'}</span>}
												</div>
											);
										})}
									</div>
									{canEdit && (
										<div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--base-borda)] px-3 py-2.5">
											<label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--base-texto)]">Ligado em todas
												<button role="switch" aria-checked={selected?.ativo} disabled={busy === 'ativo'} onClick={toggleClusterAtivo} className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${selected?.ativo ? 'bg-[var(--estado-pronto)]' : 'bg-[var(--base-texto-3)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${selected?.ativo ? 'left-[18px]' : 'left-0.5'}`} /></button>
											</label>
											<span className="text-[11px] text-[var(--base-texto-3)]">Desliga o segmento para todas as carteiras</span>
										</div>
									)}
								</div>
							)}
						</div>
						{/* rodapé */}
						<div className="flex items-center justify-between gap-3 border-t border-[var(--base-borda)] px-5 py-3">
							{!isDemais && canEdit && selectedSeg ? (
								<button onClick={() => void tirarDaCarteira(selectedSeg)} disabled={busy === selectedSeg.cluster_id} className="text-sm font-semibold text-[var(--estado-erro)] hover:underline disabled:opacity-50">Tirar da carteira</button>
							) : <span />}
							<button onClick={() => setDetalheOpen(false)} className="flex h-9 items-center rounded-lg border border-[var(--base-borda)] px-5 text-[13px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)]">Fechar</button>
						</div>
					</div>
				</div>
			)}

			{formOpen && empresa && credor && <ClusterForm cluster={editing} colunas={colunas} maxOrdem={0} credorId={credor.id} criarVinculoCredor usadoEmCarteiras={editing ? (vinculosPorCluster[editing.id] ?? 0) : undefined} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); void reload(); }} />}
			<LeaveGuardDialog open={leaveOpen} saving={savingEstr} onSalvar={leaveSalvar} onSairSemSalvar={leaveSairSemSalvar} onCancelar={leaveCancelar} />
			{matrixOpen && <MatrixCarteiras credores={credAtivos} clustersMap={clustersMap} onClose={() => setMatrixOpen(false)} onSaved={() => void reload()} />}
			<CopiarCarteiraModal open={copiarOpen} onClose={() => setCopiarOpen(false)} credores={credores} currentCredorId={credor?.id ?? ''} estrategias={estrategias} defAtual={def} destinoPersonaIds={new Set(personasUsuario.map(p => p.id))} onAplicar={aplicarCopiar} />
		{modelosOpen && <ModelosModal open={modelosOpen} onClose={() => setModelosOpen(false)} onAplicar={(d) => { void aplicarNoSegmento(d, 'Virou cópia sua: tudo editável e desligável.'); setModelosOpen(false); }} />}
		{copiarSegOpen && selectedSeg && <CopiarSegmentoModal open={copiarSegOpen} onClose={() => setCopiarSegOpen(false)} clusterId={selectedSeg.cluster_id} clusterNome={selectedSeg.nome} credores={credores} currentCredorId={credor?.id ?? ''} estrategias={estrategias} onAplicar={(d, nome) => { void aplicarNoSegmento(d, 'Copiado de ' + nome + '.'); setCopiarSegOpen(false); }} />}
			{/* Salvar flutuante — só no celular */}
			{canEdit && estrId && estrDirty && (
				<button type="button" onClick={() => void salvarEstrategia()} disabled={savingEstr} className="fixed bottom-6 right-6 z-40 flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-[var(--destaque-texto)] shadow-lg disabled:opacity-50 lg:hidden" style={{ backgroundColor: 'var(--destaque)' }}><span className="h-2 w-2 rounded-full bg-[var(--estado-atencao)]" /> Salvar</button>
			)}
		</>
	);
}

function MatrixCarteiras({ credores, clustersMap, onClose, onSaved }: {
	credores: Credor[]; clustersMap: Record<string, Cluster>; onClose: () => void; onSaved: () => void;
}) {
	const { empresa } = useMotorAuth();
	const [grid, setGrid] = useState<Record<string, Record<string, 'em_uso' | 'pausado' | null>>>({});
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [demaisMap, setDemaisMap] = useState<Record<string, boolean>>({});
	useEffect(() => {
		const m: Record<string, boolean> = {};
		credores.forEach(c => { m[c.id] = c.demais_ativo ?? true; });
		setDemaisMap(m);
	}, [credores]);

	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		(async () => {
			const { data: cls } = await supabase.from('clusters').select('id,codigo,nome,ordem,ativo').eq('empresa_id', empresa.id).order('ordem', { ascending: true });
			const { data: sc } = await supabase.from('segmentos_carteira').select('*').eq('empresa_id', empresa.id);
			if (!active) return;
			const g: Record<string, Record<string, 'em_uso' | 'pausado' | null>> = {};
			(cls ?? []).forEach((c: Row) => {
				g[c.id as string] = {};
				credores.forEach(cr => { g[c.id as string][cr.id] = null; });
			});
			(sc ?? []).forEach((r: Row) => {
				const cid = r.cluster_id as string; const cred = r.credor_id as string;
				if (g[cid]) g[cid][cred] = r.ativo ? 'em_uso' : 'pausado';
			});
			setGrid(g);
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	const rows = Object.keys(grid).sort((a, b) => {
		const ra = (clustersMap[a]?.ordem ?? 0); const rb = (clustersMap[b]?.ordem ?? 0);
		return ra - rb;
	});

	async function cycle(clusterId: string, credorId: string) {
		if (!supabase || !empresa) return;
		const cur = grid[clusterId]?.[credorId] ?? null;
		const next: 'em_uso' | 'pausado' | null = cur === null ? 'em_uso' : cur === 'em_uso' ? 'pausado' : null;
		setBusy(`${clusterId}|${credorId}`);
		setGrid(prev => ({ ...prev, [clusterId]: { ...prev[clusterId], [credorId]: next } }));
		if (next === null) {
			await supabase.from('segmentos_carteira').delete().eq('cluster_id', clusterId).eq('credor_id', credorId);
		} else {
			const { error } = await supabase.from('segmentos_carteira').upsert({ empresa_id: empresa.id, cluster_id: clusterId, credor_id: credorId, ativo: next === 'em_uso' }, { onConflict: 'cluster_id,credor_id' });
			if (error) setError(friendlyError());
		}
		setBusy('');
	}

	async function cycleDemais(c: Credor) {
		if (!supabase) return;
		const on = demaisMap[c.id] ?? true;
		if (on && !window.confirm('Os clientes que não caem em nenhum segmento em uso deixam de receber ações a partir da próxima rotina. Continuar?')) return;
		setBusy(`demais|${c.id}`);
		setDemaisMap(prev => ({ ...prev, [c.id]: !on }));
		const { error } = await supabase.from('credores').update({ demais_ativo: !on }).eq('id', c.id);
		if (error) { setError(friendlyError()); setDemaisMap(prev => ({ ...prev, [c.id]: on })); }
		else { toast.success('Vale a partir da próxima rotina (em até 1 minuto)'); onSaved(); }
		setBusy('');
	}

	return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
		<div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
			<div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Todas as carteiras</h2><button onClick={() => { onClose(); onSaved(); }} className="text-sm font-semibold text-[#0F4C5C]">Fechar</button></div>
			<p className="mb-4 text-xs text-slate-500">Clique numa célula para alternar: — → Em uso → Pausado → —.</p>
			{error && <div className="mb-4"><Notice>{error}</Notice></div>}
			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<thead><tr><th className="sticky left-0 z-10 bg-white pb-3 pr-4 text-left text-xs font-medium text-slate-400">Segmento</th>{credores.map(c => <th key={c.id} className="pb-3 px-2 text-center text-xs font-medium text-slate-400">{c.nome}</th>)}</tr></thead>
					<tbody>
						{rows.map(cid => {
							const cl = clustersMap[cid];
							return <tr key={cid} className="border-t border-[#eef3f4]">
								<td className="sticky left-0 z-10 bg-white py-2 pr-4"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded bg-[#0F4C5C] text-[9px] font-bold text-white">{cl?.codigo ?? '··'}</span><span className="text-sm font-medium">{cl?.nome ?? cid}</span></div></td>
								{credores.map(c => {
									const v = grid[cid]?.[c.id] ?? null;
									return <td key={c.id} className="px-2 py-2 text-center"><button onClick={() => cycle(cid, c.id)} disabled={busy === `${cid}|${c.id}`} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${v === 'em_uso' ? 'bg-green-100 text-[#2E7D32]' : v === 'pausado' ? 'bg-slate-100 text-slate-500' : 'text-slate-300 hover:bg-[#f5f8f9]'}`}>{v === 'em_uso' ? '✓ Em uso' : v === 'pausado' ? '⏸ Pausado' : '—'}</button></td>;
								})}
							</tr>;
						})}
						<tr className="border-t-2 border-[#dfe8ea] bg-[#fafcfc]">
							<td className="sticky left-0 z-10 bg-[#fafcfc] py-2 pr-4"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded bg-slate-300 text-[9px] font-bold text-slate-600">··</span><span className="text-sm font-medium">Demais clientes</span></div></td>
							{credores.map(c => {
								const on = demaisMap[c.id] ?? true;
								return <td key={c.id} className="px-2 py-2 text-center"><button onClick={() => cycleDemais(c)} disabled={busy === `demais|${c.id}`} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? 'bg-green-100 text-[#2E7D32]' : 'bg-slate-100 text-slate-500'}`}>{on ? '✓ Em uso' : '⏸ Pausado'}</button></td>;
							})}
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>;
}
