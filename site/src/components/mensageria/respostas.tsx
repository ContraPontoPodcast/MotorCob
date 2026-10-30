import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Radar, ArrowLeft, Send } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { isCanalValido, RADAR_CLASSES, RADAR_ORDEM, mascararDestino } from '@/lib/mensageria-produtos';

const PERIODO_OPCOES = [{ id: 'hoje', label: 'Hoje' }, { id: '7d', label: '7 dias' }, { id: '30d', label: '30 dias' }];

export function RespostasCanal() {
	const { canal } = useParams();
	const { empresa, permissoes } = useMotorAuth();
	const canAct = permissoes.includes('enviar_mensagens');
	const [periodo, setPeriodo] = useState('7d');
	const [radar, setRadar] = useState<Row[]>([]);
	const [conversas, setConversas] = useState<Row[]>([]);
	const [selId, setSelId] = useState<string | null>(null);
	const [msgs, setMsgs] = useState<Row[]>([]);
	const [filtrosClasse, setFiltrosClasse] = useState<string[]>([]);
	const [situacao, setSituacao] = useState('todas');
	const [soNaoLidas, setSoNaoLidas] = useState(false);
	const [busca, setBusca] = useState('');
	const [resposta, setResposta] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [grupoOpen, setGrupoOpen] = useState(false);
	const timer = useRef<number | null>(null);

	const loadRadar = useCallback(async () => {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		const { data } = await supabase.from('radar_resumo').select('*').eq('empresa_id', empresa.id).eq('canal', canal);
		setRadar(data ?? []);
	}, [empresa?.id, canal]);

	const loadConversas = useCallback(async () => {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		let q = supabase.from('mensageria_conversas').select('*').eq('empresa_id', empresa.id).eq('canal', canal).order('ultima_em', { ascending: false }).limit(50);
		if (situacao !== 'todas') q = q.eq('situacao', situacao === 'abertas' ? 'aberta' : 'resolvida');
		if (soNaoLidas) q = q.gt('nao_lidas', 0);
		if (busca.trim()) q = q.ilike('id_cliente', `%${busca.trim()}%`);
		const { data } = await q;
		let list = data ?? [];
		if (filtrosClasse.length) list = list.filter(c => filtrosClasse.includes(c.classe));
		setConversas(list);
	}, [empresa?.id, canal, situacao, soNaoLidas, busca, filtrosClasse]);

	const loadMsgs = useCallback(async () => {
		if (!supabase || !selId) return;
		const { data } = await supabase.from('mensageria_conversa_mensagens').select('*').eq('conversa_id', selId).order('id');
		setMsgs(data ?? []);
	}, [selId]);

	useEffect(() => { void loadRadar(); void loadConversas(); }, [loadRadar, loadConversas]);
	useEffect(() => { void loadMsgs(); }, [loadMsgs]);

	useEffect(() => {
		function tick() { if (document.visibilityState === 'visible') { void loadRadar(); void loadConversas(); if (selId) void loadMsgs(); } }
		timer.current = window.setInterval(tick, 15000);
		return () => { if (timer.current) window.clearInterval(timer.current); };
	}, [loadRadar, loadConversas, loadMsgs, selId]);

	async function abrir(id: string) {
		setSelId(id);
		if (!supabase) return;
		await supabase.rpc('atualizar_conversa', { conversa: id, acao: 'lida' });
		void loadConversas();
	}

	async function reclassificar(classe: string) {
		if (!supabase || !selId) return;
		await supabase.rpc('atualizar_conversa', { conversa: selId, acao: 'reclassificar', classe });
		void loadConversas(); void loadMsgs();
	}

	async function assumirOuResolver(acao: 'assumir' | 'resolver' | 'reabrir') {
		if (!supabase || !selId) return;
		await supabase.rpc('atualizar_conversa', { conversa: selId, acao });
		void loadConversas();
	}

	async function enviar() {
		if (!supabase || !selId || !resposta.trim()) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('responder_conversa', { conversa: selId, texto: resposta.trim() });
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		setResposta(''); setErro('');
		void loadMsgs(); void loadConversas();
	}

	if (!isCanalValido(canal)) return null;
	const sel = conversas.find(c => c.id === selId);
	const semVars = resposta.replace(/\{\{[^}]+\}\}/g, '');

	return (
		<div className="space-y-4">
			{/* Radar */}
			<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="mb-3 flex items-center gap-2">
					<Radar size={18} className="text-[#0A60D0]" />
					<p className="text-[14px] text-[#1D1D1F]"><strong>Radar</strong> lê cada resposta e mostra a intenção do cliente. O pedido de negócio pesa mais que o palavrão: “me manda o boleto FDP” é CPC Negócio.</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{RADAR_ORDEM.map(cl => {
						const r = radar.find(x => x.classe === cl);
						const info = RADAR_CLASSES[cl];
						const total = +(r?.total ?? 0);
						const ativo = filtrosClasse.includes(cl);
						return (
							<button key={cl} onClick={() => setFiltrosClasse(prev => ativo ? prev.filter(c => c !== cl) : [...prev, cl])} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${ativo ? 'text-white' : ''}`} style={{ backgroundColor: ativo ? info.cor : '#F5F5F7', color: ativo ? '#fff' : info.cor }}>
								{info.label} <span className="tnum">{total}</span>
								{r && +r.abertas > 0 && <span className="text-[11px] opacity-80">· {r.abertas} abertas</span>}
							</button>
						);
					})}
				</div>
			</div>

			{filtrosClasse.length > 0 && canAct && (
				<div className="flex justify-end">
					<button onClick={() => setGrupoOpen(true)} className="h-9 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85">Responder a todos deste filtro</button>
				</div>
			)}

			<div className="grid gap-4 lg:grid-cols-[360px_1fr]">
				{/* Lista de conversas */}
				<div className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<div className="mb-3 space-y-2">
						<div className="flex gap-2">
							<select value={situacao} onChange={e => setSituacao(e.target.value)} className="h-8 flex-1 rounded-lg border border-[#D2D2D7] px-2 text-[13px] outline-none">
								<option value="todas">Todas</option><option value="abertas">Abertas</option><option value="resolvidas">Resolvidas</option>
							</select>
							<select value={periodo} onChange={e => setPeriodo(e.target.value)} className="h-8 rounded-lg border border-[#D2D2D7] px-2 text-[13px] outline-none">
								{PERIODO_OPCOES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
							</select>
						</div>
						<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por ID do cliente" className="h-8 w-full rounded-lg border border-[#D2D2D7] px-3 text-[13px] outline-none" />
						<label className="flex items-center gap-2 text-[13px] text-[#6E6E73]"><input type="checkbox" checked={soNaoLidas} onChange={e => setSoNaoLidas(e.target.checked)} className="accent-[#0A60D0]" /> Só não lidas</label>
					</div>
					<div className="max-h-[520px] space-y-1 overflow-y-auto">
						{conversas.length === 0 ? <p className="py-6 text-center text-[13px] text-[#8E8E93]">Nenhuma conversa.</p> :
							conversas.map(c => {
								const info = RADAR_CLASSES[c.classe as string] ?? { label: c.classe, cor: '#8E8E93' };
								return (
									<button key={c.id} onClick={() => abrir(c.id)} className={`flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-[#F5F5F7] ${selId === c.id ? 'bg-[#F5F5F7]' : ''}`}>
										<span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.cor }} />
										<div className="min-w-0 flex-1">
											<div className="flex items-center justify-between gap-1">
												<span className="truncate text-[13px] font-medium text-[#1D1D1F]">{c.id_cliente}</span>
												<span className="shrink-0 text-[11px] text-[#8E8E93]">{c.ultima_em ? dateTimeBR(c.ultima_em).slice(0, 5) : ''}</span>
											</div>
											<p className="truncate text-[12px] text-[#6E6E73]">{c.destino_mascara ?? mascararDestino('')}</p>
											<div className="flex items-center gap-1.5">
												<span className="text-[11px] font-medium" style={{ color: info.cor }}>{info.label}</span>
												{c.confianca != null && <span className="text-[11px] text-[#8E8E93]">{Math.round(+c.confianca * 100)}%</span>}
												{+c.nao_lidas > 0 && <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-[#0A60D0] px-1 text-[10px] font-bold text-white">{c.nao_lidas}</span>}
											</div>
										</div>
									</button>
								);
							})}
					</div>
				</div>

				{/* Conversa aberta */}
				<div className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					{!sel ? (
						<p className="py-12 text-center text-[14px] text-[#8E8E93]">Selecione uma conversa à esquerda.</p>
					) : (
						<>
							<div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[#E5E5EA] pb-3">
								<span className="text-[15px] font-semibold text-[#1D1D1F]">{sel.id_cliente}</span>
								<span className="text-[13px] text-[#6E6E73]">{sel.destino_mascara}</span>
								{(() => { const info = RADAR_CLASSES[sel.classe as string] ?? { label: sel.classe, cor: '#8E8E93' }; return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: info.cor }}>{info.label}</span>; })()}
								<div className="ml-auto flex gap-1">
									{canAct && <>
										<select onChange={e => { if (e.target.value) void reclassificar(e.target.value); e.target.value = ''; }} className="h-8 rounded-lg border border-[#D2D2D7] px-2 text-[12px] outline-none" defaultValue="">
											<option value="">Reclassificar</option>
											{RADAR_ORDEM.map(cl => <option key={cl} value={cl}>{RADAR_CLASSES[cl].label}</option>)}
										</select>
										<button onClick={() => void assumirOuResolver('assumir')} className="h-8 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Assumir</button>
										{sel.situacao === 'resolvida' ? <button onClick={() => void assumirOuResolver('reabrir')} className="h-8 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Reabrir</button> : <button onClick={() => void assumirOuResolver('resolver')} className="h-8 rounded-lg bg-[#1D1D1F] px-3 text-[12px] font-medium text-white hover:opacity-85">Resolver</button>}
									</>}
								</div>
							</div>
							<div className="max-h-[360px] space-y-2 overflow-y-auto">
								{msgs.map(m => {
									const isOut = m.direcao === 'saida';
									const info = m.classe ? RADAR_CLASSES[m.classe as string] : null;
									return (
										<div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
											<div className={`max-w-[75%] rounded-2xl px-3 py-2 text-[14px] ${isOut ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F]'}`}>
												{!isOut && info && <span className="mb-1 block text-[11px] font-semibold" style={{ color: info.cor }}>{info.label}</span>}
												<p className="whitespace-pre-wrap leading-snug">{m.texto}</p>
												{!isOut && m.justificativa && <p className="mt-1 text-[12px] text-[#6E6E73]">Por que: {m.justificativa}</p>}
												{!isOut && <p className="mt-1 text-[11px] text-[#8E8E93]">{m.origem_radar === 'ia' ? 'IA' : 'Regras'}</p>}
												{isOut && <p className="mt-1 text-[11px] opacity-70">{m.estado === 'pendente' ? 'Na fila' : m.estado === 'enviada' ? 'Enviada' : `Não enviada: ${m.motivo ?? ''}`}</p>}
											</div>
										</div>
									);
								})}
							</div>
							{canAct && (
								<div className="mt-3 border-t border-[#E5E5EA] pt-3">
									{erro && <p className="mb-2 text-[13px] text-[#FF3B30]">{erro}</p>}
									<textarea value={resposta} onChange={e => setResposta(e.target.value)} rows={2} placeholder="Digite a resposta..." className="w-full rounded-lg border border-[#D2D2D7] p-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
									<div className="mt-2 flex items-center justify-between">
										<span className="text-[12px] text-[#8E8E93]">{canal === 'sms' ? `${semVars.length}/160 · ` : ''}Sai pelo mesmo canal no horário de envio. Respostas de SMS são cobradas como SMS.</span>
										<button onClick={enviar} disabled={busy || !resposta.trim()} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85"><Send size={14} /> Enviar</button>
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</div>

			<p className="text-center text-[12px] text-[#8E8E93]">Os textos das respostas ficam guardados por 90 dias e depois são apagados. A classificação continua nos relatórios.</p>

			{grupoOpen && <GrupoModal conversas={conversas.filter(c => filtrosClasse.includes(c.classe) && c.situacao !== 'resolvida')} onClose={() => setGrupoOpen(false)} onDone={() => { setGrupoOpen(false); void loadConversas(); }} />}
		</div>
	);
}

function GrupoModal({ conversas, onClose, onDone }: { conversas: Row[]; onClose: () => void; onDone: () => void }) {
	const [texto, setTexto] = useState('');
	const [busy, setBusy] = useState(false);
	const [progresso, setProgresso] = useState(0);
	const [resumo, setResumo] = useState<{ enviadas: number; recusadas: number; motivo: string } | null>(null);
	const limite = Math.min(200, conversas.length);

	async function enviar() {
		if (!supabase || !texto.trim()) return;
		setBusy(true); setProgresso(0);
		let enviadas = 0, recusadas = 0; let motivo = '';
		for (let i = 0; i < limite; i++) {
			const { error } = await supabase.rpc('responder_conversa', { conversa: conversas[i].id, texto: texto.trim() });
			if (error) { recusadas++; if (!motivo) motivo = friendlyError(error); } else enviadas++;
			setProgresso(i + 1);
		}
		setBusy(false);
		setResumo({ enviadas, recusadas, motivo });
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={resumo ? onDone : onClose}>
			<div className="w-full max-w-[440px] rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Responder a todos deste filtro</h2>
				{!resumo ? (<>
					<p className="mt-2 text-[14px] text-[#6E6E73]">Enviar para <strong>{limite}</strong> conversas abertas.</p>
					<textarea value={texto} onChange={e => setTexto(e.target.value)} rows={4} placeholder="Digite a resposta..." className="mt-3 w-full rounded-lg border border-[#D2D2D7] p-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					{busy && <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F5F5F7]"><div className="h-full bg-[#1D1D1F] transition-all" style={{ width: `${(progresso / limite) * 100}%` }} /></div>}
					<div className="mt-4 flex justify-end gap-2">
						<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={enviar} disabled={busy || !texto.trim()} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">Enviar para {limite} clientes</button>
					</div>
				</>) : (<>
					<p className="mt-3 text-[15px] text-[#1D1D1F]">Enviadas: <strong>{resumo.enviadas}</strong> · Recusadas: <strong>{resumo.recusadas}</strong></p>
					{resumo.recusadas > 0 && resumo.motivo && <p className="mt-1 text-[13px] text-[#FF3B30]">{resumo.motivo}</p>}
					<button onClick={onDone} className="mt-5 h-10 w-full rounded-full bg-[#1D1D1F] text-[14px] font-medium text-white hover:opacity-85">Fechar</button>
				</>)}
			</div>
		</div>
	);
}
