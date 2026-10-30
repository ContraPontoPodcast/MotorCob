import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Search, X, Check } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { OPERADOR_TIPO } from '@/lib/mensageria-produtos';
import {
	montarFiltros, formatValor, baseTemData, METRICAS_PRESET, metricasPreSelecionadas,
	type RelatorioBase, type RelatorioCampo, type ModeloRelatorio, type Metrica,
} from '@/lib/relatorios';

type Props = {
	bases: RelatorioBase[];
	camposByBase: Record<string, RelatorioCampo[]>;
	onBack: () => void;
	onSaved: (m: ModeloRelatorio) => void;
	modeloEdicao?: ModeloRelatorio;
	embedded?: boolean;
};

type FiltroLinha = { campo: string; op: string; valor: string };

export function MontarRelatorio({ bases, camposByBase, onBack, onSaved, modeloEdicao, embedded }: Props) {
	const { empresa, perfil } = useMotorAuth();
	const [passo, setPasso] = useState(modeloEdicao ? 1 : 0);
	const [base, setBase] = useState(modeloEdicao?.base ?? '');
	const [agrupar, setAgrupar] = useState<string[]>(modeloEdicao?.agrupar ?? []);
	const [selMetricas, setSelMetricas] = useState<Set<string>>(() => {
		if (modeloEdicao?.metricas) return new Set((modeloEdicao.metricas as Metrica[]).map(m => 'preset:' + m.nome));
		return new Set<string>();
	});
	const [colunasSel, setColunasSel] = useState<string[]>(modeloEdicao?.colunas ?? []);
	const [filtros, setFiltros] = useState<FiltroLinha[]>([]);
	const [ordemCampo, setOrdemCampo] = useState(modeloEdicao?.ordem?.split(' ')[0] ?? '');
	const [ordemDir, setOrdemDir] = useState<'asc' | 'desc'>((modeloEdicao?.ordem?.split(' ')[1] as 'asc' | 'desc') ?? 'desc');
	const [nome, setNome] = useState(modeloEdicao?.nome ?? '');
	const [descricao, setDescricao] = useState(modeloEdicao?.descricao ?? '');
	const [visibilidade, setVisibilidade] = useState<'empresa' | 'pessoal'>('empresa');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	// Prévia de 200 linhas.
	const [preview, setPreview] = useState<Row[]>([]);
	const [previewBusy, setPreviewBusy] = useState(false);
	const [previewErro, setPreviewErro] = useState('');

	const baseObj = bases.find(b => b.id === base);
	const campos = camposByBase[base] ?? [];
	const fotoDoDia = !!baseObj?.foto_do_dia;
	const temData = baseTemData(campos);
	const camposAgrupaveis = campos.filter(c => c.agrupavel);
	const camposNumericos = campos.filter(c => c.tipo === 'numero');
	const camposFiltraveis = campos.filter(c => c.filtravel);
	const presetMetricas = METRICAS_PRESET[base] ?? [];

	const ehResumo = agrupar.length > 0 || selMetricas.size > 0;

	// Inicializa seleções padrão ao escolher a base (novo relatório).
	useEffect(() => {
		if (modeloEdicao) return;
		setAgrupar([]); setColunasSel([]); setFiltros([]); setSelMetricas(metricasPreSelecionadas(base));
		setOrdemCampo(''); setPreview([]); setPreviewErro('');
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [base]);

	// Constrói a lista de métricas efetiva a partir da seleção.
	const metricas: Metrica[] = useMemo(() => {
		const out: Metrica[] = [];
		if (selMetricas.has('contar')) out.push({ funcao: 'contar', campo: null, nome: 'quantidade', rotulo: 'Quantidade' });
		for (const c of camposNumericos) {
			if (selMetricas.has('soma:' + c.nome)) out.push({ funcao: 'somar', campo: c.nome, nome: 'soma_' + c.nome, rotulo: 'Soma de ' + c.rotulo });
		}
		for (const m of presetMetricas) {
			if (selMetricas.has('preset:' + m.nome)) out.push(m);
		}
		return out;
	}, [selMetricas, camposNumericos, presetMetricas]);

	// Prévia: roda a cada mudança no passo 2.
	useEffect(() => {
		if (passo !== 1 || !base || !empresa) return;
		let active = true;
		async function rodar() {
			setPreviewBusy(true); setPreviewErro('');
			const deIso = fotoDoDia ? undefined : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 6 * 86400000));
			const ateIso = fotoDoDia ? undefined : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
			const filtrosObj = montarFiltros(empresa!.id, deIso, ateIso, filtros.map(f => ({ campo: f.campo, op: f.op, valor: f.valor })));
			const resumo = agrupar.length > 0 || metricas.length > 0;
			const { data, error } = await supabase!.rpc('rodar_relatorio', {
				base, colunas: resumo ? null : colunasSel, filtros: filtrosObj,
				agrupar: resumo ? agrupar : [], metricas: resumo ? metricas : [], ordem: null, limite: 200,
			});
			if (!active) return;
			setPreviewBusy(false);
			if (error) { setPreviewErro(friendlyError(error)); setPreview([]); return; }
			setPreview((data as Row[]) ?? []);
		}
		void rodar();
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [passo, base, empresa?.id, JSON.stringify(agrupar), JSON.stringify([...selMetricas]), JSON.stringify(colunasSel), JSON.stringify(filtros), fotoDoDia]);

	function toggleMetrica(key: string) {
		setSelMetricas(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
	}
	function toggleAgrupar(c: string) {
		setAgrupar(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
	}

	async function salvar() {
		if (!supabase || !empresa) return;
		if (!nome.trim()) { setErro('Informe o nome.'); return; }
		if (!base) { setErro('Escolha sobre o quê.'); return; }
		setBusy(true); setErro('');
		const resumo = agrupar.length > 0 || metricas.length > 0;
		const payload = {
			empresa_id: empresa.id, criado_por: perfil?.id, nome: nome.trim(), descricao: descricao.trim() || null,
			categoria: baseObj?.nome ?? null, base, visibilidade,
			colunas: resumo ? null : colunasSel, agrupar: resumo ? agrupar : null, metricas: resumo ? metricas : null,
			filtros: { campos: filtros.map(f => ({ campo: f.campo, op: f.op, valor: f.valor })) },
			ordem: ordemCampo ? `${ordemCampo} ${ordemDir}` : null,
		};
		const { data, error } = modeloEdicao
			? await supabase.from('relatorios_modelos').update(payload).eq('id', modeloEdicao.id).select('*').single()
			: await supabase.from('relatorios_modelos').insert(payload).select('*').single();
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		onSaved(data as ModeloRelatorio);
	}

	const passos = ['Sobre o quê', 'O que mostrar', 'Filtros e salvar'];
	const previewHeads = preview.length ? Object.keys(preview[0]) : [];
	const rotulo = (c: string) => campos.find(x => x.nome === c)?.rotulo ?? metricas.find(m => m.nome === c)?.rotulo ?? c;

	const conteudo = (
		<>
			{!embedded && <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0A60D0] hover:underline"><ArrowLeft size={15} /> Voltar</button>}
			{!embedded && (
				<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 className="text-[22px] font-bold text-[#1D1D1F]">{modeloEdicao ? 'Ajustar relatório' : 'Montar relatório'}</h1>
						<p className="mt-1 text-[14px] text-[#6E6E73]">Prévia de até 200 linhas a cada escolha.</p>
					</div>
				</div>
			)}
			<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="mb-5 flex flex-wrap items-center gap-2">
					{passos.map((p, i) => (
						<div key={p} className="flex items-center gap-2">
							<span className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold ${i === passo ? 'bg-[#1D1D1F] text-white' : i < passo ? 'bg-[#34C759] text-white' : 'bg-[#E5E5EA] text-[#8E8E93]'}`}>{i < passo ? <Check size={13} /> : i + 1}</span>
							<span className={`text-[14px] ${i === passo ? 'font-semibold text-[#1D1D1F]' : 'text-[#8E8E93]'}`}>{p}</span>
							{i < passos.length - 1 && <span className="mx-1 text-[#E5E5EA]">→</span>}
						</div>
					))}
				</div>
				{erro && <p className="mb-3 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">{erro}</p>}

				{/* Passo 1: base */}
				{passo === 0 && (
					<div className="grid gap-3 sm:grid-cols-2">{bases.map(b => (
						<button key={b.id} onClick={() => { setBase(b.id); setPasso(1); }} className={`rounded-xl border p-4 text-left ${base === b.id ? 'border-[#1D1D1F]' : 'border-[#E5E5EA]'} hover:bg-[#F5F5F7]`}>
							<p className="text-[15px] font-semibold text-[#1D1D1F]">{b.nome}</p>
							<p className="mt-1 text-[13px] text-[#6E6E73]">{b.descricao}</p>
						</button>
					))}</div>
				)}

				{/* Passo 2: separar por + números + prévia */}
				{passo === 1 && base && (
					<div className="space-y-5">
						<div>
							<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Separar por</p>
							<div className="flex flex-wrap gap-2">
								{camposAgrupaveis.map(c => (
									<button key={c.nome} onClick={() => toggleAgrupar(c.nome)} className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${agrupar.includes(c.nome) ? 'border-[#0A60D0] bg-[#E8F1FF] text-[#0A60D0]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>{c.rotulo}</button>
								))}
								{temData && (<>
									<button onClick={() => toggleAgrupar('semana')} className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${agrupar.includes('semana') ? 'border-[#0A60D0] bg-[#E8F1FF] text-[#0A60D0]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>Semana</button>
									<button onClick={() => toggleAgrupar('mes')} className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${agrupar.includes('mes') ? 'border-[#0A60D0] bg-[#E8F1FF] text-[#0A60D0]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>Mês</button>
								</>)}
							</div>
						</div>

						<div>
							<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Números</p>
							<div className="grid gap-2 sm:grid-cols-2">
								<MetricaCheck checked={selMetricas.has('contar')} onChange={() => toggleMetrica('contar')} rotulo="Quantidade" conta="contagem de linhas" />
								{camposNumericos.map(c => (
									<MetricaCheck key={c.nome} checked={selMetricas.has('soma:' + c.nome)} onChange={() => toggleMetrica('soma:' + c.nome)} rotulo={'Soma de ' + c.rotulo} conta="soma" />
								))}
								{presetMetricas.map(m => (
									<MetricaCheck key={m.nome} checked={selMetricas.has('preset:' + m.nome)} onChange={() => toggleMetrica('preset:' + m.nome)} rotulo={m.rotulo ?? m.nome} conta={m.funcao === 'taxa' ? `${m.campo} ÷ ${m.divisor}` : m.funcao === 'razao' ? `${m.campo} ÷ ${m.divisor}` : m.funcao} sentido={m.sentido} />
								))}
							</div>
						</div>

						{!ehResumo && (
							<div>
								<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Colunas (linha a linha)</p>
								<div className="flex flex-wrap gap-2">{campos.map(c => (
									<button key={c.nome} onClick={() => setColunasSel(prev => prev.includes(c.nome) ? prev.filter(x => x !== c.nome) : [...prev, c.nome])} className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${colunasSel.includes(c.nome) ? 'border-[#0A60D0] bg-[#E8F1FF] text-[#0A60D0]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>{c.rotulo}</button>
								))}</div>
							</div>
						)}

						{/* Prévia */}
						<div>
							<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Prévia {fotoDoDia ? '(como está hoje)' : '(últimos 7 dias)'}</p>
							{previewErro ? <p className="rounded-lg bg-[#FFF7E8] px-3 py-2 text-[13px] text-[#9a631b]">{previewErro}</p> :
								previewBusy ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Rodando prévia…</p> :
								preview.length === 0 ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Nada no período.</p> : (
									<div className="max-h-[320px] overflow-auto rounded-xl border border-[#E5E5EA]">
										<table className="w-full border-collapse text-[13px]">
											<thead className="sticky top-0 bg-[#F5F5F7]"><tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">{previewHeads.map(h => <th key={h} className="px-3 py-2">{rotulo(h)}</th>)}</tr></thead>
											<tbody>{preview.map((r, i) => (<tr key={i} className="border-b border-[#F0F0F2]">{previewHeads.map(h => { const m = metricas.find(x => x.nome === h); const tipo = m?.funcao === 'taxa' ? 'taxa' : m?.funcao === 'razao' ? 'razao' : m ? 'numero' : campos.find(c => c.nome === h)?.tipo; return <td key={h} className="px-3 py-1.5 tnum text-[#1D1D1F]">{formatValor(r[h], tipo)}</td>; })}</tr>))}</tbody>
										</table>
									</div>
								)}
						</div>

						<div className="flex justify-between"><button onClick={() => setPasso(0)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button><button onClick={() => setPasso(2)} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white hover:opacity-85">Avançar</button></div>
					</div>
				)}

				{/* Passo 3: filtros e salvar */}
				{passo === 2 && base && (
					<div className="space-y-5">
						<div>
							<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Filtros</p>
							<FiltroEditor campos={camposFiltraveis} filtros={filtros} onChange={setFiltros} base={base} empresaId={empresa?.id ?? ''} fotoDoDia={fotoDoDia} />
						</div>
						<div>
							<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Ordem</p>
							<div className="flex flex-wrap gap-2">
								<select value={ordemCampo} onChange={e => setOrdemCampo(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none">
									<option value="">Sem ordem</option>
									{(ehResumo ? [...agrupar, ...metricas.map(m => m.nome)] : colunasSel).map(c => <option key={c} value={c}>{rotulo(c)}</option>)}
								</select>
								<select value={ordemDir} onChange={e => setOrdemDir(e.target.value as 'asc' | 'desc')} className="h-9 rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none"><option value="asc">Crescente</option><option value="desc">Decrescente</option></select>
							</div>
						</div>
						<div className="max-w-[480px] space-y-4">
							<div><label className="mb-1.5 block text-[13px] font-semibold">Nome *</label><input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" /></div>
							<div><label className="mb-1.5 block text-[13px] font-semibold">Descrição</label><input value={descricao} onChange={e => setDescricao(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" /></div>
							<div>
								<label className="mb-1.5 block text-[13px] font-semibold">Quem vê</label>
								<div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
									<button onClick={() => setVisibilidade('empresa')} className={`rounded-[7px] px-3 py-1.5 text-[14px] font-medium ${visibilidade === 'empresa' ? 'bg-white text-[#1D1D1F] font-semibold shadow' : 'text-[#1D1D1F]'}`}>Toda a empresa</button>
									<button onClick={() => setVisibilidade('pessoal')} className={`rounded-[7px] px-3 py-1.5 text-[14px] font-medium ${visibilidade === 'pessoal' ? 'bg-white text-[#1D1D1F] font-semibold shadow' : 'text-[#1D1D1F]'}`}>Só para mim</button>
								</div>
							</div>
						</div>
						<div className="flex justify-between"><button onClick={() => setPasso(1)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button><button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando…' : modeloEdicao ? 'Salvar' : 'Salvar relatório'}</button></div>
					</div>
				)}
			</div>
		</>
	);

	if (embedded) return conteudo;
	return <div className="mx-auto max-w-[860px] px-4 py-6">{conteudo}</div>;
}

function MetricaCheck({ checked, onChange, rotulo, conta, sentido }: { checked: boolean; onChange: () => void; rotulo: string; conta: string; sentido?: string | null }) {
	return (
		<label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-[14px] ${checked ? 'border-[#0A60D0] bg-[#E8F1FF]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
			<input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 accent-[#0A60D0]" />
			<span className="min-w-0 flex-1">
				<span className="block font-medium text-[#1D1D1F]">{rotulo}</span>
				<span className="block text-[12px] text-[#8E8E93]">{conta}{sentido ? ` · ${sentido === 'menor_melhor' ? 'menor é melhor' : 'maior é melhor'}` : ''}</span>
			</span>
		</label>
	);
}

/** Editor de filtros com seletor de valores existentes (lista com busca). */
function FiltroEditor({ campos, filtros, onChange, base, empresaId, fotoDoDia }: { campos: RelatorioCampo[]; filtros: FiltroLinha[]; onChange: (f: FiltroLinha[]) => void; base: string; empresaId: string; fotoDoDia: boolean }) {
	const [pickerCampo, setPickerCampo] = useState<number | null>(null);
	const [valores, setValores] = useState<Row[]>([]);
	const [busca, setBusca] = useState('');
	const [loading, setLoading] = useState(false);

	async function abrirPicker(idx: number) {
		const f = filtros[idx];
		if (!f?.campo) return;
		setPickerCampo(idx); setBusca(''); setLoading(true);
		const deIso = fotoDoDia ? undefined : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 6 * 86400000));
		const ateIso = fotoDoDia ? undefined : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
		const filtrosObj = montarFiltros(empresaId, deIso, ateIso, filtros.filter((_, j) => j !== idx).map(x => ({ campo: x.campo, op: x.op, valor: x.valor })));
		const { data } = await supabase!.rpc('rodar_relatorio', { base, colunas: null, filtros: filtrosObj, agrupar: [f.campo], metricas: [{ funcao: 'contar', campo: null, nome: 'n' }], ordem: 'n desc', limite: 200 });
		setLoading(false);
		setValores((data as Row[]) ?? []);
	}

	const ops = (tipo: string) => OPERADOR_TIPO[tipo] ?? OPERADOR_TIPO.texto;

	return (
		<div className="space-y-2">
			{filtros.map((f, i) => {
				const campo = campos.find(c => c.nome === f.campo);
				const mostraValor = !['vazio', 'preenchido'].includes(f.op);
				return (
					<div key={i} className="flex flex-wrap items-center gap-2">
						<select value={f.campo} onChange={e => onChange(filtros.map((x, j) => j === i ? { ...x, campo: e.target.value, op: ops(campos.find(c => c.nome === e.target.value)?.tipo ?? 'texto')[0].id, valor: '' } : x))} className="h-9 rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none">
							{campos.map(c => <option key={c.nome} value={c.nome}>{c.rotulo}</option>)}
						</select>
						<select value={f.op} onChange={e => onChange(filtros.map((x, j) => j === i ? { ...x, op: e.target.value, valor: '' } : x))} className="h-9 rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none">
							{ops(campo?.tipo ?? 'texto').map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
						{mostraValor && (
							campo?.tipo === 'texto' ? (
								<button onClick={() => abrirPicker(i)} className="flex h-9 min-w-[160px] flex-1 items-center gap-2 rounded-lg border border-[#D2D2D7] px-3 text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]"><Search size={13} className="text-[#8E8E93]" /> {f.valor || 'Escolher…'}</button>
							) : (
								<input value={f.valor} onChange={e => onChange(filtros.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))} type={campo?.tipo === 'numero' ? 'number' : 'date'} className="h-9 flex-1 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" />
							)
						)}
						<button onClick={() => onChange(filtros.filter((_, j) => j !== i))} className="text-[#FF3B30]"><Trash2 size={15} /></button>
					</div>
				);
			})}
			<button onClick={() => onChange([...filtros, { campo: campos[0]?.nome ?? '', op: ops(campos[0]?.tipo ?? 'texto')[0].id, valor: '' }])} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Plus size={15} /> Filtro</button>

			{pickerCampo != null && (
				<div className="fixed inset-0 z-[90] bg-black/30" onClick={() => setPickerCampo(null)}>
					<div className="mx-auto mt-24 w-[90%] max-w-[420px] rounded-2xl bg-white p-4" style={{ boxShadow: '0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-[15px] font-semibold text-[#1D1D1F]">{campos.find(c => c.nome === filtros[pickerCampo].campo)?.rotulo}</h3>
							<button onClick={() => setPickerCampo(null)} className="text-[#8E8E93]"><X size={18} /></button>
						</div>
						<div className="relative mb-3"><input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar" className="h-9 w-full rounded-lg bg-[#F5F5F7] pl-3 pr-3 text-[14px] outline-none" autoFocus /></div>
						<div className="max-h-[280px] overflow-y-auto">
							{loading ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Carregando…</p> :
								valores.filter(v => String(v[filtros[pickerCampo].campo] ?? '').toLowerCase().includes(busca.toLowerCase())).map(v => {
									const val = String(v[filtros[pickerCampo].campo] ?? '');
									return <button key={val} onClick={() => { onChange(filtros.map((x, j) => j === pickerCampo ? { ...x, valor: val } : x)); setPickerCampo(null); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[#F5F5F7]"><span>{val || '—'}</span><span className="text-[12px] text-[#8E8E93] tnum">{Number(v.n ?? 0).toLocaleString('pt-BR')}</span></button>;
								})}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
