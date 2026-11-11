// Roleplay › Evolução (SQL 121, evolucao_treino): a evolução do treino da empresa, de uma equipe (?eq=) ou de uma pessoa
// (na página da pessoa), no período (?d=30|90|180).
// - Linha do tempo da nota: treino × ligações reais por semana (as reais pelo ID do discador de quem está no escopo),
//   com "Ver como tabela".
// - Mapa por item: % de "sim" no treino e nas ligações reais lado a lado, na régua das faixas (90/80/70), itens
//   treinados primeiro; na leitura da empresa, também por equipe. "Ver como tabela".
// - Pessoa: a linha do tempo de cada item nas sessões (sim / não / não se aplicou), da mais antiga para a mais nova.
// - Concordância IA × Qualidade (itens revisados em "Revisar avaliação").
// Sem ranking: nenhuma lista de pessoas por nota; equipe e empresa só agregadas. A nota de treino não entra na
// monitoria (só aparece ao lado da nota das ligações). Filtros na URL com replace (não enchem o histórico).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Cartao, Estado, Kpis, Pilula, Segmentos } from '@/components/ds';
import { friendlyError, supabase } from '@/lib/supabase';
import { nf } from '@/lib/speech';
import { GRAVIDADE_RP, rotaSessaoRP, type EquipeRP, type ItemChecklistRP } from '@/lib/roleplay';
import {
	PERIODOS_EVOLUCAO, faixaPct, linhaTempoItens, mapaEquipes, mapaItens, periodoValido, seriesNotas, textoComparacao, textoConcordancia,
	type EvolucaoRP,
} from '@/lib/roleplay-evolucao';
import { COR_HUMANO, COR_IA, Legenda, LinhaSemanas, TabelaSemanas } from '../graficos';
import { LinkRP, MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { lerEquipes, lerItensChecklist } from './dados';
import type { PodeRP } from './index';

export async function lerEvolucao(empresa: number, x: { equipe?: number | null; operador?: number | null; dias: number }): Promise<EvolucaoRP> {
	const { data, error } = await supabase!.rpc('evolucao_treino', { empresa, equipe: x.equipe ?? null, operador: x.operador ?? null, dias: x.dias });
	if (error) throw new Error(friendlyError(error));
	return data as EvolucaoRP;
}

const num = (v: string | null) => (v && /^\d{1,18}$/.test(v) ? Number(v) : null);

export function Evolucao({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const [q, setQ] = useSearchParams();
	const eq = num(q.get('eq'));
	const dias = periodoValido(q.get('d'));
	const [e, setE] = useState<EvolucaoRP | null>(null);
	const [equipes, setEquipes] = useState<EquipeRP[]>([]);
	const [itens, setItens] = useState<Record<string, ItemChecklistRP>>({});
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase || !pode.treinar) return;
		let ativo = true;
		setE(null); setErro('');
		Promise.all([lerEvolucao(empresa, { equipe: eq, dias }), lerEquipes(supabase, empresa), lerItensChecklist(supabase, empresa)])
			.then(([x, q2, i]) => { if (ativo) { setE(x); setEquipes(q2); setItens(i); } })
			.catch(err => { if (ativo) setErro(err instanceof Error ? err.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, eq, dias, pode.treinar]);
	const trocar = (k: 'eq' | 'd', v: string | null) => setQ(p => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n; }, { replace: true, preventScrollReset: true });
	return (
		<MolduraRP titulo="Evolução" descricao="Como o treino evolui por item e como isso aparece nas ligações reais. Sem ranking: equipe e empresa só no agregado." acoes={<SeloLgpdTreino />}>
			{!pode.treinar ? <Estado tipo="semPermissao" titulo="Seu perfil não vê a evolução do treino.">Quem tem a permissão de treinar operadores acompanha a evolução. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado>
				: erro ? <Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado>
				: (
					<div className="space-y-4">
						<div className="flex flex-wrap items-center gap-3">
							<label className="inline-flex items-center gap-2 text-[13px]">
								<span className="text-[var(--base-texto-2)]">Equipe</span>
								<select className="h-9 rounded-lg bg-[var(--base-cartao)] px-2 text-[13px]" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }} value={eq ?? ''}
									onChange={ev => trocar('eq', ev.target.value || null)}>
									<option value="">Todas as equipes</option>
									{equipes.filter(x => x.ativo || x.id === eq).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
								</select>
							</label>
							<Segmentos rotulo="Período" valor={String(dias)} onTrocar={v => trocar('d', v === '90' ? null : v)} itens={PERIODOS_EVOLUCAO.map(p => ({ v: String(p.d), n: p.nome }))} />
						</div>
						{!e ? <Estado tipo="carregando" /> : <EvolucaoView e={e} itens={itens} equipes={equipes} />}
					</div>
				)}
		</MolduraRP>
	);
}

