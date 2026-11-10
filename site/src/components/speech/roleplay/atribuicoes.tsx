// Roleplay › Treinos atribuídos: a lista (?sit=andamento|prazo_vencido|concluido) e o treino (/atribuicoes/:id), com a
// situação de cada pessoa (a mesma conta de situacao_treino_operador), o link pessoal de treino (gerar, copiar, QR,
// revogar), o lembrete copiável (não guardamos contato do operador), +1 tentativa, estender o prazo e o feedback 1:1.
// Os painéis entram no histórico (?painel=link-<op> | links | lembrete | lembrete-<op> | prazo | feedback-<op>): o ⟵ e o
// Esc fecham. O token do link aparece só quando é gerado (o banco guarda o sha-256): fica na memória desta tela.
// RPCs do SQL 90: gerar_link_treino, revogar_link_treino, liberar_tentativa_treino, estender_prazo_treino,
// salvar_feedback_treino. O "Treino lado a lado" e o "Ver sessão" chegam com a sessão por texto.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Copy, Printer, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { Aviso, Botao, Cartao, Estado, Gaveta, Kpis, Pilula, Segmentos, Tabela, campoCls, campoStyle, clsBotao, textareaCls } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { dataBR, dataHoraBR, diaSP, nf, textoTemDadoPessoal } from '@/lib/speech';
import {
	ROTA_RP_ATRIBUIR, SITUACAO_PESSOA, SITUACAO_TREINO, estadoLink, resumoFeedback, resumoTreino, rotaAtribuicaoRP, rotaAtribuir, rotaCenarioRP,
	rotaPessoaRP, situacaoPessoa, textoLembrete, textoModos, ultimaAvaliada, urlTreino,
	type OperadorRP, type PessoaNoTreino, type ResumoTreino, type SituacaoPessoa,
} from '@/lib/roleplay';
import { LinkRP, MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { usePainelUrl } from './cadastro';
import {
	estenderPrazo, gerarLink, lerAtribuicao, lerAtribuicoes, liberarTentativa, revogarLink, salvarFeedback,
	type AtribuicaoCompleta, type DadosAtribuicao, type DadosAtribuicoes,
} from './dados';
import type { PodeRP } from './index';

async function copiar(texto: string, ok = 'Copiado.') {
	try { await navigator.clipboard.writeText(texto); toast.success(ok); } catch { toast.error('Não deu para copiar. Selecione o texto e copie.'); }
}
const origem = () => (typeof window === 'undefined' ? '' : window.location.origin);

// ------------------------------------------------------------------ lista
const FILTROS_SIT = [{ v: 'todas', n: 'Todos' }, { v: 'andamento', n: 'Em andamento' }, { v: 'prazo_vencido', n: 'Prazo vencido' }, { v: 'concluido', n: 'Concluídos' }] as const;
type FiltroSit = (typeof FILTROS_SIT)[number]['v'];
export const filtroSit = (v: string | null): FiltroSit => (FILTROS_SIT.find(x => x.v === v)?.v ?? 'todas') as FiltroSit;

export function Atribuicoes({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const [q, setQ] = useSearchParams();
	const [d, setD] = useState<DadosAtribuicoes | null>(null);
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase || !pode.treinar) return;
		let ativo = true;
		lerAtribuicoes(supabase, empresa).then(x => { if (ativo) setD(x); }).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, pode.treinar]);
	const f = filtroSit(q.get('sit'));
	const trocar = (v: FiltroSit) => setQ(p => { const n = new URLSearchParams(p); if (v === 'todas') n.delete('sit'); else n.set('sit', v); return n; }, { replace: true, preventScrollReset: true });
	return (
		<MolduraRP titulo="Treinos atribuídos" descricao="Cada treino passado a uma pessoa ou equipe, com prazo e meta."
			acoes={<><SeloLgpdTreino />{pode.treinar && <LinkRP to={ROTA_RP_ATRIBUIR} className={clsBotao('primario')}>Atribuir treino</LinkRP>}</>}>
			{!pode.treinar ? <Estado tipo="semPermissao" titulo="Seu perfil não vê os treinos atribuídos.">Quem tem a permissão de treinar operadores atribui e acompanha os treinos. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado>
				: erro ? <Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado>
				: !d ? <Estado tipo="carregando" />
				: <ListaAtribuicoes d={d} filtro={f} hoje={diaSP(0)} onFiltro={trocar} />}
		</MolduraRP>
	);
}

