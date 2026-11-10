// Roleplay › Cadastro para treino › pessoa: treinos atribuídos, sessões de treino e feedbacks 1:1 de uma pessoa,
// direto do banco. Sem sessão ainda (o treino por texto e por voz chega nos próximos PRs), mostra o estado vazio.
// A nota de treino nunca se mistura com a das ligações reais (Speech › Operadores).
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Botao, BotaoLink, Cartao, Estado, Gaveta, Kpis, Pilula, Tabela, clsBotao } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { dataBR, dataHoraBR, diaSP, nf, rotaSA } from '@/lib/speech';
import {
	ROTA_RP_CADASTRO, SITUACAO_PESSOA, estadoLink, rotaAtribuicaoRP, rotaAtribuir, situacaoPessoa, ultimaAvaliada,
	type AtribuicaoRP, type SessaoRP,
} from '@/lib/roleplay';
import { LinkRP, MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { lerPessoa, salvarCadastro, type DadosPessoa } from './dados';
import { FormOperador, usePainelUrl, type DadosForm } from './cadastro';
import type { PodeRP } from './index';

export function PaginaPessoa({ empresa, id, pode }: { empresa: number; id: string; pode: PodeRP }) {
	const num = /^\d{1,18}$/.test(id) ? Number(id) : null;
	const [d, setD] = useState<DadosPessoa | null>(null);
	const [erro, setErro] = useState('');
	const [versao, setVersao] = useState(0);
	const { painel, abrir, fechar } = usePainelUrl();

	useEffect(() => {
		if (!supabase || !pode.treinar) return;
		let ativo = true;
		setErro('');
		if (num == null) { setD({ operador: null, equipes: [], cenarios: [], atribuicoes: [], pessoas: [], sessoes: [], links: [], feedbacks: [] }); return; }
		lerPessoa(supabase, empresa, num).then(x => { if (ativo) setD(x); }).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, num, pode.treinar, versao]);

	async function salvar(x: DadosForm) {
		if (!supabase) return;
		await salvarCadastro(supabase, empresa, x);
		toast.success('Cadastro salvo.');
		setVersao(v => v + 1);
		fechar();
	}

	if (!pode.treinar) return <MolduraRP titulo="Pessoa"><Estado tipo="semPermissao" titulo="Seu perfil não vê as pessoas do treino.">Quem tem a permissão de treinar operadores vê os treinos e as sessões de cada pessoa. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado></MolduraRP>;
	if (erro) return <MolduraRP titulo="Pessoa"><Estado tipo="erro" titulo="Não deu para carregar a página agora.">{erro}</Estado></MolduraRP>;
	if (!d) return <MolduraRP titulo="Pessoa"><Estado tipo="carregando" /></MolduraRP>;
	if (!d.operador) return <MolduraRP titulo="Pessoa não encontrada"><Estado tipo="vazio" titulo="Pessoa não encontrada." acoes={<BotaoLink to={ROTA_RP_CADASTRO}>Ir para o Cadastro para treino</BotaoLink>}>O endereço pode estar desatualizado.</Estado></MolduraRP>;

	const o = d.operador;
	const equipe = d.equipes.find(e => e.id === o.equipe_id)?.nome ?? 'Sem equipe';
	const desc = `${equipe} · ${o.operador_ref ? `ID no discador ${o.operador_ref}` : 'só treino, sem ID do discador'}${o.ativo ? '' : ' · desativado'}`;
	return (
		<MolduraRP titulo={o.apelido} detalhe={o.apelido} descricao={desc}
			acoes={<><SeloLgpdTreino /><Botao tipo="secundario" onClick={() => abrir('editar')}>Editar cadastro</Botao>{o.ativo && <LinkRP to={rotaAtribuir({ ops: [o.id] })} className={clsBotao('primario')}>Atribuir treino</LinkRP>}</>}>
			<CorpoPessoa d={d} hoje={diaSP(0)} />
			<Gaveta aberta={painel === 'editar'} onFechar={fechar} titulo={`Editar ${o.apelido}`} subtitulo="Primeiro nome e inicial. Sem CPF, e-mail ou telefone.">
				{/* Na edição não se traz ninguém de Speech › Operadores (só no cadastro novo). */}
				<FormOperador inicial={o} equipes={d.equipes} candidatos={[]} onSalvar={salvar} onCancelar={fechar} />
			</Gaveta>
		</MolduraRP>
	);
}

const MODO: Record<string, string> = { voz: 'Voz', texto: 'Texto' };

/** O corpo da página da pessoa com os dados já lidos (sem banco: é o que os testes renderizam). */
export function CorpoPessoa({ d, hoje, agora }: { d: DadosPessoa; hoje: string; agora?: Date }) {
	const o = d.operador!;
	const nomeCen = (id: number) => d.cenarios.find(c => c.id === id)?.nome ?? 'Cenário';
	const avaliadas = d.sessoes.filter(s => s.situacao === 'avaliada' && s.nota != null);
	const ult = avaliadas[0] ?? null;
	const situacoes = d.atribuicoes.map(a => {
		const p = d.pessoas.find(x => x.atribuicao_id === a.id)!;
		return { a, p, s: situacaoPessoa(a, p, ultimaAvaliada(d.sessoes, a.id, o.id), hoje) };
	}).filter(x => x.p).sort((x, y) => y.a.prazo.localeCompare(x.a.prazo));
	const pendentes = situacoes.filter(x => x.s !== 'aprovado' && x.a.prazo >= hoje);
	const link = estadoLink(d.links, o.id, agora);

	return (
		<div className="space-y-4">
			<Kpis itens={[
				{ rotulo: 'Treinos pendentes', valor: nf(pendentes.length), detalhe: pendentes.length ? `prazo mais próximo ${dataBR([...pendentes].sort((a, b) => a.a.prazo.localeCompare(b.a.prazo))[0].a.prazo)}` : 'nenhum em aberto' },
				{ rotulo: 'Sessões avaliadas', valor: nf(avaliadas.length), detalhe: 'tentativa abandonada não conta' },
				{ rotulo: 'Última nota de treino', valor: ult ? nf(ult.nota) : '—', detalhe: ult ? dataBR(ult.inicio) : 'ainda sem nota' },
				{ rotulo: 'Link de treino', valor: link.estado === 'ativo' ? 'Ativo' : link.estado === 'expirado' ? 'Expirado' : 'Sem link', detalhe: link.ate ? `${link.estado === 'ativo' ? 'válido até' : 'venceu em'} ${dataBR(link.ate)}` : 'gere em Treinos atribuídos', tom: link.estado === 'expirado' ? 'atencao' : undefined },
			]} />
			{o.operador_ref && <p className="text-[12.5px] text-[var(--base-texto-2)]">A nota das ligações reais fica em <Link className="font-semibold text-[var(--destaque)] hover:underline" to={rotaSA('operadores')}>Speech › Operadores</Link>. Ela nunca se mistura com a nota de treino.</p>}

			<Cartao titulo="Treinos atribuídos" semPadding>
				<div className="px-4 pb-4 sm:px-5">
					<Tabela<(typeof situacoes)[number]> rotulo={`Treinos atribuídos de ${o.apelido}`} linhas={situacoes} chave={x => x.a.id}
						vazio={`Nenhum treino atribuído a ${o.apelido} ainda.`}
						colunas={[
							{ id: 'cen', titulo: 'Cenário', celula: x => <LinkRP className="font-semibold hover:underline" to={rotaAtribuicaoRP(x.a.id)}>{nomeCen(x.a.cenario_id)}</LinkRP> },
							{ id: 'prazo', titulo: 'Prazo', num: true, celula: x => dataBR(x.a.prazo) },
							{ id: 'nota', titulo: 'Melhor nota', num: true, celula: x => (x.p.melhor_nota == null ? '—' : `${Math.round(Number(x.p.melhor_nota))} (meta ${x.a.nota_minima})`) },
							{ id: 'tent', titulo: 'Tentativas', num: true, celula: x => tentativas(x.a, x.p.tentativas_usadas, x.p.tentativas_extra) },
							{ id: 'sit', titulo: 'Situação', celula: x => <Pilula tom={SITUACAO_PESSOA[x.s].tom}>{SITUACAO_PESSOA[x.s].nome}</Pilula> },
						]}
						celular={x => ({ titulo: nomeCen(x.a.cenario_id), valor: <Pilula tom={SITUACAO_PESSOA[x.s].tom}>{SITUACAO_PESSOA[x.s].nome}</Pilula>, resumo: <span>Prazo {dataBR(x.a.prazo)} · {tentativas(x.a, x.p.tentativas_usadas, x.p.tentativas_extra)}</span> })} />
				</div>
			</Cartao>

			<section aria-labelledby="t-sessoes" className="space-y-2">
				<h2 id="t-sessoes" className="text-[15px] font-semibold text-[var(--base-texto)]">Sessões de treino</h2>
				{d.sessoes.length === 0
					? <Estado tipo="vazio" titulo="Ainda sem sessões de treino.">{o.apelido} ainda não treinou. As sessões aparecem aqui, com a nota pelo checklist e os pontos para treinar, assim que houver um treino atribuído e a pessoa fizer a primeira tentativa.</Estado>
					: <Cartao semPadding><div className="p-4 sm:px-5">
						<Tabela<SessaoRP> rotulo={`Sessões de ${o.apelido}`} linhas={d.sessoes} chave={s => s.id}
							colunas={[
								{ id: 'data', titulo: 'Data', celula: s => dataHoraBR(s.inicio) },
								{ id: 'cen', titulo: 'Cenário', celula: s => nomeCen(s.cenario_id) },
								{ id: 'modo', titulo: 'Modo', celula: s => MODO[s.modo] ?? '—' },
								{ id: 'dur', titulo: 'Duração', num: true, celula: s => (s.duracao_s == null ? '—' : `${Math.max(1, Math.round(s.duracao_s / 60))} min`) },
								{ id: 'nota', titulo: 'Nota', celula: s => notaSessao(s) },
							]}
							celular={s => ({ titulo: nomeCen(s.cenario_id), valor: notaSessao(s), resumo: <span>{dataHoraBR(s.inicio)} · {MODO[s.modo] ?? ''}</span> })} />
					</div></Cartao>}
			</section>

			{d.feedbacks.length > 0 && (
				<Cartao titulo="Feedbacks 1:1" linha="O que foi combinado com a Qualidade.">
					<ul className="space-y-3">
						{d.feedbacks.map(f => (
							<li key={f.id} className="text-[13.5px]">
								<p className="text-[var(--base-texto)]">{f.combinado}</p>
								<p className="mt-0.5 text-[12px] text-[var(--base-texto-3)]">{dataBR(f.criado_em)}{f.proxima_conversa ? ` · próxima conversa ${dataBR(f.proxima_conversa)}` : ''}</p>
							</li>
						))}
					</ul>
				</Cartao>
			)}
		</div>
	);
}

function tentativas(a: Pick<AtribuicaoRP, 'tentativas'>, usadas: number, extra: number): string {
	return a.tentativas == null ? `${usadas} (sem limite)` : `${usadas} de ${a.tentativas + extra}`;
}

function notaSessao(s: SessaoRP) {
	if (s.situacao === 'avaliada' && s.nota != null) return <Pilula tom={s.reprovada ? 'erro' : 'neutro'}>{nf(s.nota)}{s.reprovada ? ' · item crítico' : ''}</Pilula>;
	if (s.situacao === 'em_andamento') return <Pilula tom="info">Em andamento</Pilula>;
	return <Pilula title="Não conta como tentativa">{s.situacao === 'abandonada' ? 'Saiu sem contar' : 'Não contou'}</Pilula>;
}
