import { filtrarAlertas, linhasMailing, linhasRegrasDesligadas, type DiscagemExecResumo } from '@/lib/discagem';
import { SectionCard } from './discagem-campos';

export function ResultadoDia({ exec }: { exec: { resumo: DiscagemExecResumo | null; alertas: string[] } | null }) {
	const resumo = exec?.resumo ?? null;
	const alertas = exec?.alertas ?? [];

	if (!exec || !resumo || (!resumo.renitencia && !resumo.horario_fora_por_uf && resumo.regras_desligadas == null && resumo.mailing == null && !resumo.chamadas_curtas)) {
		return <div className="rounded-xl border p-6 text-center text-[14px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>Sem execução: aparece depois da próxima lista do dia.</div>;
	}

	const ren = resumo.renitencia;
	const hfu = resumo.horario_fora_por_uf ?? {};
	const rd = linhasRegrasDesligadas(resumo.regras_desligadas);
	const mail = linhasMailing(resumo.mailing);
	const todosAlertas = filtrarAlertas(alertas, ['CHAMADAS CURTAS', 'DISCAGEM', 'HORÁRIO POR UF/DDD:', 'RENITÊNCIA:']);

	return (
		<div className="space-y-4">
			{ren && (
				<SectionCard title="Renitência — clientes com voz suspensa hoje">
					<div className="grid gap-3 sm:grid-cols-3">
						<Stat label="Recusa" valor={ren.recusa} />
						<Stat label="Promessa" valor={ren.promessa} />
						<Stat label="Não ligar" valor={ren.nao_ligar} />
					</div>
				</SectionCard>
			)}

			{Object.keys(hfu).length > 0 && (
				<SectionCard title="Horário fora da janela por UF">
					<div className="flex flex-wrap gap-2">
						{Object.entries(hfu).map(([uf, n]) => (
							<span key={uf} className="rounded-lg border px-2.5 py-1 text-[12px] tnum" style={{ borderColor: 'var(--base-borda)', color: 'var(--base-texto-2)' }}>{uf}: <strong className="text-[var(--base-texto)]">{n}</strong></span>
						))}
					</div>
				</SectionCard>
			)}

			{rd.length > 0 && (
				<SectionCard title="Regras desligadas">
					<ul className="space-y-1">{rd.map((r, i) => <li key={i} className="text-[13px] text-[var(--base-texto-2)]">• {r}</li>)}</ul>
				</SectionCard>
			)}

			{mail.length > 0 && (
				<SectionCard title="Mailing do discador">
					<ul className="space-y-1">{mail.map((m, i) => <li key={i} className="text-[13px] text-[var(--base-texto-2)]">• {m}</li>)}</ul>
				</SectionCard>
			)}

			{todosAlertas.length > 0 && (
				<SectionCard title="Alertas do dia">
					<ul className="space-y-1.5">{todosAlertas.map((a, i) => <li key={i} className="text-[13px] text-[var(--base-texto-2)]">• {a}</li>)}</ul>
				</SectionCard>
			)}
		</div>
	);
}

function Stat({ label, valor }: { label: string; valor: number | undefined }) {
	return (
		<div className="rounded-lg border p-3" style={{ borderColor: 'var(--base-borda)' }}>
			<p className="text-[12px] text-[var(--base-texto-3)]">{label}</p>
			<p className="mt-1 text-[20px] font-bold tnum text-[var(--base-texto)]">{valor ?? 0}</p>
		</div>
	);
}
