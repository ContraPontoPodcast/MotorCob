// Cobrança › Estratégia › Discagem › Resubmit (SQL 65; protótipo aprovado em 01/11/2026).
// Volta automática ao mailing, no mesmo dia, de quem não teve contato. Nunca passa da régua: vale o maior entre
// "depois de" e o intervalo da renitência, e o máximo é cortado pelas tentativas por número (ou por cliente).
// Prévia com o dia de ontem: sem_contato_dia_voz() e a taxa da 2ª passada de contato_por_passada() (só contagens).
import { useEffect, useState, type ReactNode } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase } from '@/lib/supabase';
import type { Discagem } from '@/lib/discagem';
import {
	FALHAS, NOME, PADRAO, PRIORIDADES, SITUACOES, efetivo, linhaAlterada, mudarCampo, notasResubmit, resubmitEfetivo,
	voltarLinha, type DiscagemRen, type Prioridade,
} from '@/lib/renitencia';
import { Toggle } from './discagem-campos';
import { Cel, Nota, Num, SecaoTitulo, Sel, TagLinha, Travado, Un, type AbaRenProps } from './renitencia-situacao';

const GRADE = 'xl:grid-cols-[minmax(0,1.5fr)_70px_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.95fr)_minmax(0,1fr)_92px_118px]';
const linhaCls = 'grid grid-cols-2 items-center gap-x-3 gap-y-2.5 border-b px-3.5 py-3 last:border-b-0 sm:grid-cols-3';
const nf = (n: number) => Math.round(n).toLocaleString('pt-BR');

function Hora({ valor, onChange, disabled, rotulo }: { valor: string; onChange: (v: string) => void; disabled?: boolean; rotulo: string }) {
	return (
		<input type="time" min="08:00" max="20:00" value={valor} aria-label={rotulo} disabled={disabled}
			onChange={e => { const v = e.target.value || '19:00'; onChange(v > '20:00' ? '20:00' : v < '08:00' ? '08:00' : v); }}
			className="h-8 w-[112px] rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
			style={{ borderColor: 'var(--base-field-border, var(--base-borda))' }} />
	);
}

type Ontem = { situacao: string; numeros: number };