export function ListaAtribuicoes({ d, filtro, hoje, onFiltro }: { d: DadosAtribuicoes; filtro: FiltroSit; hoje: string; onFiltro: (v: FiltroSit) => void }) {
	const linhas = d.atribuicoes.map(a => ({ a, r: resumoTreino(a, d.pessoas, hoje) }))
		.filter(x => filtro === 'todas' || x.r.situacao === filtro);
	const nomeCen = (id: number) => d.cenarios.find(c => c.id === id)?.nome ?? 'Cenário';
	const para = (a: AtribuicaoCompleta) => {
		const nomes = d.pessoas.filter(p => p.atribuicao_id === a.id).map(p => d.operadores.find(o => o.id === p.operador_id)?.apelido ?? 'Pessoa');
		return nomes.length > 3 ? `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}` : nomes.join(', ');
	};
	const sit = (r: ResumoTreino) => <Pilula tom={SITUACAO_TREINO[r.situacao].tom}>{SITUACAO_TREINO[r.situacao].nome}</Pilula>;
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Segmentos rotulo="Filtrar por situação" valor={filtro} onTrocar={onFiltro} itens={FILTROS_SIT.map(x => ({ v: x.v, n: x.n }))} />
				<span className="text-[12.5px] text-[var(--base-texto-3)]" aria-live="polite">{linhas.length} {linhas.length === 1 ? 'treino' : 'treinos'}</span>
			</div>
			<Cartao semPadding><div className="p-4 sm:px-5">
				<Tabela<(typeof linhas)[number]> rotulo="Treinos atribuídos" linhas={linhas} chave={x => x.a.id}
					vazio={d.atribuicoes.length ? 'Nenhum treino nesta situação.' : 'Nenhum treino atribuído ainda. Use “Atribuir treino” para passar um cenário a pessoas ou equipes.'}
					colunas={[
						{ id: 'cen', titulo: 'Cenário', celula: x => <LinkRP to={rotaAtribuicaoRP(x.a.id)} className="font-semibold hover:underline">{nomeCen(x.a.cenario_id)}</LinkRP> },
						{ id: 'para', titulo: 'Para', celula: x => para(x.a) },
						{ id: 'prazo', titulo: 'Prazo', num: true, celula: x => dataBR(x.a.prazo) },
						{ id: 'meta', titulo: 'Chegaram na meta', num: true, celula: x => `${x.r.naMeta} de ${x.r.pessoas}` },
						{ id: 'sit', titulo: 'Situação', celula: x => sit(x.r) },
					]}
					celular={x => ({ titulo: <LinkRP to={rotaAtribuicaoRP(x.a.id)} className="font-semibold hover:underline">{nomeCen(x.a.cenario_id)}</LinkRP>, valor: sit(x.r), resumo: <span>Prazo {dataBR(x.a.prazo)} · {x.r.naMeta} de {x.r.pessoas} na meta</span> })} />
			</div></Cartao>
		</div>
	);
}

// ------------------------------------------------------------------ o treino
type Token = { token: string; valido_ate: string };

