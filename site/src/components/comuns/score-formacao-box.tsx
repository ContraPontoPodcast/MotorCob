import { num, pct, type ScoreFormacao } from '@/lib/mensageria-produtos';

const dateBR = (v: string) => { try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(v)); } catch { return v; } };

// Quadro tracejado mostrado enquanto o histórico do Score está em formação
// (completa = false). Aparece na prévia e no topo da Economia do Score.
//
// Props:
//  - formacao: dados da rpc score_formacao().
//  - semHistorico: quantos números estão como "Sem histórico" nesta lista.
//  - total: total analisado (para o %).
//  - economia: se true, mostra o texto da Economia do Score.

export function ScoreFormacaoBox({ formacao, semHistorico, total, economia }: {
	formacao: ScoreFormacao;
	semHistorico: number;
	total: number;
	economia?: boolean;
}) {
	if (formacao.completa) return null;
	const hoje = new Date();
	const ini = new Date(formacao.inicio);
	const dias = Math.max(1, Math.floor((hoje.getTime() - ini.getTime()) / 86400000) + 1);
	const x = total > 0 ? pct(semHistorico, total) : '—';

	return (
		<div className="rounded-2xl border-2 border-dashed border-[#D2D2D7] bg-[#FAFAFB] p-5">
			<div className="flex items-center gap-2">
				<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--score-sem)' }} />
				<p className="text-[14px] font-semibold text-[#1D1D1F]">O Score está formando o histórico · {dias}º dia de {formacao.janela_dias}</p>
			</div>
			<p className="mt-2 text-[13px] leading-relaxed text-[#6E6E73]">
				O histórico de entrega da Mensageria começou em {dateBR(formacao.inicio)}. Até {dateBR(formacao.completa_em)} muitos números ainda não passaram pela Mensageria e aparecem como Sem histórico: nesta lista são {num(semHistorico)} ({x}). Eles saem normalmente se a faixa estiver marcada.
			</p>
			{economia && <p className="mt-1 text-[13px] text-[#9a631b]">A economia cresce conforme o histórico se forma.</p>}
			{/* Linha do tempo inicio → completa_em */}
			<div className="mt-3 flex items-center gap-2">
				<span className="text-[12px] tnum text-[#8E8E93]">{dateBR(formacao.inicio)}</span>
				<div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#E5E5EA]">
					<div className="h-full rounded-full" style={{ width: `${Math.min(100, (dias / formacao.janela_dias) * 100)}%`, backgroundColor: 'var(--score-medio)' }} />
				</div>
				<span className="text-[12px] tnum text-[#8E8E93]">{dateBR(formacao.completa_em)}</span>
			</div>
		</div>
	);
}
