// Roleplay › sessão por texto do lado da Qualidade (SQL 100):
// - Treino lado a lado (/atribuicoes/:id/lado-a-lado/:op): a Qualidade, logada, abre a sessão nesta máquina para a
//   pessoa ao lado (iniciar_treino_lado_a_lado). Abrir a tela não começa a ligação: mostra "Começar". Começada, o id
//   da sessão vai para a URL (?sessao=, replace). Ao terminar, a sessão dá lugar ao resultado (replace).
// - Testar cenário (/cenarios/:id/testar): o mesmo, sem operador (testar_cenario_treino; conta no saldo, nada é
//   guardado para pessoa nenhuma e a conversa some em 1 dia). Termina no resultado do teste (/cenarios/:id/teste/:sid).
// - Sessão de uma pessoa (/atribuicoes/:id/sessoes/:sid): resultado formativo, "Revisar avaliação" item a item
//   (revisar_sessao_treino: alimenta a concordância IA × Qualidade), discordâncias do operador com "Marcar como
//   resolvida" (resolver_discordancia_treino) e o feedback 1:1.
// - Resultado do teste (/cenarios/:id/teste/:sid): sem operador, sem revisar e sem feedback.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Aviso, Botao, Cartao, Estado, Gaveta } from '@/components/ds';
import { friendlyError, supabase } from '@/lib/supabase';
import { dataHoraBR } from '@/lib/speech';
import {
	ROTA_RP_ATRIBUICOES, rotaAtribuicaoRP, rotaCenarioRP, rotaSessaoRP, rotaTesteRP, textoAlcada, textoDuracao, itemChecklist,
	type CenarioRP, type ItemChecklistRP,
} from '@/lib/roleplay';
import { textoEncerramento, type ResultadoTreino } from '@/lib/treino-sessao';
import { SessaoTexto } from '@/components/treino/sessao';
import { ResultadoView } from '@/components/treino/resultado';
import { chamarTreino } from '@/components/treino/chamar';
import { MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { usePainelUrl } from './cadastro';
import { PainelFeedback } from './atribuicoes';
import { lerAtribuicao, lerCenario, lerItensChecklist, salvarFeedback, type DadosAtribuicao } from './dados';
import type { PodeRP } from './index';

const num = (v: string | null | undefined) => (v && /^\d{1,18}$/.test(v) ? Number(v) : null);

function Briefing({ c, itens, para }: { c: CenarioRP; itens: Record<string, ItemChecklistRP>; para?: string }) {
	const d = c.divida ?? {};
	return (
		<Cartao titulo="Antes de começar" linha={para ? `Quem treina: ${para}. A tentativa conta como a do link.` : 'Teste da Qualidade: a nota não vai para pessoa nenhuma e a conversa some em 1 dia. Conta no saldo do mês.'}>
			<dl className="grid gap-x-4 gap-y-1.5 text-[13.5px] sm:grid-cols-[auto_1fr]">
				<dt className="text-[var(--base-texto-3)]">Cliente simulado</dt><dd className="m-0">{c.persona_nome}</dd>
				{d.produto && <><dt className="text-[var(--base-texto-3)]">Produto</dt><dd className="m-0">{d.produto}</dd></>}
				{d.dias_atraso != null && <><dt className="text-[var(--base-texto-3)]">Atraso</dt><dd className="m-0">{d.dias_atraso} dias</dd></>}
				<dt className="text-[var(--base-texto-3)]">Alçada</dt><dd className="m-0">{textoAlcada(d.alcada)}</dd>
				<dt className="text-[var(--base-texto-3)]">Duração</dt><dd className="m-0">até {textoDuracao(c.duracao_max_s)}</dd>
				{c.itens_foco.length > 0 && <><dt className="text-[var(--base-texto-3)]">Em foco</dt><dd className="m-0">{c.itens_foco.map(i => itemChecklist(i, itens).texto).join(' · ')}</dd></>}
			</dl>
			<p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]">Por enquanto o treino roda por texto: a ligação abre em tela cheia. Para sair, use “Sair” (dá para sair sem contar).</p>
		</Cartao>
	);
}

