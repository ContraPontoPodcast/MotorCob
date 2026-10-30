import { useEffect, useState } from 'react';
import { X, Download, Loader2, FileSpreadsheet, FileText } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { montarFiltros, type ModeloRelatorio, type Metrica, exportacaoSituacao } from '@/lib/relatorios';
import { exportarCsv } from '@/lib/mensageria';
import { ProcessoLongo } from '@/components/comuns/processo-longo';

type Props = {
	modelo: ModeloRelatorio;
	filtrosAtivos: { campo: string; valor: string }[];
	deIso: string;
	ateIso: string;
	fotoDoDia: boolean;
	onClose: () => void;
};

export function ExportarPainel({ modelo, filtrosAtivos, deIso, ateIso, fotoDoDia, onClose }: Props) {
	const { empresa } = useMotorAuth();
	const [formato, setFormato] = useState<'csv' | 'xlsx'>('csv');
	const [contando, setContando] = useState(false);
	const [total, setTotal] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [processando, setProcessando] = useState<string | null>(null);
	const [erro, setErro] = useState('');

	const metricas = (modelo.metricas ?? []) as Metrica[];
	const agrupar = modelo.agrupar ?? [];
	const colunas = modelo.colunas ?? [];

	useEffect(() => {
		async function contar() {
			if (!supabase || !empresa) return;
			setContando(true); setErro('');
			const filtros = montarFiltros(empresa.id, fotoDoDia ? undefined : deIso, fotoDoDia ? undefined : ateIso, filtrosAtivos);
			const { data, error } = await supabase.rpc('contar_relatorio', { base: modelo.base, colunas, filtros, agrupar, metricas });
			setContando(false);
			if (error) { setErro(friendlyError(error)); return; }
			setTotal(Number((data as Row | null)?.total ?? data ?? 0));
		}
		void contar();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [empresa?.id, modelo.id]);

	async function exportarAgora() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro('');
		const filtros = montarFiltros(empresa.id, fotoDoDia ? undefined : deIso, fotoDoDia ? undefined : ateIso, filtrosAtivos);
		const ordemFinal = modelo.ordem ?? null;
		const { data, error } = await supabase.rpc('rodar_relatorio', { base: modelo.base, colunas: agrupar.length ? null : colunas, filtros, agrupar, metricas, ordem: ordemFinal, limite: 50000 });
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		const rows = (data as Row[]) ?? [];
		const heads = rows.length ? Object.keys(rows[0]) : [];
		if (formato === 'csv') {
			exportarCsv(`${modelo.nome}.csv`, heads, rows.map(r => heads.map(h => r[h] as string | number | null)));
		} else {
			const XLSX = await import('xlsx');
			const ws = XLSX.utils.json_to_sheet(rows);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
			XLSX.writeFile(wb, `${modelo.nome}.xlsx`);
		}
		onClose();
	}

	async function pedirExportacao() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro('');
		const filtros = montarFiltros(empresa.id, fotoDoDia ? undefined : deIso, fotoDoDia ? undefined : ateIso, filtrosAtivos);
		const { data, error } = await supabase.rpc('pedir_exportacao', { nome: modelo.nome, base: modelo.base, colunas: agrupar.length ? null : colunas, filtros, agrupar, metricas, ordem: modelo.ordem ?? null, formato });
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		const id = (data as Row | null)?.id ?? (data as string | null);
		if (id) setProcessando(String(id));
	}

	// Acompanha o progresso da exportação longa.
	useEffect(() => {
		if (!processando || !supabase) return;
		let active = true;
		async function poll() {
			if (!active || !supabase) return;
			const { data } = await supabase.from('relatorio_exportacoes').select('*').eq('id', processando).maybeSingle();
			if (!active) return;
			const exp = data as Row | null;
			if (exp?.situacao === 'pronto' || exp?.situacao === 'erro') { setProcessando(null); return; }
			window.setTimeout(poll, 3000);
		}
		void poll();
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [processando]);

	if (processando) return <ExportacaoProgress id={processando} onClose={onClose} />;

	const acimaLimite = total != null && total > 50000;
	const acimaMilhao = total != null && total > 1000000;

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
			<div className="my-auto w-full max-w-[480px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Exportar relatório</h2>
					<button onClick={onClose} className="text-[#8E8E93]"><X size={20} /></button>
				</div>

				{erro && <p className="mb-3 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">{erro}</p>}

				<div className="mb-4">
					<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Formato</p>
					<div className="grid grid-cols-2 gap-2">
						<button onClick={() => setFormato('xlsx')} className={`flex items-center gap-2 rounded-xl border p-3 text-left ${formato === 'xlsx' ? 'border-[#0A60D0] bg-[#E8F1FF]' : 'border-[#D2D2D7]'}`}><FileSpreadsheet size={18} className="text-[#248A3D]" /><span className="text-[14px] font-medium">Excel (.xlsx)</span></button>
						<button onClick={() => setFormato('csv')} className={`flex items-center gap-2 rounded-xl border p-3 text-left ${formato === 'csv' ? 'border-[#0A60D0] bg-[#E8F1FF]' : 'border-[#D2D2D7]'}`}><FileText size={18} className="text-[#0A60D0]" /><span className="text-[14px] font-medium">CSV</span></button>
					</div>
				</div>

				<div className="mb-4 rounded-xl bg-[#F5F5F7] px-4 py-3 text-[14px] text-[#6E6E73]">
					{contando ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Contando linhas…</span> :
						total != null ? <><strong className="text-[#1D1D1F]">{total.toLocaleString('pt-BR')}</strong> linhas no período.</> : '—'}
				</div>

				{acimaMilhao ? (
					<p className="rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">O relatório tem mais de 1 milhão de linhas e não pode ser exportado. Reduza o período ou adicione filtros.</p>
				) : acimaLimite ? (
					<div className="rounded-xl bg-[#FFF3E8] px-4 py-3 text-[13px] text-[#9a631b]">
						<p>Acima de 50.000 linhas. A exportação roda em segundo plano e o aviso chega no sino quando terminar.</p>
						<button onClick={pedirExportacao} disabled={busy} className="mt-3 flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Pedindo…' : 'Pedir exportação'}</button>
					</div>
				) : (
					<button onClick={exportarAgora} disabled={busy || total == null} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Exportando…' : <><Download size={15} /> Exportar {formato.toUpperCase()}</>}</button>
				)}
				{formato === 'csv' && <p className="mt-2 text-center text-[12px] text-[#8E8E93]">CSV com ponto e vírgula e UTF-8.</p>}
			</div>
		</div>
	);
}