export function Resubmit({ draft, setDraft, canEdit }: AbaRenProps) {
	const { empresa, credor } = useMotorAuth();
	const d = draft as DiscagemRen;
	const e = efetivo(d);
	const ligado = e.res != null;
	const [ontem, setOntem] = useState<Ontem[] | null>(null);
	const [taxa2, setTaxa2] = useState<number | null>(null);

	useEffect(() => {
		if (!supabase || !empresa || !credor) return;
		let ativo = true;
		const hoje = new Date();
		const ont = new Date(hoje.getTime() - 86_400_000).toISOString().slice(0, 10);
		const de = new Date(hoje.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
		void Promise.all([
			supabase.rpc('sem_contato_dia_voz', { empresa: empresa.id, credor: Number(credor.id), dia: ont }),
			supabase.rpc('contato_por_passada', { empresa: empresa.id, credor: Number(credor.id), de, ate: ont, situacao: null }),
		]).then(([s, p]) => {
			if (!ativo) return;
			setOntem(((s.data ?? []) as Ontem[]).map(x => ({ situacao: x.situacao, numeros: Number(x.numeros) })));
			const p2 = ((p.data ?? []) as { passada: number; taxa: number | null }[]).find(x => x.passada === 2);
			setTaxa2(p2?.taxa != null ? Number(p2.taxa) : null);
		});
		return () => { ativo = false; };
	}, [empresa?.id, credor?.id]);

	const campo = (k: string, c: string, v: unknown) => setDraft(mudarCampo(d, 'resubmit', k, c, v) as Discagem);

	const linha = (k: string, nome: string, chaves: string) => {
		const r = e.res?.[k] ?? PADRAO.resubmit[k];
		const ef = resubmitEfetivo(e, k);
		const travado = k === 'retorno_agendado' || k === 'numero_incorreto';
		const ativo = ligado && r.ativo && !travado;
		const dis = !canEdit || !ligado;
		let volta: ReactNode, dep: ReactNode, max: ReactNode, pri: ReactNode, lim: ReactNode;
		if (k === 'retorno_agendado') {
			volta = <Cel rotulo="Volta"><Travado>Sim</Travado></Cel>;
			dep = <Cel rotulo="Depois de" nota="retorno agendado (Renitência)"><span>No horário pedido</span></Cel>;
			max = <Cel rotulo="Máx. no dia"><span>1</span></Cel>;
			pri = <Cel rotulo="Prioridade"><span>Topo</span></Cel>;
			lim = <Cel rotulo="Horário limite"><span>Janela UF/DDD</span></Cel>;
		} else if (k === 'numero_incorreto') {
			volta = <Cel rotulo="Volta"><Travado title="A renitência tira o número da voz">Não</Travado></Cel>;
			dep = <Cel rotulo="Depois de" nota="só em outro número"><Num valor={r.depois_minutos} min={0} max={600} rotulo="Depois de, minutos" disabled={dis} onChange={v => campo(k, 'depois_minutos', v)} /><Un>min</Un></Cel>;
			max = <Cel rotulo="Máx. no dia"><span>1</span></Cel>;
			pri = <Cel rotulo="Prioridade"><Sel valor={r.prioridade} opcoes={PRIORIDADES} rotulo="Prioridade na volta" disabled={dis} onChange={v => campo(k, 'prioridade', v as Prioridade)} /></Cel>;
			lim = <Cel rotulo="Horário limite"><Hora valor={r.ate} rotulo="Horário limite" disabled={dis} onChange={v => campo(k, 'ate', v)} /></Cel>;
		} else {
			volta = <Cel rotulo="Volta ao mailing"><Toggle checked={ligado && r.ativo} disabled={dis} label="Volta ao mailing" onChange={v => campo(k, 'ativo', v)} /></Cel>;
			dep = <Cel rotulo="Depois de" nota={ativo && ef.efDep !== r.depois_minutos ? <span className="text-[var(--estado-atencao-texto)]">vale {ef.efDep} min</span> : undefined}><Num valor={r.depois_minutos} min={0} max={600} rotulo="Depois de, minutos" disabled={dis} onChange={v => campo(k, 'depois_minutos', v)} /><Un>min</Un></Cel>;
			max = <Cel rotulo="Máx. no dia" nota={ativo && ef.efMax !== r.max_dia ? <span className="text-[var(--estado-atencao-texto)]">cabe {ef.efMax}</span> : undefined}><Num valor={r.max_dia} min={1} max={9} rotulo="Máximo de resubmits no dia" disabled={dis} onChange={v => campo(k, 'max_dia', v)} /></Cel>;
			pri = <Cel rotulo="Prioridade"><Sel valor={r.prioridade} opcoes={PRIORIDADES} rotulo="Prioridade na volta" disabled={dis} onChange={v => campo(k, 'prioridade', v as Prioridade)} /></Cel>;
			lim = <Cel rotulo="Horário limite" nota="e a janela UF/DDD"><Hora valor={r.ate} rotulo="Horário limite" disabled={dis} onChange={v => campo(k, 'ate', v)} /></Cel>;
		}
		const outro = k === 'retorno_agendado' ? <Cel rotulo="Outro número"><span>Não</span></Cel>
			: <Cel rotulo="Outro número"><Toggle checked={r.outro_numero} disabled={dis} label="Tenta outro número do cliente" onChange={v => campo(k, 'outro_numero', v)} /><span>{r.outro_numero ? 'Sim' : 'Não'}</span></Cel>;
		const notas = notasResubmit(e, k);
		return (
			<div key={k} className={`${linhaCls} ${GRADE}`} style={{ borderColor: 'var(--base-borda)', background: !ativo && !travado ? 'repeating-linear-gradient(135deg, transparent 0 6px, var(--base-fill) 6px 12px)' : undefined }}>
				<div className="col-span-2 min-w-0 sm:col-span-3 xl:col-span-1">
					<b className="block text-[13.5px] text-[var(--base-texto)]">{nome}</b>
					<code className="block break-words text-[11px] text-[var(--base-texto-3)]">{chaves}</code>
				</div>
				{volta}{dep}{max}{pri}{lim}{outro}
				{k === 'retorno_agendado' ? <div className="col-span-2 xl:col-span-1" /> : <TagLinha alterado={linhaAlterada(d, 'resubmit', k)} onVoltar={() => setDraft(voltarLinha(d, 'resubmit', k) as Discagem)} nome={nome} canEdit={canEdit && ligado} />}
				{notas.map((n, i) => (
					<p key={i} className="col-span-full flex gap-1.5 text-[12px]" style={{ color: n.tom === 'info' ? 'var(--estado-info)' : 'var(--estado-atencao-texto)' }}>{n.tom === 'info' ? 'i' : '!'} · {n.texto}</p>
				))}
			</div>
		);
	};
	const cab = (
		<div className={`hidden gap-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] xl:grid ${GRADE}`} style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)' }}>
			<span>Situação</span><span>Volta</span><span>Depois de</span><span>Máx. no dia</span><span>Prioridade</span><span>Horário limite</span><span>Outro número</span><span />
		</div>
	);

	// prévia com o dia de ontem: voltariam = sem contato nas situações ligadas que ainda cabem na régua
	const efPrev = ligado ? e : efetivo({ ...d, resubmit: {} });
	const linhasPv = (ontem ?? []).map(o => {
		const r = efPrev.res![o.situacao];
		const ef = resubmitEfetivo(efPrev, o.situacao);
		const ativoK = r && (o.situacao === 'numero_incorreto' ? r.outro_numero : r.ativo) && (o.situacao === 'retorno_agendado' || ef.efMax > 0);
		const voltam = ativoK ? o.numeros : 0;
		return { ...o, voltam, contatos: taxa2 != null ? voltam * taxa2 / 100 : null };
	}).sort((a, b) => b.voltam - a.voltam);
	const totV = linhasPv.reduce((t, x) => t + x.voltam, 0), totSem = linhasPv.reduce((t, x) => t + x.numeros, 0);

	return (
		<div className="space-y-5">
			{!ligado ? (
				<Nota tom="atencao">
					<b className="block">Hoje esta carteira usa a retentativa de sempre: o número volta depois do intervalo da renitência, até as tentativas do dia, na ordem da lista.</b>
					O Resubmit decide a volta por situação. Sem ligar e salvar, nada muda.
					{canEdit && <div className="mt-2"><button type="button" onClick={() => setDraft({ ...draft, resubmit: {} })} className="inline-flex h-8 items-center rounded-full px-4 text-[12.5px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Usar o Resubmit nesta carteira</button></div>}
				</Nota>
			) : (
				<Nota tom="atencao">
					<b className="block">Resubmit ligado nesta carteira.</b>
					Sem salvar, vale a versão em uso. Para voltar à retentativa de sempre: {canEdit ? <button type="button" className="font-semibold underline" onClick={() => setDraft({ ...draft, resubmit: undefined })}>desligar o Resubmit</button> : 'peça a quem edita a carteira'}.
				</Nota>
			)}
			<Nota tom="info">
				<b className="block">O Resubmit nunca passa da régua.</b>
				Cada volta conta como tentativa do dia e respeita o máximo de tentativas, o intervalo e o descanso da renitência, a lista de “não ligar”, a promessa (se estiver ligada), a janela UF/DDD e o limite de chamadas curtas. Quando a regra daqui pede mais do que a régua deixa, a linha mostra o que vale.
			</Nota>
			<section>
				<SecaoTitulo titulo="As 8 situações" linha="Padrão ligado em Não atendeu, Ocupado, Máquina, Caixa postal e Desligou sem conversar." />
				<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>{cab}{SITUACOES.map(s => linha(s.k, s.n, s.chaves))}</div>
			</section>
			<section>
				<SecaoTitulo titulo="Falhas técnicas" linha="Não penalizam o número, mas a volta conta como tentativa do dia e entra nas curtas." />
				<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>{cab}{FALHAS.map(s => linha(s.k, s.n, s.chaves))}</div>
			</section>
			<section className="rounded-2xl border p-4" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
				<SecaoTitulo titulo="Prévia com o dia de ontem" linha={`${credor?.nome ?? ''} · estimativa com a taxa de contato da 2ª passada (Contato por passada).`} />
				{ontem === null ? <p className="text-[13px] text-[var(--base-texto-2)]">Carregando…</p> : ontem.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Sem ligações do agente virtual ontem nesta carteira.</p> : (
					<>
						<div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
							<div><div className="text-[12px] text-[var(--base-texto-2)]">Voltariam ao mailing</div><div className="text-[24px] font-bold tabular-nums">{nf(totV)}</div><div className="text-[12px] text-[var(--base-texto-2)]">no máximo, antes da conferência da VM</div></div>
							<div><div className="text-[12px] text-[var(--base-texto-2)]">Contatos a mais</div><div className="text-[24px] font-bold tabular-nums">{taxa2 != null ? nf(totV * taxa2 / 100) : '—'}</div><div className="text-[12px] text-[var(--base-texto-2)]">{taxa2 != null ? `taxa da 2ª passada: ${taxa2.toLocaleString('pt-BR')}%` : 'menos de 30 chamadas na 2ª passada'}</div></div>
							<div><div className="text-[12px] text-[var(--base-texto-2)]">Sem contato ontem</div><div className="text-[24px] font-bold tabular-nums">{nf(totSem)}</div><div className="text-[12px] text-[var(--base-texto-2)]">números, nas situações acima</div></div>
						</div>
						<div className="mt-3 overflow-x-auto">
							<table className="w-full min-w-[420px] border-collapse text-[13px]">
								<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]"><th className="py-2 pr-3">Situação</th><th className="py-2 pr-3 text-right">Sem contato</th><th className="py-2 pr-3 text-right">Voltariam</th><th className="py-2 text-right">Contatos estimados</th></tr></thead>
								<tbody>{linhasPv.map(l => (
									<tr key={l.situacao} className="border-t" style={{ borderColor: 'var(--base-borda)' }}>
										<td className="py-2 pr-3 font-semibold text-[var(--base-texto)]">{NOME[l.situacao] ?? l.situacao}</td>
										<td className="py-2 pr-3 text-right tabular-nums">{nf(l.numeros)}</td><td className="py-2 pr-3 text-right tabular-nums">{nf(l.voltam)}</td>
										<td className="py-2 text-right tabular-nums">{l.contatos != null ? nf(l.contatos) : '—'}</td>
									</tr>
								))}</tbody>
							</table>
						</div>
						<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Prévia, não promessa: a VM confere tudo de novo antes de cada onda. Passadas extras têm mais chamadas curtas; Contato por passada mostra se compensam.</p>
					</>
				)}
			</section>
		</div>
	);
}
