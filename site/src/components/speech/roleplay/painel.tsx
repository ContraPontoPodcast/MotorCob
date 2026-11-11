// Roleplay › Painel: indicadores, "Precisa de ação", sugestões de atribuição e treinos em andamento, tudo do banco
// (vazio de verdade enquanto não há treino atribuído). Cada item leva à página da pessoa, ao treino ou ao cenário.
// Sugestões (SQL 120, job noturno das notas e dos alertas do Speech, só contagens): "Ver a evidência" (as contagens que
// geraram e o atalho para a aba do Speech), "Atribuir treino" (pré-marca quem originou) e "Dispensar" com o motivo em
// 1 clique ("Já tratei no 1:1" ou "Não procede"), com "Desfazer". A de item crítico repetido também entra em
// "Precisa de ação".
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { Aviso, BotaoLink, Cartao, Estado, Kpis, LinkTexto, Pilula, Tabela } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { ROTA_TESTAR_PERSONAS, dataBR, diaSP, nf, rotaSA } from '@/lib/speech';
import {
	MOTIVO_DISPENSA, ROTA_RP_CADASTRO, ROTA_RP_CENARIOS, SITUACAO_TREINO, indicadoresPainel, precisaDeAcao, resumoTreino, rotaAtribuicaoRP, rotaAtribuir,
	rotaCenarioRP, rotaPessoaRP, textoSugestao,
	type AtribuicaoRP, type ItemAcao, type SugestaoRP,
} from '@/lib/roleplay';
import { LinkRP, MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { dispensarSugestao, lerPainel, type DadosPainel } from './dados';
import type { PodeRP } from './index';

export function Painel({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const { soSpeech } = useAreasLiberadas();
	const [d, setD] = useState<DadosPainel | null>(null);
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase || !pode.treinar) return;
		let ativo = true;
		setD(null); setErro('');
		lerPainel(supabase, empresa).then(x => { if (ativo) setD(x); }).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, pode.treinar]);

	return (
		<MolduraRP titulo="Roleplay" descricao="Treino de operadores com clientes simulados. A nota usa o mesmo checklist das ligações." acoes={<SeloLgpdTreino />}>
			{!pode.treinar
				? <Estado tipo="semPermissao" titulo="Seu perfil cuida só da biblioteca de cenários." acoes={<BotaoLink to={ROTA_RP_CENARIOS}>Ver os cenários</BotaoLink>}>
					Os treinos atribuídos, as pessoas e a evolução são vistos por quem tem a permissão de treinar operadores. Quem libera é o Admin, em Empresa › Pessoas e perfis.
				</Estado>
				: erro ? <Estado tipo="erro" titulo="Não deu para carregar o Painel agora.">{erro}</Estado>
				: !d ? <Estado tipo="carregando" />
				: <PainelView d={d} hoje={diaSP(0)} desde={diaSP(-29)} onDispensar={async (id, motivo) => {
					await dispensarSugestao(supabase!, id, motivo);
					setD(x => (x ? { ...x, sugestoes: motivo ? x.sugestoes.filter(z => z.id !== id) : x.sugestoes } : x));
				}} onDesfazer={async sg => {
					await dispensarSugestao(supabase!, sg.id, null);
					setD(x => (x ? { ...x, sugestoes: [sg, ...x.sugestoes.filter(z => z.id !== sg.id)] } : x));
				}} />}
			{!soSpeech && <p className="mt-6 text-[12.5px] text-[var(--base-texto-3)]">Procurando o teste do agente de IA? <Link className="font-semibold text-[var(--destaque)] hover:underline" to={ROTA_TESTAR_PERSONAS}>Agente Voz/CX › Testar com personas</Link>.</p>}
		</MolduraRP>
	);
}

function TextoAcao({ i }: { i: ItemAcao }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5 last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
			<p className="min-w-0 flex-[1_1_320px] text-[13.5px] text-[var(--base-texto)]">{i.texto}</p>
			<span className="flex flex-wrap gap-3">
				{i.atribuicao_id != null && <LinkRP to={rotaAtribuicaoRP(i.atribuicao_id)} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Ver o treino</LinkRP>}
				{i.operador_id != null && <LinkRP to={rotaPessoaRP(i.operador_id)} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Ver a pessoa</LinkRP>}
				{i.sugestao_id != null && <LinkRP to={rotaAtribuir({ sug: i.sugestao_id })} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Atribuir treino</LinkRP>}
			</span>
		</div>
	);
}