export function DetalheAtribuicao({ empresa, id, pode }: { empresa: number; id: string; pode: PodeRP }) {
	const num = /^\d{1,18}$/.test(id) ? Number(id) : null;
	const [q] = useSearchParams();
	const [d, setD] = useState<DadosAtribuicao | null>(null);
	const [erro, setErro] = useState('');
	const [versao, setVersao] = useState(0);
	const [tokens, setTokens] = useState<Record<number, Token>>({});
	const { painel, abrir, fechar } = usePainelUrl();
	const recarregar = () => setVersao(v => v + 1);

	useEffect(() => {
		if (!supabase || !pode.treinar) return;
		let ativo = true;
		setErro('');
		if (num == null) { setD({ atribuicao: null, cenario: null, pessoas: [], operadores: [], equipes: [], sessoes: [], links: [], ultimoAcesso: {}, feedbacks: [] }); return; }
		lerAtribuicao(supabase, empresa, num).then(x => { if (ativo) setD(x); }).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, num, pode.treinar, versao]);

	async function gerar(ops: number[]) {
		if (!supabase) return;
		const novos: Record<number, Token> = {};
		for (const op of ops) {
			try { novos[op] = await gerarLink(supabase, op); } catch (e) { toast.error(e instanceof Error ? e.message : 'Não deu para gerar o link.'); }
		}
		if (Object.keys(novos).length) {
			setTokens(t => ({ ...t, ...novos }));
			toast.success(Object.keys(novos).length === 1 ? 'Link gerado. Copie agora: ele só aparece nesta tela.' : `${Object.keys(novos).length} links gerados. Copie agora: eles só aparecem nesta tela.`);
			recarregar();
		}
	}
	async function revogar(op: number) {
		if (!supabase) return;
		try {
			await revogarLink(supabase, op);
			setTokens(t => { const n = { ...t }; delete n[op]; return n; });
			toast.success('Link revogado: ele não abre mais. Uma sessão aberta por ele para na hora.');
			recarregar();
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Não deu para revogar.'); }
	}
	async function maisUma(op: number) {
		if (!supabase || !d?.atribuicao) return;
		try { await liberarTentativa(supabase, d.atribuicao.id, op); toast.success('Mais uma tentativa liberada.'); recarregar(); }
		catch (e) { toast.error(e instanceof Error ? e.message : 'Não deu para liberar.'); }
	}

	if (!pode.treinar) return <MolduraRP titulo="Treino"><Estado tipo="semPermissao" titulo="Seu perfil não vê os treinos atribuídos.">Quem tem a permissão de treinar operadores acompanha os treinos. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado></MolduraRP>;
	if (erro) return <MolduraRP titulo="Treino"><Estado tipo="erro" titulo="Não deu para carregar o treino agora.">{erro}</Estado></MolduraRP>;
	if (!d) return <MolduraRP titulo="Treino"><Estado tipo="carregando" /></MolduraRP>;
	if (!d.atribuicao) return <MolduraRP titulo="Treino não encontrado"><Estado tipo="vazio" titulo="Treino não encontrado.">O endereço pode estar desatualizado.</Estado></MolduraRP>;

	const a = d.atribuicao;
	const nome = d.cenario?.nome ?? 'Treino';
	const hoje = diaSP(0);
	const linhas = linhasPessoas(d, hoje);
	const pendentes = linhas.filter(l => l.s !== 'aprovado');
	const opDe = (op: number) => d.operadores.find(o => o.id === op);
	const painelOp = (pref: string) => (painel?.startsWith(pref) ? Number(painel.slice(pref.length)) : null);
	const opLink = painelOp('link-'), opLembrete = painelOp('lembrete-'), opFeedback = painelOp('feedback-');
	const r = resumoTreino(a, d.pessoas, hoje);
	const acoes = (
		<>
			<SeloLgpdTreino />
			<Pilula tom={SITUACAO_TREINO[r.situacao].tom}>{SITUACAO_TREINO[r.situacao].nome}</Pilula>
			{pendentes.length > 0 && <Botao tipo="secundario" onClick={() => abrir('lembrete')}>Copiar lembrete para {pendentes.length === 1 ? '1 pendente' : `os ${pendentes.length} pendentes`}</Botao>}
			<Botao tipo="secundario" onClick={() => abrir('links')}>Links da turma</Botao>
			<Botao tipo="secundario" onClick={() => abrir('prazo')}>Estender prazo</Botao>
		</>
	);
	const lembrete = (op: number) => {
		const o = opDe(op);
		const l = linhas.find(x => x.p.operador_id === op);
		const resta = l && a.tentativas != null ? Math.max(0, a.tentativas + l.p.tentativas_extra - l.p.tentativas_usadas) : null;
		return textoLembrete({ apelido: o?.apelido ?? 'Pessoa', cenario: nome, prazo: a.prazo, meta: a.nota_minima,
			tentativas: resta == null ? null : `${resta} ${resta === 1 ? 'tentativa' : 'tentativas'}`, url: tokens[op] ? urlTreino(origem(), tokens[op].token) : null });
	};
	return (
		<MolduraRP titulo={nome} detalhe={nome} acoes={acoes}
			descricao={`Para ${d.pessoas.length} ${d.pessoas.length === 1 ? 'pessoa' : 'pessoas'} · prazo ${dataBR(a.prazo)} · meta ${a.nota_minima} · ${a.tentativas == null ? 'sem limite de tentativas' : `${a.tentativas} ${a.tentativas === 1 ? 'tentativa' : 'tentativas'}`} · ${textoModos(a.modos).toLowerCase()}`}>
			<CorpoAtribuicao d={d} hoje={hoje} criada={q.get('criada') === '1'} tokens={tokens} onAbrir={abrir} onMaisUma={maisUma} />

			<Gaveta aberta={opLink != null} onFechar={fechar} titulo={`Link de treino de ${opDe(opLink ?? -1)?.apelido ?? 'pessoa'}`} subtitulo="O link abre só os treinos desta pessoa, sem o menu do MotorCX.">
				{opLink != null && <PainelLink op={opLink} apelido={opDe(opLink)?.apelido ?? 'Pessoa'} d={d} token={tokens[opLink] ?? null} onGerar={() => gerar([opLink])} onRevogar={() => revogar(opLink)} />}
			</Gaveta>
			<Gaveta aberta={painel === 'links'} onFechar={fechar} titulo="Links da turma" subtitulo="Copie todos de uma vez ou imprima os QR codes para entregar.">
				<PainelLinksTurma d={d} tokens={tokens} nome={nome} onGerar={gerar} />
			</Gaveta>
			<Gaveta aberta={painel === 'lembrete' || opLembrete != null} onFechar={fechar} titulo={opLembrete != null ? `Lembrete para ${opDe(opLembrete)?.apelido ?? 'pessoa'}` : 'Lembrete para os pendentes'}
				subtitulo="Texto pronto para o canal interno de vocês. O MotorCX não guarda o contato do operador.">
				<PainelLembrete itens={(opLembrete != null ? [opLembrete] : pendentes.map(l => l.p.operador_id)).map(op => ({ op, apelido: opDe(op)?.apelido ?? 'Pessoa', texto: lembrete(op), temLink: !!tokens[op] }))} />
			</Gaveta>
			<Gaveta aberta={painel === 'prazo'} onFechar={fechar} titulo="Estender prazo" subtitulo={`Prazo atual: ${dataBR(a.prazo)}. Os links ativos passam a valer até o novo prazo + 1 dia.`}>
				<PainelPrazo atual={a.prazo} hoje={hoje} onSalvar={async p => { if (!supabase) return; await estenderPrazo(supabase, a.id, p); toast.success(`Prazo estendido para ${dataBR(p)}.`); recarregar(); fechar(); }} />
			</Gaveta>
			<Gaveta aberta={opFeedback != null} onFechar={fechar} titulo={`Feedback 1:1 com ${opDe(opFeedback ?? -1)?.apelido ?? 'pessoa'}`} subtitulo="O que foi combinado e a próxima conversa. Fica no histórico da pessoa.">
				{opFeedback != null && <PainelFeedback apelido={opDe(opFeedback)?.apelido ?? 'Pessoa'} cenario={nome}
					onSalvar={async (combinado, proxima) => { if (!supabase) return; await salvarFeedback(supabase, empresa, { operador: opFeedback, combinado, proxima_conversa: proxima, atribuicao: a.id }); toast.success('Feedback registrado.'); recarregar(); }} />}
			</Gaveta>
		</MolduraRP>
	);
}

type LinhaPessoa = { p: PessoaNoTreino; o: OperadorRP | undefined; s: SituacaoPessoa };
export function linhasPessoas(d: Pick<DadosAtribuicao, 'atribuicao' | 'pessoas' | 'operadores' | 'sessoes'>, hoje: string): LinhaPessoa[] {
	const a = d.atribuicao!;
	return d.pessoas.map(p => ({ p, o: d.operadores.find(o => o.id === p.operador_id), s: situacaoPessoa(a, p, ultimaAvaliada(d.sessoes, a.id, p.operador_id), hoje) }))
		.sort((x, y) => ORDEM_SIT.indexOf(x.s) - ORDEM_SIT.indexOf(y.s) || (x.o?.apelido ?? '').localeCompare(y.o?.apelido ?? '', 'pt-BR'));
}
const ORDEM_SIT: SituacaoPessoa[] = ['precisa_apoio', 'item_critico', 'prazo_vencido', 'abaixo_meta', 'em_andamento', 'nao_comecou', 'aprovado'];

/** O corpo do treino com os dados já lidos (sem banco: é o que os testes renderizam). */
export function CorpoAtribuicao({ d, hoje, criada, tokens, onAbrir, onMaisUma, agora }: {
	d: DadosAtribuicao; hoje: string; criada?: boolean; tokens: Record<number, Token>; onAbrir: (painel: string) => void; onMaisUma: (op: number) => void; agora?: Date;
}) {
	const a = d.atribuicao!;
	const linhas = linhasPessoas(d, hoje);
	const r = resumoTreino(a, d.pessoas, hoje);
	const usadas = d.pessoas.reduce((n, p) => n + p.tentativas_usadas, 0);
	const comLink = linhas.filter(l => estadoLink(d.links, l.p.operador_id, agora).estado === 'ativo').length;
	const semLink = linhas.length - comLink;
	const link = (op: number) => {
		if (tokens[op]) return <Pilula tom="ok">Novo · copie agora</Pilula>;
		const l = estadoLink(d.links, op, agora);
		return l.estado === 'ativo' ? <Pilula tom="ok" title={l.ate ? `Válido até ${dataBR(l.ate)}` : undefined}>Ativo até {dataBR(l.ate)}</Pilula>
			: l.estado === 'expirado' ? <Pilula tom="atencao">Expirado</Pilula> : <Pilula>Sem link</Pilula>;
	};
	const tent = (p: PessoaNoTreino) => (a.tentativas == null ? `${p.tentativas_usadas} (sem limite)` : `${p.tentativas_usadas} de ${a.tentativas + p.tentativas_extra}`);
	const acoes = (l: LinhaPessoa) => {
		const op = l.p.operador_id;
		const podeMais = a.tentativas != null && l.s !== 'aprovado' && l.p.tentativas_usadas > 0;
		return (
			<div className="flex flex-wrap items-center justify-end gap-1.5">
				<Botao tipo="secundario" pequeno disabled title="O treino lado a lado chega com a sessão por texto">Treino lado a lado · em breve</Botao>
				<details className="relative">
					<summary className={`${clsBotao('secundario', true)} cursor-pointer list-none`}>Próximo passo<span className="sr-only"> para {l.o?.apelido}</span></summary>
					<div role="group" aria-label={`Próximo passo para ${l.o?.apelido ?? 'pessoa'}`} className="absolute right-0 z-20 mt-1 flex w-56 flex-col rounded-xl bg-[var(--base-cartao)] p-1 text-left text-[13px]" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 12px 32px rgba(0,0,0,.16)' }}>
						<button type="button" className="rounded-lg px-2.5 py-2 text-left hover:bg-[var(--base-fill)]" onClick={() => onAbrir(`lembrete-${op}`)}>Copiar lembrete</button>
						{podeMais && <button type="button" className="rounded-lg px-2.5 py-2 text-left hover:bg-[var(--base-fill)]" onClick={() => onMaisUma(op)}>Liberar +1 tentativa</button>}
						<LinkRP to={rotaAtribuir({ ops: [op] })} className="rounded-lg px-2.5 py-2 hover:bg-[var(--base-fill)]">Atribuir outro cenário</LinkRP>
						<button type="button" className="rounded-lg px-2.5 py-2 text-left hover:bg-[var(--base-fill)]" onClick={() => onAbrir(`feedback-${op}`)}>Registrar feedback 1:1</button>
						<button type="button" className="rounded-lg px-2.5 py-2 text-left hover:bg-[var(--base-fill)]" onClick={() => onAbrir(`link-${op}`)}>{estadoLink(d.links, op, agora).estado === 'ativo' || tokens[op] ? 'Ver link de treino' : 'Gerar link de treino'}</button>
					</div>
				</details>
			</div>
		);
	};
	const nomeOp = (l: LinhaPessoa) => <LinkRP to={rotaPessoaRP(l.p.operador_id)} className="font-semibold hover:underline">{l.o?.apelido ?? 'Pessoa sem cadastro'}</LinkRP>;
	const sit = (l: LinhaPessoa) => <Pilula tom={SITUACAO_PESSOA[l.s].tom}>{SITUACAO_PESSOA[l.s].nome}</Pilula>;
	return (
		<div className="space-y-4">
			{criada && (
				<div role="status"><Aviso tom="ok" titulo={`Treino atribuído a ${linhas.length} ${linhas.length === 1 ? 'pessoa' : 'pessoas'}.`}
					acao={semLink ? <button type="button" className="text-[13px] font-semibold text-[var(--destaque)] hover:underline" onClick={() => onAbrir('links')}>Gerar e copiar links</button> : undefined}>
					{comLink ? `${comLink} ${comLink === 1 ? 'já tinha' : 'já tinham'} link ativo: o treino aparece lá. ` : ''}{semLink ? `${semLink} ${semLink === 1 ? 'precisa' : 'precisam'} de link.` : ''}
				</Aviso></div>
			)}
			<Kpis itens={[
				{ rotulo: 'Chegaram na meta', valor: `${r.naMeta} de ${r.pessoas}`, detalhe: `meta ${a.nota_minima}` },
				{ rotulo: 'Nota média', valor: r.media == null ? '—' : nf(r.media), detalhe: 'melhor nota de cada pessoa' },
				{ rotulo: 'Tentativas', valor: nf(usadas), detalhe: usadas === 1 ? 'usada (abandonada não conta)' : 'usadas (abandonada não conta)' },
				{ rotulo: 'Links ativos', valor: `${comLink} de ${linhas.length}`, detalhe: semLink ? `${semLink} sem link ou expirado` : 'todos com link', tom: semLink ? 'atencao' : undefined },
			]} />
			<Cartao semPadding><div className="p-4 sm:px-5">
				<Tabela<LinhaPessoa> rotulo="Pessoas neste treino" linhas={linhas} chave={l => l.p.operador_id}
					colunas={[
						{ id: 'op', titulo: 'Operador', celula: nomeOp },
						{ id: 'sit', titulo: 'Situação', celula: sit },
						{ id: 'tent', titulo: 'Tentativas', num: true, celula: l => tent(l.p) },
						{ id: 'link', titulo: 'Link de treino', celula: l => link(l.p.operador_id) },
						{ id: 'ult', titulo: 'Último acesso', celula: l => (d.ultimoAcesso[l.p.operador_id] ? dataHoraBR(d.ultimoAcesso[l.p.operador_id]) : '—') },
						{ id: 'acoes', titulo: <span className="sr-only">Ações</span>, celula: acoes },
					]}
					celular={l => ({ titulo: nomeOp(l), valor: sit(l), resumo: <span className="flex flex-col gap-1.5">{tent(l.p)} · {link(l.p.operador_id)}{acoes(l)}</span> })} />
			</div></Cartao>
			<p className="text-[12.5px] text-[var(--base-texto-3)]">O link pessoal abre só os treinos dessa pessoa. Revogar o link faz ele parar de abrir na hora. {d.cenario && <>Cenário: <Link className="font-semibold text-[var(--destaque)] hover:underline" to={rotaCenarioRP(d.cenario.id)}>{d.cenario.nome}</Link>.</>}</p>
			{d.feedbacks.length > 0 && (
				<Cartao titulo="Feedbacks 1:1 deste treino">
					<ul className="space-y-3">
						{d.feedbacks.map(f => (
							<li key={f.id} className="text-[13.5px]">
								<p className="text-[var(--base-texto)]"><b>{d.operadores.find(o => o.id === f.operador_id)?.apelido ?? 'Pessoa'}:</b> {f.combinado}</p>
								<p className="mt-0.5 text-[12px] text-[var(--base-texto-3)]">{dataBR(f.criado_em)}{f.proxima_conversa ? ` · próxima conversa ${dataBR(f.proxima_conversa)}` : ''}</p>
							</li>
						))}
					</ul>
				</Cartao>
			)}
		</div>
	);
}

// ------------------------------------------------------------------ painéis
function Qr({ url, rotulo }: { url: string; rotulo: string }) {
	const [src, setSrc] = useState('');
	useEffect(() => {
		let ativo = true;
		import('qrcode').then(Q => Q.toDataURL(url, { margin: 1, width: 220 })).then(s => { if (ativo) setSrc(s); }).catch(() => {});
		return () => { ativo = false; };
	}, [url]);
	return src ? <img src={src} alt={`QR code do link de treino de ${rotulo}`} width={176} height={176} className="rounded-lg bg-white p-1.5" /> : <div className="grid h-[176px] w-[176px] place-items-center rounded-lg bg-[var(--base-fill)]"><QrCode size={28} aria-hidden="true" /></div>;
}

export function PainelLink({ op, apelido, d, token, onGerar, onRevogar, agora }: { op: number; apelido: string; d: Pick<DadosAtribuicao, 'links'>; token: Token | null; onGerar: () => Promise<void>; onRevogar: () => Promise<void>; agora?: Date }) {
	const [ocupado, setOcupado] = useState(false);
	const l = estadoLink(d.links, op, agora);
	const url = token ? urlTreino(origem(), token.token) : null;
	const fazer = (fn: () => Promise<void>) => async () => { setOcupado(true); try { await fn(); } finally { setOcupado(false); } };
	return (
		<div className="space-y-3">
			{url ? (
				<>
					<Aviso tom="atencao" titulo="Copie agora.">Por segurança o MotorCX guarda só uma impressão do link: depois de fechar este painel, ele não aparece de novo (dá para gerar outro).</Aviso>
					<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Link de {apelido}
						<input readOnly value={url} onFocus={e => e.currentTarget.select()} className={`${campoCls} font-mono text-[12px]`} style={campoStyle} />
					</label>
					<div className="flex flex-wrap gap-2"><Botao onClick={() => void copiar(url, 'Link copiado.')}><Copy size={14} aria-hidden="true" />Copiar link</Botao></div>
					<Qr url={url} rotulo={apelido} />
					<p className="text-[12.5px] text-[var(--base-texto-2)]">Válido até {dataBR(token!.valido_ate)}.</p>
				</>
			) : l.estado === 'ativo' ? (
				<Aviso tom="info" titulo={`Link ativo até ${dataBR(l.ate)}.`}>{apelido} já tem um link que funciona. Ele não aparece de novo aqui: se a pessoa perdeu, gere um novo (o antigo para de abrir).</Aviso>
			) : (
				<Aviso tom={l.estado === 'expirado' ? 'atencao' : 'neutro'} titulo={l.estado === 'expirado' ? 'O link venceu.' : 'Sem link de treino ainda.'}>Gere o link e entregue pelo canal interno de vocês (copie ou mostre o QR code).</Aviso>
			)}
			<div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--base-borda)' }}>
				<Botao tipo={url ? 'secundario' : 'primario'} onClick={fazer(onGerar)} disabled={ocupado}>{l.estado === 'ativo' || url ? 'Gerar link novo' : 'Gerar link'}</Botao>
				{(l.estado === 'ativo' || url) && <Botao tipo="perigo" onClick={fazer(onRevogar)} disabled={ocupado}>Revogar link</Botao>}
			</div>
			{(l.estado === 'ativo' || url) && <p className="text-[12px] text-[var(--base-texto-3)]">Gerar um link novo ou revogar faz o link atual parar de abrir na hora.</p>}
		</div>
	);
}

