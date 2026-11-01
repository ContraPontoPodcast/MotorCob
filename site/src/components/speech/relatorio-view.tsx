// O relatório ao credor, igual para a assessoria e para o credor (link de leitura, sem login). Só agregados: o banco
// recusa qualquer grupo com menos de 30 e qualquer dado por cliente ou operador no conteúdo.
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { RESPOSTA_CREDOR, dc, mesExtenso, nf, pc } from '@/lib/speech';
import { Pilula } from '@/components/voz/ui';
import { BarraH, COR_HUMANO, COR_IA, FaixaEstimativa } from './graficos';

export type ConteudoRel = {
	resumo?: { conversas?: { n: number }; acordo_pct?: number | null; principal_barreira?: string | null; principal_barreira_pct?: number | null; contestam_pct?: number | null };
	secoes?: { id: string; titulo: string; itens: { rotulo: string; n: number; pct: number }[] }[];
	recomendacoes?: { id: string; titulo: string; evidencia?: string; n: number; unidade?: string; estimativa: { centro: number; min: number; max: number } }[];
};

export function RelatorioView({ competencia, credor, assessoria, conteudo, comentario, respostas, acaoResposta }: {
	competencia: string; credor: string; assessoria: string; conteudo: ConteudoRel; comentario?: string | null;
	respostas: Record<string, string>; acaoResposta?: (rec: string, valor: string | null) => ReactNode;
}) {
	const r = conteudo.resumo ?? {};
	const secoes = (conteudo.secoes ?? []).filter(s => s.itens.length > 0);
	return (
		<article className="overflow-hidden rounded-2xl bg-[var(--base-cartao)]" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
			<header className="px-5 py-5 sm:px-7" style={{ backgroundColor: 'var(--base-fill)' }}>
				<p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)]">Relatório ao credor · {mesExtenso(competencia)}</p>
				<h2 className="mt-1 text-[20px] font-bold leading-tight text-[var(--base-texto)]">O que os devedores do {credor} disseram</h2>
				<p className="mt-1 text-[13px] text-[var(--base-texto-2)]">{nf(r.conversas?.n)} conversas analisadas · preparado por {assessoria} com o MotorCX</p>
			</header>
			<div className="space-y-6 px-5 py-5 sm:px-7">
				<section>
					<h3 className="text-[15px] font-semibold">Resumo</h3>
					<div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
						{[[nf(r.conversas?.n), 'conversas analisadas, IA e operadores'], [pc(r.acordo_pct), 'viraram acordo'],
							[r.principal_barreira_pct != null ? `${dc(r.principal_barreira_pct, 0)}%` : '—', r.principal_barreira ? `das objeções: ${r.principal_barreira.toLowerCase()}` : 'sem barreira com 30 ou mais'],
							[r.contestam_pct != null ? `${dc(r.contestam_pct)}%` : '—', 'contestam a dívida, não a reconhecem ou alegam fraude']].map(([v, t]) => (
							<div key={t} className="rounded-xl bg-[var(--base-fill)] p-3"><b className="block text-[20px] tnum">{v}</b><span className="text-[12px] text-[var(--base-texto-2)]">{t}</span></div>
						))}
					</div>
				</section>
				{secoes.map((s, k) => (
					<section key={s.id}>
						<h3 className="text-[15px] font-semibold">{s.titulo}</h3>
						{s.id === 'vulnerabilidade' && <p className="text-[12px] text-[var(--base-texto-3)]">Só contagem. Nenhum caso individual, nenhum detalhe de saúde.</p>}
						<div className="mt-1">{s.itens.map(i => <BarraH key={i.rotulo} nome={i.rotulo} valor={i.pct} max={Math.max(1, ...s.itens.map(x => x.pct))} cor={k === 1 ? COR_HUMANO : COR_IA} detalhe={nf(i.n)} />)}</div>
					</section>
				))}
				<section>
					<h3 className="text-[15px] font-semibold">Recomendações de política</h3>
					<p className="text-[12px] text-[var(--base-texto-3)]">Estimativa conservadora: metade da diferença observada, com faixa de 25% a 75%. Não é promessa.</p>
					{(conteudo.recomendacoes ?? []).length === 0 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Sem recomendação com evidência suficiente neste mês.</p> : (conteudo.recomendacoes ?? []).map(p => (
						<div key={p.id} className="mt-3 rounded-xl border p-4" style={{ borderColor: 'var(--base-borda)' }}>
							<h4 className="text-[14px] font-semibold">{p.titulo}</h4>
							{p.evidencia && <p className="mt-1 text-[13px] leading-relaxed text-[var(--base-texto-2)]">{p.evidencia}</p>}
							<p className="mt-2 text-[13px]"><b className="text-[18px] tnum">+{nf(p.estimativa.centro)}</b> {p.unidade ?? ''} · faixa de {nf(p.estimativa.min)} a {nf(p.estimativa.max)}</p>
							<FaixaEstimativa {...p.estimativa} />
							<div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
								{acaoResposta ? acaoResposta(p.id, respostas[p.id] ?? null) : <><span className="text-[var(--base-texto-3)]">Resposta do credor:</span>{respostas[p.id] ? <Pilula tom={respostas[p.id] === 'testar' ? 'ok' : 'neutro'}>{RESPOSTA_CREDOR[respostas[p.id]]}</Pilula> : <Pilula>aguardando</Pilula>}</>}
							</div>
						</div>
					))}
				</section>
				{comentario && <section><h3 className="text-[15px] font-semibold">Comentário da assessoria</h3><p className="mt-1 text-[13px] leading-relaxed text-[var(--base-texto-2)]">{comentario}</p></section>}
				<p className="flex items-start gap-2 rounded-xl bg-[var(--base-fill)] px-3 py-2 text-[12px] text-[var(--base-texto-2)]"><ShieldCheck size={15} className="mt-0.5 shrink-0" />Só números agregados. Grupos com menos de 30 conversas não aparecem. Nenhum dado de cliente, nenhum trecho de conversa e nenhum operador identificado saem neste relatório.</p>
			</div>
		</article>
	);
}