/** Lado a lado e teste: "Começar" abre a sessão; com ?sessao= na URL, a sessão em tela cheia. */
function SessaoLogada({ titulo, detalhe, meio, c, itens, para, iniciar, aoTerminar, aoSair }: {
	titulo: string; detalhe: string; meio?: { rotulo: string; to: string }; c: CenarioRP; itens: Record<string, ItemChecklistRP>; para?: string;
	iniciar: () => Promise<number>; aoTerminar: (sessao: number) => void; aoSair: (msg: string) => void;
}) {
	const [q, setQ] = useSearchParams();
	const sessao = num(q.get('sessao'));
	const [ocupado, setOcupado] = useState(false);
	const [erro, setErro] = useState('');
	if (sessao != null) {
		return <SessaoTexto quem="qualidade" chamar={chamarTreino(sessao, null)}
			ficha={{ cenario: c.nome, persona: c.persona_nome, divida: c.divida ?? {}, foco: c.itens_foco.map(i => itemChecklist(i, itens).texto), objetivo: c.objetivo_cenario }}
			onFim={r => (r.situacao === 'avaliada' ? aoTerminar(sessao) : aoSair(textoEncerramento(r)))} />;
	}
	async function comecar() {
		setOcupado(true); setErro('');
		try {
			const s = await iniciar();
			setQ(p => { const n = new URLSearchParams(p); n.set('sessao', String(s)); return n; }, { replace: true });
		} catch (e) { setErro(e instanceof Error ? e.message : 'Não deu para começar.'); } finally { setOcupado(false); }
	}
	return (
		<MolduraRP titulo={titulo} detalhe={detalhe} meio={meio} acoes={<SeloLgpdTreino />}>
			<div className="max-w-[720px] space-y-4">
				<Briefing c={c} itens={itens} para={para} />
				{!c.modos.includes('texto') && <Aviso tom="atencao">Este cenário é só por voz, e o treino por voz chega numa próxima versão.</Aviso>}
				{erro && <div role="alert"><Aviso tom="erro">{erro}</Aviso></div>}
				<Botao onClick={() => void comecar()} disabled={ocupado || !c.modos.includes('texto')}>{ocupado ? 'Abrindo…' : 'Começar'}</Botao>
			</div>
		</MolduraRP>
	);
}

export function LadoALado({ empresa, atr, op, pode }: { empresa: number; atr: string; op: string; pode: PodeRP }) {
	const navegar = useNavigate();
	const [d, setD] = useState<DadosAtribuicao | null>(null);
	const [itens, setItens] = useState<Record<string, ItemChecklistRP>>({});
	const [erro, setErro] = useState('');
	const a = num(atr), o = num(op);
	useEffect(() => {
		if (!supabase || !pode.treinar || a == null) return;
		let ativo = true;
		Promise.all([lerAtribuicao(supabase, empresa, a), lerItensChecklist(supabase, empresa)])
			.then(([x, i]) => { if (ativo) { setD(x); setItens(i); } }).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, a, pode.treinar]);
	if (!pode.treinar) return <MolduraRP titulo="Treino lado a lado"><Estado tipo="semPermissao" titulo="Seu perfil não conduz treinos.">Quem tem a permissão de treinar operadores faz o treino lado a lado.</Estado></MolduraRP>;
	if (erro) return <MolduraRP titulo="Treino lado a lado"><Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado></MolduraRP>;
	if (!d && a != null) return <MolduraRP titulo="Treino lado a lado"><Estado tipo="carregando" /></MolduraRP>;
	const pessoa = d?.operadores.find(x => x.id === o);
	if (!d?.atribuicao || !d.cenario || !pessoa || !d.pessoas.some(p => p.operador_id === o)) return <MolduraRP titulo="Treino lado a lado"><Estado tipo="vazio" titulo="Pessoa ou treino não encontrado.">O endereço pode estar desatualizado.</Estado></MolduraRP>;
	const aid = d.atribuicao.id;
	return (
		<SessaoLogada titulo={`Treino lado a lado com ${pessoa.apelido}`} detalhe="Treino lado a lado" meio={{ rotulo: d.cenario.nome, to: rotaAtribuicaoRP(aid) }} c={d.cenario} itens={itens} para={pessoa.apelido}
			iniciar={async () => {
				const r = await supabase!.rpc('iniciar_treino_lado_a_lado', { atribuicao: aid, operador: pessoa.id, modo: 'texto' });
				if (r.error) throw new Error(friendlyError(r.error));
				return Number((r.data as { sessao: number }).sessao);
			}}
			aoTerminar={s => navegar(rotaSessaoRP(aid, s), { replace: true })}
			aoSair={m => { toast.message(m); navegar(rotaAtribuicaoRP(aid), { replace: true }); }} />
	);
}