export function PainelLinksTurma({ d, tokens, nome, onGerar, agora }: { d: Pick<DadosAtribuicao, 'pessoas' | 'operadores' | 'links'>; tokens: Record<number, Token>; nome: string; onGerar: (ops: number[]) => Promise<void>; agora?: Date }) {
	const [ocupado, setOcupado] = useState(false);
	const pessoas = useMemo(() => d.pessoas.map(p => ({ op: p.operador_id, apelido: d.operadores.find(o => o.id === p.operador_id)?.apelido ?? 'Pessoa', l: estadoLink(d.links, p.operador_id, agora) }))
		.sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR')), [d, agora]);
	const semLink = pessoas.filter(p => p.l.estado !== 'ativo' && !tokens[p.op]).map(p => p.op);
	const comToken = pessoas.filter(p => tokens[p.op]);
	const todos = comToken.map(p => `${p.apelido}: ${urlTreino(origem(), tokens[p.op].token)}`).join('\n');
	const gerar = async (ops: number[]) => { setOcupado(true); try { await onGerar(ops); } finally { setOcupado(false); } };
	async function imprimir() {
		const Q = await import('qrcode');
		const blocos = await Promise.all(comToken.map(async p => ({ p, src: await Q.toDataURL(urlTreino(origem(), tokens[p.op].token), { margin: 1, width: 240 }) })));
		const w = window.open('', '_blank');
		if (!w) { toast.error('O navegador bloqueou a janela de impressão.'); return; }
		const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
		w.document.write(`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Links de treino</title><style>body{font-family:system-ui,sans-serif;margin:24px}h1{font-size:16px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.c{border:1px solid #ccc;border-radius:10px;padding:12px;text-align:center;break-inside:avoid}b{display:block;margin-top:6px}small{color:#555}</style><h1>Treino “${esc(nome)}”: link pessoal de cada pessoa</h1><div class="g">${blocos.map(b => `<div class="c"><img src="${b.src}" width="180" height="180" alt=""><b>${esc(b.p.apelido)}</b><small>Abra com a câmera do celular. Só abre os seus treinos.</small></div>`).join('')}</div>`);
		w.document.close();
		w.focus();
		w.print();
	}
	return (
		<div className="space-y-3">
			<Aviso tom="neutro">Por segurança, um link aparece só quando é gerado. Gere agora para quem precisa e copie ou imprima antes de fechar.</Aviso>
			<ul className="divide-y text-[13px]" style={{ borderColor: 'var(--base-borda)' }}>
				{pessoas.map(p => (
					<li key={p.op} className="flex flex-wrap items-center justify-between gap-2 py-2">
						<span className="font-semibold">{p.apelido}</span>
						{tokens[p.op] ? <Pilula tom="ok">Link novo pronto</Pilula> : p.l.estado === 'ativo' ? <Pilula tom="ok">Ativo até {dataBR(p.l.ate)}</Pilula> : p.l.estado === 'expirado' ? <Pilula tom="atencao">Expirado</Pilula> : <Pilula>Sem link</Pilula>}
					</li>
				))}
			</ul>
			<div className="flex flex-wrap gap-2">
				<Botao onClick={() => void gerar(semLink)} disabled={ocupado || !semLink.length}>{semLink.length ? `Gerar para quem não tem link (${semLink.length})` : 'Todos têm link'}</Botao>
				<Botao tipo="secundario" onClick={() => void gerar(pessoas.map(p => p.op))} disabled={ocupado || !pessoas.length}>Gerar novos para todos</Botao>
			</div>
			<p className="text-[12px] text-[var(--base-texto-3)]">“Gerar novos para todos” faz os links atuais pararem de abrir.</p>
			{comToken.length > 0 && (
				<div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--base-borda)' }}>
					<textarea readOnly rows={Math.min(8, comToken.length + 1)} value={todos} aria-label="Links gerados" className={`${textareaCls} font-mono text-[12px]`} style={campoStyle} />
					<div className="flex flex-wrap gap-2">
						<Botao onClick={() => void copiar(todos, 'Links copiados.')}><Copy size={14} aria-hidden="true" />Copiar todos</Botao>
						<Botao tipo="secundario" onClick={() => void imprimir()}><Printer size={14} aria-hidden="true" />Imprimir QR codes</Botao>
					</div>
				</div>
			)}
		</div>
	);
}

