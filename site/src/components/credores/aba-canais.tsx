import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Check, Copy, FileWarning, RotateCcw, X } from 'lucide-react';
import { Notice } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase, type Credor, type Row } from '@/lib/supabase';
import { toastError, ErrorDetail } from '@/components/error-detail';
import {
	retornoCanais, statusCanalOpts, marcaLabelPorCanal, inexistenteOptsPorCanal,
	regrasPadrao, regrasMudou, limparRegrasCredor, inexistentePadraoTexto,
	retornosPorCanal, type MarcaCanal, type TipoRetornoCanal, type RegrasRetorno,
} from '@/lib/canal-retorno';

export type MapeamentoCanal = {
	id: string; empresa_id: string; credor_id: string; tipo: string;
	colunas: Record<string, string> | null; confirmado: boolean;
	sugerido: Record<string, string> | null; cabecalho: string[] | null;
	arquivo: string | null; visto_em: string | null; atualizado_em: string | null;
};

export type CanalCodigo = {
	id: string; empresa_id: string; credor_id: string; canal: string; codigo: string;
	marca: MarcaCanal | null; mapeado: boolean; sugerido: string | null;
	qtd: number; primeira_vez: string | null; ultima_vez: string | null; atualizado_em: string | null;
};

const CAMPOS: { key: string; label: string; required: boolean }[] = [
	{ key: 'contato', label: 'Telefone/e-mail', required: true },
	{ key: 'status', label: 'Status', required: true },
	{ key: 'data', label: 'Data do evento', required: false },
];

const nowISO = () => new Date().toISOString();

export function AbCanais({ credor, mapeamentos, canalCodigos, canEdit, onSaved }: {
	credor: Credor; mapeamentos: MapeamentoCanal[]; canalCodigos: CanalCodigo[]; canEdit: boolean; onSaved: () => void;
}) {
	const canalMaps = mapeamentos.filter(m => m.tipo.startsWith('canal_'));
	const [regras, setRegras] = useState<Record<string, RegrasRetorno | null>>({});
	const [regrasBusy, setRegrasBusy] = useState(false);
	const [regrasError, setRegrasError] = useState('');
	const [regrasSuccess, setRegrasSuccess] = useState('');
	const [copyOpen, setCopyOpen] = useState(false);

	useEffect(() => {
		setRegras((credor.regras_retorno as Record<string, RegrasRetorno> | null) ?? {});
	}, [credor.id, credor.regras_retorno]);

	function setRegra(canal: string, patch: Partial<RegrasRetorno>) {
		setRegrasSuccess(''); setRegrasError('');
		setRegras(prev => {
			const base = prev[canal] ?? {};
			return { ...prev, [canal]: { ...base, ...patch } };
		});
	}
	function restaurarCanal(canal: string) {
		setRegrasSuccess(''); setRegrasError('');
		setRegras(prev => { const next = { ...prev }; delete next[canal]; return next; });
	}

	async function salvarRegras() {
		if (!supabase) return;
		setRegrasBusy(true); setRegrasError(''); setRegrasSuccess('');
		const limpo = limparRegrasCredor(regras);
		const { error } = await supabase.from('credores').update({ regras_retorno: limpo }).eq('id', credor.id);
		if (error) { setRegrasError(friendlyError()); setRegrasBusy(false); return; }
		setRegrasSuccess('Regras de retorno salvas com sucesso.');
		setRegrasBusy(false);
		onSaved();
	}

	const algumaMudou = retornoCanais.some(r => regrasMudou(r.canal, regras[r.canal]));

	return (
		<div className="space-y-5">
			<div className="rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<p className="max-w-2xl">Defina as regras de cada canal antes de enviar os arquivos dos fornecedores. Quando os arquivos chegarem, o MotorCX já aplica estas regras.</p>
					{canEdit && <button onClick={() => setCopyOpen(true)} className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Copy size={15} /> Copiar de outro credor</button>}
				</div>
			</div>
			{regrasError && <Notice>{regrasError}</Notice>}
			{regrasSuccess && <Notice variant="success">{regrasSuccess}</Notice>}

			{retornoCanais.map(rc => {
				const m = canalMaps.find(x => x.tipo === rc.tipo) ?? null;
				const cods = canalCodigos.filter(c => c.canal === rc.canal);
				return (
					<CartaoCanal
						key={rc.tipo}
						tipo={rc.tipo}
						canal={rc.canal}
						label={rc.canalEmpresaLabel}
						mapeamento={m}
						codigos={cods}
						canEdit={canEdit}
						onSaved={onSaved}
						regrasCanal={regras[rc.canal] ?? null}
						onRegraChange={setRegra}
						onRestaurarCanal={restaurarCanal}
					/>
				);
			})}

			{canEdit && (
				<div className="flex justify-end">
					<button onClick={salvarRegras} disabled={regrasBusy || !algumaMudou} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{regrasBusy ? 'Salvando...' : 'Salvar regras de retorno'}</button>
				</div>
			)}

			{copyOpen && <CopiarCanaisDialog credorAtual={credor} onClose={() => setCopyOpen(false)} onDone={() => { setCopyOpen(false); toast.success('Configurações de canal copiadas'); onSaved(); }} />}
		</div>
	);
}