/** A Evolução com os dados já lidos (sem banco: é o que os testes renderizam). */
export function EvolucaoView({ e, itens, equipes, comoTabela = false }: { e: EvolucaoRP; itens: Record<string, ItemChecklistRP>; equipes: { id: number; nome: string }[]; comoTabela?: boolean }) {
	const s = seriesNotas(e);
	const sessoes = e.treino_notas.reduce((n, x) => n + x.sessoes, 0);
	const naMeta = e.treino_notas.reduce((n, x) => n + x.na_meta, 0);
	const ligacoes = e.real_notas.reduce((n, x) => n + x.ligacoes, 0);
	const media = (xs: { nota: number | null }[], peso: (x: never) => number) => {
		let soma = 0, n = 0;
		for (const x of xs) if (x.nota != null) { const p = peso(x as never); soma += Number(x.nota) * p; n += p; }
		return n ? Math.round(soma / n) : null;
	};
	const notaTreino = media(e.treino_notas, (x: { sessoes: number }) => x.sessoes);
	const notaReal = media(e.real_notas, (x: { ligacoes: number }) => x.ligacoes);
	const conc = textoConcordancia(e.concordancia);
	const vazio = sessoes === 0 && ligacoes === 0;
	return (
		<div className="space-y-4">
			<Kpis itens={[
				{ rotulo: 'Sessões de treino avaliadas', valor: nf(sessoes), detalhe: sessoes ? `${naMeta} chegaram na meta` : 'nenhuma no período' },
				{ rotulo: 'Nota média no treino', valor: notaTreino == null ? '—' : nf(notaTreino), detalhe: 'não entra na monitoria' },
				{ rotulo: 'Nota média nas ligações', valor: notaReal == null ? '—' : nf(notaReal), detalhe: e.com_ligacoes ? `${nf(ligacoes)} ligações de ${e.com_ligacoes} ${e.com_ligacoes === 1 ? 'pessoa' : 'pessoas'} com ID do discador` : 'ninguém com ID do discador' },
				{ rotulo: 'Concordância IA × Qualidade', valor: conc.valor, detalhe: conc.detalhe },
			]} />
			{vazio ? <Estado tipo="vazio" titulo="Ainda sem dados no período.">A evolução aparece quando houver sessões de treino avaliadas ou ligações avaliadas de quem tem o ID do discador.</Estado> : <>
				<LinhaDoTempo x={s.rotulos} treino={s.treino} real={s.real} comoTabela={comoTabela} />
				<MapaItens e={e} itens={itens} comoTabela={comoTabela} />
				{e.escopo === 'empresa' && (e.por_equipe?.length ?? 0) > 0 && <MapaEquipes e={e} itens={itens} equipes={equipes} comoTabela={comoTabela} />}
				{e.escopo === 'pessoa' && (e.sessoes?.length ?? 0) > 0 && <LinhaTempoItens e={e} itens={itens} />}
			</>}
		</div>
	);
}

function AlternarTabela({ tabela, onTrocar }: { tabela: boolean; onTrocar: () => void }) {
	return <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)] hover:underline" aria-pressed={tabela} onClick={onTrocar}>{tabela ? 'Ver como gráfico' : 'Ver como tabela'}</button>;
}