export function TestarCenario({ empresa, id, pode }: { empresa: number; id: string; pode: PodeRP }) {
	const navegar = useNavigate();
	const [c, setC] = useState<CenarioRP | null | undefined>(undefined);
	const [itens, setItens] = useState<Record<string, ItemChecklistRP>>({});
	const cid = num(id);
	useEffect(() => {
		if (!supabase || cid == null) { setC(null); return; }
		let ativo = true;
		Promise.all([lerCenario(supabase, empresa, cid), lerItensChecklist(supabase, empresa)])
			.then(([x, i]) => { if (ativo) { setC(x); setItens(i); } }).catch(() => { if (ativo) setC(null); });
		return () => { ativo = false; };
	}, [empresa, cid]);
	if (!pode.cenarios) return <MolduraRP titulo="Testar cenário"><Estado tipo="semPermissao" titulo="Seu perfil não testa cenários.">Quem tem a permissão de editar cenários de treino testa os cenários.</Estado></MolduraRP>;
	if (c === undefined) return <MolduraRP titulo="Testar cenário"><Estado tipo="carregando" /></MolduraRP>;
	if (!c) return <MolduraRP titulo="Testar cenário"><Estado tipo="vazio" titulo="Cenário não encontrado.">O endereço pode estar desatualizado.</Estado></MolduraRP>;
	return (
		<SessaoLogada titulo={`Testar: ${c.nome}`} detalhe="Testar cenário" meio={{ rotulo: c.nome, to: rotaCenarioRP(c.id) }} c={c} itens={itens}
			iniciar={async () => {
				const r = await supabase!.rpc('testar_cenario_treino', { cenario: c.id, empresa, modo: 'texto' });
				if (r.error) throw new Error(friendlyError(r.error));
				return Number((r.data as { sessao: number }).sessao);
			}}
			aoTerminar={s => navegar(rotaTesteRP(c.id, s), { replace: true })}
			aoSair={m => { toast.message(m); navegar(rotaCenarioRP(c.id), { replace: true }); }} />
	);
}

async function lerResultado(sessao: number): Promise<ResultadoTreino> {
	const r = await supabase!.rpc('resultado_sessao_treino', { sessao });
	if (r.error) throw new Error(friendlyError(r.error));
	return r.data as ResultadoTreino;
}