function CartaoCanal({ tipo, canal, label, mapeamento, codigos, canEdit, onSaved, regrasCanal, onRegraChange, onRestaurarCanal }: {
	tipo: TipoRetornoCanal; canal: string; label: string; mapeamento: MapeamentoCanal | null; codigos: CanalCodigo[]; canEdit: boolean; onSaved: () => void;
	regrasCanal: RegrasRetorno | null; onRegraChange: (canal: string, patch: Partial<RegrasRetorno>) => void; onRestaurarCanal: (canal: string) => void;
}) {
	void tipo;
	return (
		<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
			<div className="mb-5 flex items-center gap-3 border-b border-[#ecf0f1] pb-4">
				<h3 className="text-base font-semibold text-[#163943]">{label}</h3>
				{regrasMudou(canal, regrasCanal) && <span className="rounded-full bg-[#e9a23b] px-2 py-0.5 text-[10px] font-bold text-white">você mudou</span>}
			</div>

			{/* a) Retornos esperados e regras */}
			<RegrasCanal canal={canal} regras={regrasCanal} canEdit={canEdit} onChange={onRegraChange} onRestaurar={() => onRestaurarCanal(canal)} />

			{/* b) Arquivo do fornecedor — colunas */}
			<div className="mt-6 border-t border-[#ecf0f1] pt-5">
				<h4 className="mb-3 text-sm font-semibold text-[#163943]">Arquivo do fornecedor — colunas</h4>
				{mapeamento ? (
					<MapeamentoColunas mapeamento={mapeamento} canEdit={canEdit} onSaved={onSaved} />
				) : (
					<p className="rounded-lg bg-[#f5f8f9] px-4 py-5 text-sm text-slate-500">Aguardando o primeiro arquivo de retorno deste canal. Envie em <Link to="/envios" className="font-semibold text-[#0F4C5C] underline">Enviar arquivos</Link> → Retorno dos canais; as colunas aparecem aqui para confirmar.</p>
				)}
			</div>

			{/* c) Status do fornecedor */}
			<div className="mt-6 border-t border-[#ecf0f1] pt-5">
				<h4 className="mb-3 text-sm font-semibold text-[#163943]">Status do fornecedor</h4>
				{codigos.length > 0 ? (
					<TabelaCodigos canal={canal} codigos={codigos} canEdit={canEdit} onSaved={onSaved} />
				) : (
					<p className="rounded-lg bg-[#f5f8f9] px-4 py-5 text-sm text-slate-500">Os status aparecem aqui quando o primeiro arquivo chegar.</p>
				)}
			</div>
		</section>
	);
}

// --- a) Retornos esperados e regras ---

