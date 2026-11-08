// Abas do editor do fluxo (PR3 do redesenho; SPEC §2.2): Roteiro · Mapa · Respostas prontas · Testes · Versões e
// aprovação. A aba fica na URL (?aba=mapa). Respostas prontas, Testes e Versões e aprovação mostram o que já existe
// hoje e levam às telas de hoje (gaveta da etapa de IA, Testar conversa, Testar com personas); o conteúdo novo dessas
// abas (revisar todas, rodar todos, comparar versões em palavras) vem no PR7. Nada some: só muda de lugar.
import { useNavigate } from 'react-router';
import { Loading, Notice } from '@/components/app-shell';
import { Aviso, Botao, Pilula } from '@/components/voz/ui';
import { Abas } from '@/components/ds';
import { SITUACOES, dataCurta, nomesEtapas, type Definicao } from '@/lib/fluxo';
import type { VersaoRow } from './api';
import { Linhas } from './ds';
import { useFluxo } from './contexto';
import { RegrasQuem, useCarregar } from './comum';

export type AbaEditor = 'roteiro' | 'mapa' | 'respostas' | 'testes' | 'versoes';
export const ABAS_EDITOR: { id: AbaEditor; nome: string }[] = [
	{ id: 'roteiro', nome: 'Roteiro' },
	{ id: 'mapa', nome: 'Mapa' },
	{ id: 'respostas', nome: 'Respostas prontas' },
	{ id: 'testes', nome: 'Testes' },
	{ id: 'versoes', nome: 'Versões e aprovação' },
];
/** Aba vinda da URL; qualquer outra coisa abre o Roteiro (a vista padrão). */
export const abaDaUrl = (v: string | null): AbaEditor => (ABAS_EDITOR.some(a => a.id === v) ? (v as AbaEditor) : 'roteiro');

export function AbasEditor({ atual, onTrocar, contagens }: { atual: AbaEditor; onTrocar: (a: AbaEditor) => void; contagens?: Partial<Record<AbaEditor, number>> }) {
	return <Abas rotulo="Partes do fluxo" atual={atual} onTrocar={id => onTrocar(id as AbaEditor)} itens={ABAS_EDITOR.map(a => ({ ...a, cont: contagens?.[a.id] ?? null }))} />;
}

const card = 'rounded-2xl bg-[var(--base-cartao)] px-4 py-3';
const sombra = { boxShadow: '0 0 0 1px var(--base-borda)' };
const link = 'text-[12.5px] font-semibold text-[var(--destaque)]';

