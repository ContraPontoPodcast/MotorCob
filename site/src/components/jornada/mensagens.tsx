import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BookOpen, Lock, Plus, Search, Trash2, X } from 'lucide-react';
import { Notice, useAllowed } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading } from '@/components/jornada/jornada-shell';
import { PainelEdicao } from '@/components/comuns/painel-edicao';
import { friendlyError, supabase, type Row } from '@/lib/supabase';
import {
	canalTipoMensagem, carregarFrases, salvarFrase, excluirFrase, frasePreview, previsualizar, smsMensagens,
	templateCodigoOf, templatePreviewOf, packTemplateTexto, type Frase,
} from '@/lib/frases';
import { MOMENTOS, MOMENTO_NOME, JORNADA_CANAIS, CANAL_NOME, type MomentoId } from '@/lib/jornada';

const MAX_TEXTO = 2000;
const MAX_CODIGO = 200;

/** Canais da jornada que usam mensagem. */
const CANAIS_MSG = JORNADA_CANAIS.filter(c => c.id !== 'melhor' && canalTipoMensagem(c.id) !== 'nenhuma');

/** Conta passos que usam a frase, nas estratégias motorcli da empresa. */
async function contarUsoPassos(empresaId: string, fraseId: string): Promise<number> {
	if (!supabase) return 0;
	const { data } = await supabase.from('estrategias').select('definicao,frente').eq('empresa_id', empresaId);
	if (!data) return 0;
	let n = 0;
	const alvo = `"frase_id":"${fraseId}"`;
	const alvo2 = `"frase_id": "${fraseId}"`;
	for (const r of data as Row[]) {
		if (r.frente !== 'motorcli') continue;
		const s = typeof r.definicao === 'string' ? r.definicao : JSON.stringify(r.definicao ?? {});
		// conta ocorrências (uma por passo)
		const matches = s.match(new RegExp(alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
		const matches2 = s.match(new RegExp(alvo2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
		n += (matches?.length ?? 0) + (matches2?.length ?? 0);
	}
	return n;
}

type ResultadoFrase = { frase_id: string; taxa: number | null; frase: string | null };

export function JornadaMensagens() {
	const { empresa, carteira } = useJornadaCarteira();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [frases, setFrases] = useState<Frase[]>([]);
	const [colunas, setColunas] = useState<string[]>([]);
	const [resultados, setResultados] = useState<Record<string, ResultadoFrase>>({});
	const [usoMap, setUsoMap] = useState<Record<string, number>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [aba, setAba] = useState<MomentoId>('pre_vencimento');
	const [busca, setBusca] = useState('');
	const [editor, setEditor] = useState<{ open: boolean; frase: Partial<Frase> | null; reset: number }>({ open: false, frase: null, reset: 0 });

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true); setError('');
		const [f, emp] = await Promise.all([
			carregarFrases(empresa.id),
			supabase.from('empresas').select('colunas_base').eq('id', empresa.id).maybeSingle(),
		]);
		setFrases(f.frases); setError(f.error);
		const cb = (emp.data as Row | null)?.colunas_base;
		setColunas(Array.isArray(cb?.colunas) ? cb.colunas as string[] : []);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	// Resultado das frases da carteira do topo (últimos 30 dias).
	useEffect(() => {
		if (!supabase || !carteira) { setResultados({}); return; }
		let active = true;
		(async () => {
			const ate = new Date();
			const de = new Date(); de.setDate(de.getDate() - 30);
			const { data } = await supabase.rpc('resultado_frases', {
				credor: carteira.id,
				de: de.toISOString().slice(0, 10),
				ate: ate.toISOString().slice(0, 10),
			});
			if (!active) return;
			const map: Record<string, ResultadoFrase> = {};
			(Array.isArray(data) ? (data as Row[]) : []).forEach(r => {
				map[String(r.frase_id)] = { frase_id: String(r.frase_id), taxa: r.taxa != null ? Number(r.taxa) : null, frase: r.frase ? String(r.frase) : null };
			});
			setResultados(map);
		})();
		return () => { active = false; };
	}, [carteira?.id]);

	// Uso de cada frase em passos.
	useEffect(() => {
		if (!empresa) return;
		let active = true;
		(async () => {
			const map: Record<string, number> = {};
			await Promise.all(frases.map(async f => { map[f.id] = await contarUsoPassos(empresa.id, f.id); }));
			if (active) setUsoMap(map);
		})();
		return () => { active = false; };
	}, [frases, empresa?.id]);

	const frasesDoMomento = useMemo(() => {
		const q = busca.trim().toLowerCase();
		return frases.filter(f => f.estagio === aba).filter(f => !q || f.nome.toLowerCase().includes(q) || frasePreview(f).toLowerCase().includes(q));
	}, [frases, aba, busca]);

	const contagens = useMemo(() => {
		const m: Record<string, number> = {};
		for (const f of frases) { if (f.estagio && f.estagio in MOMENTO_NOME) m[f.estagio] = (m[f.estagio] ?? 0) + 1; }
		return m;
	}, [frases]);

	async function onExcluir(f: Frase) {
		const uso = usoMap[f.id] ?? 0;
		if (uso > 0) { toast(`Usada em ${uso} passo(s): troque antes de apagar.`, { duration: 8000 }); return; }
		if (!window.confirm(`Excluir a mensagem "${f.nome}"?`)) return;
		const { error } = await excluirFrase(f.id);
		if (error) { toast.error(error); return; }
		toast.success('Mensagem excluída.');
		void reload();
	}

	function abrirNova() { setEditor({ open: true, frase: { canal: 'sms', estagio: aba }, reset: editor.reset + 1 }); }
	function abrirEditar(f: Frase) { setEditor({ open: true, frase: f, reset: editor.reset + 1 }); }

	if (!empresa) return <><JornadaHeading title="Mensagens por momento" /><Notice variant="warning">Escolha a empresa no topo.</Notice></>;
	if (loading) return <><JornadaHeading title="Mensagens por momento" /><p className="py-6 text-[13px] text-[#8E8E93]">Carregando…</p></>;

	return (
		<>
			<JornadaHeading title="Mensagens por momento" linha="Frases de cada momento da jornada, por canal." actions={canEdit ? (
				<button onClick={abrirNova} className="flex h-9 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[12px] font-semibold text-white hover:opacity-85"><Plus size={14} /> Nova mensagem</button>
			) : null} />

			{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			{/* Abas por momento */}
			<div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-[#E5E5EA] bg-white p-2" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				{MOMENTOS.map(m => (
					<button key={m.id} onClick={() => setAba(m.id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${aba === m.id ? 'bg-[#1D1D1F] text-white' : 'text-[#6E6E73] hover:bg-[#F5F5F7]'}`}>
						{m.nome}
						{contagens[m.id] ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${aba === m.id ? 'bg-white/25 text-white' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{contagens[m.id]}</span> : null}
					</button>
				))}
			</div>

			<div className="mb-4 flex items-center gap-2">
				<div className="relative flex-1 max-w-md">
					<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
					<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou texto" className="h-9 w-full rounded-lg border border-[#D2D2D7] pl-9 pr-3 text-[13px] outline-none focus:border-[#1D1D1F]" />
				</div>
			</div>

			{frasesDoMomento.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-[#D2D2D7] bg-[#FAFAFC] px-6 py-12 text-center">
					<BookOpen className="mx-auto mb-2 text-[#D2D2D7]" size={28} />
					<p className="text-[13px] text-[#8E8E93]">Nenhuma mensagem em {MOMENTO_NOME[aba]}. {canEdit && 'Crie a primeira.'}</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-2xl border border-[#E5E5EA] bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<table className="w-full border-collapse text-[13px]">
						<thead>
							<tr className="border-b border-[#E5E5EA] text-left text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">
								<th className="px-4 py-3">Nome</th>
								<th className="px-4 py-3">Canal</th>
								<th className="px-4 py-3">Usada em</th>
								<th className="px-4 py-3">Resultado</th>
								<th className="px-4 py-3 text-right">Ações</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[#F0F0F2]">
							{frasesDoMomento.map(f => {
								const res = resultados[f.id];
								const uso = usoMap[f.id] ?? 0;
								const isTemplate = canalTipoMensagem(f.canal) === 'template';
								return (
									<tr key={f.id} className={f.ativo ? '' : 'opacity-60'}>
										<td className="px-4 py-3">
											<span className="font-semibold text-[#1D1D1F]">{f.nome}</span>
											{isTemplate && <span className="ml-2 rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-semibold text-[#8E8E93]">{templateCodigoOf(f) || 'sem código'}</span>}
											<p className="mt-0.5 line-clamp-1 text-[11px] text-[#8E8E93]">{frasePreview(f)}</p>
										</td>
										<td className="px-4 py-3"><span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-semibold text-[#1D1D1F]">{CANAL_NOME[f.canal] ?? f.canal}</span></td>
										<td className="px-4 py-3 text-[12px] text-[#6E6E73]">{uso > 0 ? `${uso} passo${uso > 1 ? 's' : ''}` : '—'}</td>
										<td className="px-4 py-3 text-[12px]">
											{res?.taxa != null ? <span className="font-semibold text-[#1D1D1F]">{res.taxa}%{res.frase ? <span className="font-normal text-[#8E8E93]"> · {res.frase}</span> : ''}</span> : <span className="text-[#8E8E93]">—</span>}
										</td>
										<td className="px-4 py-3">
											<div className="flex items-center justify-end gap-1">
												{canEdit && <button onClick={() => abrirEditar(f)} className="rounded px-2 py-1 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Editar</button>}
												{canEdit && <button onClick={() => onExcluir(f)} aria-label="Excluir" className="grid h-7 w-7 place-items-center rounded text-[#8E8E93] hover:bg-[#FFE8E6] hover:text-[#FF3B30]"><Trash2 size={14} /></button>}
												{!canEdit && <Lock size={13} className="text-[#8E8E93]" />}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{editor.open && empresa && (
				<MensagemEditor
					key={editor.reset}
					frase={editor.frase}
					momento={aba}
					colunas={colunas}
					podeEditar={canEdit}
					motivoBloqueio="Somente leitura"
					resetSignal={editor.reset}
					onClose={() => setEditor({ open: false, frase: null, reset: editor.reset })}
					onSaved={() => { setEditor({ open: false, frase: null, reset: editor.reset + 1 }); void reload(); }}
				/>
			)}
		</>
	);
}

function MensagemEditor({ frase, momento, colunas, podeEditar, motivoBloqueio, resetSignal, onClose, onSaved }: {
	frase: Partial<Frase> | null; momento: MomentoId; colunas: string[]; podeEditar: boolean; motivoBloqueio: string;
	resetSignal: number; onClose: () => void; onSaved: () => void;
}) {
	const { empresa } = useJornadaCarteira();
	const isTemplate = canalTipoMensagem(frase?.canal ?? 'sms') === 'template';
	const [nome, setNome] = useState(frase?.nome ?? '');
	const [canal, setCanal] = useState(frase?.canal ?? 'sms');
	const [codigo, setCodigo] = useState(isTemplate ? (frase ? templateCodigoOf(frase) : '') : '');
	const [texto, setTexto] = useState(isTemplate ? (frase ? templatePreviewOf(frase) : '') : (frase?.texto ?? ''));
	const [ativo, setAtivo] = useState(frase?.ativo ?? true);
	const [erro, setErro] = useState('');
	const [salvando, setSalvando] = useState(false);
	const [sucesso, setSucesso] = useState('');

	useEffect(() => { setNome(frase?.nome ?? ''); setCanal(frase?.canal ?? 'sms'); setCodigo(isTemplate ? (frase ? templateCodigoOf(frase) : '') : ''); setTexto(isTemplate ? (frase ? templatePreviewOf(frase) : '') : (frase?.texto ?? '')); setAtivo(frase?.ativo ?? true); setErro(''); setSucesso(''); }, [resetSignal]);

	const canalTemplate = canalTipoMensagem(canal) === 'template';
	const isSms = canal === 'sms';
	const vars = useMemo(() => {
		const matches = texto.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) ?? [];
		const seen = new Set<string>(); const out: string[] = [];
		for (const m of matches) { const n = m.slice(1, -1).toLowerCase(); if (!seen.has(n)) { seen.add(n); out.push(n); } }
		return out;
	}, [texto]);

	function insertVar(v: string) {
		const tag = `{${v}}`;
		setTexto(t => t + tag);
	}

	function podeRevisar() {
		if (!nome.trim()) return false;
		if (canalTemplate) return !!codigo.trim() && !!texto.trim() && codigo.trim().length <= MAX_CODIGO;
		return !!texto.trim() && texto.length <= MAX_TEXTO;
	}

	async function onSalvar() {
		if (!empresa) return;
		setSalvando(true); setErro('');
		const { error } = await salvarFrase({
			id: frase?.id, empresa_id: empresa.id, canal, nome: nome.trim(),
			estagio: canalTemplate ? null : momento, texto: canalTemplate ? packTemplateTexto(codigo.trim(), texto) : texto,
			codigo_template: canalTemplate ? codigo.trim() : undefined, origem: frase?.origem ?? 'criado', ativo,
		});
		setSalvando(false);
		if (error) { setErro(error); return; }
		setSucesso('Mensagem salva.');
		onSaved();
	}

	const resumo = (
		<div className="space-y-2 text-[13px]">
			<p><span className="text-[#8E8E93]">Nome:</span> <span className="font-semibold text-[#1D1D1F]">{nome || '—'}</span></p>
			<p><span className="text-[#8E8E93]">Canal:</span> <span className="font-semibold text-[#1D1D1F]">{CANAL_NOME[canal] ?? canal}</span></p>
			<p><span className="text-[#8E8E93]">Momento:</span> <span className="font-semibold text-[#1D1D1F]">{MOMENTO_NOME[momento]}</span></p>
			{canalTemplate && <p><span className="text-[#8E8E93]">Template:</span> <span className="font-mono text-[12px] text-[#1D1D1F]">{codigo || '—'}</span></p>}
			<div><span className="text-[#8E8E93]">Prévia:</span> <p className="mt-1 whitespace-pre-wrap rounded-lg bg-[#F5F5F7] p-2 text-[12px] text-[#1D1D1F]">{previsualizar(texto)}</p></div>
		</div>
	);

	const form = (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div>
					<label className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Nome <span className="text-[#FF3B30]">*</span></label>
					<input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Lembrete de vencimento" className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[13px] outline-none focus:border-[#1D1D1F]" />
				</div>
				<div>
					<label className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Canal <span className="text-[#FF3B30]">*</span></label>
					<select value={canal} onChange={e => setCanal(e.target.value)} className="h-9 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[13px] outline-none focus:border-[#1D1D1F]">
						{CANAIS_MSG.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
					</select>
				</div>
			</div>

			{canalTemplate ? (
				<>
					<div>
						<label className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Código do template aprovado <span className="text-[#FF3B30]">*</span></label>
						<input value={codigo} maxLength={MAX_CODIGO} onChange={e => setCodigo(e.target.value)} placeholder="Ex.: lembrete_vencimento_v1" className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 font-mono text-[13px] outline-none focus:border-[#1D1D1F]" />
						<p className="mt-1 text-[11px] text-[#8E8E93]">Template aprovado no provedor da Mensageria. Não é texto livre.</p>
					</div>
					<div>
						<label className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Prévia do texto <span className="text-[#FF3B30]">*</span></label>
						<textarea value={texto} onChange={e => setTexto(e.target.value)} rows={4} placeholder="Prévia do texto do template…" className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[13px] outline-none focus:border-[#1D1D1F]" />
						<span className="mt-1 text-[11px] text-[#8E8E93]">{texto.length}/{MAX_TEXTO}</span>
					</div>
				</>
			) : (
				<div>
					<div className="mb-1.5 flex items-center justify-between">
						<label className="text-[12px] font-semibold text-[#6E6E73]">Texto <span className="text-[#FF3B30]">*</span></label>
						<span className={`text-[11px] ${isSms && texto.length > 160 ? 'font-bold text-[#FF3B30]' : 'text-[#8E8E93]'}`}>{isSms ? `${texto.length}/160 · ${smsMensagens(texto)} parte(s)` : `${texto.length}/${MAX_TEXTO}`}</span>
					</div>
					<textarea value={texto} onChange={e => setTexto(e.target.value)} rows={5} placeholder="Escreva a mensagem. Use {primeiro_nome}, {valor}…" className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[13px] outline-none focus:border-[#1D1D1F]" />
					{isSms && texto.length > 160 && <p className="mt-1 text-[11px] font-semibold text-[#FF3B30]">SMS acima de 160 caracteres não é enviado.</p>}
					{isSms && <p className="mt-1 text-[11px] text-[#8E8E93]">Lembre embaixo: "Responda SAIR para não receber".</p>}
				</div>
			)}

			{!canalTemplate && (
				<div>
					<p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">Inserir variável</p>
					<div className="flex flex-wrap gap-1.5">
						{colunas.length === 0 ? <span className="text-[11px] text-[#8E8E93]">As variáveis vêm das colunas extras da última carga de clientes.</span> :
							colunas.map(v => <button key={v} type="button" onClick={() => insertVar(v)} className="rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-semibold text-[#1D1D1F] hover:bg-[#E8E8ED]">{`{${v}}`}</button>)}
					</div>
				</div>
			)}

			{vars.length > 0 && (
				<div className="rounded-lg border border-[#E5E5EA] bg-[#FAFAFC] p-3">
					<p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">Variáveis no texto</p>
					<div className="flex flex-wrap gap-1.5">
						{vars.map(v => <span key={v} className="rounded-full bg-[#E8F1FF] px-2 py-0.5 text-[11px] font-semibold text-[#0A60D0]">{`{${v}}`}</span>)}
					</div>
				</div>
			)}

			{texto.trim() && (
				<div className="rounded-lg border border-[#E5E5EA] bg-white p-3">
					<p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">Prévia com valores de exemplo</p>
					<p className="whitespace-pre-wrap text-[13px] text-[#1D1D1F]">{previsualizar(texto)}</p>
				</div>
			)}

			<label className="flex items-center gap-2 text-[13px] text-[#1D1D1F]">
				<input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="accent-[#1D1D1F]" /> Ativa
			</label>
		</div>
	);

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
			<div className="w-full max-w-2xl max-h-[92vh] overflow-auto" onClick={e => e.stopPropagation()}>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">{frase?.id ? 'Editar mensagem' : 'Nova mensagem'} · {MOMENTO_NOME[momento]}</h2>
					<button onClick={onClose} aria-label="Fechar"><X size={18} className="text-[#8E8E93]" /></button>
				</div>
				<PainelEdicao
					titulo={frase?.id ? 'Editar mensagem' : 'Nova mensagem'}
					podeEditar={podeEditar}
					motivoBloqueio={motivoBloqueio}
					resumo={resumo}
					form={form}
					revisao={resumo}
					podeRevisar={podeRevisar()}
					podeSalvar={podeRevisar()}
					salvando={salvando}
					erro={erro}
					sucesso={sucesso}
					onSalvar={onSalvar}
					resetSignal={resetSignal}
				/>
			</div>
		</div>
	);
}
