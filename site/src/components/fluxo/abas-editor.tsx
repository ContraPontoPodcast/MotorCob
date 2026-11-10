// Abas do editor do fluxo (PR3 do redesenho; SPEC §2.2): Roteiro · Mapa · Respostas prontas · Testes · Versões e
// aprovação. A aba fica na URL (?aba=mapa). PR7: Respostas prontas com a fila de revisão (quem aprova revisa aqui);
// Testes com os casos de teste (rodar todos, onde cada um parou, com link para a etapa) e o resumo das personas (último
// lote desta versão × o da versão em uso). Versões e aprovação fica em versao.tsx. Escrever uma resposta continua na
// etapa de IA; o roleplay completo continua em Testar com personas.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Play } from 'lucide-react';
import { Aviso, Botao, Pilula } from '@/components/voz/ui';
import { Abas } from '@/components/ds';
import { dataCurta, nomesEtapas, textoFim, type Definicao } from '@/lib/fluxo';
import type { CasoResultadoRow, CasoRow, ResultadoLoteRow, RespostaRow } from './api';
import { Linhas, Seg } from './ds';
import { useFluxo } from './contexto';
import { executar, useCarregar } from './comum';

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

/** Respostas prontas: todas as da versão, com a fila do que falta revisar. Quem aprova revisa aqui (revisar_resposta_
 * fluxo_voz: só quem tem Aprovar roteiro de voz); a conversa com IA só usa as revisadas. Escrever continua na etapa. */