/** Respostas prontas: todas as da versão, por etapa. Escrever e revisar continua na etapa de IA (gaveta), como hoje. */
export function AbaRespostas({ versao, definicao, onAbrirEtapa }: { versao: number; definicao: Definicao; onAbrirEtapa: (id: string) => void }) {
	const { api } = useFluxo();
	const { dados, erro, carregando } = useCarregar(async () => (api ? api.respostas(versao) : []), [api, versao]);
	const nomes = nomesEtapas(definicao);
	const ias = definicao.blocos.filter(b => b.tipo === 'generativa');
	if (carregando && !dados) return <Loading />;
	if (erro && !dados) return <Notice>{erro}</Notice>;
	const lista = dados ?? [];
	const sem = lista.filter(r => !r.revisado_em).length;
	return (
		<div className="space-y-4">
			<div className={card} style={sombra}>
				<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Respostas prontas</h2>
				<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Perguntas que o cliente costuma fazer, com a resposta que a empresa aprovou. A conversa com IA só usa as revisadas por quem aprova. Sem dado de cliente.</p>
				{lista.length > 0 && (sem
					? <div className="mt-3"><Aviso tom="atencao" titulo={`${sem} sem revisão.`}>Quem aprova revisa na etapa de IA, em "Base de respostas".</Aviso></div>
					: <div className="mt-3"><Aviso tom="ok" titulo="Todas revisadas." /></div>)}
				{lista.length ? (
					<div className="mt-2">
						<Linhas itens={lista.map(r => ({
							e: <b className="font-semibold">{r.pergunta}</b>,
							s: <>{r.resposta}<span className="mt-0.5 block text-[var(--base-texto-3)]">Etapa: <button type="button" className={link} onClick={() => onAbrirEtapa(r.bloco_id)}>{nomes.get(r.bloco_id) ?? 'etapa que não existe mais'}</button></span></>,
							d: r.revisado_em ? <Pilula tom="ok">revisada</Pilula> : <Pilula tom="atencao">sem revisão</Pilula>,
						}))} />
					</div>
				) : <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">{ias.length ? 'Nenhuma resposta pronta nesta versão ainda.' : 'Este fluxo não tem etapa de conversa com IA: as respostas prontas só valem nela.'}</p>}
			</div>
			{ias.length > 0 && (
				<div className={card} style={sombra}>
					<h3 className="text-[13.5px] font-semibold text-[var(--base-texto)]">Escrever ou revisar</h3>
					<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Hoje, as respostas ficam dentro de cada etapa de conversa com IA.</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{ias.map(b => <Botao key={b.id} secundario onClick={() => onAbrirEtapa(b.id)}>Abrir “{nomes.get(b.id)}”</Botao>)}
					</div>
				</div>
			)}
		</div>
	);
}

/** Testes: casos de teste guardados com o último resultado nesta versão, mais os atalhos para as telas de teste. */
export function AbaTestes({ versao, fluxo, pendencias }: { versao: number; fluxo: number; pendencias: { casos: number; avisos: string[] } }) {
	const { api, rota } = useFluxo();
	const navigate = useNavigate();
	const { dados, erro, carregando } = useCarregar(async () => {
		if (!api) return { casos: [], res: [] };
		const [casos, res] = await Promise.all([api.casos(fluxo), api.resultadosCasos(versao)]);
		return { casos, res };
	}, [api, fluxo, versao]);
	if (carregando && !dados) return <Loading />;
	if (erro && !dados) return <Notice>{erro}</Notice>;
	const casos = (dados?.casos ?? []).filter(c => c.ativo);
	const res = new Map((dados?.res ?? []).map(r => [r.caso_id, r]));
	return (
		<div className="grid items-start gap-4 lg:grid-cols-2">
			<div className={card} style={sombra}>
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Casos de teste</h2>
						<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Conversas guardadas que rodam a cada versão. Caso que falha segura a aprovação.</p>
					</div>
					<Botao secundario onClick={() => navigate(rota('testar', null, { versao }))}>Testar conversa</Botao>
				</div>
				{pendencias.casos > 0 && <div className="mt-3"><Aviso tom="erro" titulo={`${pendencias.casos} ${pendencias.casos === 1 ? 'caso falhou' : 'casos falharam'} nesta versão.`}>Abra Testar conversa para ver o caminho e rodar de novo.</Aviso></div>}
				{casos.length ? (
					<div className="mt-2">
						<Linhas itens={casos.map(c => {
							const r = res.get(c.id);
							return {
								e: <b className="font-semibold">{c.nome}</b>,
								s: r ? `Rodou em ${dataCurta(r.executado_em)}` : 'Ainda não rodou nesta versão',
								d: !r ? <Pilula tom="neutro">não rodou</Pilula> : r.passou ? <Pilula tom="ok">passou</Pilula> : <Pilula tom="erro">falhou</Pilula>,
							};
						})} />
					</div>
				) : <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Nenhum caso guardado. Em Testar conversa, uma conversa vira caso de teste no fim.</p>}
			</div>
			<div className={card} style={sombra}>
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Testar com personas</h2>
						<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">A IA faz o papel de clientes fictícios. É aviso, nunca bloqueio.</p>
					</div>
					<Botao secundario onClick={() => navigate(rota('personas', null, { versao }))}>Testar com personas</Botao>
				</div>
				{pendencias.avisos.length > 0
					? <div className="mt-3"><Aviso tom="atencao" titulo="Antes de aprovar:">{pendencias.avisos.join(' ')}</Aviso></div>
					: <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Os lotes e o resultado por persona ficam na tela Testar com personas.</p>}
			</div>
		</div>
	);
}

/** Versões e aprovação: a lista de versões e quem faz o quê. O caminho da versão fica no topo do editor; aprovar e
 * colocar em uso continuam no botão do cabeçalho; voltar para uma versão arquivada, na lista de fluxos (quem aprova). */
export function AbaVersoes({ v, versoes, onAbrir }: { v: VersaoRow; versoes: VersaoRow[]; onAbrir: (id: number) => void }) {
	const { rota } = useFluxo();
	const navigate = useNavigate();
	return (
		<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
			<div className="space-y-4">
				<div className={card} style={sombra}>
					<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Versões</h2>
					<Linhas itens={versoes.map(x => ({
						e: <><b className="font-semibold tnum">v{x.versao}</b> <Pilula tom={SITUACOES[x.situacao].tom}>{SITUACOES[x.situacao].nome}</Pilula>{x.id === v.id ? <span className="text-[var(--base-texto-3)]"> · aberta</span> : null}</>,
						s: x.motivo ?? `Atualizada em ${dataCurta(x.atualizado_em ?? x.criado_em)}`,
						d: x.id !== v.id ? <button type="button" className={link} onClick={() => onAbrir(x.id)}>Abrir</button> : null,
					}))} />
					<p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">Enviar, aprovar e colocar em uso ficam no botão do topo, que muda conforme a fase. Voltar para uma versão arquivada fica na <button type="button" className={link} onClick={() => navigate(rota('lista'))}>lista de fluxos</button> (quem aprova), com motivo.</p>
				</div>
			</div>
			<div className={card} style={sombra}>
				<h2 className="mb-2 text-[15px] font-semibold text-[var(--base-texto)]">Quem faz o quê</h2>
				<RegrasQuem />
			</div>
		</div>
	);
}
