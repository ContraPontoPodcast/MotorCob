import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { faseCor, faseDescricao, faseLabel, type Maturidade } from '@/lib/personas';
import { numberBR, pctBR } from '@/lib/supabase';

/** Anel de maturidade 84px na cor da persona (trilho #E5E5EA) + barras de volume e separação. */
export function MedidorMaturidade({ maturidade, nome, cor }: { maturidade: Maturidade; nome: string; cor: string }) {
	const fase = maturidade.fase ?? 'coletando';
	const indice = Math.max(0, Math.min(100, maturidade.indice ?? 0));
	const anterior = maturidade.indice_anterior ?? null;

	const R = 34;
	const C = 2 * Math.PI * R;
	const dash = (indice / 100) * C;

	const diff = anterior != null ? indice - anterior : null;
	const tendencia = diff == null
		? { txt: 'primeira medição', Icon: null as null | typeof ArrowUp, cor: '#8E8E93' }
		: diff > 0
			? { txt: `+${numberBR(diff)} desde ontem`, Icon: ArrowUp, cor: '#248A3D' }
			: diff < 0
				? { txt: `${numberBR(diff)} desde ontem`, Icon: ArrowDown, cor: '#FF3B30' }
				: { txt: 'estável', Icon: ArrowRight, cor: '#8E8E93' };

	const volume = Math.max(0, Math.min(100, maturidade.volume_pct ?? 0));
	const confianca = maturidade.confianca ?? null;
	const meta = maturidade.meta_tentativas ?? 200;

	return (
		<div className="mb-4 rounded-2xl bg-[#F5F5F7] p-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				{/* Anel 84px */}
				<div className="flex shrink-0 flex-col items-center">
					<svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`Maturidade ${indice} de 100, ${faseLabel(fase)}`}>
						<circle cx="42" cy="42" r={R} fill="none" stroke="#E5E5EA" strokeWidth="8" />
						<circle
							cx="42" cy="42" r={R} fill="none" stroke={cor} strokeWidth="8" strokeLinecap="round"
							strokeDasharray={`${dash} ${C - dash}`}
							transform="rotate(-90 42 42)"
						/>
						<text x="42" y="40" textAnchor="middle" className="tnum" style={{ fontSize: 20, fontWeight: 600, fill: '#1D1D1F' }}>{numberBR(indice)}</text>
						<text x="42" y="54" textAnchor="middle" style={{ fontSize: 9, fill: '#8E8E93' }}>/100</text>
					</svg>
					<span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${cor}1a`, color: cor }}>
						{tendencia.Icon && <tendencia.Icon size={11} />} {faseLabel(fase)}
					</span>
					{diff != null && (
						<span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: tendencia.cor }}>
							{tendencia.Icon && <tendencia.Icon size={10} />} {tendencia.txt}
						</span>
					)}
					{diff == null && <span className="mt-0.5 text-[10px] text-[#8E8E93]">{tendencia.txt}</span>}
				</div>

				{/* Descrição + barras */}
				<div className="min-w-0 flex-1">
					<p className="text-[11px] leading-relaxed text-[#6E6E73]">{faseDescricao(fase)}</p>

					<div className="mt-3 space-y-2.5">
						<MiniBar label="Volume" valor={`${numberBR(volume)}%`} pct={volume} cor="#1D1D1F" legenda={`tentativas no 1º e 2º canal (meta: ${numberBR(meta)} em cada)`} />
						<MiniBar
							label="Separação ★/☆"
							valor={confianca == null ? '—' : pctBR(confianca)}
							pct={confianca == null ? 0 : Math.max(0, Math.min(100, confianca * 100))}
							cor={cor}
							legenda="chance de o ★ ser mesmo melhor que o ☆"
							tracejada={confianca == null}
						/>
					</div>

					{maturidade.proximo_passo && (
						<p className="mt-2.5 text-[11px] text-[#6E6E73]">{maturidade.proximo_passo}</p>
					)}
				</div>
			</div>
		</div>
	);
}

function MiniBar({ label, valor, pct, cor, legenda, tracejada }: { label: string; valor: string; pct: number; cor: string; legenda: string; tracejada?: boolean }) {
	return (
		<div>
			<div className="mb-1 flex items-center justify-between gap-2">
				<span className="text-[11px] font-semibold text-[#6E6E73]">{label}</span>
				<span className="text-[11px] font-semibold text-[#1D1D1F]">{valor}</span>
			</div>
			<div className="h-1 w-full overflow-hidden rounded-full bg-[#E5E5EA]">
				<div
					className="h-full rounded-full"
					style={{ width: `${Math.max(2, pct)}%`, backgroundColor: tracejada ? 'transparent' : cor, borderTop: tracejada ? '2px dashed #C7C7CC' : undefined }}
				/>
			</div>
			<p className="mt-1 text-[10px] text-[#8E8E93]">{legenda}</p>
		</div>
	);
}