export function PainelLembrete({ itens }: { itens: { op: number; apelido: string; texto: string; temLink: boolean }[] }) {
	if (!itens.length) return <p className="text-[13px] text-[var(--base-texto-2)]">Ninguém pendente neste treino.</p>;
	const todos = itens.map(i => i.texto).join('\n\n');
	return (
		<div className="space-y-3">
			{itens.some(i => !i.temLink) && <Aviso tom="neutro">Sem o link nesta tela, o lembrete pede para a pessoa abrir o link que já recebeu. Para mandar o link junto, gere em “Links da turma” e volte aqui.</Aviso>}
			{itens.map(i => (
				<div key={i.op} className="space-y-1.5">
					<p className="text-[12px] font-semibold text-[var(--base-texto-2)]">{i.apelido}</p>
					<textarea readOnly rows={4} value={i.texto} aria-label={`Lembrete para ${i.apelido}`} className={textareaCls} style={campoStyle} />
					<Botao tipo="secundario" pequeno onClick={() => void copiar(i.texto, 'Lembrete copiado.')}><Copy size={13} aria-hidden="true" />Copiar</Botao>
				</div>
			))}
			{itens.length > 1 && <Botao onClick={() => void copiar(todos, 'Lembretes copiados.')}><Copy size={14} aria-hidden="true" />Copiar todos</Botao>}
		</div>
	);
}

