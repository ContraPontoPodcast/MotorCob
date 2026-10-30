import type { FichaDados } from '@/components/estrategias/ficha-estrategia';
import { fichaLanesDeFaixa, fichaDiaLabel, fichaCanalNome, fichaNormPassos } from '@/components/estrategias/ficha-estrategia';
import type { Passos, Acao } from '@/lib/estrategia';

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MODO_LABEL: Record<string, string> = { sempre: 'sempre', senao: 'senão', junto: '+junto', reserva: 'reserva' };

/** Exporta a ficha inteira como uma imagem JPG (escala 2x). */
export async function exportarJpg(node: HTMLElement, filename: string) {
	const { toPng } = await import('html-to-image');
	const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
	const link = document.createElement('a');
	link.href = dataUrl;
	link.download = filename;
	link.click();
}

/** Exporta a ficha como PDF A4 paisagem, uma seção por página, com rodapé página X/Y. */
export async function exportarPdf(root: HTMLElement, filename: string) {
	const { toCanvas } = await import('html-to-image');
	const { jsPDF } = await import('jspdf');
	const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	const pageW = 297;
	const pageH = 210;
	const margin = 8;
	const footerH = 6;

	const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-ficha-section]'));
	if (sections.length === 0) return;

	// Primeiro passada: captura todas as seções
	const canvases: HTMLCanvasElement[] = [];
	for (const sec of sections) {
		const canvas = await toCanvas(sec, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
		canvases.push(canvas);
	}

	for (const canvas of canvases) {
		const imgW = pageW - margin * 2;
		const ratio = canvas.height / canvas.width;
		const imgH = imgW * ratio;
		const maxH = pageH - margin * 2 - footerH;
		if (imgH <= maxH) {
			pdf.addPage();
			const imgData = canvas.toDataURL('image/jpeg', 0.92);
			pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
		} else {
			// seção alta: fatia em páginas
			const slices = Math.ceil(imgH / maxH);
			const sliceHpx = (canvas.width * maxH) / imgW;
			for (let s = 0; s < slices; s++) {
				pdf.addPage();
				const sliceCanvas = document.createElement('canvas');
				sliceCanvas.width = canvas.width;
				sliceCanvas.height = Math.min(sliceHpx, canvas.height - s * sliceHpx);
				const ctx = sliceCanvas.getContext('2d')!;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
				ctx.drawImage(canvas, 0, s * sliceHpx, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
				const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
				const sliceImgH = (sliceCanvas.height / canvas.width) * imgW;
				pdf.addImage(imgData, 'JPEG', margin, margin, imgW, sliceImgH);
			}
		}
	}

	// Remove a primeira página em branco do jsPDF
	const total = pdf.getNumberOfPages();
	if (total > 1) pdf.deletePage(1);

	// Rodapé página X/Y
	const finalTotal = pdf.getNumberOfPages();
	for (let i = 1; i <= finalTotal; i++) {
		pdf.setPage(i);
		pdf.setFontSize(8);
		pdf.setTextColor(150, 150, 150);
		pdf.text(`Página ${i}/${finalTotal} · Gerado pelo MotorCX`, pageW / 2, pageH - 3, { align: 'center' });
	}

	pdf.save(filename);
}

/** Exporta a ficha como PowerPoint: capa, um slide por faixa (tabela editável), CPC+acordo, regras. */
export async function exportarPpt(dados: FichaDados, filename: string) {
	const pptxgen = (await import('pptxgenjs')).default;
	const pptx = new pptxgen();
	pptx.defineLayout({ name: 'A4L', width: 11.69, height: 8.27 });
	pptx.layout = 'A4L';
	const COR = '0F4C5C';
	const COR_TEXTO = '163943';

	const { nome, empresaNome, credorNome, segmentos, def, personas, calendar, resumo } = dados;
	const dataExport = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

	// Slide 1 — capa
	const capa = pptx.addSlide();
	capa.background = { color: 'FFFFFF' };
	capa.addText('Ficha da estratégia', { x: 0.6, y: 0.6, w: 10, h: 0.5, fontSize: 14, bold: true, color: COR, charSpacing: 2 });
	capa.addText(nome, { x: 0.6, y: 1.1, w: 10, h: 0.8, fontSize: 32, bold: true, color: COR_TEXTO });
	capa.addText([
		{ text: 'Empresa: ', options: { color: '64748B' } }, { text: empresaNome, options: { bold: true, color: COR_TEXTO } },
		{ text: '   ·   Credor: ', options: { color: '64748B' } }, { text: credorNome, options: { bold: true, color: COR_TEXTO } },
	], { x: 0.6, y: 2.1, w: 10, h: 0.4, fontSize: 14 });
	if (segmentos.length > 0) {
		capa.addText([
			{ text: 'Segmentos: ', options: { color: '64748B' } }, { text: segmentos.join(', '), options: { color: COR_TEXTO } },
		], { x: 0.6, y: 2.6, w: 10, h: 0.4, fontSize: 12 });
	}
	capa.addText(`Exportado em ${dataExport} · Gerado pelo MotorCX`, { x: 0.6, y: 7.4, w: 10, h: 0.3, fontSize: 10, color: '94A3B8' });

	function slideTabela(titulo: string, passos: Passos, nota?: string) {
		const { dias, lanes } = fichaLanesDeFaixa(passos, personas);
		const slide = pptx.addSlide();
		slide.background = { color: 'FFFFFF' };
		slide.addText(titulo, { x: 0.4, y: 0.3, w: 10.8, h: 0.5, fontSize: 20, bold: true, color: COR_TEXTO });
		if (nota) slide.addText(nota, { x: 0.4, y: 0.85, w: 10.8, h: 0.3, fontSize: 11, color: '64748B' });

		if (dias.length === 0) {
			slide.addText('Seguindo o padrão MotorCX.', { x: 0.4, y: 1.4, w: 10, h: 0.4, fontSize: 12, italic: true, color: '94A3B8' });
			return;
		}
		const header = ['Raia \\ Dia', ...dias.map(d => fichaDiaLabel(d))];
		const rows: string[][] = [header];
		for (const lane of lanes) {
			const row = [lane.nome];
			for (const d of dias) {
				const acts = (lane.cells[d] ?? []).filter(a => a.canal !== 'sem_acao');
				row.push(acts.length === 0 ? '—' : acts.map(a => {
					const n = fichaCanalNome[a.canal] ?? a.canal;
					return a.modo && a.modo !== 'sempre' ? `${n} (${MODO_LABEL[a.modo] ?? a.modo})` : n;
				}).join(' · '));
			}
			rows.push(row);
		}
		const colW = Math.min(2.5, 10.8 / (dias.length + 1));
		slide.addTable(rows as unknown as never[], {
			x: 0.4, y: 1.3, w: 10.8,
			colW: Array(dias.length + 1).fill(colW),
			border: { type: 'solid', pt: 0.5, color: 'C9DADD' },
			rowH: 0.4,
			fontSize: 10,
			color: COR_TEXTO,
			align: 'left',
			valign: 'top',
			autoPage: true,
			fill: { color: 'FFFFFF' },
		});
	}

	// Slides por faixa
	slideTabela('Cliente novo · ainda não deu CPC', fichaNormPassos(def.localizacao?.passos), `Vira Não CPC no dia D+${def.localizacao?.dias_sem_contato_para_ncp ?? 8}.`);
	slideTabela('Não CPC · ciclo que se repete', fichaNormPassos(def.giro?.passos), `Ciclo de ${def.giro?.ciclo_dias ?? 8} dias × ${def.giro?.max_ciclos ?? 3}.`);
	slideTabela('Acordo · preventivo', fichaNormPassos(def.preventivo?.passos), 'Dias antes do vencimento.');
	slideTabela('Acordo · quebra', fichaNormPassos(def.quebra?.passos), 'Dias depois da quebra.');

	// Slide Deu CPC e acordo
	const cpc = pptx.addSlide();
	cpc.background = { color: 'FFFFFF' };
	cpc.addText('Deu CPC e acordo', { x: 0.4, y: 0.3, w: 10.8, h: 0.5, fontSize: 20, bold: true, color: COR_TEXTO });
	const cpcOrdem = (def.cpc?.ordem ?? []).filter((a: Acao) => a.canal);
	const cpcLines: string[] = [];
	cpcLines.push(`Canal do CPC no contato principal; depois segue a ordem: ${cpcOrdem.map(a => fichaCanalNome[a.canal] ?? a.canal).join(' → ') || 'só o canal do CPC'}.`);
	cpcLines.push(`Tentativas por canal antes de trocar: ${def.cpc?.tentativas_por_canal ?? 3}.`);
	cpcLines.push(`CPC A a cada ${def.cpc?.intervalo_cpa ?? 1} dia(s) · CPC B a cada ${def.cpc?.intervalo_cpb ?? 1} dia(s).`);
	cpc.addText(cpcLines.map((l, i) => ({ text: l, options: { breakLine: true, bullet: i === 0, color: COR_TEXTO, fontSize: 12 } })), { x: 0.4, y: 1.1, w: 10.8, h: 2 });

	// Slide Regras e calendário
	const regras = pptx.addSlide();
	regras.background = { color: 'FFFFFF' };
	regras.addText('Regras e calendário', { x: 0.4, y: 0.3, w: 10.8, h: 0.5, fontSize: 20, bold: true, color: COR_TEXTO });
	regras.addText('Travas que valem sempre: contato inválido ou que não pertence ao cliente nunca recebe; WhatsApp só em número confiável; horário, domingo e feriado; 48h entre ações massivas.', { x: 0.4, y: 1.0, w: 10.8, h: 0.8, fontSize: 12, color: COR_TEXTO });
	const prio = def.prioridade_contatos?.criterios ?? [];
	const prioTxt = prio.length ? prio.map(c => `${c.campo} (${c.sentido === 'asc' ? 'menor primeiro' : 'maior primeiro'})`).join(', depois ') : 'Sem regra personalizada (padrão MotorCX).';
	regras.addText(`Prioridade dos telefones: ${prioTxt}`, { x: 0.4, y: 2.0, w: 10.8, h: 0.5, fontSize: 12, color: COR_TEXTO });
	const calTxt = calendar
		? calendar.seguirPadrao ? `Calendário: segue o padrão do credor (${credorNome}).` : `Calendário: ${calendar.diasSemana.map(i => DIAS_SEMANA[i]).join(', ')}${calendar.feriados ? ' · não exporta em feriado nacional' : ''}.`
		: `Calendário: segue o padrão do credor (${credorNome}).`;
	regras.addText(calTxt, { x: 0.4, y: 2.6, w: 10.8, h: 0.5, fontSize: 12, color: COR_TEXTO });
	if (resumo.length > 0) {
		regras.addText('Como vai funcionar', { x: 0.4, y: 3.3, w: 10.8, h: 0.4, fontSize: 14, bold: true, color: COR });
		regras.addText(resumo.map(l => ({ text: l, options: { breakLine: true, bullet: true, color: COR_TEXTO, fontSize: 11 } })), { x: 0.4, y: 3.8, w: 10.8, h: 3.5 });
	}

	await pptx.writeFile({ fileName: filename });
}
