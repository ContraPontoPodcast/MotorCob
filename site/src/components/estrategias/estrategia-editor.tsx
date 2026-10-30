import { useEffect, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { Loading, Notice, PageHeading, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase } from '@/lib/supabase';
import { definicaoVazia, isVazia, type Definicao, type Estrategia } from '@/lib/estrategia';
import { EstrategiaEditorCore } from '@/components/estrategias/estrategia-editor-core';
import { LeaveGuardDialog } from '@/components/estrategias/leave-guard-dialog';
import { ExportarButton } from '@/components/estrategias/exportar-button';
import { computarResumoFicha } from '@/components/estrategias/ficha-estrategia';

export function EstrategiaEditor() {
	const { id } = useParams();
	const navigate = useNavigate();
	const { empresa } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [nome, setNome] = useState('');
	const [descricao, setDescricao] = useState('');
	const [def, setDef] = useState<Definicao>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [existing, setExisting] = useState<Estrategia | null>(null);
	const [segmentos, setSegmentos] = useState<string[]>([]);
	const [dirty, setDirty] = useState(false);
	const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
	const routeBlocked = blocker.state === 'blocked';

	const novo = id === 'nova';

	useEffect(() => {
		if (!empresa) { setLoading(false); return; }
		if (novo) { setDef({}); setLoading(false); return; }
		if (!supabase) { setLoading(false); return; }
		let active = true;
		supabase.from('estrategias').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
			if (!active) return;
			if (error || !data) { setError(friendlyError()); setLoading(false); return; }
			const e = data as Estrategia;
			if (e.empresa_id !== empresa.id) { setError('A estratégia escolhida é de outra empresa.'); setLoading(false); return; }
			setExisting(e); setNome(e.nome); setDescricao(e.descricao ?? ''); setDef(e.definicao ?? {}); setLoading(false);
		});
		return () => { active = false; };
	}, [id, empresa?.id]);

	// Carrega os segmentos (clusters) que usam esta estratégia.
	useEffect(() => {
		if (!supabase || !empresa || novo || !id) { setSegmentos([]); return; }
		let active = true;
		supabase.from('clusters').select('nome').eq('empresa_id', empresa.id).eq('estrategia_id', id).order('nome').then(({ data }) => {
			if (!active) return;
			setSegmentos((data ?? []).map((r: { nome: string }) => r.nome));
		});
		return () => { active = false; };
	}, [id, empresa?.id, novo]);

	async function persistir(): Promise<boolean> {
		if (!supabase || !empresa) return false;
		if (!nome.trim()) { setError('Informe o nome da estratégia.'); return false; }
		setSaving(true); setError('');
		const limpo: Definicao = {};
		if (def.localizacao) limpo.localizacao = def.localizacao;
		if (def.cpc) limpo.cpc = def.cpc;
		if (def.giro) limpo.giro = def.giro;
		if (def.preventivo) limpo.preventivo = def.preventivo;
		if (def.quebra) limpo.quebra = def.quebra;
		if (def.prioridade_contatos) limpo.prioridade_contatos = def.prioridade_contatos;
		if (def.mensagens) limpo.mensagens = def.mensagens;
		if (def.travas) limpo.travas = def.travas;
		// NUNCA grave definicao = {} (o motor lê {} como o playbook inteiro).
		if (!limpo.localizacao && !limpo.cpc && !limpo.giro && !limpo.preventivo && !limpo.quebra) {
			const v = definicaoVazia();
			limpo.localizacao = v.localizacao; limpo.cpc = v.cpc; limpo.giro = v.giro; limpo.preventivo = v.preventivo; limpo.quebra = v.quebra;
		}
		const payload = { empresa_id: empresa.id, nome: nome.trim(), descricao: descricao.trim() || null, definicao: limpo as unknown as Record<string, unknown> };
		try {
			const res = existing
				? await supabase.from('estrategias').update(payload).eq('id', existing.id).select('id').single()
				: await supabase.from('estrategias').insert(payload).select('id').single();
			if (res.error) { setError(friendlyError()); setSaving(false); return false; }
			setDirty(false); setSaving(false); return true;
		} catch (e) { setError(friendlyError(e)); setSaving(false); return false; }
	}

	async function salvar() {
		const ok = await persistir();
		if (ok) navigate('/orquestracao');
	}

	async function leaveSalvar() {
		const ok = await persistir();
		if (!ok) { if (routeBlocked) blocker.reset(); return; }
		if (routeBlocked) blocker.proceed();
	}
	function leaveSairSemSalvar() { setDirty(false); if (routeBlocked) blocker.proceed(); }
	function leaveCancelar() { if (routeBlocked) blocker.reset(); }

	if (!empresa) return <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>;
	if (loading) return <Loading/>;
	if (!canEdit) return <Notice>Acesso não autorizado para este perfil.</Notice>;

	return <>
		<PageHeading eyebrow="CONFIGURAÇÃO / OPERAÇÃO" title={novo ? 'Nova estratégia' : 'Editar estratégia'} description="Defina, fase por fase, quais canais acionar, em que dia, em qual ordem e em quais contatos." actions={!novo && existing ? <ExportarButton dados={{ nome, empresaNome: empresa?.nome ?? '', credorNome: '', segmentos, def, personas: [], contagens: {}, resumo: computarResumoFicha(def, []) }} estrId={existing.id} /> : null} />
		<div className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
			<div className="grid gap-4 sm:grid-cols-2">
				<div><label className="mb-2 block text-xs font-semibold">Nome</label><input value={nome} onChange={e => { setNome(e.target.value); setDirty(true); }} placeholder="Nome da estratégia" className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
				<div><label className="mb-2 block text-xs font-semibold">Descrição</label><input value={descricao} onChange={e => { setDescricao(e.target.value); setDirty(true); }} placeholder="Resumo curto (opcional)" className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
			</div>
		</div>
		<div className="mt-6"><EstrategiaEditorCore def={def} setDef={(d) => { setDef(d); setDirty(true); }} /></div>
		{error && <div className="mt-5"><Notice>{error}</Notice></div>}
		<div className="mt-6 flex justify-end gap-3">
			<button onClick={() => navigate('/orquestracao')} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
			<button onClick={salvar} disabled={saving} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar'}</button>
		</div>
		<LeaveGuardDialog open={routeBlocked} saving={saving} onSalvar={leaveSalvar} onSairSemSalvar={leaveSairSemSalvar} onCancelar={leaveCancelar} />
	</>;
}