/** Uma sugestão: título em linguagem de monitoria, quem, evidência (só contagens), Atribuir e Dispensar com motivo. */
export function CartaoSugestao({ s, d, onDispensar, aberto = false }: {
	s: SugestaoRP; d: Pick<DadosPainel, 'operadores' | 'equipes' | 'itens' | 'cenarios'>; onDispensar?: (motivo: 'tratado' | 'falso_positivo') => void; aberto?: boolean;
}) {
	const [ver, setVer] = useState(aberto);
	const [dispensando, setDispensando] = useState(false);
	const t = textoSugestao(s, d);
	const cen = d.cenarios.find(c => c.id === s.cenario_id)?.nome ?? null;
	const idEv = `ev-sug-${s.id}`;
	return (
		<article className="rounded-xl bg-[var(--base-fill)] px-3.5 py-3" aria-label={t.titulo}>
			<p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-[var(--base-texto)]">{t.titulo}{t.prioridade === 'alta' && <Pilula tom="erro">Prioridade alta</Pilula>}</p>
			<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">{t.quem} · desde {dataBR(s.criado_em)}{cen ? <> · cenário sugerido: <Link className="font-semibold text-[var(--destaque)] hover:underline" to={rotaCenarioRP(s.cenario_id!)}>{cen}</Link></> : ' · sem cenário com esse foco: escolha ao atribuir'}</p>
			{ver && (
				<div id={idEv} className="mt-2 rounded-lg bg-[var(--base-cartao)] px-3 py-2 text-[12.5px]">
					<p className="font-semibold">De onde veio</p>
					<ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--base-texto-2)]">{t.evidencia.map((x, i) => <li key={i}>{x}</li>)}</ul>
					<p className="mt-1.5 text-[var(--base-texto-3)]">Só contagens das ligações avaliadas: nenhum trecho, cliente ou gravação entra na sugestão nem no cenário. <Link className="font-semibold text-[var(--destaque)] hover:underline" to={rotaSA(t.aba)}>Abrir Speech › {t.aba === 'alertas' ? 'Alertas' : t.aba === 'operadores' ? 'Operadores' : 'Qualidade'}</Link></p>
				</div>
			)}
			<div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
				<LinkRP to={rotaAtribuir({ sug: s.id })} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Atribuir treino</LinkRP>
				<button type="button" className="text-[13px] font-semibold text-[var(--destaque)] hover:underline" aria-expanded={ver} aria-controls={idEv} onClick={() => setVer(v => !v)}>{ver ? 'Esconder a evidência' : 'Ver a evidência'}</button>
				{onDispensar && (!dispensando
					? <button type="button" className="text-[13px] font-semibold text-[var(--base-texto-2)] hover:underline" onClick={() => setDispensando(true)}>Dispensar</button>
					: <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Por que dispensar?">
						<span className="text-[12.5px] text-[var(--base-texto-2)]">Por quê?</span>
						{(['tratado', 'falso_positivo'] as const).map(m => <button key={m} type="button" className="rounded-full bg-[var(--base-cartao)] px-2.5 py-1 text-[12.5px] font-semibold hover:underline" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }} onClick={() => { setDispensando(false); onDispensar(m); }}>{MOTIVO_DISPENSA[m]}</button>)}
						<button type="button" className="text-[12.5px] text-[var(--base-texto-3)] hover:underline" onClick={() => setDispensando(false)}>Cancelar</button>
					</span>)}
			</div>
		</article>
	);
}