export function PainelPrazo({ atual, hoje, onSalvar }: { atual: string; hoje: string; onSalvar: (prazo: string) => Promise<void> }) {
	const min = atual >= hoje ? atual : hoje;
	const [p, setP] = useState('');
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState(false);
	async function salvar() {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(p) || p <= atual) { setErro('Escolha uma data depois do prazo atual.'); return; }
		setOcupado(true); setErro('');
		try { await onSalvar(p); } catch (e) { setErro(e instanceof Error ? e.message : 'Não deu para estender.'); } finally { setOcupado(false); }
	}
	return (
		<div className="space-y-3">
			<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Novo prazo
				<input type="date" value={p} min={min} onChange={e => setP(e.target.value)} className={campoCls} style={campoStyle} />
				<small className="text-[11.5px] font-normal text-[var(--base-texto-3)]">Até 180 dias a partir de hoje.</small>
			</label>
			{erro && <p role="alert" className="text-[12.5px] font-medium text-[var(--estado-erro-texto)]">{erro}</p>}
			<Botao onClick={() => void salvar()} disabled={ocupado || !p}>{ocupado ? 'Salvando…' : 'Estender prazo'}</Botao>
		</div>
	);
}

export function PainelFeedback({ apelido, cenario, onSalvar }: { apelido: string; cenario: string; onSalvar: (combinado: string, proxima: string | null) => Promise<void> }) {
	const [combinado, setCombinado] = useState('');
	const [proxima, setProxima] = useState('');
	const [erro, setErro] = useState('');
	const [salvo, setSalvo] = useState<string | null>(null);
	const [ocupado, setOcupado] = useState(false);
	async function salvar() {
		const t = combinado.trim();
		if (t.length < 3) { setErro('Escreva o que foi combinado.'); return; }
		if (t.includes('@') || textoTemDadoPessoal(t)) { setErro('Sem CPF, telefone ou e-mail no feedback.'); return; }
		setOcupado(true); setErro('');
		try { await onSalvar(t, proxima || null); setSalvo(resumoFeedback({ apelido, cenario, combinado: t, proxima: proxima || null })); }
		catch (e) { setErro(e instanceof Error ? e.message : 'Não deu para registrar.'); } finally { setOcupado(false); }
	}
	if (salvo) return (
		<div className="space-y-3">
			<Aviso tom="ok" titulo="Feedback registrado.">Ele aparece na página da pessoa e neste treino.</Aviso>
			<textarea readOnly rows={4} value={salvo} aria-label="Resumo para o supervisor" className={textareaCls} style={campoStyle} />
			<Botao tipo="secundario" onClick={() => void copiar(salvo, 'Resumo copiado.')}><Copy size={14} aria-hidden="true" />Copiar resumo para o supervisor</Botao>
		</div>
	);
	return (
		<div className="space-y-3">
			<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">O que foi combinado
				<textarea rows={5} maxLength={1000} value={combinado} onChange={e => setCombinado(e.target.value)} className={textareaCls} style={campoStyle} placeholder="Ex.: Antes de oferecer, confirmar a identidade e perguntar quanto cabe por mês." />
			</label>
			<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Próxima conversa (opcional)
				<input type="date" value={proxima} onChange={e => setProxima(e.target.value)} className={campoCls} style={campoStyle} />
			</label>
			{erro && <p role="alert" className="text-[12.5px] font-medium text-[var(--estado-erro-texto)]">{erro}</p>}
			<Botao onClick={() => void salvar()} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Registrar feedback'}</Botao>
		</div>
	);
}