function LinhaDoTempo({ x, treino, real, comoTabela }: { x: string[]; treino: (number | null)[]; real: (number | null)[]; comoTabela: boolean }) {
	const [tabela, setTabela] = useState(comoTabela);
	const series = [{ nome: 'Treino', cor: COR_IA, valores: treino }, { nome: 'Ligações reais', cor: COR_HUMANO, valores: real }];
	return (
		<Cartao titulo="Linha do tempo da nota" linha="Nota média por semana, no treino e nas ligações reais (meta de referência: 75)." direita={<AlternarTabela tabela={tabela} onTrocar={() => setTabela(v => !v)} />}>
			{tabela ? <TabelaSemanas x={x} series={series} fmt={v => nf(v)} />
				: <><Legenda itens={series.map(z => ({ nome: z.nome, cor: z.cor, linha: true }))} /><LinhaSemanas x={x} series={series} min={0} max={100} ticks={[0, 25, 50, 75, 100]} meta={75} fmt={v => nf(v)} rotulo="Nota média por semana: treino e ligações reais" /></>}
		</Cartao>
	);
}

function CelulaPct({ v, n }: { v: number | null; n: number }) {
	if (v == null) return <span className="text-[var(--base-texto-3)]" title={n ? `${n} avaliações` : 'sem avaliações'}>{n ? 'poucas' : '—'}</span>;
	const f = faixaPct(v);
	return <span className="inline-flex min-w-[52px] justify-center rounded-md px-1.5 py-0.5 font-semibold tnum" title={`${f.nome} · ${n} avaliações`}
		style={{ backgroundColor: `color-mix(in srgb, var(--destaque) ${Math.round(f.tom * 0.35)}%, transparent)` }}>{v}%</span>;
}

function MapaItens({ e, itens, comoTabela }: { e: EvolucaoRP; itens: Record<string, ItemChecklistRP>; comoTabela: boolean }) {
	const [tabela, setTabela] = useState(comoTabela);
	const linhas = mapaItens(e, itens);
	return (
		<Cartao titulo="Mapa por item" linha="% de “sim” em cada item do checklist, no treino e nas ligações reais. Os itens treinados vêm primeiro." direita={<AlternarTabela tabela={tabela} onTrocar={() => setTabela(v => !v)} />}>
			{linhas.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Sem itens avaliados no período.</p> : tabela ? (
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-[12.5px]">
						<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]"><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5 text-right">Treino</th><th className="px-2 py-1.5 text-right">Avaliações</th><th className="px-2 py-1.5 text-right">Ligações reais</th><th className="px-2 py-1.5 text-right">Avaliações</th></tr></thead>
						<tbody>{linhas.map(l => <tr key={l.item} className="border-t" style={{ borderColor: 'var(--base-borda)' }}><td className="px-2 py-1.5">{l.texto}</td><td className="px-2 py-1.5 text-right tnum">{l.treino == null ? '—' : `${l.treino}%`}</td><td className="px-2 py-1.5 text-right tnum">{l.nTreino}</td><td className="px-2 py-1.5 text-right tnum">{l.real == null ? '—' : `${l.real}%`}</td><td className="px-2 py-1.5 text-right tnum">{l.nReal}</td></tr>)}</tbody>
					</table>
				</div>
			) : (
				<ul className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
					{linhas.map(l => (
						<li key={l.item} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1 py-2 text-[13px]" style={{ borderColor: 'var(--base-borda)' }}>
							<span className="min-w-0">
								<span className="flex flex-wrap items-center gap-1.5">{l.texto}{l.gravidade === 'bloqueante' && <Pilula tom="erro">{GRAVIDADE_RP.bloqueante}</Pilula>}{l.treinado && <Pilula tom="info">Treinado</Pilula>}</span>
								<small className="block text-[12px] text-[var(--base-texto-3)]">{textoComparacao(l)}</small>
							</span>
							<span className="text-center"><small className="block text-[10.5px] uppercase text-[var(--base-texto-3)]">Treino</small><CelulaPct v={l.treino} n={l.nTreino} /></span>
							<span className="text-center"><small className="block text-[10.5px] uppercase text-[var(--base-texto-3)]">Ligações</small><CelulaPct v={l.real} n={l.nReal} /></span>
						</li>
					))}
				</ul>
			)}
		</Cartao>
	);
}

