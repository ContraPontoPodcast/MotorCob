import { InfoButton } from '@/components/mensageria/info-button';
import { INFO_DEFS } from '@/lib/mensageria-info';
import { num, pct, precoCliente, type ScoreFormacao } from '@/lib/mensageria-produtos';
import { SCORE_FAIXAS } from '@/components/comuns/score-faixas';
import { ScoreFormacaoBox } from '@/components/comuns/score-formacao-box';

export type ScorePrevia = {
	faixas: { alto: number; medio: number; baixo: number; sem: number };
	analisados: number;
	preco_sms: number | null;
	preco_score: number | null;
	cobranca: string | null;
};

// Reexporta para quem já importava daqui.
export { SCORE_FAIXAS };

const money2 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
	previa: ScorePrevia;
	scoreOn: boolean;
	onScoreOn: (v: boolean) => void;
	faixasSel: string[];
	onToggleFaixa: (id: string) => void;
	onToggleTodos: () => void;
	formacao?: ScoreFormacao | null;
};

export function ScorePreviaCard({ previa, scoreOn, onScoreOn, faixasSel, onToggleFaixa, onToggleTodos, formacao }: Props) {
	const f = previa.faixas ?? { alto: 0, medio: 0, baixo: 0, sem: 0 };
	const total = previa.analisados || (f.alto + f.medio + f.baixo + f.sem) || 1;
	const enviados = faixasSel.reduce((s, id) => s + Number((f as Record<string, number>)[id] ?? 0), 0);
	const naoEnviados = Math.max(0, previa.analisados - enviados);
	const naoSelLabels = SCORE_FAIXAS.filter(x => !faixasSel.includes(x.id)).map(x => x.label.toLowerCase()).join(', ');

	const temPreco = (previa.preco_sms ?? 0) > 0 && (previa.preco_score ?? 0) > 0;
	const scoreCost = previa.cobranca === 'analisado'
		? previa.analisados * (previa.preco_score ?? 0)
		: naoEnviados * (previa.preco_score ?? 0);
	const totalCom = enviados * (previa.preco_sms ?? 0) + scoreCost;
	const totalSem = previa.analisados * (previa.preco_sms ?? 0);
	const custoUnit = previa.analisados ? totalCom / previa.analisados : 0;
	const todosOn = faixasSel.length === 4;

	return (
		<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<h3 className="text-[15px] font-semibold text-[#1D1D1F]">Score de Entrega</h3>
					<InfoButton def={INFO_DEFS.score_entrega} />
				</div>
				<button role="switch" aria-checked={scoreOn} aria-label="Score de Entrega" onClick={() => onScoreOn(!scoreOn)} className={`relative h-6 w-11 rounded-full transition-colors ${scoreOn ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}>
					<span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${scoreOn ? 'left-6' : 'left-1'}`} />
				</button>
			</div>

			{scoreOn ? (
				<div className="mt-4 space-y-4">
					{/* Histórico em formação */}
					{formacao && !formacao.completa && (
						<ScoreFormacaoBox formacao={formacao} semHistorico={f.sem} total={total} />
					)}

					{/* Barra dividida pelas 4 faixas */}
					<div className="flex h-3 w-full overflow-hidden rounded-full bg-[#F5F5F7]">
						{SCORE_FAIXAS.map(x => {
							const v = Number((f as Record<string, number>)[x.id] ?? 0);
							const w = total > 0 ? (v / total) * 100 : 0;
							return w > 0 ? <div key={x.id} style={{ width: `${w}%`, backgroundColor: x.cor }} title={`${x.label}: ${num(v)}`} /> : null;
						})}
					</div>

					{/* Quadro por faixa */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{SCORE_FAIXAS.map(x => {
							const v = Number((f as Record<string, number>)[x.id] ?? 0);
							return (
								<div key={x.id} className="rounded-xl border border-[#E5E5EA] p-3">
									<div className="flex items-center gap-1.5">
										<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: x.cor }} />
										<span className="text-[13px] font-medium text-[#1D1D1F]">{x.label}</span>
										{x.id === 'sem' && <InfoButton def={INFO_DEFS.sem_historico} />}
									</div>
									<p className="mt-1.5 text-[18px] font-bold tnum text-[#1D1D1F]">{num(v)}</p>
									<p className="text-[12px] tnum text-[#8E8E93]">{pct(v, total)} da lista</p>
								</div>
							);
						})}
					</div>

					{/* O que enviar */}
					<div>
						<p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">O que enviar</p>
						<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
							<label className="flex items-center gap-2 text-[14px] font-medium text-[#1D1D1F]">
								<input type="checkbox" checked={todosOn} onChange={onToggleTodos} className="h-4 w-4 accent-[#1D1D1F]" />
								Todos
							</label>
							{SCORE_FAIXAS.map(x => (
								<label key={x.id} className="flex items-center gap-2 text-[14px] text-[#1D1D1F]">
									<input type="checkbox" checked={faixasSel.includes(x.id)} onChange={() => onToggleFaixa(x.id)} className="h-4 w-4 accent-[#1D1D1F]" />
									{x.label}
								</label>
							))}
						</div>
						{faixasSel.length === 0 && (
							<p className="mt-2 text-[13px] text-[#FF3B30]">Selecione ao menos uma faixa para agendar o envio.</p>
						)}
					</div>

					{/* Prévia que muda na hora */}
					<div className="rounded-xl bg-[#F5F5F7] px-4 py-3">
						<p className="text-[14px] text-[#1D1D1F]">
							<strong className="tnum">{num(enviados)}</strong> números serão enviados
							{naoEnviados > 0 && <> · <strong className="tnum">{num(naoEnviados)}</strong> não serão enviados{naoSelLabels ? ` (${naoSelLabels})` : ''}</>}
						</p>
						{temPreco && previa.analisados > 0 && (
							<p className="mt-1 text-[13px] text-[#6E6E73]">
								Custo unitário efetivo <strong className="tnum text-[#1D1D1F]">{precoCliente(custoUnit)}</strong> contra {precoCliente(previa.preco_sms ?? 0, 'SMS')} do SMS padrão · total {money2(totalCom)} em vez de {money2(totalSem)}.
							</p>
						)}
					</div>
				</div>
			) : (
				<p className="mt-3 text-[13px] text-[#6E6E73]">Desligado: todos os {num(previa.analisados)} números saem por SMS, sem o filtro do Score.</p>
			)}
		</div>
	);
}
