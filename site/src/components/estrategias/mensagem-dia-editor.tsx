import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BookOpen, Pencil, Search, Trash2, X } from 'lucide-react';
import {
	extrairVariaveis, previsualizar, smsMensagens, VARS_MOTORCOB, variavelLabel,
	FRASE_CANAIS, fraseCanalLabel, frasePreview, templateCodigoOf, canalTipoMensagem, type Frase,
} from '@/lib/frases';
import { canalLabel, type MensagemAcao, type MensagemRef } from '@/lib/estrategia';

const MAX_TEXTO = 2000;
const VARS_INSERIR = ['saldo', 'dias_atraso', 'vencimento', 'valor_parcela', 'qtd_parcelas_abertas', 'nome', 'link'];

/** Lê o MensagemRef de um canal/estágio específico dentro de uma MensagemAcao. */
function getRef(m: MensagemAcao | undefined, chave: string): MensagemRef | undefined {
	if (m == null) return undefined;
	if (typeof m === 'string' || ('frase_id' in m && !('cpa' in m) && !('whatsapp' in m))) return m as MensagemRef;
	const obj = m as Record<string, MensagemRef>;
	return obj?.[chave];
}
function isTextoRef(r: MensagemRef | undefined): r is string {
	return typeof r === 'string';
}
function isFraseRef(r: MensagemRef | undefined): r is { frase_id: string } {
	return !!r && typeof r === 'object' && 'frase_id' in r;
}

