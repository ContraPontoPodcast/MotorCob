import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CloudUpload, FileSpreadsheet, UploadCloud, ChevronDown, ChevronUp, Landmark } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateTimeBR, friendlyError, logAccess, safeFileName, supabase, today, type Row } from '@/lib/supabase';
import { retornoCanais, marcaLabelPorCanal, retornoCanalPorTipo, retornoTipoSet } from '@/lib/canal-retorno';

const mainTypes = [
	{ id: 'base', label: 'Carga geral', desc: 'A carteira toda do credor em cobrança. Substitui a anterior: quem não vier nela sai das ações.', credorRequired: true },
	{ id: 'incremental', label: 'Carga incremental', desc: 'Contratos novos ou atualizados. Somam à carga geral.', credorRequired: true },
	{ id: 'retirada', label: 'Retirada', desc: 'Contratos que saem da cobrança, com o motivo. Param de ser acionados na hora.', credorRequired: true },
	{ id: 'acordo', label: 'Acordo', desc: 'O acordo formalizado, uma linha por parcela com o vencimento. O cliente passa para Preventivo / Acordo em dia e o MotorCX lembra antes de cada vencimento.', credorRequired: true },
	{ id: 'baixa', label: 'Baixa / pagamento', desc: 'Pagamentos: parcela de acordo, quitação ou parcial. Quitado vira Liquidado e sai das ações.', credorRequired: true },
	{ id: 'ocorrencia', label: 'Ocorrência', desc: 'O retorno da empresa dizendo, por cliente, se deu CPC. Não precisa trazer o telefone: o MotorCX sabe qual contato foi acionado.', credorRequired: true },
	{ id: 'enriquecimento', label: 'Atualização de contatos (bureau)', desc: 'O arquivo que volta do enriquecimento, com telefones, WhatsApp e RCS.', credorRequired: false },
];
const multi = new Set(mainTypes.map(t => t.id));

const otherTypes: { id: string; label: string }[] = [
	{ id: 'retorno', label: 'Retorno de fornecedor' },
	{ id: 'parcelas', label: 'Parcelas de acordos' },
	{ id: 'clientes', label: 'Clientes (formato MotorCX)' },
	{ id: 'contatos', label: 'Contatos (formato MotorCX)' },
	{ id: 'portal', label: 'Log do portal' },
];
const help: Record<string,string> = {
	base: 'A carteira toda do credor em cobrança, do jeito que vem (com os telefones e e-mails em colunas). Substitui a anterior.',
	incremental: 'Contratos novos ou atualizados do credor. Somam à carga geral.',
	retirada: 'Contratos que saem da cobrança, com o motivo. Param de ser acionados na hora.',
	acordo: 'O acordo formalizado, uma linha por parcela com o vencimento.',
	baixa: 'Pagamentos: parcela de acordo, quitação ou parcial.',
	ocorrencia: 'O arquivo da empresa dizendo, por tentativa, se houve CPC. Não precisa trazer o telefone: o MotorCX sabe qual contato mandou acionar.',
	enriquecimento: 'O arquivo que volta do bureau, do jeito que vem (um CPF por linha, telefones com WhatsApp, RCS, score e Não Perturbe). O MotorCX junta os números novos e as marcas à base.',
	retorno: 'Arquivo do fornecedor, como ele vem (o motor reconhece pelo nome).',
	parcelas: 'id_cliente;id_acordo;parcela;vencimento;valor;pago_em',
	clientes: 'id_cliente;data_entrada;saldo;dias_atraso;bloqueio',
	contatos: 'id_cliente;contato;tipo;origem;cpf;whatsapp_valido;atualizado_em',
	portal: 'token;evento;ocorrido_em;valor_acordo',
};
const reportHighlights: Record<string, { key: string; label: string }[]> = {
	base: [{ key: 'na_carga', label: 'Em cobrança' }, { key: 'fora_da_carga', label: 'Fora' }],
	incremental: [{ key: 'linhas', label: 'Linhas' }, { key: 'clientes', label: 'Clientes' }],
	retirada: [{ key: 'retirados', label: 'Retirados' }],
	acordo: [{ key: 'acordos_abertos', label: 'Acordos abertos' }],
	baixa: [{ key: 'parcelas_pagas', label: 'Parcelas pagas' }, { key: 'pagamentos', label: 'Pagamentos' }],
	ocorrencia: [{ key: 'aceitas', label: 'Aceitas' }, { key: 'contato_identificado', label: 'Contato identificado' }],
	enriquecimento: [{ key: 'clientes_encontrados', label: 'Clientes encontrados' }, { key: 'telefones_novos', label: 'Telefones novos' }, { key: 'emails_novos', label: 'E-mails novos' }],
};
const andamentoTypes = new Set(['base', 'incremental', 'retirada', 'acordo', 'baixa']);
const andamentoPassos = ['Carga recebida', 'Gerando a lista', 'Lista pronta'];