function ExportacaoProgress({ id, onClose }: { id: string; onClose: () => void }) {
	const [exp, setExp] = useState<Row | null>(null);
	useEffect(() => {
		if (!supabase) return;
		let active = true;
		async function poll() {
			if (!active || !supabase) return;
			const { data } = await supabase.from('relatorio_exportacoes').select('*').eq('id', id).maybeSingle();
			if (!active) return;
			setExp(data as Row | null);
			if (data?.situacao !== 'pronto' && data?.situacao !== 'erro') window.setTimeout(poll, 3000);
		}
		void poll();
		return () => { active = false; };
	}, [id]);

	const feitas = Number(exp?.linhas_feitas ?? 0);
	const totalLinhas = Number(exp?.linhas_total ?? 0);
	const etapa = exp?.situacao === 'erro' ? 1 : 0;
	const sit = exp ? exportacaoSituacao(exp.situacao) : null;

	if (exp?.situacao === 'pronto' && exp.arquivo_url) {
		return (
			<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
				<div className="w-full max-w-[440px] rounded-2xl bg-white p-6 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
					<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Exportação pronta</h2>
					<p className="mt-2 text-[14px] text-[#6E6E73]">{Number(exp.linhas ?? 0).toLocaleString('pt-BR')} linhas.</p>
					<a href={String(exp.arquivo_url)} download className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85"><Download size={15} /> Baixar arquivo</a>
				</div>
			</div>
		);
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8" onClick={onClose}>
			<div className="w-full max-w-[560px]" onClick={e => e.stopPropagation()}>
				<ProcessoLongo etapas={['Gerando o arquivo', 'Salvando']} etapaAtual={etapa} linhas={feitas} aviso="Pode sair desta tela. Quando terminar, o aviso chega no sino." />
				{sit && exp?.situacao === 'erro' && <p className="mt-3 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">Erro ao gerar o arquivo. Tente novamente.</p>}
				{totalLinhas > 0 && <p className="mt-2 text-center text-[13px] text-[#8E8E93] tnum">{feitas.toLocaleString('pt-BR')} de {totalLinhas.toLocaleString('pt-BR')} linhas</p>}
			</div>
		</div>
	);
}