export function SessaoDaPessoa({ empresa, atr, sid, pode, teste }: { empresa: number; atr: string; sid: string; pode: PodeRP; teste?: boolean }) {
	const s = num(sid);
	const [r, setR] = useState<ResultadoTreino | null | undefined>(undefined);
	const [erro, setErro] = useState('');
	const [revisando, setRevisando] = useState(false);
	const [versao, setVersao] = useState(0);
	const { painel, abrir, fechar } = usePainelUrl();
	useEffect(() => {
		if (!supabase || s == null) { setR(null); return; }
		let ativo = true;
		lerResultado(s).then(x => { if (ativo) setR(x); }).catch(e => { if (ativo) { setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); setR(null); } });
		return () => { ativo = false; };
	}, [s, versao]);
	const tituloBase = teste ? 'Resultado do teste' : 'Sessão';
	if (!teste && !pode.treinar) return <MolduraRP titulo={tituloBase}><Estado tipo="semPermissao" titulo="Seu perfil não vê as sessões de treino.">Quem tem a permissão de treinar operadores vê as sessões.</Estado></MolduraRP>;
	if (r === undefined) return <MolduraRP titulo={tituloBase}><Estado tipo="carregando" /></MolduraRP>;
	if (!r) return <MolduraRP titulo={tituloBase}><Estado tipo={erro ? 'erro' : 'vazio'} titulo="Sessão não encontrada.">{erro || 'O endereço pode estar desatualizado.'}</Estado></MolduraRP>;
	const nome = r.operador?.apelido ?? 'pessoa';
	const titulo = teste ? 'Resultado do teste' : `Sessão de ${nome}${r.tentativa ? ` · tentativa ${r.tentativa}` : ''}`;
	const meio = teste ? (r.cenario ? { rotulo: r.cenario.nome, to: rotaCenarioRP(r.cenario.id) } : null) : (r.atribuicao ? { rotulo: r.cenario?.nome ?? 'Treino', to: rotaAtribuicaoRP(r.atribuicao) } : null);
	const ladoErrado = !teste && r.atribuicao != null && String(r.atribuicao) !== atr;
	const restantes = r.tentativas != null && !teste ? Math.max(0, r.tentativas - (r.tentativa ?? 0)) : null;
	const acoes = (
		<>
			<SeloLgpdTreino />
			{!teste && r.situacao === 'avaliada' && <Botao tipo={revisando ? 'primario' : 'secundario'} onClick={() => setRevisando(v => !v)}>{revisando ? 'Concluir revisão' : 'Revisar avaliação'}</Botao>}
			{!teste && r.operador && <Botao tipo="secundario" onClick={() => abrir('feedback')}>Registrar feedback 1:1</Botao>}
		</>
	);
	return (
		<MolduraRP titulo={titulo} detalhe={teste ? 'Resultado do teste' : `Sessão de ${nome}`} meio={meio} acoes={acoes}
			descricao={`${dataHoraBR(r.inicio)} · texto${r.duracao_s != null ? ` · ${Math.max(1, Math.round(r.duracao_s / 60))} min` : ''}${teste ? ' · teste da Qualidade: não conta para ninguém e a conversa some em 1 dia' : ''}`}>
			{ladoErrado && <div className="mb-4"><Aviso tom="neutro">Esta sessão é de outro treino. <Link className="font-semibold underline" to={rotaSessaoRP(r.atribuicao!, r.sessao)} replace>Abrir no treino certo</Link>.</Aviso></div>}
			{revisando && <div className="mb-4"><Aviso tom="info" titulo="Revisar avaliação.">Mude a resposta do item em que a Qualidade discorda da IA. A revisão vale para esta sessão e entra na concordância IA × Qualidade; a nota da sessão não muda.</Aviso></div>}
			<div className="max-w-[860px]">
				<ResultadoView r={r} quem="qualidade" restantes={restantes} prazo={r.prazo ?? null} revisando={revisando}
					onRevisar={async (item, valor) => {
						const x = await supabase!.rpc('revisar_sessao_treino', { sessao: r.sessao, item, qualidade: valor });
						if (x.error) { toast.error(friendlyError(x.error)); return; }
						toast.success('Revisão guardada.');
						setVersao(v => v + 1);
					}}
					onResolver={async id => {
						const x = await supabase!.rpc('resolver_discordancia_treino', { discordancia: id });
						if (x.error) { toast.error(friendlyError(x.error)); return; }
						toast.success('Discordância marcada como resolvida.');
						setVersao(v => v + 1);
					}} />
			</div>
			{!teste && r.operador && (
				<Gaveta aberta={painel === 'feedback'} onFechar={fechar} titulo={`Feedback 1:1 com ${nome}`} subtitulo="O que foi combinado e a próxima conversa. Fica no histórico da pessoa.">
					<PainelFeedback apelido={nome} cenario={r.cenario?.nome ?? ''}
						onSalvar={async (combinado, proxima) => { await salvarFeedback(supabase!, empresa, { operador: r.operador!.id, combinado, proxima_conversa: proxima, atribuicao: r.atribuicao ?? null, sessao: r.sessao }); toast.success('Feedback registrado.'); }} />
				</Gaveta>
			)}
			{!teste && !r.atribuicao && <p className="mt-4 text-[12.5px]"><Link className="font-semibold text-[var(--destaque)] hover:underline" to={ROTA_RP_ATRIBUICOES}>Treinos atribuídos</Link></p>}
		</MolduraRP>
	);
}
