import { SUGESTOES, stableEqual, pct, filtrarAlertas, type Discagem, type DiscagemExecResumo } from '@/lib/discagem';
import { SectionCard, Toggle, PercentField, NumberField, CaixaInfo } from './discagem-campos';
import type { DiscagemProps } from '@/lib/discagem';

type Props = DiscagemProps & { exec: { resumo: DiscagemExecResumo | null; alertas: string[] } | null };

export function ChamadasCurtas({ draft, update, reverter, canEdit, exec }: Props) {
	const cc = draft.chamadas_curtas ?? SUGESTOES.chamadas_curtas!;
	const resumo = exec?.resumo?.chamadas_curtas;
	const medido = resumo?.medido ?? [];
	const ultimo = medido.length ? medido[medido.length - 1] : null;
	const previsao = cc.ativo ? (resumo?.previsao ?? null) : null;
	const linhasMin = cc.ativo ? resumo?.linhas_minimas : undefined;
	const alertas = filtrarAlertas(exec?.alertas, ['CHAMADAS CURTAS', 'DISCAGEM']);

	const marcas = [
		{ label: 'seu aviso', val: cc.aviso, cor: 'var(--estado-atencao)' },
		...(cc.corte_ativo ? [{ label: 'corte', val: cc.corte, cor: 'var(--estado-erro)' }] : []),
		{ label: 'MP 85%', val: 0.85, cor: 'var(--base-texto-3)' },
	].sort((a, b) => a.val - b.val);

	return (
		<div className="space-y-4">
			<CaixaInfo tone="azul">
				O acompanhamento da regra e as medidas são responsabilidade da sua operação; o MotorCX mostra os números e avisa. A regra ainda depende de regulamentação da Anatel.
			</CaixaInfo>

			{/* Medidor */}
			<SectionCard title="Medidor de chamadas curtas" canEdit={canEdit}>
				{!ultimo && !previsao ? (
					<p className="text-[13px] text-[var(--base-texto-3)]">Sem medição ainda. Aparece depois da próxima lista do dia.</p>
				) : (
					<div className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<MedidorCard titulo="Último dia medido" dado={ultimo} marcas={marcas} />
							{previsao ? <MedidorCard titulo="Previsão de hoje" dado={previsao} marcas={marcas} /> : (
								<div className="rounded-lg border p-4" style={{ borderColor: 'var(--base-borda)' }}>
									<p className="text-[13px] font-semibold text-[var(--base-texto-2)]">Previsão de hoje</p>
									<p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Monitoramento desligado — sem previsão.</p>
								</div>
							)}
						</div>
						{linhasMin != null && (
							<p className="text-[12px] text-[var(--base-texto-3)]">A lista de hoje precisa de pelo menos {linhasMin} linha(s) de saída (o MotorCX não sabe por qual linha o discador liga).</p>
						)}
						{medido.length > 0 && (
							<div>
								<p className="mb-2 text-[12px] font-semibold text-[var(--base-texto-2)]">Últimos {medido.length} dia{medido.length > 1 ? 's' : ''} medido{medido.length > 1 ? 's' : ''}</p>
								<div className="flex flex-wrap gap-2">
									{medido.map((m, i) => (
										<span key={i} className="rounded-lg border px-2.5 py-1 text-[11px] tnum" style={{ borderColor: 'var(--base-borda)', color: 'var(--base-texto-2)' }}>
											{m.chamadas} chamadas · {m.curtas} curtas · {pct(m.fracao)}
										</span>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</SectionCard>

			{/* Seus limites */}
			<SectionCard title="Seus limites" ajustado={!stableEqual(cc, SUGESTOES.chamadas_curtas)} onReverter={() => reverter('chamadas_curtas')} canEdit={canEdit}>
				<div className="flex items-center gap-2">
					<Toggle checked={cc.ativo} disabled={!canEdit} label="Monitorar chamadas curtas" onChange={v => update({ chamadas_curtas: { ...cc, ativo: v } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">{cc.ativo ? 'Monitorando' : 'Desligado (sugestão)'}</span>
				</div>
				<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<PercentField label="Aviso" value={cc.aviso} disabled={!canEdit} sugestao="75%" hint={cc.aviso >= 0.85 ? 'O aviso chega junto ou depois da referência da MP.' : undefined} onChange={v => update({ chamadas_curtas: { ...cc, aviso: v } })} />
					<NumberField label="Máx. por número/dia" value={cc.max_por_numero_dia} min={1} disabled={!canEdit} sugestao="900" onChange={v => update({ chamadas_curtas: { ...cc, max_por_numero_dia: v === '' ? 1 : v } })} />
					<NumberField label="Máx. total/dia" value={cc.max_total_dia} min={1} disabled={!canEdit} sugestao="9000" onChange={v => update({ chamadas_curtas: { ...cc, max_total_dia: v === '' ? 1 : v } })} />
					<NumberField label="Conta como curta até" value={cc.segundos} min={1} max={60} suffix="seg" disabled={!canEdit} sugestao="6" onChange={v => update({ chamadas_curtas: { ...cc, segundos: v === '' ? 1 : v } })} />
					<div className="flex flex-col gap-1.5">
						<span className="text-[12px] font-semibold text-[var(--base-texto-2)]">Abandono conta</span>
						<div className="flex items-center gap-2">
							<Toggle checked={cc.abandono_conta} disabled={!canEdit} label="Abandono conta" onChange={v => update({ chamadas_curtas: { ...cc, abandono_conta: v } })} />
							<span className="text-[13px] text-[var(--base-texto-2)]">{cc.abandono_conta ? 'Sim' : 'Não'}</span>
						</div>
					</div>
				</div>
			</SectionCard>

			{/* Corte opcional */}
			<SectionCard title="Corte da voz (opcional)" canEdit={canEdit}>
				<div className="flex flex-wrap items-center gap-2">
					<Toggle checked={cc.corte_ativo} disabled={!canEdit} label="Cortar a voz" onChange={v => update({ chamadas_curtas: { ...cc, corte_ativo: v } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">Cortar a voz pelo fim da prioridade ao passar de {pct(cc.corte)}</span>
				</div>
				{cc.corte_ativo && (
					<div className="mt-3 grid gap-4 sm:grid-cols-2">
						<PercentField label="Corte" value={cc.corte} disabled={!canEdit} sugestao="80%" onChange={v => update({ chamadas_curtas: { ...cc, corte: v } })} />
						{resumo?.cortados != null && (
							<div className="rounded-lg px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--estado-erro-fundo)', color: 'var(--estado-erro-texto)' }}>
								<strong className="tnum">{resumo.cortados}</strong> clientes saíram da voz hoje.
							</div>
						)}
					</div>
				)}
				{cc.corte_ativo && resumo?.previsao_depois && (
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Previsão depois do corte: {resumo.previsao_depois.chamadas} chamadas · {resumo.previsao_depois.curtas} curtas · {pct(resumo.previsao_depois.fracao)}.</p>
				)}
			</SectionCard>

			{alertas.length > 0 && (
				<SectionCard title="Alertas do dia" canEdit={canEdit}>
					<ul className="space-y-1.5">
						{alertas.map((a, i) => <li key={i} className="text-[13px] text-[var(--base-texto-2)]">• {a}</li>)}
					</ul>
				</SectionCard>
			)}
		</div>
	);
}

function MedidorCard({ titulo, dado, marcas }: { titulo: string; dado: { chamadas: number; curtas: number; fracao: number } | null; marcas: { label: string; val: number; cor: string }[] }) {
	const fr = Math.min(1, dado?.fracao ?? 0);
	return (
		<div className="rounded-lg border p-4" style={{ borderColor: 'var(--base-borda)' }}>
			<p className="text-[13px] font-semibold text-[var(--base-texto-2)]">{titulo}</p>
			{!dado ? <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">—</p> : (
				<>
					<p className="mt-1 text-[12px] tnum text-[var(--base-texto-3)]">{dado.chamadas} chamadas · {dado.curtas} curtas · <strong style={{ color: 'var(--base-texto)' }}>{pct(dado.fracao)}</strong></p>
					<div className="relative mt-3 h-2.5 rounded-full" style={{ backgroundColor: 'var(--base-fill)' }}>
						<div className="h-full rounded-full" style={{ width: `${fr * 100}%`, backgroundColor: fr >= 0.85 ? 'var(--estado-erro)' : fr >= 0.75 ? 'var(--estado-atencao)' : 'var(--estado-pronto)' }} />
						{marcas.map((m, i) => (
							<span key={i} className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2" style={{ left: `${Math.min(100, m.val * 100)}%`, backgroundColor: m.cor }} title={`${m.label}: ${pct(m.val)}`} />
						))}
					</div>
					<div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--base-texto-3)]">
						{marcas.map((m, i) => <span key={i}><span className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: m.cor }} /> {m.label} {pct(m.val)}</span>)}
					</div>
				</>
			)}
		</div>
	);
}