/** O Painel com os dados já lidos (sem banco: é o que os testes renderizam). */
export function PainelView({ d, hoje, desde, agora, onDispensar, onDesfazer }: {
	d: DadosPainel; hoje: string; desde: string; agora?: Date;
	onDispensar?: (id: number, motivo: 'tratado' | 'falso_positivo') => Promise<void>; onDesfazer?: (s: SugestaoRP) => Promise<void>;
}) {
	const [todas, setTodas] = useState(false);
	const acoes = precisaDeAcao({ ...d, hoje, agora });
	const dispensar = (sg: SugestaoRP, motivo: 'tratado' | 'falso_positivo') => {
		if (!onDispensar) return;
		onDispensar(sg.id, motivo).then(() => {
			toast.success(`Sugestão dispensada (${MOTIVO_DISPENSA[motivo].toLowerCase()}). Ela não volta por 30 dias.`, onDesfazer ? {
				action: { label: 'Desfazer', onClick: () => { void onDesfazer(sg).then(() => toast.success('Sugestão de volta.')).catch(e => toast.error(e instanceof Error ? e.message : 'Não deu para desfazer.')); } },
			} : undefined);
		}).catch(e => toast.error(e instanceof Error ? e.message : 'Não deu para dispensar agora.'));
	};
	const k = indicadoresPainel(d.atribuicoes, d.pessoas, d.sessoes, hoje, desde);
	const abertas = d.atribuicoes.filter(a => resumoTreino(a, d.pessoas, hoje).situacao !== 'concluido');
	const nomeCen = (id: number | null) => d.cenarios.find(c => c.id === id)?.nome ?? null;
	const ordenadas = [...d.sugestoes].sort((a, b) => Number(b.regra === 'item_critico_operador') - Number(a.regra === 'item_critico_operador'));
	const sugs = todas ? ordenadas : ordenadas.slice(0, 2);
	const semCadastro = d.operadores.filter(o => o.so_treino || o.equipe_id != null).length === 0;

	return (
		<div className="space-y-4">
			{semCadastro && <Aviso tom="info" titulo="Comece pelo Cadastro para treino." acao={<LinkTexto to={ROTA_RP_CADASTRO}>Abrir o cadastro</LinkTexto>}>Cadastre as equipes e quem vai treinar (apelido e, se quiser, o ID do discador).</Aviso>}
			<Kpis itens={[
				{ rotulo: 'Treinos em andamento', valor: nf(k.emAndamento), detalhe: k.treinosAbertos ? `${k.emAndamento === 1 ? 'pessoa' : 'pessoas'} em ${k.treinosAbertos} ${k.treinosAbertos === 1 ? 'treino' : 'treinos'}` : 'nenhum treino aberto' },
				{ rotulo: 'Chegaram na meta', valor: k.pctMeta == null ? '—' : `${k.pctMeta}%`, detalhe: k.avaliadas ? `${k.naMeta} de ${k.avaliadas} em 30 dias` : 'sem treino atribuído em 30 dias' },
				{ rotulo: 'Nota média no treino', valor: k.notaMedia == null ? '—' : nf(k.notaMedia), detalhe: k.sessoes ? `${k.sessoes} ${k.sessoes === 1 ? 'sessão' : 'sessões'} em 30 dias` : 'sem sessões em 30 dias' },
				{ rotulo: 'Minutos de voz no mês', valor: d.uso ? nf(d.uso.minutos_voz) : '—', detalhe: d.uso ? (d.uso.voz_bloqueada ? `de ${nf(d.uso.franquia_voz)} · esgotado, só texto` : `de ${nf(d.uso.franquia_voz)} do plano`) : undefined, tom: d.uso?.voz_bloqueada ? 'atencao' : undefined },
			]} />

			<Cartao titulo="Precisa de ação" linha={acoes.length ? `${acoes.length} ${acoes.length === 1 ? 'item' : 'itens'} · o mais urgente primeiro` : undefined}>
				{acoes.length === 0
					? <p className="text-[13px] text-[var(--base-texto-2)]">Nada pendente: ninguém esgotou as tentativas, nenhum item crítico com “não”, nenhum prazo vencido e nenhum link faltando.</p>
					: <div>{acoes.map((i, n) => <TextoAcao key={n} i={i} />)}</div>}
			</Cartao>

			<Cartao titulo="Sugestões de atribuição" linha="Das notas e dos alertas do Speech, toda manhã. Só contagens, nunca trecho de ligação.">
				{d.sugestoes.length === 0
					? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma sugestão aberta. Elas aparecem a partir das notas e dos alertas das ligações.</p>
					: <div className="space-y-2">
						{sugs.map(s => <CartaoSugestao key={s.id} s={s} d={d} onDispensar={onDispensar ? m => dispensar(s, m) : undefined} />)}
						{d.sugestoes.length > 2 && <button type="button" className="text-[13px] font-semibold text-[var(--destaque)] hover:underline" aria-expanded={todas} onClick={() => setTodas(x => !x)}>{todas ? 'Mostrar menos' : `Ver todas (${d.sugestoes.length})`}</button>}
					</div>}
			</Cartao>

			<Cartao titulo="Treinos em andamento" semPadding>
				<div className="px-4 pb-4 sm:px-5">
					<Tabela<AtribuicaoRP> rotulo="Treinos em andamento" linhas={abertas} chave={a => a.id}
						vazio="Nenhum treino atribuído em andamento. Os treinos atribuídos aparecem aqui com o prazo e quem já chegou na meta."
						colunas={[
							{ id: 'cen', titulo: 'Cenário', celula: a => <LinkRP className="font-semibold hover:underline" to={rotaAtribuicaoRP(a.id)}>{nomeCen(a.cenario_id) ?? 'Cenário'}</LinkRP> },
							{ id: 'prazo', titulo: 'Prazo', num: true, celula: a => dataBR(a.prazo) },
							{ id: 'meta', titulo: 'Chegaram na meta', num: true, celula: a => { const r = resumoTreino(a, d.pessoas, hoje); return `${r.naMeta} de ${r.pessoas}`; } },
							{ id: 'nota', titulo: 'Nota média', num: true, celula: a => { const r = resumoTreino(a, d.pessoas, hoje); return r.media == null ? '—' : `${r.media} (meta ${a.nota_minima})`; } },
							{ id: 'sit', titulo: 'Situação', celula: a => { const s = SITUACAO_TREINO[resumoTreino(a, d.pessoas, hoje).situacao]; return <Pilula tom={s.tom}>{s.nome}</Pilula>; } },
						]}
						celular={a => { const r = resumoTreino(a, d.pessoas, hoje); const s = SITUACAO_TREINO[r.situacao]; return { titulo: nomeCen(a.cenario_id) ?? 'Cenário', valor: <Pilula tom={s.tom}>{s.nome}</Pilula>, resumo: <span>Prazo {dataBR(a.prazo)} · {r.naMeta} de {r.pessoas} na meta</span> }; }} />
				</div>
			</Cartao>
		</div>
	);
}