function VariavelBotoes({ onInsert }: { onInsert: (v: string) => void }) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{VARS_INSERIR.map(v => (
				<button key={v} type="button" onClick={() => onInsert(v)}
					className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${VARS_MOTORCOB.has(v) ? 'bg-[#eaf2f3] text-[#0F4C5C] hover:bg-[#dceaec]' : 'border border-dashed border-[#e9a23b] bg-[#fff7e8] text-[#9a631b] hover:bg-[#fff1d8]'}`}>
					{`{${v}}`}
				</button>
			))}
		</div>
	);
}

/** Aba de edição de um único MensagemRef (playbook ou escrever). */
function RefEditor({ canal, refAtual, frases, estagio, onSetRef, onSalvarNoPlaybook }: {
	canal: string; refAtual: MensagemRef | undefined; frases: Frase[]; estagio: string;
	onSetRef: (r: MensagemRef | null) => void;
	onSalvarNoPlaybook: (texto: string, nome: string) => Promise<string | null>;
}) {
	const [aba, setAba] = useState<'playbook' | 'escrever'>(isTextoRef(refAtual) ? 'escrever' : 'playbook');
	const [busca, setBusca] = useState('');
	const [texto, setTexto] = useState(isTextoRef(refAtual) ? refAtual : '');
	const [nomeSalvar, setNomeSalvar] = useState('');
	const [busy, setBusy] = useState(false);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const isSms = canal === 'sms';

	const frasesCanal = useMemo(() => {
		const ativas = frases.filter(f => f.canal === canal && f.ativo);
		const q = busca.trim().toLowerCase();
		const filtradas = q ? ativas.filter(f => f.nome.toLowerCase().includes(q) || frasePreview(f).toLowerCase().includes(q) || templateCodigoOf(f).toLowerCase().includes(q)) : ativas;
		return [...filtradas].sort((a, b) => {
			const ae = a.estagio === estagio ? 0 : a.estagio === null || a.estagio === 'qualquer' ? 1 : 2;
			const be = b.estagio === estagio ? 0 : b.estagio === null || b.estagio === 'qualquer' ? 1 : 2;
			return ae - be;
		});
	}, [frases, canal, busca, estagio]);

	function insertVar(v: string) {
		const ta = taRef.current;
		const tag = `{${v}}`;
		if (!ta) { setTexto(t => t + tag); return; }
		const start = ta.selectionStart ?? texto.length;
		const end = ta.selectionEnd ?? texto.length;
		const next = texto.slice(0, start) + tag + texto.slice(end);
		setTexto(next);
		requestAnimationFrame(() => { ta.focus(); const pos = start + tag.length; ta.setSelectionRange(pos, pos); });
	}

	async function salvarNoPlaybook() {
		if (!texto.trim()) { toast.error('Escreva o texto antes de salvar no playbook.'); return; }
		if (!nomeSalvar.trim()) { toast.error('Dê um nome à frase.'); return; }
		setBusy(true);
		const id = await onSalvarNoPlaybook(texto, nomeSalvar.trim());
		setBusy(false);
		if (id) { onSetRef({ frase_id: id }); }
	}

	function aplicarTexto() {
		if (!texto.trim()) { toast.error('Escreva o texto.'); return; }
		onSetRef(texto);
	}

	const vars = extrairVariaveis(texto);
	const tituloCanal = fraseCanalLabel[canal] ?? canalLabel[canal] ?? canal;

	return (
		<div className="space-y-3">
			<div className="flex gap-1 border-b border-[#e5edef]">
				<button onClick={() => setAba('playbook')} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${aba === 'playbook' ? 'border-[#0F4C5C] text-[#0F4C5C]' : 'border-transparent text-slate-400 hover:text-[#0F4C5C]'}`}><BookOpen size={13}/> Do playbook</button>
				<button onClick={() => setAba('escrever')} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${aba === 'escrever' ? 'border-[#0F4C5C] text-[#0F4C5C]' : 'border-transparent text-slate-400 hover:text-[#0F4C5C]'}`}><Pencil size={13}/> Escrever</button>
			</div>

			{aba === 'playbook' ? (
				<div>
					<div className="relative mb-3">
						<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
						<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar frase" className="h-9 w-full rounded border border-[#d8e3e5] pl-9 pr-3 text-sm outline-none focus:border-[#0F4C5C]"/>
					</div>
					{frasesCanal.length === 0 ? (
						<p className="py-6 text-center text-sm text-slate-400">Nenhuma frase ativa em {tituloCanal}. Crie em Canais → Frases ou escreva na aba Escrever.</p>
					) : (
						<div className="max-h-[300px] space-y-2 overflow-auto">
							{frasesCanal.map(f => {
								const selecionada = isFraseRef(refAtual) && refAtual.frase_id === f.id;
								return (
									<button key={f.id} onClick={() => onSetRef({ frase_id: f.id })} className={`block w-full rounded-lg border p-3 text-left transition ${selecionada ? 'border-[#0F4C5C] bg-[#eaf2f3] ring-1 ring-[#0F4C5C]' : 'border-[#e2eaec] hover:bg-[#f5f8f9]'}`}>
										<div className="flex items-center justify-between">
											<span className="text-sm font-semibold text-[#163943]">{f.nome}</span>
											{canalTipoMensagem(f.canal) === 'template' && <span className="text-[10px] font-semibold text-slate-400">{templateCodigoOf(f) || 'sem código'}</span>}
										</div>
										<p className="mt-1 line-clamp-2 text-xs text-slate-600">{previsualizar(frasePreview(f))}</p>
									</button>
								);
							})}
						</div>
					)}
				</div>
			) : (
				<div className="space-y-3">
					<div>
						<div className="mb-1.5 flex items-center justify-between">
							<label className="text-xs font-semibold text-slate-600">Texto da mensagem</label>
							<span className={`text-[11px] ${texto.length > MAX_TEXTO ? 'font-bold text-[#C62828]' : 'text-slate-400'}`}>{texto.length}/{MAX_TEXTO}{isSms && texto ? ` · ${smsMensagens(texto)} SMS` : ''}</span>
						</div>
						<textarea ref={taRef} value={texto} onChange={e => setTexto(e.target.value)} rows={4} placeholder="Escreva a mensagem…" className="w-full rounded border border-[#d8e3e5] p-3 text-sm outline-none focus:border-[#0F4C5C]"/>
					</div>
					<VariavelBotoes onInsert={insertVar}/>
					{vars.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{vars.map(v => (
								<span key={v} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARS_MOTORCOB.has(v) ? 'bg-[#eaf2f3] text-[#0F4C5C]' : 'border border-dashed border-[#e9a23b] bg-[#fff7e8] text-[#9a631b]'}`}>
									{`{${v}}`}{!VARS_MOTORCOB.has(v) && ' · ferramenta do canal'}
								</span>
							))}
						</div>
					)}
					{texto.trim() && (
						<div className="rounded-lg border border-[#e2eaec] bg-[#f7fafb] p-3">
							<p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Prévia</p>
							<p className="whitespace-pre-wrap text-sm text-slate-700">{previsualizar(texto)}</p>
						</div>
					)}
					<div className="rounded-lg border border-[#f0d49a] bg-[#fff7e8] p-3">
						<p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#9a631b]">Salvar no playbook</p>
						<div className="flex gap-2">
							<input value={nomeSalvar} onChange={e => setNomeSalvar(e.target.value)} placeholder="Nome da frase" className="h-9 flex-1 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/>
							<button onClick={salvarNoPlaybook} disabled={busy} className="h-9 shrink-0 rounded-lg border border-[#9a631b] bg-[#fff7e8] px-3 text-xs font-semibold text-[#9a631b] hover:bg-[#fff1d8] disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar no playbook'}</button>
						</div>
					</div>
				</div>
			)}

			<div className="flex items-center justify-between border-t border-[#ecf0f1] pt-3">
				{refAtual ? <button onClick={() => onSetRef(null)} className="flex items-center gap-1.5 text-xs font-semibold text-[#C62828] hover:underline"><Trash2 size={13}/> Limpar</button> : <span/>}
				<div className="flex gap-2">
					{aba === 'escrever' && <button onClick={aplicarTexto} className="h-9 rounded-lg bg-[#0F4C5C] px-4 text-sm font-semibold text-white">Usar texto</button>}
				</div>
			</div>
		</div>
	);
}

