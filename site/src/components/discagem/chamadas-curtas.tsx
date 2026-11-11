import { SUGESTOES, REGRA_CURTAS, FONTE_CURTAS, stableEqual, pct, filtrarAlertas, type DiscagemExecResumo } from '@/lib/discagem';
import { SectionCard, Toggle, PercentField, NumberField, CaixaInfo } from './discagem-campos';
import type { DiscagemProps } from '@/lib/discagem';
import { CurtasHoje } from './curtas-hoje';

// PR 8 do plano (REVISAO C1): no topo, os medidores de hoje por linha (bina) e no total da empresa; "Ligação não
// completada" e "Abandono" contam sempre (travados em Sim: regra da Anatel e decisão do dono, pergunta 15 do SPEC).
type Props = DiscagemProps & { exec: { resumo: DiscagemExecResumo | null; alertas: string[] } | null; empresaId?: number | null; abandonoSalvoNao?: boolean };

export function ChamadasCurtas({ draft, update, reverter, canEdit, exec, empresaId, abandonoSalvoNao }: Props) {
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
		{ label: 'Anatel 85%', val: 0.85, cor: 'var(--base-texto-3)' },
	].sort((a, b) => a.val - b.val);

	return (
		<div className="space-y-4">
			<CaixaInfo tone="amber">
				<strong>{REGRA_CURTAS}</strong> {FONTE_CURTAS} Trocar a bina ou espalhar as ligações por mais linhas não resolve: a Anatel pode endurecer os critérios para quem tentar contornar a regra. O MotorCX mostra os números, avisa e, com o corte ligado, tira a voz pelo fim da prioridade; o acompanhamento continua sendo da sua operação.
			</CaixaInfo>

			{empresaId != null && <CurtasHoje empresaId={empresaId} />}

			{/* Medidor da lista do dia (por carteira) */}
			<SectionCard title="Medidor da lista do dia (esta carteira)" canEdit={canEdit}>
				{!ultimo && !previsao ? (
					<p className="text-[13px] text-[var(--base-texto-3)]">Sem medição ainda. Aparece depois da próxima lista do dia.</p>
				) : (
					<div className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<MedidorCard titulo="Último dia medido" dado={ultimo} marcas={marcas} aviso={cc.aviso} />
							{previsao ? <MedidorCard titulo="Previsão de hoje" dado={previsao} marcas={marcas} aviso={cc.aviso} /> : (
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
					<span className="text-[13px] text-[var(--base-texto-2)]">{cc.ativo ? 'Monitorando' : 'Desligado (não recomendado)'}</span>
				</div>
				<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<PercentField label="Aviso" value={cc.aviso} disabled={!canEdit} sugestao="70%" hint={cc.aviso >= 0.85 ? 'O aviso chega junto ou depois do limite de 85% da Anatel.' : undefined} onChange={v => update({ chamadas_curtas: { ...cc, aviso: v } })} />
					<NumberField label="Máx. por número/dia" value={cc.max_por_numero_dia} min={1} disabled={!canEdit} sugestao="900" onChange={v => update({ chamadas_curtas: { ...cc, max_por_numero_dia: v === '' ? 1 : v } })} />
					<NumberField label="Máx. total/dia" value={cc.max_total_dia} min={1} disabled={!canEdit} sugestao="9000" onChange={v => update({ chamadas_curtas: { ...cc, max_total_dia: v === '' ? 1 : v } })} />
					<NumberField label="Conta como curta até" value={cc.segundos} min={1} max={60} suffix="seg" disabled={!canEdit} sugestao="6" onChange={v => update({ chamadas_curtas: { ...cc, segundos: v === '' ? 1 : v } })} />
					<div className="flex flex-col gap-1.5">
						<span className="text-[12px] font-semibold text-[var(--base-texto-2)]">Ligação não completada conta</span>
						<span className="text-[13px] text-[var(--base-texto)]">Sim (regra da Anatel)</span>
						<span className="text-[11px] text-[var(--base-texto-3)]">Travado: a regra conta as não completadas.</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-[12px] font-semibold text-[var(--base-texto-2)]">Abandono conta</span>
						<span className="text-[13px] text-[var(--base-texto)]">Sim, sempre</span>
						<span className="text-[11px] text-[var(--base-texto-3)]">Travado: todo abandono conta como curta, mesmo com a mensagem de identificação.</span>
					</div>
				</div>
				{abandonoSalvoNao && (
					<p role="alert" className="mt-3 rounded-lg px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--estado-atencao-fundo)', color: 'var(--estado-atencao-texto)' }}>
						Esta carteira tinha salvo “abandono não conta” na lista da manhã. A VM já conta todo abandono; salve uma versão nova para a lista contar também.
						{canEdit && <button type="button" className="ml-2 font-semibold underline" onClick={() => update({ chamadas_curtas: { ...cc, abandono_conta: true } })}>Preparar a versão</button>}
					</p>
				)}
			</SectionCard>

			{/* Corte (ligado por padrão em 80%) */}
			<SectionCard title="Corte da voz" canEdit={canEdit}>
				<div className="flex flex-wrap items-center gap-2">
					<Toggle checked={cc.corte_ativo} disabled={!canEdit} label="Cortar a voz" onChange={v => update({ chamadas_curtas: { ...cc, corte_ativo: v } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">{cc.corte_ativo ? `Ligado (recomendado): a voz é cortada pelo fim da prioridade ao passar de ${pct(cc.corte)} de curtas previstas` : 'Desligado: a lista sai inteira, mesmo com a previsão acima do limite'}</span>
				</div>
				{!cc.corte_ativo && (
					<div className="mt-3 rounded-lg px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--estado-erro-fundo)', color: 'var(--estado-erro-texto)' }}>
						Sem o corte, um dia acima de 85% de curtas pode bloquear todas as linhas da empresa por 15 dias. Recomendamos ligar em 80%.
					</div>
				)}
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

function MedidorCard({ titulo, dado, marcas, aviso }: { titulo: string; dado: { chamadas: number; curtas: number; fracao: number } | null; marcas: { label: string; val: number; cor: string }[]; aviso: number }) {
	const fr = Math.min(1, dado?.fracao ?? 0);
	return (
		<div className="rounded-lg border p-4" style={{ borderColor: 'var(--base-borda)' }}>
			<p className="text-[13px] font-semibold text-[var(--base-texto-2)]">{titulo}</p>
			{!dado ? <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">—</p> : (
				<>
					<p className="mt-1 text-[12px] tnum text-[var(--base-texto-3)]">{dado.chamadas} chamadas · {dado.curtas} curtas · <strong style={{ color: 'var(--base-texto)' }}>{pct(dado.fracao)}</strong></p>
					<div className="relative mt-3 h-2.5 rounded-full" style={{ backgroundColor: 'var(--base-fill)' }}>
						<div className="h-full rounded-full" style={{ width: `${fr * 100}%`, backgroundColor: fr >= 0.85 ? 'var(--estado-erro)' : fr >= aviso ? 'var(--estado-atencao)' : 'var(--estado-pronto)' }} />
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
