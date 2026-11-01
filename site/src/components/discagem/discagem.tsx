import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { History, Phone, RotateCcw, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { usePermissao, PageHeading, Notice, Loading } from '@/components/app-shell';
import { PERM } from '@/lib/permissoes';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { effectiveDiscagem, computeDiff, computeLigacoes, type Discagem as DiscagemT, type DiscagemExecResumo, type LigacoesInfo } from '@/lib/discagem';
import { resumoMudancas, type DiscagemRen } from '@/lib/renitencia';
import { ChamadasCurtas } from './chamadas-curtas';
import { RenitenciaSituacao } from './renitencia-situacao';
import { Resubmit } from './resubmit';
import { ContatoPassada } from './passadas';
import { Horarios } from './horarios';
import { ResultadoDia } from './resultado-dia';

// Abas da Discagem. Renitência por situação, Resubmit e Contato por passada: SQL 65 (protótipo de 01/11/2026).
// Toda gravação passa por salvar_discagem (valida, versiona e audita; recusa se outra pessoa salvou antes).
type TabId = 'curtas' | 'renitencia' | 'resubmit' | 'passadas' | 'horarios' | 'resultado';
const TABS: { id: TabId; nome: string; novo?: boolean }[] = [
	{ id: 'curtas', nome: 'Chamadas curtas' },
	{ id: 'renitencia', nome: 'Renitência por situação', novo: true },
	{ id: 'resubmit', nome: 'Resubmit', novo: true },
	{ id: 'passadas', nome: 'Contato por passada', novo: true },
	{ id: 'horarios', nome: 'Horários' },
	{ id: 'resultado', nome: 'Resultado do dia' },
];

type Versao = { versao: number; regras: Record<string, unknown> | null; resumo: string[]; motivo: string | null; criado_em: string };
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);
	return (
		<div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label={titulo} className="my-auto flex w-full max-w-[520px] flex-col gap-3 rounded-2xl border p-5" style={{ backgroundColor: 'var(--base-cartao)', borderColor: 'var(--base-borda)', boxShadow: '0 18px 48px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
				<h2 className="text-[17px] font-bold text-[var(--base-texto)]">{titulo}</h2>
				{children}
			</div>
		</div>
	);
}

const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold disabled:opacity-50';
const btnSec = `${btn} border text-[var(--base-texto)]`;

export function Discagem() {
	const { empresa, credor } = useMotorAuth();
	const canEdit = usePermissao(PERM.editarCredores);
	const [tab, setTab] = useState<TabId>('renitencia');
	const [draft, setDraft] = useState<DiscagemT>(effectiveDiscagem(null));
	const [stored, setStored] = useState<Record<string, unknown> | null>(null);
	const [dirty, setDirty] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [exec, setExec] = useState<{ resumo: DiscagemExecResumo | null; alertas: string[] } | null>(null);
	const [ligacoes, setLigacoes] = useState<LigacoesInfo>({});
	const [versoes, setVersoes] = useState<Versao[]>([]);
	const [sobre, setSobre] = useState<null | 'salvar' | 'padrao' | 'historico'>(null);
	const [motivo, setMotivo] = useState('');

	useEffect(() => { if (credor) void reload(); }, [credor?.id]);

	async function reload() {
		if (!supabase || !credor) return;
		setLoading(true); setError('');
		const [c, ex, segs, vs] = await Promise.all([
			supabase.from('credores').select('*').eq('id', credor.id).maybeSingle(),
			supabase.from('execucoes').select('*').eq('credor_id', credor.id).order('iniciada_em', { ascending: false }).limit(1),
			supabase.from('segmentos_em_uso').select('estrategia_id,nome').eq('credor_id', credor.id).eq('vinculado', true),
			supabase.from('regras_voz_versoes').select('versao,regras,resumo,motivo,criado_em').eq('credor_id', credor.id).order('versao', { ascending: false }).limit(50),
		]);
		if (c.error) { setError(friendlyError(c.error)); setLoading(false); return; }
		const disc = (c.data as Row | null)?.discagem as Record<string, unknown> | null | undefined;
		setStored(disc ?? null);
		setDraft(effectiveDiscagem(disc));
		setDirty(false);
		setVersoes(vs.error ? [] : ((vs.data ?? []) as Versao[]));
		const exRow = (ex.data?.[0] as Row | undefined);
		setExec(exRow ? { resumo: (exRow.resumo as { discagem?: DiscagemExecResumo } | null)?.discagem ?? null, alertas: (exRow.alertas as string[] | null) ?? [] } : null);
		const estrIds = Array.from(new Set((segs.data ?? []).map((r: Row) => r.estrategia_id as string).filter(Boolean)));
		if (estrIds.length && supabase && empresa) {
			const { data: estrs } = await supabase.from('estrategias').select('id,nome,definicao').in('id', estrIds).eq('empresa_id', empresa.id);
			setLigacoes(computeLigacoes(((estrs ?? []) as Row[]).map(r => ({ id: r.id as string, nome: r.nome as string, definicao: (r.definicao as Record<string, unknown> | null) ?? null }))));
		} else {
			setLigacoes({});
		}
		setLoading(false);
	}

	const atual = versoes[0]?.versao ?? 0;
	const proxima = Math.max(atual, 1) + 1;
	const diff = computeDiff(draft);
	const pendentes = dirty ? resumoMudancas(stored as DiscagemRen, diff as DiscagemRen) : [];
	const mudouOutra = dirty && pendentes.length === 0 && JSON.stringify(diff) !== JSON.stringify(stored ?? {});

	function update(patch: Partial<DiscagemT>) { setDraft(prev => ({ ...prev, ...patch })); setDirty(true); }
	function trocar(d: DiscagemT) { setDraft(d); setDirty(true); }
	function reverter(key: keyof DiscagemT) { update({ [key]: (effectiveDiscagem(null) as DiscagemT)[key] } as Partial<DiscagemT>); }

	async function salvar() {
		if (!supabase || !credor) return;
		setSaving(true);
		const { data, error: e } = await supabase.rpc('salvar_discagem', {
			credor: Number(credor.id), regras: diff, versao_base: atual, motivo: motivo.trim() || null,
			resumo: (pendentes.length ? pendentes : ['Ajustes de chamadas curtas ou horários']).slice(0, 200),
		});
		setSaving(false);
		if (e) { toast.error(friendlyError(e)); return; }
		setSobre(null); setMotivo('');
		toast.success(`v${data} salva. Vale na próxima lista do dia e na próxima onda.`);
		await reload();
	}

	if (!empresa) return <><PageHeading title="Discagem" description="Regras de discagem da carteira." /><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!credor) return <><PageHeading title="Discagem" description="Regras de discagem da carteira." /><Notice variant="warning">Escolha a carteira no topo.</Notice></>;

	const edita = tab !== 'passadas' && tab !== 'resultado';
	const nPend = pendentes.length + (mudouOutra ? 1 : 0);

	return (
		<>
			<PageHeading title="Discagem" description="Regras de discagem e renitência da carteira. Chaves ausentes seguem o padrão MotorCX (o que o motor faz hoje)." actions={
				<div className="flex flex-wrap items-center gap-2">
					<button type="button" className={btnSec} style={{ borderColor: 'var(--base-borda)' }} onClick={() => setSobre('historico')}><History size={14} /> Histórico{atual ? ` · v${atual}` : ''}</button>
					{canEdit && <button type="button" className={btnSec} style={{ borderColor: 'var(--base-borda)' }} onClick={() => setSobre('padrao')}><RotateCcw size={14} /> Voltar ao padrão MotorCX</button>}
				</div>
			} />

			<div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-[var(--base-texto-2)]">
				<Phone size={15} className="text-[var(--base-texto-3)]" />
				<span>Carteira: <strong className="text-[var(--base-texto)]">{credor.nome}</strong></span>
				{!canEdit && <span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10px] font-bold text-[var(--base-texto-3)]">somente leitura</span>}
			</div>

			{loading ? <Loading /> : error ? <Notice>{error}</Notice> : (
				<>
					<div role="tablist" aria-label="Discagem" className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--base-fill)] p-1" style={{ scrollbarWidth: 'none' }}>
						{TABS.map(t => (
							<button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
								className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] ${tab === t.id ? 'font-semibold text-[var(--base-texto)] shadow-sm' : 'text-[var(--base-texto-2)]'}`}
								style={tab === t.id ? { backgroundColor: 'var(--base-cartao)' } : undefined}>
								{t.nome}{t.novo && <span className="rounded-full px-1.5 text-[10px] font-bold uppercase" style={{ backgroundColor: 'var(--base-cartao)', color: 'var(--area)' }}>novo</span>}
							</button>
						))}
					</div>

					{tab === 'curtas' && <ChamadasCurtas draft={draft} update={update} reverter={reverter} canEdit={canEdit} exec={exec} />}
					{tab === 'renitencia' && <RenitenciaSituacao draft={draft} setDraft={trocar} canEdit={canEdit} ligacoes={ligacoes} />}
					{tab === 'resubmit' && <Resubmit draft={draft} setDraft={trocar} canEdit={canEdit} />}
					{tab === 'passadas' && <ContatoPassada irResubmit={() => setTab('resubmit')} />}
					{tab === 'horarios' && <Horarios draft={draft} update={update} reverter={reverter} canEdit={canEdit} exec={exec} />}
					{tab === 'resultado' && <ResultadoDia exec={exec} />}

					{edita && (nPend > 0 && canEdit ? (
						<div role="region" aria-label="Alterações não salvas" className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-[13px]" style={{ borderColor: 'var(--area)', backgroundColor: 'var(--base-cartao)', boxShadow: '0 18px 48px rgba(0,0,0,.18)' }}>
							<b className="text-[var(--base-texto)]">{nPend} {nPend === 1 ? 'alteração não salva' : 'alterações não salvas'}</b>
							<span className="text-[12px] text-[var(--base-texto-2)]">em {credor.nome} · vale na próxima onda depois de salvar</span>
							<span className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
								<button type="button" className={`${btnSec} flex-1 sm:flex-none`} style={{ borderColor: 'var(--base-borda)' }} onClick={() => { setDraft(effectiveDiscagem(stored)); setDirty(false); toast('Alterações descartadas.'); }}>Descartar</button>
								<button type="button" className={`${btn} flex-1 text-[var(--destaque-texto)] sm:flex-none`} style={{ backgroundColor: 'var(--destaque)' }} onClick={() => setSobre('salvar')}>Salvar como v{proxima}</button>
							</span>
						</div>
					) : (
						<p className="mt-5 text-[11.5px] text-[var(--base-texto-3)]">
							{versoes[0] ? `Versão em uso: v${atual}, salva em ${quando(versoes[0].criado_em)}.` : 'Ainda sem histórico: a primeira gravação guarda como v1 o que vale hoje.'} Toda mudança vira uma versão nova, com o antes e depois, e fica na Auditoria.
						</p>
					))}
				</>
			)}

			{sobre === 'salvar' && (
				<Modal titulo={`Salvar como v${proxima}?`} onClose={() => setSobre(null)}>
					<p className="text-[13.5px] text-[var(--base-texto-2)]">{credor.nome} · vale a partir da próxima onda. Fica no histórico com o antes e depois.</p>
					<ul className="flex max-h-[220px] list-disc flex-col gap-1 overflow-auto pl-5 text-[13px] text-[var(--base-texto)]">
						{pendentes.map(x => <li key={x}>{x}</li>)}
						{mudouOutra && <li>Ajustes de chamadas curtas ou horários</li>}
					</ul>
					<label className="text-[12px] text-[var(--base-texto-2)]" htmlFor="motivo-discagem">Motivo (opcional, sem dados de clientes)</label>
					<textarea id="motivo-discagem" maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: teste de volta mais cedo para Ocupado"
						className="min-h-[56px] w-full rounded-xl border bg-[var(--base-cartao)] px-3 py-2 text-[13px] text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }} />
					<div className="flex flex-wrap justify-end gap-2">
						<button type="button" className={btnSec} style={{ borderColor: 'var(--base-borda)' }} onClick={() => setSobre(null)}>Voltar</button>
						<button type="button" disabled={saving} className={`${btn} text-[var(--destaque-texto)]`} style={{ backgroundColor: 'var(--destaque)' }} onClick={() => void salvar()}>{saving ? 'Salvando…' : `Salvar v${proxima}`}</button>
					</div>
				</Modal>
			)}
			{sobre === 'padrao' && (() => {
				const n = resumoMudancas(diff as DiscagemRen, {}).length;
				return (
					<Modal titulo="Voltar ao padrão MotorCX?" onClose={() => setSobre(null)}>
						<p className="text-[13.5px] text-[var(--base-texto-2)]">{n ? `${n} ${n === 1 ? 'valor volta' : 'valores voltam'} ao padrão em ${credor.nome} (o que o motor faz hoje, sem o Resubmit). Nada vale até salvar; a versão atual continua no histórico.` : 'Esta carteira já está no padrão MotorCX.'}</p>
						<div className="flex flex-wrap justify-end gap-2">
							<button type="button" className={btnSec} style={{ borderColor: 'var(--base-borda)' }} onClick={() => setSobre(null)}>Cancelar</button>
							<button type="button" disabled={!n} className={`${btn} text-[var(--destaque-texto)]`} style={{ backgroundColor: 'var(--destaque)' }} onClick={() => { trocar(effectiveDiscagem(null)); setSobre(null); toast('Padrão MotorCX carregado. Salve para valer.'); }}>Voltar ao padrão</button>
						</div>
					</Modal>
				);
			})()}
			{sobre === 'historico' && (
				<div className="fixed inset-0 z-[120] bg-black/35" onClick={() => setSobre(null)}>
					<aside role="dialog" aria-modal="true" aria-label="Histórico" className="absolute bottom-0 right-0 top-0 flex w-[440px] max-w-full flex-col border-l" style={{ backgroundColor: 'var(--base-cartao)', borderColor: 'var(--base-borda)' }} onClick={e => e.stopPropagation()}>
						<div className="flex items-center gap-2 border-b px-4 py-3.5" style={{ borderColor: 'var(--base-borda)' }}>
							<h2 className="text-[17px] font-bold text-[var(--base-texto)]">Histórico · {credor.nome}</h2>
							<button type="button" aria-label="Fechar" onClick={() => setSobre(null)} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><X size={16} /></button>
						</div>
						<div className="flex flex-col gap-3 overflow-auto px-4 py-4">
							<p className="text-[11.5px] text-[var(--base-texto-3)]">Cada versão guarda as regras inteiras. Também fica na Auditoria da empresa (quem, quando, antes e depois).</p>
							{versoes.length === 0 && <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma versão ainda.</p>}
							{versoes.map((v, i) => (
								<div key={v.versao} className="flex flex-col gap-1.5 rounded-xl border p-3 text-[13px] text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>
									<div className="flex flex-wrap items-center gap-2"><b>v{v.versao}</b>{i === 0 && <span className="rounded-full bg-[var(--estado-pronto-fundo,var(--base-fill))] px-2 text-[11px] font-semibold text-[var(--estado-pronto)]">em uso</span>}<span className="text-[12px] text-[var(--base-texto-2)]">{quando(v.criado_em)}</span></div>
									{v.resumo?.length > 0 && <ul className="list-disc pl-5 text-[12.5px] text-[var(--base-texto-2)]">{v.resumo.map(x => <li key={x}>{x}</li>)}</ul>}
									{v.motivo && <span className="text-[12px] text-[var(--base-texto-2)]">Motivo: {v.motivo}</span>}
									{i > 0 && canEdit && <div><button type="button" className={btnSec} style={{ borderColor: 'var(--base-borda)' }} onClick={() => { trocar(effectiveDiscagem(v.regras)); setSobre(null); toast(`Versão v${v.versao} carregada. Salve para ela voltar a valer.`); }}>Carregar esta versão</button></div>}
								</div>
							))}
						</div>
					</aside>
				</div>
			)}
		</>
	);
}