function MapaEquipes({ e, itens, equipes, comoTabela }: { e: EvolucaoRP; itens: Record<string, ItemChecklistRP>; equipes: { id: number; nome: string }[]; comoTabela: boolean }) {
	const [tabela, setTabela] = useState(comoTabela);
	const m = mapaEquipes(e, equipes, itens);
	return (
		<Cartao titulo="Mapa por item e equipe" linha="% de “sim” no treino, por equipe. Só agregado: nenhuma nota por pessoa." direita={<AlternarTabela tabela={tabela} onTrocar={() => setTabela(v => !v)} />}>
			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-[12.5px]">
					<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]"><th className="px-2 py-1.5">Item</th>{m.equipes.map(q => <th key={q.id} className="px-2 py-1.5 text-center">{q.nome}</th>)}</tr></thead>
					<tbody>{m.linhas.map(l => (
						<tr key={l.item} className="border-t" style={{ borderColor: 'var(--base-borda)' }}>
							<td className="px-2 py-1.5">{l.texto}</td>
							{l.celulas.map((c, i) => <td key={i} className="px-2 py-1.5 text-center tnum">{tabela ? (c.pct == null ? '—' : `${c.pct}% (${c.n})`) : <CelulaPct v={c.pct} n={c.n} />}</td>)}
						</tr>
					))}</tbody>
				</table>
			</div>
		</Cartao>
	);
}

const MARCA: Record<string, { s: string; t: string; cor: string }> = {
	sim: { s: '●', t: 'sim', cor: 'var(--estado-ok-texto, var(--destaque))' },
	nao: { s: '○', t: 'não', cor: 'var(--estado-erro-texto)' },
	na: { s: '–', t: 'não se aplicou', cor: 'var(--base-texto-3)' },
};

function LinhaTempoItens({ e, itens }: { e: EvolucaoRP; itens: Record<string, ItemChecklistRP> }) {
	const lt = linhaTempoItens(e, itens);
	return (
		<Cartao titulo="Linha do tempo por item" linha="Cada coluna é uma sessão avaliada, da mais antiga para a mais nova. ● sim · ○ não · – não se aplicou (com a revisão da Qualidade).">
			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-[12.5px]">
					<thead>
						<tr className="text-[11px] text-[var(--base-texto-3)]">
							<th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Item</th>
							{lt.sessoes.map(s => <th key={s.id} className="px-1.5 py-1.5 text-center font-normal">{s.atribuicao != null ? <LinkRP to={rotaSessaoRP(s.atribuicao, s.id)} className="hover:underline" title={s.cenario ?? undefined}>{s.data}</LinkRP> : s.data}<span className="block tnum">{s.nota == null ? '' : nf(s.nota)}</span></th>)}
						</tr>
					</thead>
					<tbody>{lt.linhas.map(l => (
						<tr key={l.item} className="border-t" style={{ borderColor: 'var(--base-borda)' }}>
							<td className="px-2 py-1.5">{l.texto}</td>
							{l.respostas.map((r, i) => <td key={i} className="px-1.5 py-1.5 text-center" style={{ color: r ? MARCA[r].cor : undefined }}>{r ? <><span aria-hidden="true">{MARCA[r].s}</span><span className="sr-only">{MARCA[r].t}</span></> : ''}</td>)}
						</tr>
					))}</tbody>
				</table>
			</div>
		</Cartao>
	);
}

/** Na página da pessoa: a evolução dela (treino × ligações reais, mapa por item e linha do tempo por item). */
export function EvolucaoPessoa({ empresa, operador, itens }: { empresa: number; operador: number; itens?: Record<string, ItemChecklistRP> }) {
	const [e, setE] = useState<EvolucaoRP | null>(null);
	const [its, setIts] = useState<Record<string, ItemChecklistRP>>(itens ?? {});
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		Promise.all([lerEvolucao(empresa, { operador, dias: 90 }), itens ? Promise.resolve(itens) : lerItensChecklist(supabase, empresa)])
			.then(([x, i]) => { if (ativo) { setE(x); setIts(i); } }).catch(err => { if (ativo) setErro(err instanceof Error ? err.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, operador]);
	return (
		<section aria-labelledby="t-evolucao" className="space-y-2">
			<h2 id="t-evolucao" className="text-[15px] font-semibold text-[var(--base-texto)]">Evolução nos últimos 90 dias</h2>
			{erro ? <Estado tipo="erro" titulo="Não deu para carregar a evolução agora.">{erro}</Estado> : !e ? <Estado tipo="carregando" /> : <EvolucaoView e={e} itens={its} equipes={[]} />}
		</section>
	);
}
