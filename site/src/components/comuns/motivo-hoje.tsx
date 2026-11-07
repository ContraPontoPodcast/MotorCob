// "Hoje" do cliente (estado_cliente.motivo_hoje, escrito pelo motor em rodar_dia.py › _motivo_do_cliente):
// "com ação hoje", "sem ação: <motivo>" ou "não avaliado hoje". O texto do motor pode ser longo (ex.: "sem ação:
// giro sem passo hoje (ou pausado aguardando enriquecimento)"); por isso a pílula leva só o rótulo curto e o motivo
// vai numa linha secundária (cortada com reticências na tabela, inteira no title). Só tokens do tema.
import { Pilula, type Tom } from '@/components/ds';

export type MotivoHojePartes = { rotulo: string; detalhe: string; tom: Tom };

/** Separa o texto do motor em rótulo curto (pílula), detalhe (motivo) e tom. */
export function partirMotivoHoje(motivo: string): MotivoHojePartes {
	const t = motivo.trim();
	const m = t.toLowerCase();
	if (m.startsWith('com ação')) return { rotulo: 'Com ação', detalhe: '', tom: 'ok' };
	if (m.startsWith('sem ação')) return { rotulo: 'Sem ação', detalhe: t.replace(/^sem ação\s*:?\s*/i, ''), tom: 'atencao' };
	if (m.startsWith('não avaliado')) return { rotulo: 'Não avaliado', detalhe: '', tom: 'neutro' };
	return { rotulo: 'Hoje', detalhe: t, tom: 'neutro' };
}

/**
 * Pílula curta + motivo. `compacto` (tabela): motivo numa linha só, cortado, com o texto inteiro no title.
 * Sem `compacto` (ficha do cliente): o motivo quebra linha normalmente, ao lado da pílula.
 */
export function MotivoHoje({ motivo, compacto = false }: { motivo: string | null | undefined; compacto?: boolean }) {
	if (!motivo?.trim()) return <span className="text-[var(--base-texto-3)]">—</span>;
	const { rotulo, detalhe, tom } = partirMotivoHoje(motivo);
	const titulo = motivo.trim();
	if (compacto) {
		return <div className="flex min-w-0 max-w-[280px] flex-col items-start gap-0.5" title={titulo}>
			<Pilula tom={tom}>{rotulo}</Pilula>
			{detalhe && <span className="block w-full truncate text-[11.5px] text-[var(--base-texto-2)]">{detalhe}</span>}
		</div>;
	}
	return <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" title={titulo}>
		<Pilula tom={tom}>{rotulo}</Pilula>
		{detalhe && <span className="text-xs text-[var(--base-texto-2)]">{detalhe}</span>}
	</span>;
}
