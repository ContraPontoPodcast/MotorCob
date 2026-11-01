// Cobrança › Estratégia › Discagem › Regra por sinalização (SQL 65; protótipo funcional aprovado em 01/11/2026).
// Só leitura até o redesign aprovado: mostra o que vale na carteira (credores.discagem › por_sinalizacao,
// modo_discagem e reciclagem_auto) ou, sem a regra, o padrão sugerido e o que a VM faz hoje. Quem grava é sempre
// salvar_discagem (discagem.tsx), com versão e auditoria.
import { DEPOIS, PADRAO, PRIORIDADES, SINALIZACOES, efetivo, type DiscagemRen, type RegraSinal } from '@/lib/renitencia';
import type { Discagem } from '@/lib/discagem';
import { Cel, Nota, SecaoTitulo, Travado, Un } from './renitencia-situacao';

const GRADE = 'xl:grid-cols-[minmax(0,1.5fr)_90px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,.8fr)]';
const linhaCls = 'grid grid-cols-2 items-center gap-x-3 gap-y-2.5 border-b px-3.5 py-3 last:border-b-0 sm:grid-cols-3';
const FIXAS: Record<string, string> = {
	retorno_agendado: 'pediu retorno finaliza (vale o agendamento)',
	numero_inexistente: 'inexistente não redisca', pessoa_errada: 'pessoa errada não redisca',
};

export function RegraSinalizacao({ draft }: { draft: Discagem }) {
	const e = efetivo(draft as DiscagemRen);
	const vale = e.sinal != null;
	const regras: Record<string, RegraSinal> = e.sinal ?? PADRAO.por_sinalizacao;
	const modo = (draft as DiscagemRen).modo_discagem as Record<string, unknown> | null | undefined;
	const rec = (draft as DiscagemRen).reciclagem_auto as Record<string, unknown> | null | undefined;
	return (
		<div className="space-y-5">
			<Nota tom={vale ? 'info' : 'atencao'}>
				<b className="block">{vale ? 'A regra por sinalização vale nesta carteira.' : 'Esta carteira ainda usa a retentativa de hoje: o número volta depois do intervalo, até as tentativas do dia, na ordem da lista.'}</b>
				{vale ? 'Abaixo, o que a VM faz depois de cada tentativa.' : 'Abaixo, o padrão sugerido que passa a valer quando a regra for salva (com 3 tentativas por número).'} A edição desta regra, do modo de discagem e da reciclagem automática chega com a nova tela; o que estiver salvo continua valendo.
			</Nota>
			<section>
				<SecaoTitulo titulo="Modo de discagem" />
				<p className="text-[13px] text-[var(--base-texto-2)]">
					{!modo ? 'O de hoje: um telefone de voz por cliente no dia, na ordem da lista.'
						: modo.modo === 'vertical' ? `Vertical: até ${String(modo.max_telefones_dia ?? 1)} telefones por cliente antes do próximo cliente.`
						: `Horizontal: ${String((modo.spins as Record<string, unknown> | undefined)?.quantidade ?? 3)} spins no dia, spin N no telefone N, com ${String((modo.spins as Record<string, unknown> | undefined)?.intervalo_min ?? 120)} min entre spins.`}
					{' '}Reciclagem automática: {rec?.ativo ? `ligada às ${String(rec.hora ?? '16:00')}, com ${String(rec.sem_contato_pct ?? 60)}% ou mais sem contato.` : 'desligada.'}
				</p>
			</section>
			<section>
				<SecaoTitulo titulo="O que acontece depois de cada tentativa" linha="1) finaliza o cliente? 2) senão, redisca o mesmo telefone; 3) esgotadas as rediscagens, o “depois”. CPC, promessa, recusa e “não ligar” sempre finalizam; sem crédito e bloqueio de originação pausam a rota e alertam a equipe." />
				<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
					<div className={`hidden gap-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] xl:grid ${GRADE}`} style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)' }}>
						<span>Sinalização</span><span>Finaliza</span><span>Rediscar o mesmo telefone</span><span>Prioridade</span><span>Depois</span><span>Até</span>
					</div>
					{SINALIZACOES.map(s => {
						const r = regras[s.k];
						if (!r) return null;
						return (
							<div key={s.k} className={`${linhaCls} ${GRADE}`} style={{ borderColor: 'var(--base-borda)' }}>
								<div className="col-span-2 min-w-0 sm:col-span-3 xl:col-span-1"><b className="block text-[13.5px] text-[var(--base-texto)]">{s.n}</b>{FIXAS[s.k] && <small className="block text-[11.5px] text-[var(--base-texto-3)]">{FIXAS[s.k]}</small>}</div>
								<Cel rotulo="Finaliza">{FIXAS[s.k] && s.k === 'retorno_agendado' ? <Travado>Sim</Travado> : <span>{r.finaliza ? 'Sim' : 'Não'}</span>}</Cel>
								<Cel rotulo="Rediscar o mesmo telefone">{r.finaliza ? <span>—</span> : r.rediscar.ativo ? <><span className="tabular-nums">{r.rediscar.depois_min}</span><Un>min · até {r.rediscar.max}×</Un></> : <span>Não</span>}</Cel>
								<Cel rotulo="Prioridade"><span>{r.finaliza || !r.rediscar.ativo ? '—' : PRIORIDADES[r.rediscar.prioridade]}</span></Cel>
								<Cel rotulo="Depois"><span>{r.finaliza ? 'Finaliza' : DEPOIS[r.depois.acao]}{!r.finaliza && r.depois.acao === 'proximo_telefone' && r.depois.espera_min ? ` (espera ${r.depois.espera_min} min)` : ''}</span></Cel>
								<Cel rotulo="Até"><span className="tabular-nums">{r.ate}</span></Cel>
							</div>
						);
					})}
				</div>
				<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Os limites sempre cortam: tentativas por número e por cliente, descanso, “não ligar”, promessa (se ligada), a janela UF/DDD e as chamadas curtas.</p>
			</section>
		</div>
	);
}
