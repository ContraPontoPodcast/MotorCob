import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BookOpen, Copy, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { useAllowed, Notice } from '@/components/app-shell';
import {
	carregarFrases, salvarFrase, excluirFrase, toggleFraseAtiva, contarUsoFrase,
	extrairVariaveis, previsualizar, smsMensagens, VARS_MOTORCOB, variavelLabel,
	FRASE_ESTAGIOS, estagioLabel, canalTipoMensagem, templateCodigoOf, templatePreviewOf, frasePreview,
	type Frase,
} from '@/lib/frases';

const MAX_TEXTO = 2000;
const MAX_CODIGO = 200;
const VARS_INSERIR = ['saldo', 'dias_atraso', 'vencimento', 'valor_parcela', 'qtd_parcelas_abertas', 'nome', 'link'];

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

function FraseEditor({ canal, frase, onClose, onSaved }: {
	canal: string; frase: Partial<Frase> | null; onClose: () => void; onSaved: () => void;
}) {
	const { empresa } = useMotorAuth();
	const isTemplate = canalTipoMensagem(canal) === 'template';
	const [nome, setNome] = useState(frase?.nome ?? '');
	const [codigo, setCodigo] = useState(isTemplate ? (frase ? templateCodigoOf(frase) : '') : '');
	const [estagio, setEstagio] = useState(frase?.estagio ?? '');
	const [texto, setTexto] = useState(isTemplate ? (frase ? templatePreviewOf(frase) : '') : (frase?.texto ?? ''));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const taRef = useRef<HTMLTextAreaElement>(null);
	const isSms = canal === 'sms';
	const vars = useMemo(() => extrairVariaveis(texto), [texto]);

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

	async function salvar(origemExtra?: 'criado') {
		if (!empresa) return;
		if (!nome.trim()) { setError('Nome é obrigatório.'); return; }
		if (isTemplate && !codigo.trim()) { setError('Código do template no provedor é obrigatório.'); return; }
		if (isTemplate && codigo.trim().length > MAX_CODIGO) { setError(`Código do template excede ${MAX_CODIGO} caracteres.`); return; }
		if (!texto.trim()) { setError(isTemplate ? 'Prévia do texto é obrigatória.' : 'Texto é obrigatório.'); return; }
		if (texto.length > MAX_TEXTO) { setError(`Texto excede ${MAX_TEXTO} caracteres.`); return; }
		setBusy(true); setError('');
		const { error } = await salvarFrase({
			id: frase?.id, empresa_id: empresa.id, canal, nome: nome.trim(),
			estagio: isTemplate ? null : (estagio || null), texto,
			codigo_template: isTemplate ? codigo.trim() : undefined,
			origem: frase?.origem ?? origemExtra ?? 'criado', ativo: frase?.ativo ?? true,
		});
		setBusy(false);
		if (error) { setError(error); return; }
		toast.success(frase ? 'Modelo atualizado.' : 'Modelo criado.');
		onSaved();
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-lg font-semibold">{frase ? 'Editar modelo de mensagem' : 'Novo modelo de mensagem'}</h3>
					<button onClick={onClose} className="text-slate-400 hover:text-[#0F4C5C]"><X size={20}/></button>
				</div>
				{error && <div className="mb-4"><Notice>{error}</Notice></div>}
				<div className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<label className="mb-1 block text-xs font-semibold text-slate-600">Nome <span className="text-[#C62828]">*</span></label>
							<input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Lembrete de saldo" className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/>
							<p className="mt-1 text-[11px] text-slate-400">Único neste canal.</p>
						</div>
						{isTemplate ? (
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Código do template no provedor <span className="text-[#C62828]">*</span></label>
								<input value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={MAX_CODIGO} placeholder="Ex.: lembrete_saldo_v1" className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/>
								<p className="mt-1 text-[11px] text-slate-400">Nome do template aprovado no provedor. Até {MAX_CODIGO} caracteres.</p>
							</div>
						) : (
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Estágio sugerido</label>
								<select value={estagio} onChange={e => setEstagio(e.target.value)} className="h-10 w-full rounded border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">
									<option value="">Qualquer</option>
									{FRASE_ESTAGIOS.filter(e => e.id !== 'qualquer').map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
								</select>
							</div>
						)}
					</div>
					<div>
						<div className="mb-1.5 flex items-center justify-between">
							<label className="text-xs font-semibold text-slate-600">{isTemplate ? 'Prévia do texto' : 'Texto'} <span className="text-[#C62828]">*</span></label>
							<span className={`text-[11px] ${isSms && texto.length > 160 ? 'font-bold text-[#C62828]' : 'text-slate-400'}`}>{isSms ? `${texto.length}/160` : isTemplate && canal === 'rcs' ? (texto.length > 160 ? 'RCS Single (preço diferente)' : 'RCS Basic') : `${texto.length}/${MAX_TEXTO}`}</span>
						</div>
						<textarea ref={taRef} value={texto} onChange={e => setTexto(e.target.value)} rows={5} placeholder={isTemplate ? 'Prévia do texto do template…' : 'Escreva a mensagem. Use {saldo}, {vencimento}…'} className="w-full rounded border border-[#d8e3e5] p-3 text-sm outline-none focus:border-[#0F4C5C]"/>
						{isSms && (texto.length > 160
							? <p className="mt-1 text-[11px] font-semibold text-[#C62828]">O SMS acima de 160 caracteres não é enviado.</p>
							: <p className="mt-1 text-[11px] text-slate-400">160 caracteres por mensagem. {texto ? `${smsMensagens(texto)} mensagem(s).` : ''}</p>)}
						{isTemplate && canal === 'rcs' && <p className="mt-1 text-[11px] text-slate-400">{texto.length > 160 ? 'Acima de 160: cobra como RCS Single.' : 'Até 160: cobra como RCS Basic.'}</p>}
					</div>
					<div>
						<p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Inserir variável</p>
						<VariavelBotoes onInsert={insertVar}/>
						<p className="mt-1.5 text-[11px] text-slate-400">Azul = o MotorCX preenche. Âmbar = a ferramenta do canal preenche.</p>
					</div>
					{vars.length > 0 && (
						<div className="rounded-lg border border-[#e2eaec] bg-[#f7fafb] p-3">
							<p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Variáveis no texto</p>
							<div className="flex flex-wrap gap-1.5">
								{vars.map(v => (
									<span key={v} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARS_MOTORCOB.has(v) ? 'bg-[#eaf2f3] text-[#0F4C5C]' : 'border border-dashed border-[#e9a23b] bg-[#fff7e8] text-[#9a631b]'}`}>
										{`{${v}}`} {variavelLabel[v] ? `· ${variavelLabel[v]}` : ''}{!VARS_MOTORCOB.has(v) && ' · ferramenta do canal'}
									</span>
								))}
							</div>
						</div>
					)}
					{texto.trim() && (
						<div className="rounded-lg border border-[#e2eaec] bg-white p-3">
							<p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Prévia com valores de exemplo</p>
							<p className="whitespace-pre-wrap text-sm text-slate-700">{previsualizar(texto)}</p>
						</div>
					)}
				</div>
				<div className="mt-5 flex justify-end gap-2">
					<button onClick={onClose} className="h-10 rounded-lg border border-[#c9dadd] px-4 text-sm font-semibold text-slate-600 hover:bg-[#edf4f5]">Cancelar</button>
					<button onClick={() => salvar()} disabled={busy} className="h-10 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar modelo'}</button>
				</div>
			</div>
		</div>
	);
}

export function FrasesTab({ canal }: { canal: string }) {
	const { empresa } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const isTemplate = canalTipoMensagem(canal) === 'template';
	const [frases, setFrases] = useState<Frase[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busca, setBusca] = useState('');
	const [filtroEstagio, setFiltroEstagio] = useState('all');
	const [editor, setEditor] = useState<{ open: boolean; frase: Partial<Frase> | null }>({ open: false, frase: null });

	async function reload() {
		if (!empresa) return;
		setLoading(true); setError('');
		const { frases, error } = await carregarFrases(empresa.id);
		setFrases(frases); setError(error); setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id, canal]);

	const filtradas = useMemo(() => {
		const q = busca.trim().toLowerCase();
		return frases.filter(f => f.canal === canal)
			.filter(f => filtroEstagio === 'all' ? true : (f.estagio ?? 'qualquer') === filtroEstagio)
			.filter(f => !q || f.nome.toLowerCase().includes(q) || frasePreview(f).toLowerCase().includes(q) || templateCodigoOf(f).toLowerCase().includes(q));
	}, [frases, canal, busca, filtroEstagio]);

	async function onToggleAtiva(f: Frase, ativo: boolean) {
		setFrases(prev => prev.map(x => x.id === f.id ? { ...x, ativo } : x));
		const { error } = await toggleFraseAtiva(f.id, ativo);
		if (error) { toast.error(error); setFrases(prev => prev.map(x => x.id === f.id ? { ...x, ativo: !ativo } : x)); }
	}

	async function onExcluir(f: Frase) {
		if (!empresa) return;
		const uso = await contarUsoFrase(empresa.id, f.id);
		if (uso > 0) {
				toast(`Este modelo de mensagem é usado em ${uso} estratégia(s); prefira desativar.`, { duration: 8000 });
			return;
		}
		if (!window.confirm(`Excluir o modelo de mensagem "${f.nome}"?`)) return;
		const { error } = await excluirFrase(f.id);
		if (error) { toast.error(error); return; }
		toast.success('Modelo excluído.');
		void reload();
	}

	function duplicar(f: Frase) {
		setEditor({ open: true, frase: { ...f, id: undefined, nome: `${f.nome} (cópia)` } });
	}

	if (!empresa) return <Notice variant="warning">Escolha a empresa no topo.</Notice>;
	if (loading) return <p className="py-6 text-sm text-slate-400">Carregando…</p>;

	return (
		<div>
			{error && <div className="mb-3"><Notice>{error}</Notice></div>}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="relative flex-1 min-w-[180px]">
					<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
						<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou texto" className="h-9 w-full rounded border border-[#d8e3e5] pl-9 pr-3 text-sm outline-none focus:border-[#0F4C5C]"/>
				</div>
				{!isTemplate && (
					<select value={filtroEstagio} onChange={e => setFiltroEstagio(e.target.value)} className="h-9 rounded border border-[#d8e3e5] bg-white px-2 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="all">Todos os estágios</option>
						{FRASE_ESTAGIOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
					</select>
				)}
				{canEdit && <button onClick={() => setEditor({ open: true, frase: null })} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-3 text-xs font-semibold text-white"><Plus size={14}/> Novo modelo</button>}
			</div>

			{filtradas.length === 0 ? (
				<div className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-6 py-10 text-center text-sm text-slate-500">
					<BookOpen className="mx-auto mb-2 text-slate-300" size={28}/>
					Nenhum modelo de mensagem neste canal. {canEdit && 'Crie o primeiro ou importe um playbook.'}
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<thead>
							<tr className="border-b border-[#e2eaec] text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
								<th className="py-2 pr-3">Nome</th>
								{isTemplate && <th className="py-2 pr-3">Código</th>}
								{!isTemplate && <th className="py-2 pr-3">Estágio</th>}
								<th className="py-2 pr-3">{isTemplate ? 'Prévia' : 'Texto'}</th>
								<th className="py-2 pr-3">Origem</th>
								<th className="py-2 pr-3 text-center">Ativa</th>
								<th className="py-2 pr-2 text-right">Ações</th>
							</tr>
						</thead>
						<tbody>
							{filtradas.map(f => (
								<tr key={f.id} className={`border-b border-[#eef3f4] align-top ${f.ativo ? '' : 'opacity-60'}`}>
									<td className="py-2.5 pr-3 font-medium text-[#163943]">{f.nome}</td>
									{isTemplate && <td className="py-2.5 pr-3"><span className="rounded-full bg-[#eaf2f3] px-2 py-0.5 text-[11px] font-semibold text-[#0F4C5C]">{templateCodigoOf(f) || '—'}</span></td>}
									{!isTemplate && <td className="py-2.5 pr-3"><span className="rounded-full bg-[#eaf2f3] px-2 py-0.5 text-[11px] font-semibold text-[#0F4C5C]">{f.estagio ? estagioLabel[f.estagio] ?? f.estagio : 'Qualquer'}</span></td>}
									<td className="py-2.5 pr-3 max-w-[280px]"><span className="line-clamp-2 text-xs text-slate-600">{frasePreview(f)}</span></td>
									<td className="py-2.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.origem === 'importado' ? 'bg-[#fff7e8] text-[#9a631b]' : 'bg-[#eaf2f3] text-[#0F4C5C]'}`}>{f.origem === 'importado' ? 'Importada' : 'Criada'}</span></td>
									<td className="py-2.5 pr-3 text-center">
										{canEdit ? (
											<button role="switch" aria-checked={f.ativo} onClick={() => onToggleAtiva(f, !f.ativo)} className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${f.ativo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${f.ativo ? 'left-[18px]' : 'left-0.5'}`}/></button>
										) : <span className={`h-2 w-2 rounded-full ${f.ativo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}/>}
									</td>
									<td className="py-2.5 pr-2">
										<div className="flex items-center justify-end gap-1">
											{canEdit && <>
												<button onClick={() => setEditor({ open: true, frase: f })} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-[#edf4f5] hover:text-[#0F4C5C]" aria-label="Editar"><Pencil size={14}/></button>
												<button onClick={() => duplicar(f)} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-[#edf4f5] hover:text-[#0F4C5C]" aria-label="Duplicar"><Copy size={14}/></button>
												<button onClick={() => onExcluir(f)} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]" aria-label="Excluir"><Trash2 size={14}/></button>
											</>}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{editor.open && <FraseEditor canal={canal} frase={editor.frase} onClose={() => setEditor({ open: false, frase: null })} onSaved={() => void reload()}/>}
		</div>
	);
}