export function AbaRespostas({ respostas, definicao, podeAprovar, onAbrirEtapa, onMudou }: {
	respostas: RespostaRow[]; definicao: Definicao; podeAprovar: boolean; onAbrirEtapa: (id: string) => void; onMudou: () => void;
}) {
	const { api } = useFluxo();
	const nomes = nomesEtapas(definicao);
	const ias = definicao.blocos.filter(b => b.tipo === 'generativa');
	const sem = respostas.filter(r => !r.revisado_em);
	const [filtro, setFiltro] = useState<'fila' | 'todas'>(sem.length ? 'fila' : 'todas');
	const [revisando, setRevisando] = useState<number | null>(null);
	const lista = filtro === 'fila' ? sem : [...sem, ...respostas.filter(r => r.revisado_em)];
	async function revisar(id: number) {
		if (!api) return;
		setRevisando(id);
		if (await executar(() => api.revisarResposta(id), 'Resposta revisada. A partir de agora a IA pode usar.')) onMudou();
		setRevisando(null);
	}
	return (
		<div className="space-y-4">
			<div className={card} style={sombra}>
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Respostas prontas</h2>
						<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Perguntas que o cliente costuma fazer, com a resposta que a empresa aprovou. A conversa com IA só usa as revisadas por quem aprova. Sem dado de cliente.</p>
					</div>
					{respostas.length > 0 && <Seg rotulo="Mostrar" valor={filtro} onChange={setFiltro} itens={[{ v: 'fila', n: `Para revisar (${sem.length})` }, { v: 'todas', n: `Todas (${respostas.length})` }]} />}
				</div>
				{respostas.length > 0 && (sem.length
					? <div className="mt-3"><Aviso tom="atencao" titulo={`${sem.length} sem revisão.`}>{podeAprovar ? 'Leia e revise cada uma. Só as revisadas vão para a ligação.' : 'Quem tem Aprovar roteiro de voz revisa aqui. Até lá, a IA não usa.'}</Aviso></div>
					: <div className="mt-3"><Aviso tom="ok" titulo="Todas revisadas." /></div>)}
				{lista.length ? (
					<div className="mt-2">
						<Linhas itens={lista.map(r => ({
							e: <b className="font-semibold">{r.pergunta}</b>,
							s: <>{r.resposta}<span className="mt-0.5 block text-[var(--base-texto-3)]">Etapa: <button type="button" className={link} onClick={() => onAbrirEtapa(r.bloco_id)}>{nomes.get(r.bloco_id) ?? 'etapa que não existe mais'}</button>{r.revisado_em ? ` · revisada em ${dataCurta(r.revisado_em)}` : ''}</span></>,
							d: r.revisado_em ? <Pilula tom="ok">revisada</Pilula>
								: podeAprovar ? <Botao onClick={() => void revisar(r.id)} disabled={revisando != null}>{revisando === r.id ? 'Revisando…' : 'Revisar e aprovar'}</Botao>
								: <Pilula tom="atencao">sem revisão</Pilula>,
						}))} />
					</div>
				) : <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">{respostas.length ? 'Nada para revisar. Todas as respostas desta versão já foram revisadas.' : ias.length ? 'Nenhuma resposta pronta nesta versão ainda.' : 'Este fluxo não tem etapa de conversa com IA: as respostas prontas só valem nela.'}</p>}
			</div>
			{ias.length > 0 && (
				<div className={card} style={sombra}>
					<h3 className="text-[13.5px] font-semibold text-[var(--base-texto)]">Escrever ou mudar uma resposta</h3>
					<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Fica na etapa de conversa com IA, em "Base de respostas". Resposta mudada volta para a fila de revisão.</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{ias.map(b => <Botao key={b.id} secundario onClick={() => onAbrirEtapa(b.id)}>Abrir “{nomes.get(b.id)}”</Botao>)}
					</div>
				</div>
			)}
		</div>
	);
}

/** Testes: casos de teste (rodar todos nesta versão; o que falhou diz onde parou, com link para a etapa) e o resumo das
 * personas (último lote concluído desta versão × o da versão em uso). Caso que falha segura a aprovação; personas é aviso. */
export function AbaTestes({ versao, definicao, casos, resultados, falharam, avisos, podeEditar, emUso, onMudou, onAbrirEtapa }: {
	versao: { id: number; versao: number }; definicao: Definicao; casos: CasoRow[]; resultados: CasoResultadoRow[]; falharam: number; avisos: string[];
	podeEditar: boolean; emUso: { id: number; versao: number } | null; onMudou: () => void; onAbrirEtapa: (id: string) => void;
}) {
	const { api, rota } = useFluxo();
	const navigate = useNavigate();
	const nomes = nomesEtapas(definicao);
	const [rodando, setRodando] = useState(false);
	const ativos = casos.filter(c => c.ativo);
	const res = new Map(resultados.map(r => [r.caso_id, r]));
	const passaram = ativos.filter(c => res.get(c.id)?.passou).length;
	const personas = useCarregar(async () => {
		if (!api) return null;
		const ult = async (id: number) => (await api.lotes(id)).find(l => l.situacao === 'concluido') ?? null;
		const [lote, loteUso] = await Promise.all([ult(versao.id), emUso ? ult(emUso.id) : Promise.resolve(null)]);
		const [a, b] = await Promise.all([lote ? api.resultadoLote(lote.id) : Promise.resolve([] as ResultadoLoteRow[]), loteUso ? api.resultadoLote(loteUso.id) : Promise.resolve([] as ResultadoLoteRow[])]);
		return { lote, a, b };
	}, [api, versao.id, emUso?.id]);
	async function rodarTodos() {
		if (!api) return;
		setRodando(true);
		await executar(async () => { const r = await api.rodarCasos(versao.id); const f = r.filter(x => !x.passou).length; if (f) throw new Error(`${f} de ${r.length} casos falharam nesta versão (seguram a aprovação).`); }, 'Todos os casos passaram.');
		setRodando(false); onMudou();
	}
	const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v))}%`);
	const p = personas.dados;
	const porPersona = new Map((p?.b ?? []).map(r => [r.persona_id, r]));
	return (
		<div className="grid items-start gap-4 lg:grid-cols-2">
			<section className={card} style={sombra} aria-labelledby="casos-teste">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<h2 id="casos-teste" className="text-[15px] font-semibold text-[var(--base-texto)]">Casos de teste</h2>
						<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Conversas guardadas que rodam a cada versão. Caso que falha segura a aprovação.</p>
					</div>
					{podeEditar && <Botao secundario onClick={() => void rodarTodos()} disabled={rodando || !ativos.length}><Play size={14} aria-hidden /> {rodando ? 'Rodando…' : 'Rodar todos'}</Botao>}
				</div>
				{ativos.length > 0 && <p className="mt-2 text-[13px] font-semibold text-[var(--base-texto)]">{passaram} de {ativos.length} passaram nesta versão{falharam ? ` · ${falharam} ${falharam === 1 ? 'falhou' : 'falharam'}` : ''}</p>}
				{ativos.length ? (
					<div className="mt-1">
						<Linhas itens={ativos.map(c => {
							const r = res.get(c.id);
							const parou = r && !r.passou ? r.caminho_obtido[r.caminho_obtido.length - 1] : null;
							return {
								e: <b className="font-semibold">{c.nome}</b>,
								s: !r ? 'Ainda não rodou nesta versão.'
									: r.passou ? `Passou em ${dataCurta(r.executado_em)}.`
									: <span style={{ color: 'var(--estado-erro-texto)' }}>
										{parou ? <>Parou em “{nomes.get(parou) ?? 'etapa que não existe mais'}”</> : 'Não chegou a nenhuma etapa'}
										{c.resultado_esperado ? `; esperado: ${textoFim(c.resultado_esperado)}${r.resultado_obtido ? `, deu: ${textoFim(r.resultado_obtido)}` : ''}` : ''}.
										{parou && nomes.has(parou) && <> <button type="button" className={link} onClick={() => onAbrirEtapa(parou)}>Abrir a etapa</button></>}
									</span>,
								d: !r ? <Pilula tom="neutro">não rodou</Pilula> : r.passou ? <Pilula tom="ok">passou</Pilula> : <Pilula tom="erro">falhou</Pilula>,
							};
						})} />
					</div>
				) : <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Nenhum caso guardado. Em Testar conversa, uma conversa vira caso de teste no fim.</p>}
				<div className="mt-3"><Botao secundario onClick={() => navigate(rota('testar', null, { versao: versao.id }))}>Testar conversa em tela cheia</Botao></div>
			</section>
			<section className={card} style={sombra} aria-labelledby="personas-resumo">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<h2 id="personas-resumo" className="text-[15px] font-semibold text-[var(--base-texto)]">Testar com personas</h2>
						<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">A IA faz o papel de clientes fictícios. É aviso, nunca bloqueio.</p>
					</div>
					<Botao secundario onClick={() => navigate(rota('personas', null, { versao: versao.id }))}>{p?.lote ? 'Ver as conversas' : 'Testar com personas'}</Botao>
				</div>
				{avisos.length > 0 && <div className="mt-3"><Aviso tom="atencao" titulo="Antes de aprovar:">{avisos.join(' ')}</Aviso></div>}
				{personas.carregando && !p ? <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Carregando o último lote…</p>
					: personas.erro && !p ? <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Não foi possível ler os lotes agora.</p>
					: p?.lote && p.a.length ? (
						<div className="mt-2 overflow-x-auto">
							<p className="text-[12px] text-[var(--base-texto-3)]">Último lote: {dataCurta(p.lote.concluido_em ?? p.lote.pedido_em)} · {p.lote.conversas} conversas. Acordo simulado por persona.</p>
							<table className="mt-1 w-full min-w-[320px] text-[13px]">
								<thead><tr className="text-left text-[12px] text-[var(--base-texto-2)]"><th className="py-1 pr-2 font-semibold">Persona</th><th className="py-1 pr-2 text-right font-semibold">v{versao.versao}</th>{emUso && <th className="py-1 pr-2 text-right font-semibold">v{emUso.versao} (em uso)</th>}<th className="py-1 font-semibold">Atenção</th></tr></thead>
								<tbody>
									{p.a.map(r => {
										const u = porPersona.get(r.persona_id);
										const reprov = r.conversas - r.passaram;
										const caiu = u && r.taxa_acordo != null && u.taxa_acordo != null && Number(u.taxa_acordo) - Number(r.taxa_acordo) > 5;
										return (
											<tr key={r.persona_id} className="border-t" style={{ borderColor: 'var(--base-borda)' }}>
												<td className="py-1.5 pr-2">{r.persona ?? 'persona'}</td>
												<td className="py-1.5 pr-2 text-right font-semibold tnum" style={caiu ? { color: 'var(--estado-erro-texto)' } : undefined}>{pct(r.taxa_acordo)}</td>
												{emUso && <td className="py-1.5 pr-2 text-right tnum text-[var(--base-texto-2)]">{u ? pct(u.taxa_acordo) : '—'}</td>}
												<td className="py-1.5 text-[12px] text-[var(--base-texto-2)]">{[caiu ? 'acordo caiu mais de 5 p.p.' : '', reprov ? `${reprov} fora do esperado` : '', r.opt_out ? `${r.opt_out} opt-out` : ''].filter(Boolean).join(' · ')}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					) : <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Esta versão ainda não passou por personas. Um lote compara o acordo simulado com a versão em uso.</p>}
			</section>
		</div>
	);
}
