import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, FileImage, FileText, Presentation } from 'lucide-react';
import { FichaEstrategia, type FichaDados } from '@/components/estrategias/ficha-estrategia';
import { exportarJpg, exportarPdf, exportarPpt } from '@/lib/estrategia-export';
import { slugify, supabase, today } from '@/lib/supabase';

type CalendarioEstrategia = { seguir_padrao?: boolean; dias_semana?: number[]; feriados_nacionais?: boolean };

export function ExportarButton({ dados, credorId, estrId }: { dados: Omit<FichaDados, 'calendar'>; credorId?: string; estrId?: string | null }) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState('');
	const [calendar, setCalendar] = useState<FichaDados['calendar']>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	// Busca o calendário do credor para a estratégia (override ou padrão).
	useEffect(() => {
		if (!supabase || !credorId) { setCalendar(null); return; }
		let active = true;
		(async () => {
			try {
				const { data } = await supabase.from('credores').select('calendario').eq('id', credorId).maybeSingle();
				if (!active) return;
				const cal = (data as Record<string, unknown> | null)?.calendario as { estrategias?: Record<string, CalendarioEstrategia> } | null;
				const e = (estrId && cal?.estrategias?.[estrId]) || {};
				const seguir = e.seguir_padrao !== false;
				setCalendar({ diasSemana: e.dias_semana ?? [0, 1, 2, 3, 4], seguirPadrao: seguir, feriados: e.feriados_nacionais ?? true });
			} catch {
				if (active) setCalendar(null);
			}
		})();
		return () => { active = false; };
	}, [credorId, estrId]);

	const dadosCompletos: FichaDados = { ...dados, calendar };
	const baseName = ['estrategia', slugify(dados.nome), slugify(dados.credorNome), today()].filter(Boolean).join('_');

	async function run(tipo: 'pdf' | 'jpg' | 'ppt') {
		setOpen(false);
		const node = rootRef.current;
		if (!node) return;
		setBusy(tipo);
		try {
			await new Promise(r => setTimeout(r, 60));
			if (tipo === 'jpg') await exportarJpg(node, `${baseName}.jpg`);
			else if (tipo === 'pdf') await exportarPdf(node, `${baseName}.pdf`);
			else await exportarPpt(dadosCompletos, `${baseName}.pptx`);
			toast.success(`${tipo.toUpperCase()} gerado.`);
		} catch (e) {
			toast.error('Não foi possível gerar o arquivo.');
			console.error(e);
		} finally {
			setBusy('');
		}
	}

	return (
		<div className="relative">
			{/* Ficha renderizada fora da tela para captura */}
			<div aria-hidden style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} ref={rootRef}>
				<FichaEstrategia dados={dadosCompletos} />
			</div>

			<button type="button" onClick={() => setOpen(v => !v)} disabled={!!busy}
				className="flex h-11 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-sm font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3] disabled:opacity-50">
				<FileText size={16} /> {busy ? 'Gerando…' : 'Exportar'}
				<ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open && (
				<>
					<button className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} aria-hidden />
					<div className="absolute right-0 top-12 z-30 w-52 rounded-lg border border-[#d8e3e5] bg-white p-1 shadow-lg">
						<button type="button" onClick={() => run('pdf')} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-600 hover:bg-[#edf4f5]"><FileText size={15} className="text-[#C62828]" /> PDF</button>
						<button type="button" onClick={() => run('jpg')} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-600 hover:bg-[#edf4f5]"><FileImage size={15} className="text-[#0E7C86]" /> Imagem (JPG)</button>
						<button type="button" onClick={() => run('ppt')} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-600 hover:bg-[#edf4f5]"><Presentation size={15} className="text-[#e9a23b]" /> PowerPoint (PPT)</button>
					</div>
				</>
			)}
		</div>
	);
}
