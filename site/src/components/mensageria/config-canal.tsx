import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { supabase, friendlyError, moneyBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { isCanalValido } from '@/lib/mensageria-produtos';

export function ConfigCanal() {
	const { canal } = useParams();
	const { empresa, permissoes } = useMotorAuth();
	const canEdit = permissoes.includes('editar_canais');
	const [centros, setCentros] = useState<Row[]>([]);
	const [orcamentos, setOrcamentos] = useState<Record<string, Row>>({});
	const [centroDia, setCentroDia] = useState('');
	const [rcsFallback, setRcsFallback] = useState('sms');
	const [rcsFallbackTemplate, setRcsFallbackTemplate] = useState('');
	const [templatesSms, setTemplatesSms] = useState<Row[]>([]);
	const [rcsAgente, setRcsAgente] = useState('nao_conversacional');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [sucesso, setSucesso] = useState('');
	const [editCentro, setEditCentro] = useState<Row | null | 'novo'>(null);

	async function reload() {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		setLoading(true);
		const [cc, cfg, ts] = await Promise.all([
			supabase.from('mensageria_centros_custo').select('*').eq('empresa_id', empresa.id).order('nome'),
			supabase.from('mensageria_config').select('*').eq('empresa_id', empresa.id).maybeSingle(),
			supabase.from('mensageria_templates').select('id,nome').eq('empresa_id', empresa.id).eq('canal', 'sms').eq('situacao', 'ativo').order('nome'),
		]);
		const c = cfg.data as Row | null;
		setCentros(cc.data ?? []);
		setCentroDia(c?.centro_custo_id ?? '');
		setRcsFallback(c?.rcs_fallback ?? 'sms');
		setRcsFallbackTemplate(c?.rcs_fallback_template ?? '');
		setRcsAgente(c?.rcs_agente ?? 'nao_conversacional');
		setTemplatesSms(ts.data ?? []);
		setLoading(false);
		// orçamentos
		const orc: Record<string, Row> = {};
		for (const centro of cc.data ?? []) {
			const { data } = await supabase.rpc('orcamento_centro', { centro: centro.id });
			orc[centro.id] = data as Row;
		}
		setOrcamentos(orc);
	}
	useEffect(() => { void reload(); }, [empresa?.id, canal]);

	async function salvarListaDia() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro(''); setSucesso('');
		const payload: Record<string, unknown> = { empresa: empresa.id, centro_custo: centroDia || null };
		if (canal === 'rcs') { payload.rcs_fallback = rcsFallback; payload.rcs_fallback_template = rcsFallbackTemplate || null; }
		const { error } = await supabase.rpc('configurar_mensageria', payload);
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		setSucesso('Configuração salva.');
	}

	if (!isCanalValido(canal)) return null;
	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	return (
		<div className="space-y-4">
			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}
			{sucesso && <div className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{sucesso}</div>}

			{/* Centros de custo */}
			<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="mb-4 flex items-center justify-between">
					<div><p className="text-[16px] font-semibold text-[#1D1D1F]">Centros de custo</p><p className="mt-0.5 text-[13px] text-[#6E6E73]">Gasto estimado pelos preços do seu contrato.</p></div>
					{canEdit && <button onClick={() => setEditCentro('novo')} className="h-9 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85">Novo centro</button>}
				</div>
				{centros.length === 0 ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Nenhum centro de custo.</p> : (
					<div className="space-y-3">
						{centros.map(c => {
							const orc = orcamentos[c.id];
							const gasto = +(orc?.gasto ?? 0); const orcamento = +(c.orcamento ?? 0);
							const pctVal = orcamento > 0 ? Math.min(100, (gasto / orcamento) * 100) : 0;
							const cor = orc?.alerta || pctVal >= 100 ? '#FF3B30' : pctVal >= 80 ? '#FF9500' : '#34C759';
							return (
								<div key={c.id} className="rounded-xl border border-[#E5E5EA] p-4">
									<div className="flex items-center justify-between">
										<span className="text-[15px] font-medium text-[#1D1D1F]">{c.nome}</span>
										{canEdit && <button onClick={() => setEditCentro(c)} className="text-[13px] font-medium text-[#0A60D0] hover:underline">Editar</button>}
									</div>
									{orcamento > 0 && (<>
										<div className="mt-2 flex items-center justify-between text-[13px] text-[#6E6E73]"><span>Orçamento: {moneyBR(orcamento)}</span><span>Gasto: {moneyBR(gasto)} · Restante: {moneyBR(orc?.restante ?? orcamento - gasto)}</span></div>
										<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#F5F5F7]"><div className="h-full rounded-full" style={{ width: `${pctVal}%`, backgroundColor: cor }} /></div>
										<p className="mt-1 text-[12px] text-[#8E8E93]">Ao acabar: {c.ao_acabar === 'bloquear' ? 'Bloquear envios' : 'Enviar mesmo assim'} · Alerta em {c.alerta_pct ?? 80}%</p>
									</>)}
								</div>
							);
						})}
					</div>
				)}
			</section>

			{/* Lista do dia */}
			<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<p className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Lista do dia</p>
				<div className="max-w-[480px] space-y-4">
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Centro de custo da Lista do dia</label>
						<select value={centroDia} onChange={e => setCentroDia(e.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none disabled:bg-[#F5F5F7]">
							<option value="">Sem centro de custo</option>
							{centros.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
						</select>
					</div>
					{canal === 'rcs' && (
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Se o aparelho não tiver RCS</label>
							<select value={rcsFallback} onChange={e => setRcsFallback(e.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none disabled:bg-[#F5F5F7]">
								<option value="sms">Enviar por SMS</option>
								<option value="whatsapp">Enviar por WhatsApp</option>
								<option value="nenhum">Não enviar</option>
							</select>
							{rcsFallback === 'sms' && (
								<select value={rcsFallbackTemplate} onChange={e => setRcsFallbackTemplate(e.target.value)} disabled={!canEdit} className="mt-2 h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none disabled:bg-[#F5F5F7]">
									<option value="">Template do SMS de fallback (vazio = texto do RCS)</option>
									{templatesSms.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
								</select>
							)}
						</div>
					)}
					{canal === 'rcs' && (
						<div className="rounded-lg border border-[#E5E5EA] px-4 py-3">
							<p className="text-[14px] font-medium text-[#1D1D1F]">Agente RCS</p>
							<p className="mt-1 text-[13px] text-[#6E6E73]">{rcsAgente === 'conversacional' ? 'Conversacional' : 'Não conversacional'} · {canEdit ? 'mude em Empresa › Módulos' : 'configurado pela equipe MotorCX'}</p>
						</div>
					)}
					{canEdit && <button onClick={salvarListaDia} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Salvar'}</button>}
				</div>
			</section>

			{editCentro && <CentroModal existente={editCentro === 'novo' ? null : editCentro} onClose={() => setEditCentro(null)} onSaved={() => { setEditCentro(null); void reload(); }} />}
		</div>
	);
}

function CentroModal({ existente, onClose, onSaved }: { existente: Row | null; onClose: () => void; onSaved: () => void }) {
	const { empresa } = useMotorAuth();
	const [nome, setNome] = useState(existente?.nome ?? '');
	const [orcamento, setOrcamento] = useState(existente?.orcamento ?? '');
	const [aoAcabar, setAoAcabar] = useState(existente?.ao_acabar ?? 'bloquear');
	const [alertaPct, setAlertaPct] = useState(existente?.alerta_pct ?? 80);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	async function salvar() {
		if (!supabase || !empresa) return;
		if (!nome.trim()) { setErro('Informe o nome.'); return; }
		setBusy(true); setErro('');
		const payload = { empresa_id: empresa.id, nome: nome.trim(), orcamento: orcamento ? +orcamento : null, ao_acabar: aoAcabar, alerta_pct: +alertaPct };
		const { error } = existente ? await supabase.from('mensageria_centros_custo').update(payload).eq('id', existente.id) : await supabase.from('mensageria_centros_custo').insert(payload);
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		onSaved();
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
			<div className="w-full max-w-[420px] rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">{existente ? 'Editar centro' : 'Novo centro de custo'}</h2>
				<div className="space-y-4">
					<div><label className="mb-1.5 block text-[13px] font-semibold">Nome *</label><input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" /></div>
					<div><label className="mb-1.5 block text-[13px] font-semibold">Orçamento do mês (R$, vazio = sem limite)</label><input type="number" value={orcamento} onChange={e => setOrcamento(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" /></div>
					<div><label className="mb-1.5 block text-[13px] font-semibold">Ao acabar o orçamento</label><select value={aoAcabar} onChange={e => setAoAcabar(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none"><option value="bloquear">Bloquear envios</option><option value="enviar">Enviar mesmo assim</option></select></div>
					<div><label className="mb-1.5 block text-[13px] font-semibold">Alerta em (%)</label><input type="number" value={alertaPct} onChange={e => setAlertaPct(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" /></div>
					{erro && <p className="text-[13px] text-[#FF3B30]">{erro}</p>}
					<div className="flex justify-end gap-2"><button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button><button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Salvar'}</button></div>
				</div>
			</div>
		</div>
	);
}