function DetalheRelatorio({ r, credorCodigo }: { r: Row; credorCodigo: string | null }) {
	const rel = r.relatorio as Row | undefined;
	if (!rel) return null;
	const status = (r.status as string) ?? 'pendente';
	const tipo = (r.tipo as string) ?? '';
	const isCanal = retornoTipoSet.has(tipo);

	if (status === 'erro' && rel.erro) {
		return <p className="mt-1 whitespace-normal text-xs leading-relaxed text-[#C62828]">{String(rel.erro)}</p>;
	}

	if (status === 'aguardando') {
		const tab = isCanal ? 'canais' : (rel.codigos_novos ? 'ocorrencias' : 'arquivos');
		return (
			<div className="mt-1">
				{rel.aguardando && <p className="whitespace-normal text-xs text-slate-500">{String(rel.aguardando)}</p>}
				{credorCodigo && <Link to={`/credores/${credorCodigo}/configuracoes?tab=${tab}`} onClick={e => e.stopPropagation()} className="text-xs font-semibold text-[#0F4C5C] underline hover:text-[#0d4252]">Abrir configurações da carteira</Link>}
			</div>
		);
	}

	if (status === 'processado') {
		if (isCanal) {
			const parts: string[] = [];
			if (rel.linhas != null) parts.push(`${rel.linhas} linhas`);
			if (rel.aproveitadas != null) parts.push(`${rel.aproveitadas} aproveitadas`);
			const porMarca = rel.por_marca as Record<string, number> | undefined;
			const statusMarcar = rel.status_para_marcar as string[] | undefined;
			return (
				<div className="mt-1">
					{parts.length > 0 && <p className="whitespace-normal text-xs text-slate-500">{parts.join(' · ')}</p>}
					{porMarca && typeof porMarca === 'object' && (
						<div className="mt-1 flex flex-wrap gap-1">
							{Object.entries(porMarca).map(([m, n]) => <span key={m} className="rounded bg-[#eaf2f3] px-1.5 py-0.5 text-[10px] font-semibold text-[#0F4C5C]">{marcaLabelPorCanal(retornoCanalPorTipo(tipo)?.canal ?? '', m)}: {n}</span>)}
						</div>
					)}
					{Array.isArray(statusMarcar) && statusMarcar.length > 0 && (
						<p className="mt-1 text-[11px] text-[#9a631b]">marque em Configurações → Canais: {statusMarcar.slice(0, 5).join(', ')}</p>
					)}
					{rel.lote_travado && <p className="mt-1 text-[11px] font-semibold text-[#C62828]">Mais da metade voltou como inexistente — parece falha do fornecedor. Nenhum número foi descartado por este arquivo.</p>}
				</div>
			);
		}
		if (tipo === 'acordo' || tipo === 'baixa' || tipo === 'retirada') {
			const id = (rel.identificacao ?? {}) as Row;
			const metodos: { key: string; label: string }[] = [
				{ key: 'codigo', label: 'pelo código' },
				{ key: 'contrato', label: 'contrato' },
				{ key: 'cpf', label: 'CPF' },
				{ key: 'formatacao', label: 'formatação' },
			];
			const existentes = metodos.filter(m => id[m.key] != null);
			const soma = existentes.reduce((acc, m) => acc + (Number(id[m.key]) || 0), 0);
			const parts: string[] = [];
			if (rel.linhas != null) parts.push(`${rel.linhas} linhas`);
			if (existentes.length) parts.push(`clientes achados: ${soma} (${existentes.map(m => `${m.label} ${id[m.key]}`).join(', ')})`);
			const nao = Number(id.nao_encontrado) || 0;
			const amb = Number(id.ambiguo) || 0;
			return (
				<p className="mt-1 whitespace-normal text-xs text-slate-500">
					{parts.join(' · ')}{nao > 0 && <span className="text-[#9a631b]"> · {nao} não encontrados na carga</span>}{amb > 0 && <span className="text-[#9a631b]"> · {amb} com CPF em mais de um cadastro</span>}
				</p>
			);
		}
		if (tipo === 'ocorrencia') {
			const aceitas = Number(rel.aceitas) || 0;
			const linhas = Number(rel.linhas) || 0;
			const parts: string[] = [`${aceitas} de ${linhas} linhas aproveitadas`];
			const rej = rel.rejeitadas;
			if (rej && typeof rej === 'object') {
				const entries: [string, number][] = Array.isArray(rej) ? (rej as Row[]).map((x): [string, number] => [String(x.motivo ?? x.key ?? ''), Number(x.qtd ?? x.count ?? 0)]).filter(e => e[0]) : Object.entries(rej).map(([k, v]): [string, number] => [k, Number(v) || 0]);
				entries.sort((a, b) => b[1] - a[1]);
				entries.slice(0, 3).forEach(([motivo, n]) => { if (n > 0) parts.push(`· ${n} ${motivo}`); });
			}
			const quar = rel.quarentena;
			if (quar && typeof quar === 'object') {
				const keys: string[] = Array.isArray(quar) ? quar.map((x: Row) => String(x.codigo ?? x.key ?? '')).filter(Boolean) : Object.keys(quar);
				if (keys.length) parts.push(`· resultado não reconhecido: ${keys.slice(0, 5).map(k => `'${k}'`).join(', ')}`);
			}
			return <p className="mt-1 whitespace-normal text-xs text-slate-500">{parts.join(' ')}</p>;
		}
	}
	return null;
}

