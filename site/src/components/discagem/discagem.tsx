import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Phone } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { usePermissao, PageHeading, Notice, Loading } from '@/components/app-shell';
import { PERM } from '@/lib/permissoes';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { SUGESTOES, effectiveDiscagem, computeDiff, computeLigacoes, stableEqual, type Discagem, type DiscagemExecResumo, type LigacoesInfo } from '@/lib/discagem';
import { ChamadasCurtas } from './chamadas-curtas';
import { Renitencia } from './renitencia';
import { Horarios } from './horarios';
import { ResultadoDia } from './resultado-dia';

type TabId = 'curtas' | 'renitencia' | 'horarios' | 'resultado';
const TABS: { id: TabId; nome: string }[] = [
	{ id: 'curtas', nome: 'Chamadas curtas' },
	{ id: 'renitencia', nome: 'Renitência' },
	{ id: 'horarios', nome: 'Horários' },
	{ id: 'resultado', nome: 'Resultado do dia' },
];

export function Discagem() {
	const { empresa, credor } = useMotorAuth();
	const canEdit = usePermissao(PERM.editarCredores);
	const [tab, setTab] = useState<TabId>('curtas');
	const [draft, setDraft] = useState<Discagem>(SUGESTOES);
	const [stored, setStored] = useState<Record<string, unknown> | null>(null);
	const [dirty, setDirty] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [exec, setExec] = useState<{ resumo: DiscagemExecResumo | null; alertas: string[] } | null>(null);
	const [ligacoes, setLigacoes] = useState<LigacoesInfo>({});

	useEffect(() => { if (credor) void reload(); }, [credor?.id]);

	async function reload() {
		if (!supabase || !credor) return;
		setLoading(true); setError('');
		const [c, ex, segs] = await Promise.all([
			supabase.from('credores').select('*').eq('id', credor.id).maybeSingle(),
			supabase.from('execucoes').select('*').eq('credor_id', credor.id).order('iniciada_em', { ascending: false }).limit(1),
			supabase.from('segmentos_em_uso').select('estrategia_id,nome').eq('credor_id', credor.id).eq('vinculado', true),
		]);
		if (c.error) { setError(friendlyError(c.error)); setLoading(false); return; }
		const disc = (c.data as Row | null)?.discagem as Record<string, unknown> | null | undefined;
		setStored(disc ?? null);
		setDraft(effectiveDiscagem(disc));
		setDirty(false);
		// Execução
		const exRow = (ex.data?.[0] as Row | undefined);
		if (exRow) {
			const resumo = (exRow.resumo as { discagem?: DiscagemExecResumo } | null)?.discagem ?? null;
			setExec({ resumo, alertas: (exRow.alertas as string[] | null) ?? [] });
		} else {
			setExec(null);
		}
		// Travas de ligações das estratégias dos segmentos
		const estrIds = Array.from(new Set((segs.data ?? []).map((r: Row) => r.estrategia_id as string).filter(Boolean)));
		if (estrIds.length && supabase && empresa) {
			const { data: estrs } = await supabase.from('estrategias').select('id,nome,definicao').in('id', estrIds).eq('empresa_id', empresa.id);
			const lista = ((estrs ?? []) as Row[]).map(r => ({ id: r.id as string, nome: r.nome as string, definicao: (r.definicao as Record<string, unknown> | null) ?? null }));
			setLigacoes(computeLigacoes(lista));
		} else {
			setLigacoes({});
		}
		setLoading(false);
	}

	function update(patch: Partial<Discagem>) { setDraft(prev => ({ ...prev, ...patch })); setDirty(true); }
	function reverter(key: keyof Discagem) {
		const sug = (SUGESTOES as Discagem)[key];
		update({ [key]: sug } as Partial<Discagem>);
	}

	async function salvar() {
		if (!supabase || !credor) return;
		setSaving(true);
		const diff = computeDiff(draft);
		const { error: uerr } = await supabase.from('credores').update({ discagem: diff }).eq('id', credor.id);
		if (uerr) { toast.error(friendlyError(uerr)); setSaving(false); return; }
		setStored(diff); setDirty(false);
		toast.success('Salvo. Vale na próxima lista do dia.');
		setSaving(false);
	}

	if (!empresa) return <><PageHeading title="Discagem" description="Regras de discagem da carteira." /><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!credor) return <><PageHeading title="Discagem" description="Regras de discagem da carteira." /><Notice variant="warning">Escolha a carteira no topo.</Notice></>;

	return (
		<>
			<PageHeading title="Discagem" description="Regras de discagem da carteira. Chaves ausentes seguem a sugestão do MotorCX." actions={
				canEdit ? (
					<button type="button" onClick={() => void salvar()} disabled={saving || !dirty} className="flex h-9 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold text-[var(--destaque-texto)] disabled:opacity-50" style={{ backgroundColor: 'var(--destaque)' }}>
						{dirty && <span className="h-2 w-2 rounded-full bg-[var(--estado-atencao)]" />}
						{saving ? 'Salvando...' : dirty ? 'Salvar alterações' : 'Salvar'}
					</button>
				) : null
			} />

			<div className="mb-4 flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]">
				<Phone size={15} className="text-[var(--base-texto-3)]" />
				<span>Carteira: <strong className="text-[var(--base-texto)]">{credor.nome}</strong></span>
				{!canEdit && <span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10px] font-bold text-[var(--base-texto-3)]">somente leitura</span>}
			</div>

			{loading ? <Loading /> : error ? <Notice>{error}</Notice> : (
				<>
					<div className="mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--base-borda)' }}>
						{TABS.map(t => (
							<button key={t.id} type="button" onClick={() => setTab(t.id)} className={`shrink-0 border-b-2 px-4 py-2 text-[13px] font-semibold transition-colors ${tab === t.id ? '' : 'border-transparent text-[var(--base-texto-3)] hover:text-[var(--base-texto)]'}`} style={tab === t.id ? { borderColor: 'var(--area)', color: 'var(--base-texto)' } : undefined}>
								{t.nome}
							</button>
						))}
					</div>

					{tab === 'curtas' && <ChamadasCurtas draft={draft} update={update} reverter={reverter} canEdit={canEdit} exec={exec} />}
					{tab === 'renitencia' && <Renitencia draft={draft} update={update} reverter={reverter} canEdit={canEdit} ligacoes={ligacoes} />}
					{tab === 'horarios' && <Horarios draft={draft} update={update} reverter={reverter} canEdit={canEdit} exec={exec} />}
					{tab === 'resultado' && <ResultadoDia exec={exec} />}
				</>
			)}
		</>
	);
}
