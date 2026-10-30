import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Upload, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { Notice } from '@/components/app-shell';
import {
	parseCsv, parsePlanilha, classificarImport, importarFrases, carregarFrases,
	MODELO_CSV, FRASE_CANAIS, FRASE_ESTAGIOS, fraseCanalLabel, estagioLabel,
	extrairVariaveis, VARS_MOTORCOB, type LinhaPreview,
} from '@/lib/frases';

export function ImportarPlaybookModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
	const { empresa } = useMotorAuth();
	const fileRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<LinhaPreview[] | null>(null);
	const [atualizar, setAtualizar] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	function baixarModelo() {
		const blob = new Blob([MODELO_CSV], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = 'modelo-frases-motorcob.csv';
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	async function onFile(file: File) {
		if (!empresa) return;
		setError('');
		try {
			let linhas;
			if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
				const text = await file.text();
				linhas = parseCsv(text);
			} else {
				const buf = await file.arrayBuffer();
				linhas = await parsePlanilha(buf);
			}
			if (linhas.length === 0) { setError('Arquivo vazio ou sem linhas reconhecíveis.'); return; }
			const { frases } = await carregarFrases(empresa.id);
			setPreview(classificarImport(linhas, frases, atualizar));
		} catch (e) {
			setError('Não foi possível ler o arquivo. Use CSV ou Excel (.xlsx).');
		}
	}

	// reclassifica ao mudar o toggle "atualizar"
	function recalc(atualizarVal: boolean) {
		setAtualizar(atualizarVal);
		if (preview && empresa) {
			void carregarFrases(empresa.id).then(({ frases }) => {
				// reclassifica a partir das linhas originais (sem erro de parse)
				setPreview(prev => prev ? classificarImport(prev, frases, atualizarVal) : prev);
			});
		}
	}

	const novas = preview?.filter(p => p.acao === 'nova').length ?? 0;
	const atualizam = preview?.filter(p => p.acao === 'atualizar').length ?? 0;
	const erros = preview?.filter(p => p.acao === 'erro').length ?? 0;

	async function gravar() {
		if (!empresa || !preview) return;
		setBusy(true); setError('');
		const { gravadas, error } = await importarFrases(empresa.id, preview);
		setBusy(false);
		if (error) { setError(error); return; }
		toast.success(`${gravadas} frase(s) importada(s).`);
		onDone(); onClose();
	}

	const todasVars = preview ? Array.from(new Set(preview.flatMap(p => extrairVariaveis(p.texto)))) : [];

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-lg font-semibold">Importar playbook de frases</h3>
					<button onClick={onClose} className="text-slate-400 hover:text-[#0F4C5C]"><X size={20}/></button>
				</div>
				<p className="mb-4 text-sm text-slate-500">Importe frases para todos os canais de uma vez. Colunas: <strong>canal, estagio, nome, texto</strong>. Aceita CSV (; ou ,) ou Excel (.xlsx).</p>

				{error && <div className="mb-4"><Notice>{error}</Notice></div>}

				{!preview && (
					<div className="space-y-4">
						<div className="flex flex-wrap gap-2">
							<button onClick={() => fileRef.current?.click()} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white hover:bg-[#0d4252]"><Upload size={16}/> Escolher arquivo</button>
							<button onClick={baixarModelo} className="flex h-11 items-center gap-2 rounded-lg border border-[#0F4C5C] px-5 text-sm font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Download size={16}/> Baixar modelo</button>
							<input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }}/>
						</div>
						<div className="rounded-lg border border-[#e2eaec] bg-[#f7fafb] p-4 text-xs text-slate-600">
							<p className="mb-2 font-semibold text-[#163943]">Apelidos aceitos</p>
							<p className="mb-1"><strong>Canal:</strong> {FRASE_CANAIS.map(c => c.label).join(', ')} (ou a chave).</p>
							<p className="mb-1"><strong>Estágio:</strong> {FRASE_ESTAGIOS.filter(e => e.id !== 'qualquer').map(e => e.label).join(', ')} (ou a chave; vazio = qualquer).</p>
							<p><strong>Código do template:</strong> coluna <code>codigo_template</code> — obrigatória para WhatsApp e RCS; Discador e E-mail são ignorados.</p>
						</div>
					</div>
				)}

				{preview && (
					<div className="space-y-4">
						<div className="grid grid-cols-3 gap-3">
							<div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center"><p className="text-2xl font-bold text-[#2E7D32]">{novas}</p><p className="text-[11px] font-semibold text-[#2E7D32]">Novas</p></div>
							<div className="rounded-lg border border-[#f0d49a] bg-[#fff7e8] p-3 text-center"><p className="text-2xl font-bold text-[#9a631b]">{atualizam}</p><p className="text-[11px] font-semibold text-[#9a631b]">Atualizam</p></div>
							<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center"><p className="text-2xl font-bold text-[#C62828]">{erros}</p><p className="text-[11px] font-semibold text-[#C62828]">Com erro</p></div>
						</div>
						<label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={atualizar} onChange={e => recalc(e.target.checked)} className="accent-[#0F4C5C]"/> Atualizar as que já existem (mesmo canal + nome)</label>
						{todasVars.length > 0 && (
							<div className="rounded-lg border border-[#e2eaec] bg-[#f7fafb] p-3">
								<p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Variáveis encontradas</p>
								<div className="flex flex-wrap gap-1.5">
									{todasVars.map(v => (
										<span key={v} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARS_MOTORCOB.has(v) ? 'bg-[#eaf2f3] text-[#0F4C5C]' : 'border border-dashed border-[#e9a23b] bg-[#fff7e8] text-[#9a631b]'}`}>
											{`{${v}}`}{!VARS_MOTORCOB.has(v) && ' · ferramenta do canal'}
										</span>
									))}
								</div>
							</div>
						)}
						<div className="max-h-[300px] overflow-auto rounded-lg border border-[#e2eaec]">
							<table className="w-full border-collapse text-xs">
								<thead className="sticky top-0 bg-[#eaf2f3]">
									<tr className="text-left text-[10px] font-bold uppercase tracking-wider text-[#0F4C5C]">
										<th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Canal</th><th className="px-2 py-1.5">Código</th><th className="px-2 py-1.5">Estágio</th><th className="px-2 py-1.5">Nome</th><th className="px-2 py-1.5">Texto</th><th className="px-2 py-1.5">Status</th>
									</tr>
								</thead>
								<tbody>
									{preview.map((p, i) => (
										<tr key={i} className="border-t border-[#eef3f4] align-top">
											<td className="px-2 py-1.5 text-slate-400">{p.linha}</td>
											<td className="px-2 py-1.5">{p.chave ? fraseCanalLabel[p.chave] : <span className="text-[#C62828]">{p.canal}</span>}</td>
											<td className="px-2 py-1.5 text-slate-500">{p.codigo_template || '—'}</td>
											<td className="px-2 py-1.5">{p.estagioChave ? estagioLabel[p.estagioChave] ?? p.estagioChave : '—'}</td>
											<td className="px-2 py-1.5 font-medium">{p.nome || '—'}</td>
											<td className="px-2 py-1.5 max-w-[220px]"><span className="line-clamp-2 text-slate-600">{p.texto}</span></td>
											<td className="px-2 py-1.5">
												{p.acao === 'nova' && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-[#2E7D32]">Nova</span>}
												{p.acao === 'atualizar' && <span className="rounded-full bg-[#fff3df] px-2 py-0.5 text-[10px] font-semibold text-[#9a631b]">Atualiza</span>}
												{p.acao === 'erro' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-[#C62828]" title={p.erro ?? ''}>Erro</span>}
												{p.erro && <span className="mt-0.5 block text-[10px] text-[#C62828]">{p.erro}</span>}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="flex justify-end gap-2">
							<button onClick={() => setPreview(null)} className="h-10 rounded-lg border border-[#c9dadd] px-4 text-sm font-semibold text-slate-600 hover:bg-[#edf4f5]">Recomeçar</button>
							<button onClick={gravar} disabled={busy || (novas + atualizam) === 0} className="h-10 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Gravando...' : `Gravar ${novas + atualizam} frase(s)`}</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