export type MensagemDiaEditorProps = {
	canal: string;
	mensagem: MensagemAcao | undefined;
	frases: Frase[];
	estagio: string;
	isCpc: boolean;
	isPersona: boolean;
	isCpcHot?: boolean;
	canaisEmpresa: string[];
	titulo: string;
	onClose: () => void;
	onSet: (m: MensagemAcao | null) => void;
	onSalvarNoPlaybook: (texto: string, nome: string) => Promise<string | null>;
};

export function MensagemDiaEditor({ canal, mensagem, frases, estagio, isCpc, isPersona, isCpcHot, canaisEmpresa, titulo, onClose, onSet, onSalvarNoPlaybook }: MensagemDiaEditorProps) {
	// CPC: mesma frase para A e B, ou separadas
	const cpcMesma = useMemo(() => {
		if (!isCpc) return true;
		if (mensagem == null || typeof mensagem === 'string' || 'frase_id' in mensagem) return true;
		const obj = mensagem as Record<string, MensagemRef>;
		const cpa = obj?.cpa;
		const cpb = obj?.cpb;
		return JSON.stringify(cpa) === JSON.stringify(cpb);
	}, [isCpc, mensagem]);
	const [cpcMesmaState, setCpcMesmaState] = useState(cpcMesma);

	// Persona: abas por canal
	const personaCanais = useMemo(() => {
		if (!isPersona) return [];
		return FRASE_CANAIS.filter(c => canaisEmpresa.includes(c.id)).map(c => c.id);
	}, [isPersona, canaisEmpresa]);
	const [personaTab, setPersonaTab] = useState(personaCanais[0] ?? canal);

	// CPC Hot (canal do CPC · telefone Hot): abas por canal ligado na empresa + CPC A/B em cada aba
	const hotCanais = useMemo(() => {
		if (!isCpcHot) return [];
		return FRASE_CANAIS.filter(c => canaisEmpresa.includes(c.id)).map(c => c.id);
	}, [isCpcHot, canaisEmpresa]);
	const [hotTab, setHotTab] = useState(hotCanais[0] ?? canal);
	const [hotMesmaOverride, setHotMesmaOverride] = useState<Record<string, boolean>>({});
	function hotObj(): Record<string, MensagemRef> {
		return (mensagem && typeof mensagem === 'object' && !('frase_id' in mensagem) ? mensagem : {}) as Record<string, MensagemRef>;
	}
	function hotRef(c: string): MensagemRef | undefined {
		return hotObj()?.[c];
	}
	function isHotMesmaDerived(c: string): boolean {
		const r = hotRef(c);
		if (r == null) return true;
		return typeof r === 'string' || 'frase_id' in r;
	}
	const hotMesma = hotMesmaOverride[hotTab] ?? isHotMesmaDerived(hotTab);
	function hotCpcRef(c: string, chave: 'cpa' | 'cpb'): MensagemRef | undefined {
		const r = hotRef(c);
		if (r && typeof r === 'object' && !('frase_id' in r)) return (r as Record<string, MensagemRef>)[chave];
		return undefined;
	}
	function setHotRef(c: string, r: MensagemRef | null) {
		const obj = hotObj();
		const next = { ...obj };
		if (r == null) delete next[c]; else next[c] = r;
		if (Object.keys(next).length === 0) onSet(null);
		else onSet(next as unknown as MensagemAcao);
	}
	function setHotCpcRef(c: string, chave: 'cpa' | 'cpb', r: MensagemRef | null) {
		const obj = hotObj();
		const curRaw = obj[c];
		const cur = (curRaw && typeof curRaw === 'object' && !('frase_id' in curRaw) ? curRaw : {}) as Record<string, MensagemRef>;
		const nextCpc = { ...cur };
		if (r == null) delete nextCpc[chave]; else nextCpc[chave] = r;
		const next = { ...obj };
		if (Object.keys(nextCpc).length === 0) delete next[c]; else next[c] = nextCpc as unknown as MensagemRef;
		if (Object.keys(next).length === 0) onSet(null);
		else onSet(next as unknown as MensagemAcao);
	}
	function setHotMesma(v: boolean) {
		setHotMesmaOverride(prev => ({ ...prev, [hotTab]: v }));
		if (v) {
			const r = hotRef(hotTab);
			if (r && typeof r === 'object' && !('frase_id' in r)) {
				const cpa = (r as Record<string, MensagemRef>)?.cpa;
				setHotRef(hotTab, cpa ?? null);
			}
		} else {
			const r = hotRef(hotTab);
			if (r != null && (typeof r === 'string' || 'frase_id' in r)) {
				const obj = hotObj();
				const next = { ...obj, [hotTab]: { cpa: r, cpb: r } };
				onSet(next as unknown as MensagemAcao);
			}
		}
	}

	function setRefSimples(r: MensagemRef | null) {
		onSet(r);
	}
	function setCpcRef(chave: 'cpa' | 'cpb', r: MensagemRef | null) {
		const obj = (mensagem && typeof mensagem === 'object' && !('frase_id' in mensagem) ? mensagem : {}) as Record<string, MensagemRef>;
		const next = { ...obj };
		if (r == null) delete next[chave]; else next[chave] = r;
		if (Object.keys(next).length === 0) onSet(null);
		else onSet(next);
	}
	function setCpcMesma(r: MensagemRef | null) {
		onSet(r);
	}
	function setPersonaRef(c: string, r: MensagemRef | null) {
		const obj = (mensagem && typeof mensagem === 'object' && !('frase_id' in mensagem) ? mensagem : {}) as Record<string, MensagemRef>;
		const next = { ...obj };
		if (r == null) delete next[c]; else next[c] = r;
		if (Object.keys(next).length === 0) onSet(null);
		else onSet(next);
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<div>
						<h3 className="text-lg font-semibold">Frase · {titulo}</h3>
						<p className="text-xs text-slate-400">Escolha uma frase do playbook ou escreva um texto próprio para este dia.</p>
					</div>
					<button onClick={onClose} className="text-slate-400 hover:text-[#0F4C5C]"><X size={20}/></button>
				</div>

				{isCpc && !isCpcHot && (
					<div className="mb-4">
						<label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
							<input type="checkbox" checked={cpcMesmaState} onChange={e => { setCpcMesmaState(e.target.checked); if (e.target.checked) setCpcMesma(getRef(mensagem, 'cpa') ?? null); }} className="accent-[#0F4C5C]"/>
							Mesma frase para CPC A e CPC B
						</label>
					</div>
				)}

				{isCpcHot && hotCanais.length > 0 && (
					<div className="mb-4 flex flex-wrap gap-1 border-b border-[#e5edef] pb-2">
						{hotCanais.map(c => (
							<button key={c} onClick={() => setHotTab(c)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${hotTab === c ? 'bg-[#0F4C5C] text-white' : 'text-slate-500 hover:bg-[#edf4f5]'}`}>{fraseCanalLabel[c] ?? c}</button>
						))}
					</div>
				)}
				{isCpcHot && hotCanais.length > 0 && (
					<div className="mb-4">
						<label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
							<input type="checkbox" checked={hotMesma} onChange={e => setHotMesma(e.target.checked)} className="accent-[#0F4C5C]"/>
							Mesma frase para CPC A e CPC B
						</label>
					</div>
				)}

				{isPersona && !isCpcHot && personaCanais.length > 0 && (
					<div className="mb-4 flex flex-wrap gap-1 border-b border-[#e5edef] pb-2">
						{personaCanais.map(c => (
							<button key={c} onClick={() => setPersonaTab(c)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${personaTab === c ? 'bg-[#0F4C5C] text-white' : 'text-slate-500 hover:bg-[#edf4f5]'}`}>{fraseCanalLabel[c] ?? c}</button>
						))}
					</div>
				)}

				{isCpcHot && hotCanais.length > 0 ? (
				hotMesma ? (
					<RefEditor canal={hotTab} refAtual={hotRef(hotTab)} frases={frases} estagio="cpc_a" onSetRef={r => setHotRef(hotTab, r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
				) : (
					<div className="space-y-5">
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CPC A</p>
							<RefEditor canal={hotTab} refAtual={hotCpcRef(hotTab, 'cpa')} frases={frases} estagio="cpc_a" onSetRef={r => setHotCpcRef(hotTab, 'cpa', r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
						</div>
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CPC B</p>
							<RefEditor canal={hotTab} refAtual={hotCpcRef(hotTab, 'cpb')} frases={frases} estagio="cpc_b" onSetRef={r => setHotCpcRef(hotTab, 'cpb', r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
						</div>
					</div>
				)
			) : isCpc && !cpcMesmaState ? (
					<div className="space-y-5">
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CPC A</p>
							<RefEditor canal={canal} refAtual={getRef(mensagem, 'cpa')} frases={frases} estagio="cpc_a" onSetRef={r => setCpcRef('cpa', r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
						</div>
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CPC B</p>
							<RefEditor canal={canal} refAtual={getRef(mensagem, 'cpb')} frases={frases} estagio="cpc_b" onSetRef={r => setCpcRef('cpb', r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
						</div>
					</div>
				) : isPersona && personaCanais.length > 0 ? (
					<RefEditor canal={personaTab} refAtual={getRef(mensagem, personaTab)} frases={frases} estagio={estagio} onSetRef={r => setPersonaRef(personaTab, r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
				) : (
					<RefEditor canal={canal} refAtual={mensagem as MensagemRef | undefined} frases={frases} estagio={estagio} onSetRef={r => setRefSimples(r)} onSalvarNoPlaybook={onSalvarNoPlaybook}/>
				)}

				<div className="mt-5 flex justify-end">
					<button onClick={onClose} className="h-9 rounded-lg border border-[#c9dadd] px-4 text-sm font-semibold text-slate-600 hover:bg-[#edf4f5]">Fechar</button>
				</div>
			</div>
		</div>
	);
}