function RegrasCanal({ canal, regras, canEdit, onChange, onRestaurar }: {
	canal: string; regras: RegrasRetorno | null; canEdit: boolean; onChange: (canal: string, patch: Partial<RegrasRetorno>) => void; onRestaurar: () => void;
}) {
	const padrao = regrasPadrao(canal);
	const atual: RegrasRetorno = regras ?? {};
	const rows = retornosPorCanal[canal] ?? [];
	const opts = inexistenteOptsPorCanal[canal] ?? [];
	const mudou = regrasMudou(canal, regras);

	function val<K extends keyof RegrasRetorno>(f: K): RegrasRetorno[K] {
		return (atual[f] ?? padrao[f]) as RegrasRetorno[K];
	}
	function mudouField(f: keyof RegrasRetorno): boolean {
		return atual[f] != null && JSON.stringify(atual[f]) !== JSON.stringify(padrao[f]);
	}

	function setEscalonamento(idx: number, valor: number) {
		const arr = [...(val('escalonamento') ?? [])];
		arr[idx] = valor;
		onChange(canal, { escalonamento: arr });
	}
	function addDegrau() {
		const arr = [...(val('escalonamento') ?? [])];
		if (arr.length >= 10) return;
		const ultimo = arr[arr.length - 1] ?? 30;
		arr.push(ultimo);
		onChange(canal, { escalonamento: arr });
	}
	function removeDegrau(idx: number) {
		const arr = [...(val('escalonamento') ?? [])];
		arr.splice(idx, 1);
		onChange(canal, { escalonamento: arr.length ? arr : undefined });
	}

	const inexistenteVal = val('inexistente') ?? 'escalonar';
	const escalonamento = val('escalonamento') ?? [];
	const limiteVal = val('limite_lote') ?? 0.5;

	return (
		<div>
			<h4 className="mb-3 text-sm font-semibold text-[#163943]">Retornos esperados e regras</h4>
			<div className="overflow-x-auto rounded-xl border border-[#e2eaec]">
				<table className="w-full min-w-[640px] text-left text-sm">
					<thead className="border-b border-[#e5edef] bg-[#f7fafb] text-xs text-slate-400">
						<tr>
							<th className="px-4 py-2.5 font-medium">Retorno</th>
							<th className="px-4 py-2.5 font-medium">Regra</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-[#ecf0f1]">
						{rows.map((row, i) => (
							<tr key={i}>
								<td className="px-4 py-3 align-top text-[13px] font-medium text-[#163943]">{row.evento}</td>
								<td className="px-4 py-3 align-top">
									<p className="text-[13px] text-slate-600">{row.regra}</p>
									{row.campos && (
										<div className="mt-2 space-y-2.5">
											{row.campos.filter(c => (c !== 'escalonamento' || inexistenteVal === 'escalonar') && (c !== 'dias_rever' || inexistenteVal === 'retestar')).map(c => (
												<div key={c}>
													{c === 'inexistente' && (
														<CampoEditavel label="Ação" mudou={mudouField('inexistente')} sugestao={inexistentePadraoTexto(canal)}>
															<select value={inexistenteVal} disabled={!canEdit} onChange={e => onChange(canal, { inexistente: e.target.value as RegrasRetorno['inexistente'] })} className="h-9 w-full rounded-lg border border-[#d8e3e5] bg-white px-2 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]">
																{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
															</select>
														</CampoEditavel>
													)}
													{c === 'escalonamento' && (
														<CampoEditavel label="Dias de suspensão a cada falha (1ª, 2ª, 3ª…)" mudou={mudouField('escalonamento')} sugestao="7, 15, 30, 90, 120">
															<div className="flex flex-wrap items-center gap-2">
																{escalonamento.map((d, idx) => (
																	<span key={idx} className="inline-flex items-center gap-1 rounded-lg border border-[#d8e3e5] bg-white px-2 py-1 text-xs">
																		<span className="text-slate-400">{idx + 1}ª</span>
																		<input type="number" min={1} value={d} disabled={!canEdit} onChange={e => setEscalonamento(idx, Number(e.target.value))} className="w-14 bg-transparent text-center text-sm font-semibold outline-none disabled:opacity-50" />
																		d
																		{canEdit && <button type="button" onClick={() => removeDegrau(idx)} className="text-slate-300 hover:text-[#C62828]" aria-label="Remover degrau">×</button>}
																	</span>
																))}
																{canEdit && escalonamento.length < 10 && (
																	<button type="button" onClick={addDegrau} className="flex h-8 items-center gap-1 rounded-lg border border-dashed border-[#0F4C5C] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]">+ degrau</button>
																)}
															</div>
														</CampoEditavel>
													)}
													{c === 'dias_rever' && (
														<CampoEditavel label="Testar de novo depois de (dias)" mudou={mudouField('dias_rever')} sugestao={padrao.dias_rever != null ? `${padrao.dias_rever} dias` : '—'}>
															<input type="number" min={1} value={val('dias_rever') ?? ''} disabled={!canEdit} onChange={e => onChange(canal, { dias_rever: Number(e.target.value) })} className="h-9 w-32 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]" />
														</CampoEditavel>
													)}
													{c === 'temporarios_pausa' && (
														<CampoEditavel label="Falhas seguidas para pausar (0 = nunca)" mudou={mudouField('temporarios_pausa')} sugestao={`${padrao.temporarios_pausa}`}>
															<input type="number" min={0} value={val('temporarios_pausa') ?? 0} disabled={!canEdit} onChange={e => onChange(canal, { temporarios_pausa: Number(e.target.value) })} className="h-9 w-32 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]" />
														</CampoEditavel>
													)}
													{c === 'dias_pausa' && (
														<CampoEditavel label="Dias de pausa" mudou={mudouField('dias_pausa')} sugestao={`${padrao.dias_pausa} dias`}>
															<input type="number" min={1} value={val('dias_pausa') ?? ''} disabled={!canEdit} onChange={e => onChange(canal, { dias_pausa: Number(e.target.value) })} className="h-9 w-32 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]" />
														</CampoEditavel>
													)}
												</div>
											))}
										</div>
									)}
								</td>
							</tr>
						))}
						{/* Trava de lote (campo avançado) */}
						<tr className="bg-[#fafcfc]">
							<td className="px-4 py-3 align-top text-[13px] font-medium text-[#163943]">Trava de lote <span className="text-[10px] font-normal text-slate-400">(avançado)</span></td>
							<td className="px-4 py-3 align-top">
								<p className="text-[13px] text-slate-600">Se mais de X% de um arquivo vier como falha permanente, é problema do fornecedor e nada é descartado.</p>
								<div className="mt-2">
									<CampoEditavel label="% de falha permanente" mudou={mudouField('limite_lote')} sugestao="50% (0,5)">
										<input type="number" min={0} max={1} step={0.1} value={limiteVal} disabled={!canEdit} onChange={e => onChange(canal, { limite_lote: Number(e.target.value) })} className="h-9 w-32 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]" />
									</CampoEditavel>
								</div>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p className="mt-2 rounded-lg bg-[#f5f8f9] px-3 py-2 text-[11px] leading-relaxed text-slate-500">Qualquer entrega, leitura ou clique depois desfaz pausa, suspensão e inexistente. Bloqueio (opt-out) nunca é desfeito por entrega.</p>
			{canEdit && mudou && (
				<button type="button" onClick={onRestaurar} className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-slate-500 hover:bg-[#edf4f5]"><RotateCcw size={14} /> Restaurar sugestão MotorCX</button>
			)}
		</div>
	);
}

function CampoEditavel({ label, mudou, sugestao, children }: {
	label: string; mudou: boolean; sugestao: string; children: React.ReactNode;
}) {
	return (
		<div className={`rounded-lg border px-3 py-2 ${mudou ? 'border-[#e9a23b] bg-[#fff7e8]' : 'border-[#e2eaec] bg-white'}`}>
			<div className="mb-1 flex items-center justify-between gap-2">
				<label className="text-xs font-semibold text-slate-600">{label}</label>
				{mudou
					? <span className="text-[10px] font-bold text-[#9a631b]">você mudou</span>
					: <span className="text-[10px] text-slate-400">Sugestão MotorCX: {sugestao}</span>}
			</div>
			{children}
		</div>
	);
}

// --- b) Mapeamento de colunas ---

function MapeamentoColunas({ mapeamento, canEdit, onSaved }: {
	mapeamento: MapeamentoCanal; canEdit: boolean; onSaved: () => void;
}) {
	const [editing, setEditing] = useState(!mapeamento?.confirmado);
	const [vals, setVals] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState('');

	useEffect(() => {
		if (!mapeamento) { setVals({}); setEditing(true); return; }
		const src = mapeamento.confirmado ? (mapeamento.colunas ?? {}) : (mapeamento.sugerido ?? mapeamento.colunas ?? {});
		const v: Record<string, string> = {};
		CAMPOS.forEach(c => { v[c.key] = (src as Record<string, string>)?.[c.key] ?? ''; });
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
		for (const c of CAMPOS) { const v = vals[c.key]?.trim(); if (v) preenchidos[c.key] = v; }
		for (const c of CAMPOS) { if (c.required && !preenchidos[c.key]) { setErr(`"${c.label}" é obrigatório.`); return; } }
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
		return CAMPOS.filter(c => mapeamento.colunas![c.key]).map(c => `${c.label} = ${mapeamento.colunas![c.key]}`).join(' · ');
	}, [mapeamento]);

	return (
		<div>
			<div className="mb-3 flex flex-wrap items-center gap-3">
			{mapeamento ? (confirmado
				? <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-bold text-[#2E7D32]"><Check size={12} /> Confirmado</span>
				: <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3df] px-2.5 py-0.5 text-[11px] font-bold text-[#9a631b]"><FileWarning size={12} /> Aguardando mapeamento — os arquivos esperam até você confirmar</span>)
			: null}
			{mapeamento?.arquivo && <span className="text-xs text-slate-500">Último arquivo: <strong className="font-medium text-slate-600">{mapeamento.arquivo}</strong></span>}
			</div>

			{confirmado && !editing ? (
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-slate-600">{resumo || 'Nenhuma coluna apontada.'}</p>
					{canEdit && <button onClick={() => setEditing(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]">Alterar</button>}
				</div>
			) : (
				<div className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-3">
						{CAMPOS.map(c => {
							const val = vals[c.key] ?? '';
							const isSugestao = !confirmado && mapeamento?.sugerido?.[c.key] && val === mapeamento.sugerido[c.key];
							return (
								<div key={c.key}>
									<label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-600">
										{c.label}{c.required && <span className="text-[#C62828]">*</span>}
										{isSugestao && <span className="text-[10px] font-normal italic text-slate-400">sugerido pelo MotorCX</span>}
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
					{err && <ErrorDetail />}
					{canEdit && (
						<div className="flex justify-end">
							<button onClick={confirmar} disabled={busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Confirmando...' : 'Confirmar colunas'}</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// --- c) Status do fornecedor ---

function TabelaCodigos({ canal, codigos, canEdit, onSaved }: {
	canal: string; codigos: CanalCodigo[]; canEdit: boolean; onSaved: () => void;
}) {
	const [busyId, setBusyId] = useState('');
	const [aceitando, setAceitando] = useState(false);
	const opts = statusCanalOpts[canal] ?? [];

	const ordenados = useMemo(() => {
		return [...codigos].sort((a, b) => {
			if (a.mapeado !== b.mapeado) return a.mapeado ? 1 : -1;
			return b.qtd - a.qtd;
		});
	}, [codigos]);

	const nMapeados = codigos.filter(c => c.mapeado).length;
	const nNovos = codigos.filter(c => !c.mapeado).length;

	async function marcar(oc: CanalCodigo, marca: MarcaCanal) {
		if (!supabase) return;
		const novo: MarcaCanal = oc.marca === marca ? 'entregue' : marca;
		setBusyId(oc.id);
		const { error } = await supabase.from('canal_codigos').update({ marca: novo, mapeado: true, atualizado_em: nowISO() }).eq('id', oc.id);
		if (error) { toastError(error); }
		setBusyId('');
		onSaved();
	}

	async function aceitarTodosNovos() {
		if (!supabase) return;
		const novos = codigos.filter(c => !c.mapeado && c.sugerido);
		if (!novos.length) return;
		if (!window.confirm(`Aceitar a sugestão do MotorCX para os ${novos.length} status novos?`)) return;
		setAceitando(true);
		for (const oc of novos) {
			const novo = (oc.sugerido as MarcaCanal) ?? 'entregue';
			const { error } = await supabase.from('canal_codigos').update({ marca: novo, mapeado: true, atualizado_em: nowISO() }).eq('id', oc.id);
			if (error) { toastError(error); break; }
		}
		setAceitando(false);
		onSaved();
	}

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-slate-600"><strong>{codigos.length}</strong> status · <strong className="text-[#2E7D32]">{nMapeados}</strong> marcados{nNovos > 0 && <> · <strong className="text-[#9a631b]">{nNovos}</strong> novos para marcar</>}</p>
				{canEdit && nNovos > 0 && <button onClick={aceitarTodosNovos} disabled={aceitando} className="flex h-10 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3] disabled:opacity-50">{aceitando ? 'Aceitando...' : 'Aceitar as sugestões dos novos'}</button>}
			</div>
			<div className="overflow-x-auto rounded-xl border border-[#dfe8ea] bg-white">
				<table className="w-full min-w-[760px] text-left text-sm">
					<thead className="border-b border-[#e5edef] text-xs text-slate-400">
						<tr>
							<th className="px-4 py-3 font-medium">Status</th>
							<th className="px-4 py-3 font-medium">Linhas</th>
							<th className="px-4 py-3 font-medium">Sugestão</th>
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
								<td className="px-4 py-3 text-xs text-slate-500"><span className="font-semibold text-slate-600">{oc.qtd}</span> linhas</td>
								<td className="px-4 py-3 text-xs text-slate-400">{oc.sugerido ? marcaLabelPorCanal(canal, oc.sugerido) : '—'}</td>
								<td className="px-4 py-3">
									<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
										{opts.map(opt => (
											<label key={opt.marca} className="flex cursor-pointer items-center gap-1.5 text-xs" title={opt.label}>
												<input type="radio" name={`cod-${oc.id}`} checked={oc.marca === opt.marca} disabled={!canEdit || busyId === oc.id} onChange={() => marcar(oc, opt.marca)} className="accent-[#0F4C5C]" />
												{opt.label}
											</label>
										))}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// --- Copiar de outro credor (escopo Canais) ---

function CopiarCanaisDialog({ credorAtual, onClose, onDone }: {
	credorAtual: Credor; onClose: () => void; onDone: () => void;
}) {
	const { empresa, credores } = useMotorAuth();
	const [origemId, setOrigemId] = useState('');
	const [preview, setPreview] = useState<{ map: number; cod: number; regras: boolean } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const origens = credores.filter(c => c.id !== credorAtual.id);

	useEffect(() => {
		if (!origemId || !supabase || !empresa) { setPreview(null); return; }
		let active = true;
		(async () => {
			const [m, o, r] = await Promise.all([
				supabase.from('mapeamento_arquivos').select('id', { count: 'exact', head: true }).eq('credor_id', origemId).eq('confirmado', true).like('tipo', 'canal_%'),
				supabase.from('canal_codigos').select('id', { count: 'exact', head: true }).eq('credor_id', origemId).eq('mapeado', true),
				supabase.from('credores').select('regras_retorno').eq('id', origemId).maybeSingle(),
			]);
			if (!active) return;
			const rr = (r.data as Row | null)?.regras_retorno;
			setPreview({ map: m.count ?? 0, cod: o.count ?? 0, regras: !!rr && Object.keys(rr as object).length > 0 });
		})();
		return () => { active = false; };
	}, [origemId, empresa?.id]);

	async function confirmar() {
		if (!supabase || !empresa || !origemId) return;
		setBusy(true); setError('');
		const [m, o, r] = await Promise.all([
			supabase.from('mapeamento_arquivos').select('*').eq('credor_id', origemId).eq('confirmado', true).like('tipo', 'canal_%'),
			supabase.from('canal_codigos').select('*').eq('credor_id', origemId).eq('mapeado', true),
			supabase.from('credores').select('regras_retorno').eq('id', origemId).maybeSingle(),
		]);
		if (m.error || o.error || r.error) { setError(friendlyError()); setBusy(false); return; }
		const mapRows = (m.data ?? []) as MapeamentoCanal[];
		const codRows = (o.data ?? []) as CanalCodigo[];
		const regrasOrigem = (r.data as Row | null)?.regras_retorno as Record<string, RegrasRetorno> | null;
		if (mapRows.length) {
			const toUpsert = mapRows.map(rw => ({ empresa_id: empresa.id, credor_id: credorAtual.id, tipo: rw.tipo, colunas: rw.colunas, confirmado: true, atualizado_em: nowISO() }));
			const { error: me } = await supabase.from('mapeamento_arquivos').upsert(toUpsert, { onConflict: 'empresa_id,credor_id,tipo' });
			if (me) { setError(friendlyError()); setBusy(false); return; }
		}
		if (codRows.length) {
			const toUpsert = codRows.map(rw => ({ empresa_id: empresa.id, credor_id: credorAtual.id, canal: rw.canal, codigo: rw.codigo, marca: rw.marca, mapeado: true, atualizado_em: nowISO() }));
			const { error: oe } = await supabase.from('canal_codigos').upsert(toUpsert, { onConflict: 'empresa_id,credor_id,canal,codigo' });
			if (oe) { setError(friendlyError()); setBusy(false); return; }
		}
		const { error: re } = await supabase.from('credores').update({ regras_retorno: regrasOrigem ?? null }).eq('id', credorAtual.id);
		if (re) { setError(friendlyError()); setBusy(false); return; }
		setBusy(false);
		onDone();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between">
					<h2 className="text-lg font-semibold">Copiar canais de outro credor</h2>
					<button onClick={onClose} aria-label="Fechar"><X size={20} /></button>
				</div>
				<p className="mb-4 text-xs text-slate-500">Copia as regras de retorno, os mapeamentos de coluna e os status marcados dos canais do credor de origem para <strong>{credorAtual.nome}</strong>. Não apaga nada do credor atual.</p>
				{origens.length === 0 ? <p className="text-sm text-slate-500">Não há outros credores nesta empresa.</p> : <>
					<label className="mb-2 block text-xs font-semibold">Credor de origem</label>
					<select value={origemId} onChange={e => setOrigemId(e.target.value)} className="mb-4 h-11 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="">— escolha o credor —</option>
						{origens.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
					</select>
					{preview && <p className="mb-4 rounded-lg bg-[#f5f8f9] px-4 py-3 text-sm text-slate-600">{preview.map} mapeamento{preview.map !== 1 ? 's' : ''} de canal, {preview.cod} status{preview.cod !== 1 ? 's' : ''} marcado{preview.cod !== 1 ? 's' : ''}{preview.regras ? ' e regras de retorno' : ''}</p>}
					{error && <p role="alert" className="mb-4 text-sm text-[#C62828]">{error}</p>}
					{error && <ErrorDetail />}
					<div className="flex justify-end gap-3">
						<button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
						<button onClick={confirmar} disabled={!origemId || busy || (preview !== null && preview.map === 0 && preview.cod === 0 && !preview.regras)} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Copiando...' : 'Confirmar'}</button>
					</div>
				</>}
			</div>
		</div>
	);
}
