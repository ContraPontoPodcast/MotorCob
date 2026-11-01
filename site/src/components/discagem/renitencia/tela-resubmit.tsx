// Cobrança › Estratégia › Discagem › Resubmit (tela 2 do redesign aprovado): prévia com o dia de ontem pela regra
// em edição (sem_contato_dia_voz + taxa de contato da 2ª passada de Contato por passada) e a reciclagem automática
// editável. Só contagens. As rediscagens por sinalização ficam na Renitência; Reenviar e Reciclar, no lote.
import { useEffect, useState } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError } from '@/lib/supabase';
import type { Discagem } from '@/lib/discagem';
import {
	EXCLUSOES, NOME, SITUACOES_RENITENCIA, TRAVADAS, efetivo, mudarRec, previaOntem, recDaCarteira,
	type DiscagemRen, type SemContatoDia,
} from '@/lib/renitencia';
import { Chip, Hora, Kpi, Nota, Num, Ponto, Secao, SecaoTitulo, Toggle, Travado, borda, nf, pc } from './pecas';

type Props = { draft: Discagem; salvo: Record<string, unknown> | null; setDraft: (d: Discagem) => void; canEdit: boolean; irSinal: () => void };
const diaISO = (dias: number) => new Date(Date.now() - dias * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export function TelaResubmit({ draft, salvo, setDraft, canEdit, irSinal }: Props) {
	const { empresa, credor } = useMotorAuth();
	const [sem, setSem] = useState<SemContatoDia[] | null>(null);
	const [base, setBase] = useState(0);
	const [taxas, setTaxas] = useState<Record<string, number | null>>({});
	const [geral, setGeral] = useState<{ t2: number | null; c1: number | null; c2: number | null }>({ t2: null, c1: null, c2: null });
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !empresa || !credor) return;
		const sb = supabase;
		let ativo = true;
		const ontem = diaISO(1), de = diaISO(30);
		setSem(null);
		const porSit = SITUACOES_RENITENCIA.map(s => sb.rpc('contato_por_passada', { empresa: empresa.id, credor: Number(credor.id), de, ate: ontem, situacao: s }));
		void Promise.all([
			sb.rpc('sem_contato_dia_voz', { empresa: empresa.id, credor: Number(credor.id), dia: ontem }),
			sb.rpc('contato_por_passada', { empresa: empresa.id, credor: Number(credor.id), de, ate: ontem, situacao: null }),
			...porSit,
		]).then(([s, g, ...ps]) => {
			if (!ativo) return;
			if (s.error) { setErro(friendlyError(s.error)); setSem([]); return; }
			const linhas = (s.data ?? []) as { situacao: string; numeros: number; chamadas: number }[];
			setSem(linhas.map(x => ({ situacao: x.situacao, numeros: Number(x.numeros) })));
			setBase(Number(linhas[0]?.chamadas ?? 0));
			const p = (rows: unknown, n: number) => ((rows ?? []) as { passada: number; taxa: number | null; curtas_pct: number | null }[]).find(r => Number(r.passada) === n);
			const gp1 = p(g.data, 1), gp2 = p(g.data, 2);
			setGeral({ t2: gp2?.taxa != null ? Number(gp2.taxa) : null, c1: gp1?.curtas_pct != null ? Number(gp1.curtas_pct) : null, c2: gp2?.curtas_pct != null ? Number(gp2.curtas_pct) : null });
			setTaxas(Object.fromEntries(SITUACOES_RENITENCIA.map((k, i) => { const r = p(ps[i]?.data, 2); return [k, r?.taxa != null ? Number(r.taxa) : null]; })));
			setErro('');
		});
		return () => { ativo = false; };
	}, [empresa?.id, credor?.id]);

	const d = draft as DiscagemRen;
	const e = efetivo(d);
	const pv = sem ? previaOntem(sem, d, taxas, geral.t2) : null;
	const curtAntes = geral.c1, curtDepois = pv && geral.c1 != null ? (base * geral.c1 + pv.voltam * (geral.c2 ?? geral.c1)) / Math.max(1, base + pv.voltam) : null;

	const R = recDaCarteira(d), Rs = recDaCarteira((salvo ?? {}) as DiscagemRen);
	const recSujo = JSON.stringify(R) !== JSON.stringify(Rs);
	const setRec = (patch: Parameters<typeof mudarRec>[1]) => setDraft(mudarRec(d, patch) as Discagem);
	const dis = !canEdit;

	return (
		<div className="space-y-5">
			<Nota tom="info">
				<b className="block">As regras de rediscagem por sinalização ficam na Renitência.</b>
				Finaliza, rediscar, depois e horário limite estão na Regra de discagem por sinalização. Reenviar agora e Reciclar mailing ficam no lote.
				<span className="mt-1.5 block"><button type="button" onClick={irSinal} className="text-[13px] font-semibold text-[var(--estado-info)]">Abrir Regra de discagem por sinalização →</button></span>
			</Nota>

			<Secao>
				<SecaoTitulo titulo="Prévia com o dia de ontem" linha={`${credor?.nome ?? ''} · pela regra em edição e a taxa de contato da 2ª passada (Contato por passada).`}
					direita={<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--base-texto-2)]">estimativa</span>} />
				{erro && <Nota tom="atencao">{erro}</Nota>}
				{!pv ? <p className="text-[13px] text-[var(--base-texto-2)]">Carregando…</p> : pv.semContato === 0 ? (
					<Nota tom="info"><b className="block">Ontem não houve ligação sem contato nesta carteira.</b>A prévia aparece no dia seguinte às primeiras ligações do agente virtual.</Nota>
				) : <>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
						<Kpi rotulo="Voltariam ao mailing" valor={nf(pv.voltam)} detalhe={`hoje: ${nf(pv.hojeVoltam)} (retentativa de hoje)`} />
						<Kpi rotulo="Contatos a mais" valor={nf(pv.contatos)} detalhe={`${pv.contatos >= pv.hojeContatos ? '+' : ''}${nf(pv.contatos - pv.hojeContatos)} em relação à regra de hoje`} />
						<Kpi rotulo="Sem contato ontem" valor={nf(pv.semContato)} detalhe="números nas sinalizações da regra" />
						<Kpi rotulo="Chamadas curtas previstas" valor={curtDepois != null ? pc(curtDepois) : '—'} alerta={(curtDepois ?? 0) >= 75}
							detalhe={curtAntes != null ? `hoje ${pc(curtAntes)} · aviso 75% · MP 85%` : 'sem histórico de curtas ainda'} />
					</div>
					<div className="mt-3 overflow-x-auto">
						<table className="w-full min-w-[420px] border-collapse text-[13px]">
							<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]">{['Situação', 'Sem contato ontem', 'Voltariam', 'Contatos estimados'].map((h, i) => <th key={h} className={`py-2 pr-3 ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
							<tbody>{pv.linhas.length ? pv.linhas.map(l => (
								<tr key={l.k} className="border-t" style={borda}>
									<td className="py-2 pr-3 text-[var(--base-texto)]">{NOME[l.k] ?? l.k}</td><td className="py-2 pr-3 text-right tabular-nums">{nf(l.semContato)}</td>
									<td className="py-2 pr-3 text-right tabular-nums">{nf(l.voltam)}</td><td className="py-2 text-right tabular-nums">{nf(l.contatos)}</td>
								</tr>
							)) : <tr><td colSpan={4} className="py-2">Nenhuma situação volta ao mailing.</td></tr>}</tbody>
						</table>
					</div>
					<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Prévia, não promessa: a VM confere tudo de novo antes de cada onda.</p>
				</>}
			</Secao>

			<Secao>
				<SecaoTitulo titulo={<>Reciclagem automática{recSujo && <Ponto />}</>} linha="Limpa os estágios do lote e disca o mesmo mailing de novo, do começo. Desligada por padrão."
					direita={<label className="inline-flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]"><Toggle checked={R.ativo} disabled={dis} label="Reciclagem automática" onChange={v => setRec({ ativo: v })} />{R.ativo ? 'Ligada' : 'Desligada'}</label>} />
				{R.ativo ? <div className="space-y-3">
					<p className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-[var(--base-texto)]">
						<span>Às</span><Hora valor={R.hora} rotulo="Horário da reciclagem" disabled={dis} onChange={v => v && setRec({ hora: v })} />
						<span>, se o lote terminou a passada com</span><Num valor={R.sem_contato_pct} min={10} max={100} largura={56} rotulo="Sem contato a partir de, por cento" disabled={dis} onChange={v => setRec({ sem_contato_pct: v })} /><span>% ou mais sem contato, recicla.</span>
					</p>
					<div>
						<span className="text-[11.5px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Ficam de fora</span>
						<div role="group" aria-label="Ficam de fora" className="mt-1.5 flex flex-wrap gap-1.5">
							{EXCLUSOES.map(x => x.k === 'promessa' && e.promessa
								? <Chip key={x.k} ativo travado title="A promessa já suspende ligações nesta carteira">{x.n}</Chip>
								: <Chip key={x.k} ativo={R.excluir.includes(x.k)} title={x.t} onClick={() => !dis && setRec({ excluir: R.excluir.includes(x.k) ? R.excluir.filter(y => y !== x.k) : [...R.excluir, x.k] })}>{x.n}</Chip>)}
							{TRAVADAS.map(x => <Chip key={x.k} ativo travado title={x.t}>{x.n}</Chip>)}
						</div>
						{!e.promessa && <p className="mt-1.5 text-[11.5px] text-[var(--base-texto-3)]">Promessa: a carteira não suspende por promessa; marque para deixar quem prometeu de fora. Retorno agendado de fora mantém o horário pedido.</p>}
					</div>
					<ul className="space-y-1 text-[12.5px] text-[var(--base-texto-2)]">
						<li><Travado>Nunca zera: “não ligar”, número inexistente, limite de chamadas curtas da MP 1.396/2026 e janela UF/DDD.</Travado></li>
						<li><Travado>Sempre mantém o limite de hoje por cliente. Recomeçar a contagem só à mão, no lote, com a permissão “Reciclar lote”.</Travado></li>
						<li><Travado>Uma por lote por dia; fica no histórico do lote como “Automática”.</Travado></li>
					</ul>
				</div> : <p className="text-[13px] text-[var(--base-texto-2)]">Ligada, a VM confere no horário escolhido quanto do lote ficou sem contato e, acima do percentual, recicla sozinha. Também dá para reciclar à mão no lote.</p>}
			</Secao>
		</div>
	);
}
