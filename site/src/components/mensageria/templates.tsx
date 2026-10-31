import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router';
import { Plus, Pencil, Copy, Archive, X, Link as LinkIcon } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, safeFileName, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { isCanalValido, CATEGORIA_RCS, TIPO_MIDIA_NOME } from '@/lib/mensageria-produtos';
import { ModeloEmailEditor } from '@/components/mensageria/modelo-email';

export function TemplatesCanal() {
	const { canal } = useParams();
	const { empresa, permissoes } = useMotorAuth();
	const canEdit = permissoes.includes('editar_canais');
	const [lista, setLista] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [editando, setEditando] = useState<Row | null | 'novo'>(null);

	async function reload() {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		setLoading(true);
		const { data, error } = await supabase.from('mensageria_templates').select('*').eq('empresa_id', empresa.id).eq('canal', canal).neq('situacao', 'arquivado').order('nome');
		if (error) { setErro(friendlyError(error)); setLoading(false); return; }
		setLista(data ?? []); setErro(''); setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id, canal]);

	if (!isCanalValido(canal)) return null;
	if (canal === 'email') return <ModeloEmailEditor />;

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				{canEdit && <button onClick={() => setEditando('novo')} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={15} /> Novo template</button>}
			</div>
			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}
			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				lista.length === 0 ? (
					<div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<span className="mc-area-tag mb-3">Mensageria</span>
						<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Templates</h2>
						<p className="mx-auto mt-2 max-w-sm text-[14px] text-[#6E6E73]">O template é o texto da mensagem, com variáveis como {'{{nome}}'} e {'{{valor}}'}.</p>
						{canEdit && <button onClick={() => setEditando('novo')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Criar o primeiro template</button>}
					</div>
				) : (
					<div className="overflow-x-auto rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<table className="w-full border-collapse text-[14px]">
							<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
								<th className="px-5 py-3">Nome</th>
								{canal === 'rcs' && <th className="px-5 py-3">Categoria</th>}
								{canal === 'rcs' && <th className="px-5 py-3">Tipo de mídia</th>}
								<th className="px-5 py-3">Variáveis</th>
								<th className="px-5 py-3">Atualizado em</th>
								{canEdit && <th className="px-5 py-3 text-right">Ações</th>}
							</tr></thead>
							<tbody>
								{lista.map(t => (
									<tr key={t.id} className="border-b border-[#F0F0F2]">
										<td className="px-5 py-3 font-medium text-[#1D1D1F]">{t.nome}</td>
										{canal === 'rcs' && <td className="px-5 py-3 text-[#6E6E73]">{CATEGORIA_RCS.find(c => c.id === t.categoria)?.label ?? t.categoria}</td>}
										{canal === 'rcs' && <td className="px-5 py-3 text-[#6E6E73]">{TIPO_MIDIA_NOME[t.tipo_midia as string] ?? t.tipo_midia}</td>}
										<td className="px-5 py-3"><div className="flex flex-wrap gap-1">{((t.variaveis as string[]) ?? []).map(v => <span key={v} className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[12px] text-[#6E6E73]">{`{{${v}}}`}</span>)}</div></td>
										<td className="px-5 py-3 tnum text-[#6E6E73]">{dateTimeBR(t.atualizado_em)}</td>
										{canEdit && <td className="px-5 py-3"><div className="flex justify-end gap-1">
											<button onClick={() => setEditando(t)} className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><Pencil size={15} /></button>
											<button onClick={async () => { const { error } = await supabase!.from('mensageria_templates').insert({ empresa_id: empresa!.id, canal, nome: `${t.nome} (cópia)`, categoria: t.categoria, tipo_midia: t.tipo_midia, conteudo: t.conteudo, rastrear_links: t.rastrear_links, situacao: 'ativo' }); if (error) setErro(friendlyError(error)); else void reload(); }} className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><Copy size={15} /></button>
											<button onClick={async () => { if (!confirm('Arquivar template?')) return; const { error } = await supabase!.from('mensageria_templates').update({ situacao: 'arquivado' }).eq('id', t.id); if (error) setErro(friendlyError(error)); else void reload(); }} className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><Archive size={15} /></button>
										</div></td>}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			{editando && <TemplateEditor canal={canal} existente={editando === 'novo' ? null : editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); void reload(); }} />}
		</div>
	);
}

function TemplateEditor({ canal, existente, onClose, onSaved }: { canal: string; existente: Row | null; onClose: () => void; onSaved: () => void }) {
	const { empresa } = useMotorAuth();
	const [nome, setNome] = useState(existente?.nome ?? '');
	const [categoria, setCategoria] = useState(existente?.categoria ?? 'transacional');
	const [tipoMidia, setTipoMidia] = useState(existente?.tipo_midia ?? 'simples');
	const [texto, setTexto] = useState<string>((existente?.conteudo as Row)?.texto ?? '');
	const [rastrear, setRastrear] = useState(existente?.rastrear_links ?? false);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isRcs = canal === 'rcs';
	const isSms = canal === 'sms';

	function inserirVar() {
		const v = prompt('Nome da variável (letras, números e _):');
		if (!v || !/^[a-zA-Z0-9_]+$/.test(v)) return;
		const el = textareaRef.current;
		const tag = `{{${v}}}`;
		if (!el) { setTexto(t => t + tag); return; }
		const s = el.selectionStart ?? texto.length, e = el.selectionEnd ?? texto.length;
		const next = texto.slice(0, s) + tag + texto.slice(e);
		setTexto(next);
		requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tag.length, s + tag.length); });
	}

	async function salvar() {
		if (!supabase || !empresa) return;
		if (!nome.trim()) { setErro('Informe o nome.'); return; }
		setBusy(true); setErro('');
		const conteudo: Record<string, unknown> = { texto: texto.trim() };
		const payload: Record<string, unknown> = { empresa_id: empresa.id, canal, nome: nome.trim(), categoria: isRcs ? categoria : null, tipo_midia: isRcs ? tipoMidia : null, conteudo, rastrear_links: rastrear, situacao: 'ativo' };
		let error;
		if (existente) error = (await supabase.from('mensageria_templates').update(payload).eq('id', existente.id)).error;
		else error = (await supabase.from('mensageria_templates').insert(payload)).error;
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		onSaved();
	}

	const semVars = texto.replace(/\{\{[^}]+\}\}/g, '');
	const seloRcs = isRcs ? (semVars.length <= 160 ? 'RCS Basic' : 'RCS Single') : null;

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
			<div className="max-h-[92vh] w-full max-w-[640px] overflow-auto rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{existente ? 'Editar template' : 'Novo template'}</h2>
					<button onClick={onClose} aria-label="Fechar"><X size={20} className="text-[#8E8E93]" /></button>
				</div>
				<div className="space-y-4">
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Nome *</label>
						<input value={nome} onChange={e => setNome(e.target.value)} maxLength={120} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					</div>
					{isRcs && (
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Categoria</label>
								<div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
									{CATEGORIA_RCS.map(c => <button key={c.id} onClick={() => setCategoria(c.id)} className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium ${categoria === c.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F]'}`}>{c.label}</button>)}
								</div>
							</div>
							<div>
								<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Tipo de mídia</label>
								<select value={tipoMidia} onChange={e => setTipoMidia(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">
									{Object.entries(TIPO_MIDIA_NOME).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
								</select>
							</div>
						</div>
					)}
					<div>
						<div className="mb-1.5 flex items-center justify-between">
							<label className="text-[13px] font-semibold text-[#1D1D1F]">Texto</label>
							<button onClick={inserirVar} className="rounded-full border border-[#D2D2D7] px-3 py-1 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Inserir variável</button>
						</div>
						<textarea ref={textareaRef} value={texto} onChange={e => setTexto(e.target.value)} rows={5} className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
						{isSms && <p className="mt-1 text-[12px] text-[#8E8E93]">{semVars.length}/160 sem as variáveis · Depois de preencher as variáveis, o SMS acima de 160 caracteres não é enviado.</p>}
						{seloRcs && <p className="mt-1 text-[12px] font-semibold text-[#3B5BA9]">{seloRcs}</p>}
					</div>
					<div className="flex items-center justify-between rounded-lg border border-[#E5E5EA] px-4 py-3">
						<div><span className="text-[14px] font-medium text-[#1D1D1F]">Rastrear links</span><p className="text-[12px] text-[#8E8E93]">Os links viram endereços curtos do MotorCX para saber quem clicou.</p></div>
						<button role="switch" aria-checked={rastrear} onClick={() => setRastrear(!rastrear)} className={`relative h-6 w-11 rounded-full transition-colors ${rastrear ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${rastrear ? 'left-6' : 'left-1'}`} /></button>
					</div>
					{rastrear && <p className="flex items-center gap-1.5 text-[12px] text-[#6E6E73]"><LinkIcon size={12} /> Exemplo: https://motorcob.com.br/Ab12Cd34 · No SMS o link curto ocupa cerca de 30 caracteres dos 160.</p>}
					{erro && <p className="text-[13px] text-[#FF3B30]">{erro}</p>}
					<div className="flex justify-end gap-2 pt-1">
						<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Salvar'}</button>
					</div>
				</div>
			</div>
		</div>
	);
}
