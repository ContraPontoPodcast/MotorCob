// Resultados › Painel › Recuperação por canal e persona (SQL 77; Etapa 3 da IA na Orquestração).
// Do acionamento ao dinheiro: ações → CPC → acordo → pagamento → valor pago, com o custo e o "recuperado por R$ 1".
// Soma no servidor pela RPC recuperacao_por_acao (só agregados; taxa nula quando o grupo tem menos de 30 ações).
// Regra: o acordo vai para o último toque com CPC nos 7 dias antes da rotina que o recebeu; sem toque = "Sem ação do motor".
import { useEffect, useState } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { Empty, Loading, Notice } from '@/components/app-shell';
import { friendlyError, supabase } from '@/lib/supabase';
import { NOME_CANAL_RECUPERACAO, PERIODOS_RECUPERACAO, lerLinhasRecuperacao, periodoRecuperacao, type LinhaRecuperacao } from '@/lib/recuperacao';

const nf = (n: number) => Math.round(n).toLocaleString('pt-BR');
const rs = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pc = (n: number | null) => (n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`);

export function RecuperacaoCanalPersona() {
	const { empresa, credor } = useMotorAuth();
	const [dias, setDias] = useState<number>(30);
	const [linhas, setLinhas] = useState<LinhaRecuperacao[] | null>(null);
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !empresa) return;
		let ativo = true;
		const { de, ate } = periodoRecuperacao(new Date(), dias);
		setLinhas(null);
		void supabase.rpc('recuperacao_por_acao', { empresa: empresa.id, de, ate, credor: credor ? credor.id : null, agrupar: ['canal', 'persona'] })
			.then(({ data, error }) => {
				if (!ativo) return;
				if (error) { setErro(friendlyError(error)); setLinhas([]); return; }
				setErro('');
				setLinhas(lerLinhasRecuperacao(data));
			});
		return () => { ativo = false; };
	}, [empresa?.id, credor?.id, dias]);

	return (
		<section className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-6 sm:p-8">
			<div className="mb-1 flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-lg font-semibold text-[var(--base-texto)]">Recuperação por canal e persona</h2>
				<select aria-label="Período da recuperação" value={dias} onChange={e => setDias(Number(e.target.value))}
					className="h-9 rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] px-3 text-sm text-[var(--base-texto)]">
					{PERIODOS_RECUPERACAO.map(p => <option key={p} value={p}>Últimos {p} dias</option>)}
				</select>
			</div>
			<p className="mb-6 text-xs text-[var(--base-texto-2)]">
				Pelo dia da ação. O acordo conta para o último toque com CPC nos 7 dias antes de ele chegar ao MotorCX; pagamento que chega depois atualiza o dia da ação.
				Taxas só com 30 ações ou mais no grupo.
			</p>
			{erro ? <Notice>{erro}</Notice> : linhas == null ? <Loading /> : !linhas.length ? <Empty>Ainda não há resultado publicado para o período.</Empty> : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[960px] text-left text-xs">
						<thead>
							<tr className="border-b border-[var(--base-borda)] text-[var(--base-texto-2)]">
								<th className="pb-3 font-semibold">Canal</th>
								<th className="pb-3 font-semibold">Persona</th>
								<th className="pb-3 pr-3 text-right font-semibold">Ações</th>
								<th className="pb-3 pr-3 text-right font-semibold">CPC</th>
								<th className="pb-3 pr-3 text-right font-semibold">Taxa de CPC</th>
								<th className="pb-3 pr-3 text-right font-semibold">Acordos</th>
								<th className="pb-3 pr-3 text-right font-semibold">Pagamentos</th>
								<th className="pb-3 pr-3 text-right font-semibold">Valor pago</th>
								<th className="pb-3 pr-3 text-right font-semibold">Custo</th>
								<th className="pb-3 text-right font-semibold">Recuperado por R$ 1</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--base-borda)] text-[var(--base-texto)]">
							{linhas.map(l => (
								<tr key={`${l.canal}|${l.persona}`} className="hover:bg-[var(--base-fill)]">
									<td className="py-3 font-semibold">{l.canal ? (NOME_CANAL_RECUPERACAO[l.canal] ?? l.canal) : 'Sem ação do motor'}</td>
									<td className="py-3">{l.persona || 'Sem persona'}</td>
									<td className="py-3 pr-3 text-right">{nf(l.acoes)}</td>
									<td className="py-3 pr-3 text-right">{nf(l.cpcs)}</td>
									<td className="py-3 pr-3 text-right">{pc(l.taxa_cpc)}</td>
									<td className="py-3 pr-3 text-right">{nf(l.acordos)}</td>
									<td className="py-3 pr-3 text-right">{nf(l.pagamentos)}</td>
									<td className="py-3 pr-3 text-right">{rs(l.valor_pago)}</td>
									<td className="py-3 pr-3 text-right">{rs(l.custo)}</td>
									<td className="py-3 text-right font-semibold">{l.recuperado_por_real == null ? '—' : rs(l.recuperado_por_real)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