export function Uploads() {
	const { empresa, credor, credores } = useMotorAuth();
	const [busy, setBusy] = useState(false);
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [selected, setSelected] = useState<Row | null>(null);
	const [showOther, setShowOther] = useState(false);
	const [otherType, setOtherType] = useState('retorno');
	const [otherFiles, setOtherFiles] = useState<File[]>([]);
	const [otherDrag, setOtherDrag] = useState(false);
	const [formCredorId, setFormCredorId] = useState('');
	const otherInput = useRef<HTMLInputElement>(null);

	useEffect(() => { setFormCredorId(credor?.id ?? ''); }, [credor?.id]);

	async function reload() {
		if (!supabase || !empresa) return;
		const { data, error } = await supabase.from('envios').select('*').eq('empresa_id', empresa.id).order('enviado_em', { ascending: false }).limit(50);
		if (error) setError(friendlyError()); else setRows(data ?? []);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	// ?carga=ID (Início › Para hoje › "Uma carga voltou com erro"): abre o relatório dessa carga.
	const [params, setParams] = useSearchParams();
	const cargaLink = params.get('carga');
	useEffect(() => {
		if (!cargaLink || !supabase || !empresa || loading) return;
		const naLista = rows.find(r => String(r.id) === cargaLink);
		let active = true;
		(async () => {
			let alvo: Row | null = naLista ?? null;
			if (!alvo) {
				const { data } = await supabase.from('envios').select('*').eq('empresa_id', empresa.id).eq('id', cargaLink).maybeSingle();
				alvo = (data as Row | null) ?? null;
			}
			if (!active) return;
			if (alvo) setSelected(alvo);
			else setError('Não encontramos esta carga. Ela pode ter sido apagada.');
			const n = new URLSearchParams(params); n.delete('carga'); setParams(n, { replace: true });
		})();
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cargaLink, empresa?.id, loading]);

	const credorFixo = credores.length === 1;
	const credorNome = (id: string | null) => id ? (credores.find(c => c.id === id)?.nome ?? '—') : 'Todas as carteiras';
	const credorCodigo = (id: string | null) => id ? (credores.find(c => c.id === id)?.codigo ?? null) : null;

	async function uploadFiles(type: string, files: File[], credorId: string | null) {
		if (!supabase || !empresa || !empresa.slug || !files.length) return;
		const tipoDef = mainTypes.find(t => t.id === type);
		const required = tipoDef?.credorRequired ?? true;
		if (required && !credorId) { setError('Escolha a carteira no topo do bloco de envio.'); return; }
		setBusy(true); setError(''); setSuccess(''); let done = 0;
		for (const file of files) {
			const safe = safeFileName(file.name);
			const path = `${empresa.slug}/${type}/${today()}/${Date.now()}_${safe}`;
			try {
				const { error } = await supabase.storage.from('entradas').upload(path, file, { contentType: 'text/csv', upsert: false });
				if (error) throw error;
				const inserted = await supabase.from('envios').insert({ empresa_id: empresa.id, credor_id: credorId, tipo: type, caminho: path, nome_original: file.name });
				if (inserted.error) throw inserted.error;
				await logAccess('envio', path, empresa.id); done++;
			} catch { setError(`Não foi possível finalizar o envio de ${file.name}. Fale com o administrador.`); break; }
		}
		if (done) { setSuccess(`${done} arquivo${done > 1 ? 's' : ''} enviado${done > 1 ? 's' : ''} com sucesso.`); await reload(); }
		setBusy(false);
	}

	function acceptFiles(list: FileList | null): File[] {
		if (!list) return [];
		const next = Array.from(list);
		if (next.some(f => !['.csv','.txt','.xlsx'].some(ext => f.name.toLowerCase().endsWith(ext)))) { setError('Selecione apenas arquivos CSV, TXT ou XLSX.'); return []; }
		if (next.some(f => f.size > 50 * 1024 * 1024)) { setError('Cada arquivo deve ter no máximo 50 MB.'); return []; }
		setError('');
		return next;
	}

	function onMainDrop(e: DragEvent, type: string) {
		e.preventDefault();
		const files = acceptFiles(e.dataTransfer.files);
		if (files.length) void uploadFiles(type, files, formCredorId || null);
	}
	function onMainPick(e: ChangeEvent<HTMLInputElement>, type: string) {
		const files = acceptFiles(e.target.files);
		if (files.length) void uploadFiles(type, files, formCredorId || null);
		e.target.value = '';
	}

	function onOtherDrop(e: DragEvent) {
		e.preventDefault(); setOtherDrag(false);
		setOtherFiles(acceptFiles(e.dataTransfer.files));
	}
	function onOtherChange(e: ChangeEvent<HTMLInputElement>) {
		setOtherFiles(acceptFiles(e.target.files));
	}

	const highlights = selected ? (reportHighlights[selected.tipo] ?? []) : [];
	const relatorio = selected?.relatorio as Row | undefined;
	const andamento = selected && andamentoTypes.has(selected.tipo) ? (selected.status ?? 'pendente') : null;
	const andamentoStage = andamento === 'processado' ? 2 : andamento === 'erro' ? -1 : 0;

	return <>
		<PageHeading eyebrow="ENTRADA / ARQUIVOS" title="Enviar arquivos" description="Envie os arquivos de entrada para o processamento diário."/>
		{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : <div className="space-y-6">
			{error && <Notice>{error}</Notice>}
			{success && <Notice variant="success">{success}</Notice>}

			<div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#dfe8ea] bg-white p-4">
				<span className="flex items-center gap-2 text-sm font-semibold text-[#0F4C5C]"><Landmark size={17}/> Credor</span>
				{credorFixo ? <span className="text-sm font-medium text-slate-600">{credores[0]?.nome ?? '—'}</span>
					: <select value={formCredorId} onChange={e => setFormCredorId(e.target.value)} className="h-10 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="">Todas as carteiras</option>
						{credores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
					</select>}
				<p className="text-xs text-slate-400">{formCredorId ? 'Os arquivos vão para este credor.' : 'Para carga, retirada, acordo, baixa e ocorrência, escolha um credor. A atualização de contatos pode ser de todos.'}</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				{mainTypes.map(t => (
					<label key={t.id} onDragOver={e => e.preventDefault()} onDrop={e => onMainDrop(e, t.id)} className={`group flex cursor-pointer flex-col rounded-xl border-2 border-dashed p-6 transition ${busy ? 'opacity-60' : 'border-[#cbdadd] bg-[#fafcfc] hover:border-[#0F4C5C] hover:bg-[#eaf2f3]'}`}>
						<input type="file" accept=".csv,.txt,.xlsx" multiple={multi.has(t.id)} className="sr-only" onChange={e => onMainPick(e, t.id)} disabled={busy}/>
						<div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-[#e9f1f3] text-[#0F4C5C]"><UploadCloud size={22}/></div>
						<h2 className="text-base font-semibold">{t.label}</h2>
						<p className="mt-2 text-xs leading-relaxed text-slate-500">{t.desc}</p>
						<span className="mt-4 text-xs font-semibold text-[#0F4C5C]">Arraste o arquivo aqui ou clique para selecionar</span>
					</label>
				))}
			</div>

			<div>
				<h2 className="mb-1 text-lg font-semibold">Retorno dos canais</h2>
				<p className="mb-4 text-xs text-slate-500">Arquivos dos fornecedores com o telefone/e-mail e o status do envio. Não precisam do ID do cliente.</p>
				<div className="grid gap-4 lg:grid-cols-3">
					{retornoCanais.map(t => (
						<label key={t.tipo} onDragOver={e => e.preventDefault()} onDrop={e => onMainDrop(e, t.tipo)} className={`group flex cursor-pointer flex-col rounded-xl border-2 border-dashed p-6 transition ${busy ? 'opacity-60' : 'border-[#cbdadd] bg-[#fafcfc] hover:border-[#0F4C5C] hover:bg-[#eaf2f3]'}`}>
							<input type="file" accept=".csv,.txt,.xlsx" multiple className="sr-only" onChange={e => onMainPick(e, t.tipo)} disabled={busy}/>
							<div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-[#e9f1f3] text-[#0F4C5C]"><UploadCloud size={22}/></div>
							<h2 className="text-base font-semibold">{t.label}</h2>
							<p className="mt-2 text-xs leading-relaxed text-slate-500">Arquivo do fornecedor com o telefone (ou e-mail) e o status do envio. Não precisa do ID do cliente.</p>
							<span className="mt-4 text-xs font-semibold text-[#0F4C5C]">Arraste o arquivo aqui ou clique para selecionar</span>
						</label>
					))}
				</div>
			</div>

			<div>
				<button onClick={() => setShowOther(v => !v)} className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-[#0F4C5C]">
					{showOther ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} Outros tipos de arquivo
				</button>
				{showOther && <div className="mt-4 rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
					<div className="mb-6 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-[#0F4C5C]"><CloudUpload size={21}/></div><div><h2 className="font-semibold">Outro tipo de arquivo</h2><p className="text-xs text-slate-500">Arquivos CSV, TXT ou XLSX · até 50 MB por arquivo</p></div></div>
					<label htmlFor="tipo-outro" className="mb-2 block text-xs font-semibold">Tipo de arquivo</label>
					<select id="tipo-outro" value={otherType} onChange={e => { setOtherType(e.target.value); setOtherFiles([]); }} className="mb-6 h-11 w-full rounded-lg border border-[#d7e2e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">{otherTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
					<input ref={otherInput} type="file" accept=".csv,.txt,.xlsx" className="sr-only" onChange={onOtherChange}/>
					<div onDragOver={e => { e.preventDefault(); setOtherDrag(true); }} onDragLeave={() => setOtherDrag(false)} onDrop={onOtherDrop} className={`rounded-xl border-2 border-dashed p-8 text-center transition ${otherDrag ? 'border-[#0F4C5C] bg-[#e9f1f3]' : 'border-[#cbdadd] bg-[#fafcfc]'}`}>
						<UploadCloud size={28} className="mx-auto mb-3 text-[#0F4C5C]"/>
						<p className="text-sm font-semibold">Arraste o arquivo aqui</p>
						<p className="mt-1 text-xs text-slate-500">ou selecione do seu dispositivo</p>
						<button type="button" onClick={() => otherInput.current?.click()} className="mt-4 rounded-lg border border-[#0F4C5C] px-4 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]">Escolher arquivo</button>
					</div>
					{otherFiles.length > 0 && <div className="mt-4 space-y-2">{otherFiles.map((f,i) => <div key={i} className="flex items-center gap-2 text-sm text-[#0F4C5C]"><FileSpreadsheet size={16}/> {f.name} <span className="text-xs text-slate-400">({(f.size / 1024 / 1024).toFixed(1)} MB)</span></div>)}</div>}
					<button onClick={() => void uploadFiles(otherType, otherFiles, formCredorId || null)} disabled={busy || !otherFiles.length} className="mt-6 h-11 w-full rounded-lg bg-[#0F4C5C] text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Enviando...' : 'Enviar para processamento'}</button>
					<div className="mt-5 break-all rounded-lg border border-[#dce8ea] bg-[#f5f8f9] p-4 font-mono text-xs leading-6 text-[#365661]">{help[otherType]}</div>
				</div>}
			</div>

			<section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
				<h2 className="mb-1 text-lg font-semibold">Histórico de envios</h2>
				<p className="mb-2 text-xs text-slate-500">Últimos 50 arquivos enviados</p>
				<p className="mb-6 rounded-lg bg-[#f5f8f9] px-4 py-3 text-xs leading-relaxed text-[#365661]">Acordo, pagamento e ocorrência acham o cliente pelo código da carga, pelo contrato ou pelo CPF/CNPJ. A ocorrência entra na hora: o CPC aparece em até 1 minuto.</p>
				{loading ? <Loading/> : rows.length === 0 ? <Empty>Nenhum arquivo enviado ainda.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-[#e5edef] text-xs text-slate-400"><tr><th className="pb-3 font-medium">Data e hora</th><th className="pb-3 font-medium">Carteira</th><th className="pb-3 font-medium">Tipo</th><th className="pb-3 font-medium">Nome do arquivo</th><th className="pb-3 font-medium">Status</th></tr></thead><tbody className="divide-y divide-[#ecf0f1]">{rows.map((r,i) => <tr key={r.id ?? i} onClick={() => setSelected(r)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSelected(r); }} className="cursor-pointer hover:bg-[#f7fafb]"><td className="py-4">{dateTimeBR(r.enviado_em)}</td><td className="py-4 text-slate-500">{credorNome(r.credor_id ?? null)}</td><td className="py-4 capitalize">{r.tipo}</td><td className="max-w-[320px] py-4"><div className="truncate font-medium">{r.nome_original}</div><DetalheRelatorio r={r} credorCodigo={credorCodigo(r.credor_id ?? null)} /></td><td className="py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.status === 'processado' ? 'bg-green-50 text-[#2E7D32]' : r.status === 'erro' ? 'bg-red-50 text-[#C62828]' : 'bg-amber-50 text-[#9a631b]'}`}>{r.status === 'aguardando' ? 'Aguardando mapeamento' : r.status === 'processado' ? 'Processado' : r.status === 'erro' ? 'Com erro' : 'Na fila'}</span></td></tr>)}</tbody></table></div>}
			</section>
		</div>}

		{selected && <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={() => setSelected(null)}><div role="dialog" aria-modal="true" aria-label="Relatório do envio" className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}><div className="flex justify-between"><h2 className="text-lg font-semibold">Relatório do envio</h2><button onClick={() => setSelected(null)} aria-label="Fechar" className="text-xl">×</button></div><p className="mt-1 text-xs text-slate-500">{selected.nome_original} · {credorNome(selected.credor_id ?? null)}</p>
			{andamento && <div className="mt-5 flex items-center gap-2">{andamentoPassos.map((s, i) => { const active = i <= andamentoStage; const failed = andamento === 'erro' && i === 1; return <div key={s} className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${failed ? 'bg-red-100 text-[#C62828]' : active ? 'bg-[#0F4C5C] text-white' : 'bg-[#eef2f3] text-slate-400'}`}>{i + 1}</span><span className={`text-xs ${active ? 'font-semibold text-[#0F4C5C]' : 'text-slate-400'}`}>{s}</span>{i < 2 && <span className="h-px w-6 bg-[#dfe8ea]"/>}</div>; })}</div>}
			{relatorio?.erro && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#C62828]">{String(relatorio.erro)}</div>}
			{highlights.length > 0 && relatorio ? <div className="mt-5 grid grid-cols-2 gap-3">{highlights.map(h => <div key={h.key} className="rounded-lg border border-[#e2eaec] bg-[#eaf2f3] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{h.label}</p><p className="mt-1 text-xl font-semibold text-[#0F4C5C]">{String(relatorio?.[h.key] ?? '—')}</p></div>)}</div> : null}<pre className="mt-5 max-h-[50vh] overflow-auto rounded-lg bg-[#f2f6f7] p-5 text-xs leading-relaxed">{selected.relatorio ? JSON.stringify(selected.relatorio, null, 2) : 'Relatório ainda não disponível.'}</pre></div></div>}
	</>;
}
