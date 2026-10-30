import { useCallback, useEffect, useState } from 'react';
import { Lock, Plus, Pencil, Trash2, Bell, Clock, MessageSquare } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { useAreaLabel } from '@/components/tema-provider';
import { RADAR_ORDEM, RADAR_CLASSES } from '@/lib/mensageria-produtos';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';

const CARD_SHADOW = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

function dateExtensa() {
	try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); } catch { return ''; }
}

export function ConfigAtendimento() {
	const { perfil, empresa, permissoes } = useMotorAuth();
	const areaLabel = useAreaLabel();
	const canEdit = permissoes.includes('editar_canais');

	const [usarMeta, setUsarMeta] = useState(false);
	const [metaMin, setMetaMin] = useState('15');
	const [avisoJudicial, setAvisoJudicial] = useState(true);
	const [avisoAcimaMeta, setAvisoAcimaMeta] = useState(true);
	const [avisoNegocio, setAvisoNegocio] = useState(false);
	const [rapidas, setRapidas] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [sucesso, setSucesso] = useState('');
	const [editando, setEditando] = useState<Row | null | 'novo'>(null);
	const [apagarId, setApagarId] = useState<Row | null>(null);

	const reload = useCallback(async () => {
		if (!supabase || !empresa) return;
		setLoading(true);
		const [cfg, rp] = await Promise.all([
			supabase.from('mensageria_config').select('*').eq('empresa_id', empresa.id).maybeSingle(),
			supabase.from('mensageria_respostas_rapidas').select('*').eq('empresa_id', empresa.id).order('nome'),
		]);
		const c = cfg.data as Row | null;
		const mv = c?.meta_resposta_min;
		setUsarMeta(mv != null);
		if (mv != null) setMetaMin(String(mv));
		setAvisoJudicial(c?.aviso_judicial == null ? true : !!c.aviso_judicial);
		setAvisoAcimaMeta(c?.aviso_acima_meta == null ? true : !!c.aviso_acima_meta);
		setAvisoNegocio(!!c?.aviso_negocio_sem_resp);
		setRapidas((rp.data ?? []) as Row[]);
		setLoading(false);
	}, [empresa?.id]);

	useEffect(() => { void reload(); }, [reload]);

	async function salvarConfig() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro(''); setSucesso('');
		const meta = usarMeta ? Math.min(240, Math.max(5, Number(metaMin) || 15)) : null;
		const { error } = await supabase.rpc('salvar_config_atendimento', {
			empresa: empresa.id,
			meta: meta,
			judicial: avisoJudicial,
			acima_meta: avisoAcimaMeta,
			negocio: avisoNegocio,
		});
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		setSucesso('Configuração do atendimento salva.');
	}

	if (loading) {
		return (
			<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
				<p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
			{/* Cabeçalho */}
			<div className="mb-5">
				<span className="mc-area-tag mb-1.5">{areaLabel}</span>
				<h1 className="mc-page-title text-[28px] font-bold leading-tight tracking-tight text-[#1D1D1F]">Atendimento</h1>
				<p className="mt-1 text-[14px] text-[#6E6E73]">{empresa?.nome ?? '—'} · Configurar · {dateExtensa()}</p>
			</div>

			{!canEdit ? (
				<div className="mc-halo rounded-2xl bg-[#F5F5F7] px-6 py-16 text-center" style={{ boxShadow: CARD_SHADOW }}>
					<Lock className="mx-auto mb-4 text-[#8E8E93]" size={32} />
					<p className="text-[15px] text-[#1D1D1F]">Só Admin e Planejamento configuram o atendimento.</p>
				</div>
			) : (
				<div className="space-y-5">
					{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}
					{sucesso && <div className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{sucesso}</div>}

					{/* Meta de primeira resposta */}
					<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
						<div className="mb-4 flex items-center gap-2">
							<Clock size={18} className="text-[#6E6E73]" />
							<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Meta de primeira resposta</h2>
						</div>
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<p className="text-[15px] font-medium text-[#1D1D1F]">Usar meta de primeira resposta</p>
								<p className="mt-1 text-[13px] text-[#6E6E73]">Acima da meta, âmbar; acima do dobro, vermelho. Sem meta, a espera aparece sem cor.</p>
							</div>
							<Toggle on={usarMeta} onClick={() => setUsarMeta(!usarMeta)} />
						</div>
						{usarMeta && (
							<div className="mt-4 max-w-[280px]">
								<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Minutos</label>
								<input type="number" min={5} max={240} value={metaMin} onChange={e => setMetaMin(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
								<p className="mt-1 text-[12px] text-[#8E8E93]">Entre 5 e 240 minutos.</p>
							</div>
						)}
					</section>

					{/* Avisos no sino */}
					<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
						<div className="mb-4 flex items-center gap-2">
							<Bell size={18} className="text-[#6E6E73]" />
							<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Avisos no sino</h2>
						</div>
						<div className="space-y-3">
							<AvisoLinha
								titulo="Judicial"
								desc="Avisar Admin e Gestão na hora."
								on={avisoJudicial}
								onClick={() => setAvisoJudicial(!avisoJudicial)}
							/>
							<AvisoLinha
								titulo="Conversa acima do dobro da meta"
								desc="Avisar quem atende."
								on={avisoAcimaMeta}
								onClick={() => setAvisoAcimaMeta(!avisoAcimaMeta)}
								disabled={!usarMeta}
								disabledMsg="precisa da meta"
							/>
							<AvisoLinha
								titulo="CPC Negócio sem responsável há 10 min"
								desc="Avisar a Gestão."
								on={avisoNegocio}
								onClick={() => setAvisoNegocio(!avisoNegocio)}
							/>
						</div>
						<div className="mt-5">
							<button onClick={salvarConfig} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Salvar'}</button>
						</div>
					</section>

					{/* Respostas rápidas */}
					<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
						<div className="mb-4 flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<MessageSquare size={18} className="text-[#6E6E73]" />
								<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Respostas rápidas</h2>
							</div>
							<button onClick={() => setEditando('novo')} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-medium text-white hover:opacity-85"><Plus size={15} /> Nova resposta rápida</button>
						</div>
						<p className="mb-4 text-[13px] text-[#6E6E73]">Cada empresa escreve as suas (com o jurídico dela, quando precisar). Nunca dados pessoais.</p>
						{rapidas.length === 0 ? (
							<p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhuma resposta rápida ainda.</p>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-[14px]">
									<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
										<th className="py-2 pr-4">Nome</th><th className="py-2 pr-4">Classe</th><th className="py-2 pr-4">Texto</th><th className="py-2" />
									</tr></thead>
									<tbody>
										{rapidas.map(r => (
											<tr key={r.id} className="border-b border-[#F0F0F2] align-top">
												<td className="py-2.5 pr-4 font-medium text-[#1D1D1F]">{String(r.nome ?? '')}</td>
												<td className="py-2.5 pr-4 text-[#6E6E73]">{r.classe ? (RADAR_CLASSES[String(r.classe)]?.label ?? r.classe) : 'Todas'}</td>
												<td className="py-2.5 pr-4 max-w-[320px] truncate text-[#6E6E73]">{String(r.texto ?? '')}</td>
												<td className="py-2.5 text-right">
													<div className="inline-flex gap-1">
														<button onClick={() => setEditando(r)} aria-label="Editar" className="grid h-8 w-8 place-items-center rounded-full text-[#6E6E73] hover:bg-[#F5F5F7]"><Pencil size={14} /></button>
														<button onClick={() => setApagarId(r)} aria-label="Apagar" className="grid h-8 w-8 place-items-center rounded-full text-[#FF3B30] hover:bg-[#FFE8E6]"><Trash2 size={14} /></button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>
				</div>
			)}

			{editando && (
				<RespostaRapidaModal
					existente={editando === 'novo' ? null : editando}
					onClose={() => setEditando(null)}
					onSaved={() => { setEditando(null); void reload(); }}
				/>
			)}

			<ConfirmaAcao
				aberto={!!apagarId}
				titulo="Apagar resposta rápida"
				texto={`Apagar "${apagarId ? String(apagarId.nome) : ''}"? A resposta rápida some da caixa de atendimento.`}
				botao="Apagar"
				corBotao="#FF3B30"
				onConfirm={async () => {
					if (!supabase || !apagarId) return;
					setBusy(true);
					const { error } = await supabase.rpc('apagar_resposta_rapida', { id: apagarId.id });
					setBusy(false);
					if (error) { setErro(friendlyError(error)); setApagarId(null); return; }
					setApagarId(null);
					void reload();
				}}
				onClose={() => setApagarId(null)}
				loading={busy}
			/>
		</div>
	);
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
	return (
		<button role="switch" aria-checked={on} disabled={disabled} onClick={onClick} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}>
			<span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'left-6' : 'left-1'}`} />
		</button>
	);
}

function AvisoLinha({ titulo, desc, on, onClick, disabled, disabledMsg }: { titulo: string; desc: string; on: boolean; onClick: () => void; disabled?: boolean; disabledMsg?: string }) {
	return (
		<div className="flex items-start justify-between gap-4 rounded-lg border border-[#E5E5EA] px-4 py-3">
			<div className="min-w-0">
				<p className="text-[14px] font-medium text-[#1D1D1F]">{titulo}</p>
				<p className="mt-0.5 text-[13px] text-[#6E6E73]">{desc}</p>
			</div>
			{disabled ? (
				<span className="shrink-0 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93]">{disabledMsg}</span>
			) : (
				<Toggle on={on} onClick={onClick} />
			)}
		</div>
	);
}

function RespostaRapidaModal({ existente, onClose, onSaved }: { existente: Row | null; onClose: () => void; onSaved: () => void }) {
	const { empresa } = useMotorAuth();
	const [nome, setNome] = useState(existente?.nome ?? '');
	const [classe, setClasse] = useState(existente?.classe ?? '');
	const [texto, setTexto] = useState(existente?.texto ?? '');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	async function salvar() {
		if (!supabase || !empresa) return;
		if (!nome.trim() || !texto.trim()) { setErro('Preencha o nome e o texto.'); return; }
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('salvar_resposta_rapida', {
			empresa: empresa.id,
			id: existente?.id ?? null,
			nome: nome.trim(),
			classe: classe || null,
			texto: texto.trim(),
		});
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		onSaved();
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
			<div className="my-auto w-full max-w-[480px] rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">{existente ? 'Editar resposta rápida' : 'Nova resposta rápida'}</h2>
				<div className="space-y-4">
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Nome *</label>
						<input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					</div>
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Classe</label>
						<select value={classe} onChange={e => setClasse(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
							<option value="">Todas as classes</option>
							{RADAR_ORDEM.map(cl => <option key={cl} value={cl}>{RADAR_CLASSES[cl].label}</option>)}
						</select>
					</div>
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Texto *</label>
						<textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Ex.: Olá {{nome}}, vamos negociar seu acordo." className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					</div>
					{erro && <p className="text-[13px] text-[#FF3B30]">{erro}</p>}
					<div className="flex justify-end gap-2">
						<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Salvar'}</button>
					</div>
				</div>
			</div>
		</div>
	);
}
