// Caminho da versão (PR7 do redesenho; SPEC §2.1 e §2.4): Rascunho → Testes → Aprovação → Em uso, com uma única ação
// principal no cabeçalho, e a aba "Versões e aprovação": checklist "Antes de aprovar", parecer e Aprovar (quem tem
// Aprovar roteiro de voz), "o que muda" da versão em uso para a aberta em palavras, comparar com qualquer versão e
// "Voltar para esta" (arquivada, com motivo). As travas e permissões são as de antes: o banco segura enviar, aprovar e
// colocar em uso enquanto houver pendência (fluxo_voz_bloqueios); a equipe MotorCX envia, nunca aprova.
import { useState, type ReactNode } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import { Botao, Pilula, campoCls, campoStyle } from '@/components/voz/ui';
import { VoltarBotao } from '@/components/comuns/voltar';
import { SITUACOES, dataCurta, type SituacaoVersao } from '@/lib/fluxo';
import { FASES, diferencas, resumoDiferencas, type AcaoFase, type Diferenca, type Fase, type ItemCheck } from '@/lib/fluxo-versao';
import type { VersaoRow } from './api';
import { RegrasQuem } from './comum';
import { Campo } from './ds';

const card = 'rounded-2xl bg-[var(--base-cartao)] px-4 py-3';
const sombra = { boxShadow: '0 0 0 1px var(--base-borda)' };
const link = 'text-[12.5px] font-semibold text-[var(--destaque)]';

export interface ResumoCaminho {
	versao: number; desenho: number; casos: { passaram: number; total: number; falharam: number }; avisosPersonas: number;
	enviadoEm: string | null; aprovadoEm: string | null; situacao: SituacaoVersao; emUso: { versao: number; desde: string | null } | null;
}

/** As 4 fases, com o que falta em cada uma. No celular, 2 × 2. */
export function CaminhoVersao({ fase, r }: { fase: Fase; r: ResumoCaminho }) {
	const casos = !r.casos.total ? 'nenhum caso de teste guardado' : r.casos.total === 1 ? r.casos.passaram ? '1 de 1 caso passou' : '0 de 1 caso passou' : `${r.casos.passaram} de ${r.casos.total} casos passaram`;
	const linhas: [string, string, boolean][] = [
		[`v${r.versao} · quem tem Editar canais edita`, r.desenho ? `${r.desenho} ${r.desenho === 1 ? 'ponto' : 'pontos'} a corrigir` : 'tudo certo no desenho', r.desenho > 0],
		[casos, r.avisosPersonas ? `personas: ${r.avisosPersonas} ${r.avisosPersonas === 1 ? 'aviso' : 'avisos'}` : 'personas: sem aviso', r.casos.falharam > 0],
		['quem tem Aprovar roteiro de voz', r.situacao === 'aprovado_empresa' || r.situacao === 'em_uso' ? `aprovada${r.aprovadoEm ? ` em ${dataCurta(r.aprovadoEm)}` : ''}` : r.enviadoEm ? `enviada em ${dataCurta(r.enviadoEm)} · aguardando` : 'ainda não enviada', false],
		['entra na próxima ligação', r.situacao === 'em_uso' ? `em uso${r.emUso?.desde ? ` desde ${dataCurta(r.emUso.desde)}` : ''}` : r.emUso ? `hoje: v${r.emUso.versao} em uso${r.emUso.desde ? ` desde ${dataCurta(r.emUso.desde)}` : ''}` : 'nenhuma versão em uso ainda', false],
	];
	return (
		<ol aria-label="Caminho da versão" className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[var(--base-cartao)] p-2 lg:grid-cols-4" style={sombra}>
			{FASES.map((nome, i) => {
				const feito = i < fase || (i === 3 && fase === 3);
				const atual = i === fase && fase !== 3;
				const [a, b, ruim] = linhas[i];
				return (
					<li key={nome} aria-current={i === fase ? 'step' : undefined} data-fase={i} className="flex min-w-0 items-start gap-2 rounded-xl px-2.5 py-2" style={atual ? { backgroundColor: 'var(--base-fill)', boxShadow: 'inset 0 0 0 1.5px var(--area-voz)' } : undefined}>
						<span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold"
							style={{ backgroundColor: feito ? 'var(--estado-pronto-fundo)' : atual ? 'var(--destaque)' : 'var(--base-fill)', color: feito ? 'var(--estado-pronto-texto)' : atual ? 'var(--destaque-texto)' : 'var(--base-texto-2)' }}>
							{feito ? <Check size={13} aria-hidden /> : i + 1}
						</span>
						<span className="min-w-0">
							<b className="block text-[13.5px] font-semibold text-[var(--base-texto)]">{nome}{feito ? <span className="sr-only"> (feito)</span> : atual ? <span className="sr-only"> (agora)</span> : null}</b>
							<small className="block text-[12px] text-[var(--base-texto-2)]">{a}</small>
							<small className="block text-[12px]" style={{ color: ruim && i <= fase ? 'var(--estado-erro-texto)' : 'var(--base-texto-2)' }}>{b}</small>
						</span>
					</li>
				);
			})}
		</ol>
	);
}

/** A única ação principal do cabeçalho; o motivo fica escrito embaixo (decisão do dono: o bloqueio sempre diz por quê). */
export function AcaoPrincipal({ acao, ocupado, onAcao }: { acao: AcaoFase; ocupado?: boolean; onAcao: (t: AcaoFase['tipo']) => void }) {
	const btn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
	return (
		<div className="flex max-w-[300px] flex-col items-start gap-1 sm:items-end">
			{acao.tipo !== 'nenhuma'
				? <button type="button" className={btn} style={{ backgroundColor: 'var(--destaque)', color: 'var(--destaque-texto)' }} disabled={ocupado} aria-describedby="motivo-envio" data-acao={acao.tipo} onClick={() => onAcao(acao.tipo)}>{acao.rotulo}</button>
				: null}
			{acao.nota && <span id="motivo-envio" role="status" className="text-[12px] text-[var(--base-texto-2)] sm:text-right">{acao.nota}</span>}
		</div>
	);
}

const ICONE: Record<ItemCheck['estado'], { cor: string; fundo: string; el: ReactNode; rot: string }> = {
	ok: { cor: 'var(--estado-pronto-texto)', fundo: 'var(--estado-pronto-fundo)', el: <Check size={12} aria-hidden />, rot: 'em dia' },
	erro: { cor: 'var(--estado-erro-texto)', fundo: 'var(--estado-erro-fundo)', el: <X size={12} aria-hidden />, rot: 'impede' },
	aviso: { cor: 'var(--estado-atencao-texto)', fundo: 'var(--estado-atencao-fundo)', el: <span aria-hidden className="text-[11px] font-bold">!</span>, rot: 'atenção' },
};

/** Checklist "Antes de aprovar": cada item com o estado e o atalho para onde se resolve. */
export function ChecklistAprovar({ itens, onIr }: { itens: ItemCheck[]; onIr?: (id: ItemCheck['id']) => void }) {
	const atalho: Partial<Record<ItemCheck['id'], string>> = { desenho: 'ver no roteiro', casos: 'ver nos testes', personas: 'ver nos testes', respostas: 'revisar', alcada: 'cadastrar' };
	return (
		<ul className="mt-2 space-y-1.5" aria-label="Antes de aprovar">
			{itens.map(it => {
				const ic = ICONE[it.estado];
				const mostra = onIr && atalho[it.id] && (it.estado !== 'ok' || it.id === 'casos');
				return (
					<li key={it.id} data-check={it.id} data-estado={it.estado} className="flex items-start gap-2 text-[13px] text-[var(--base-texto)]">
						<span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ color: ic.cor, backgroundColor: ic.fundo }}>{ic.el}<span className="sr-only">{ic.rot}:</span></span>
						<span className="min-w-0">{it.texto}{mostra && <> · <button type="button" className={link} onClick={() => onIr!(it.id)}>{atalho[it.id]}</button></>}</span>
					</li>
				);
			})}
		</ul>
	);
}

/** "O que muda", em palavras: + etapa nova, − removida, ~ alterada (com antes → depois). */
export function ListaDiferencas({ itens, onAbrirEtapa }: { itens: Diferenca[]; onAbrirEtapa?: (id: string) => void }) {
	if (!itens.length) return <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Nenhuma diferença no desenho: as etapas, as falas e os caminhos são os mesmos.</p>;
	const marca = { nova: { el: <Plus size={13} aria-hidden />, cor: 'var(--estado-pronto-texto)', rot: 'Etapa nova' }, removida: { el: <Minus size={13} aria-hidden />, cor: 'var(--estado-erro-texto)', rot: 'Etapa removida' }, alterada: { el: <span aria-hidden className="font-bold">~</span>, cor: 'var(--estado-atencao-texto)', rot: 'Etapa alterada' } };
	return (
		<ul className="mt-2 divide-y" style={{ borderColor: 'var(--base-borda)' }} aria-label="O que muda">
			{itens.map(d => (
				<li key={`${d.tipo}-${d.id}`} data-diferenca={d.tipo} className="flex items-start gap-2 py-2" style={{ borderColor: 'var(--base-borda)' }}>
					<span className="mt-0.5 grid w-4 shrink-0 place-items-center" style={{ color: marca[d.tipo].cor }}>{marca[d.tipo].el}</span>
					<span className="min-w-0 text-[13px]">
						<span className="sr-only">{marca[d.tipo].rot}: </span>
						{onAbrirEtapa && d.tipo !== 'removida'
							? <button type="button" className="text-left font-semibold text-[var(--base-texto)] hover:underline" onClick={() => onAbrirEtapa(d.id)}>{d.tipo === 'nova' ? `Nova etapa "${d.nome}"` : d.nome}</button>
							: <b className="font-semibold">{d.tipo === 'removida' ? `Saiu a etapa "${d.nome}"` : d.nome}</b>}
						{d.detalhes.map((t, i) => <small key={i} className="block text-[12.5px] text-[var(--base-texto-2)]" style={{ overflowWrap: 'anywhere' }}>{t}</small>)}
					</span>
				</li>
			))}
		</ul>
	);
}

export interface PropsAbaVersoes {
	v: VersaoRow; versoes: VersaoRow[]; checklist: ItemCheck[]; conectores: { id: number; nome: string }[];
	podeEditar: boolean; podeAprovar: boolean; ocupado: boolean; impede: number;
	comparar: number | null; onComparar: (id: number | null) => void;
	onAprovar: (parecer: string) => void; onEnviar: () => void; onUsar: () => void;
	onAbrir: (id: number) => void; onVoltar: (versao: number, motivo: string) => Promise<boolean>;
	onIr: (id: ItemCheck['id']) => void; onAbrirEtapa: (id: string) => void;
}

/** Aba "Versões e aprovação". */
export function AbaVersoes(p: PropsAbaVersoes) {
	const { v, versoes } = p;
	const [parecer, setParecer] = useState('');
	const [voltar, setVoltar] = useState<number | null>(null);
	const [motivo, setMotivo] = useState('');
	const emUso = versoes.find(x => x.situacao === 'em_uso') ?? null;
	// base padrão: a em uso; se a aberta é a em uso, a versão anterior a ela
	const padrao = emUso && emUso.id !== v.id ? emUso : [...versoes].filter(x => x.versao < v.versao).sort((a, b) => b.versao - a.versao)[0] ?? null;
	const escolhida = p.comparar != null ? versoes.find(x => x.id === p.comparar && x.id !== v.id) ?? null : null;
	const base = escolhida ?? padrao;
	const [antes, depois] = base ? (base.versao < v.versao ? [base, v] : [v, base]) : [null, v];
	const difs = antes ? diferencas(antes.definicao, depois.definicao, { conectores: p.conectores }) : [];
	const rotV = (x: VersaoRow) => `v${x.versao}${x.situacao === 'em_uso' ? ' (em uso)' : ''}`;
	const enviado = v.situacao === 'rascunho' && !!v.enviado_aprovacao_em;

	return (
		<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
			<div className="min-w-0 space-y-4">
				<section className={card} style={sombra} aria-labelledby="antes-aprovar">
					<h2 id="antes-aprovar" className="text-[15px] font-semibold text-[var(--base-texto)]">{v.situacao === 'rascunho' ? `Antes de aprovar a v${v.versao}` : `A v${v.versao} hoje`}</h2>
					<ChecklistAprovar itens={p.checklist} onIr={v.situacao === 'rascunho' ? p.onIr : undefined} />
					{v.parecer && <p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]"><b className="font-semibold text-[var(--base-texto)]">Parecer de quem aprovou:</b> {v.parecer}</p>}
					{v.situacao === 'rascunho' && p.podeAprovar && (
						<div className="mt-3 space-y-2">
							<Campo rotulo="Parecer de quem aprova (opcional)" ajuda="Fica registrado com a aprovação.">
								<textarea rows={2} maxLength={500} value={parecer} onChange={e => setParecer(e.target.value)} placeholder="Ex.: testei o caminho de quem diz que já pagou" className={`${campoCls} h-auto w-full py-2`} style={campoStyle} />
							</Campo>
							<div className="flex flex-wrap items-center gap-2">
								<Botao onClick={() => p.onAprovar(parecer.trim())} disabled={p.ocupado || p.impede > 0}>Aprovar</Botao>
								{p.impede > 0
									? <span role="status" className="text-[12px] text-[var(--estado-erro-texto)]">{p.impede} {p.impede === 1 ? 'pendência impede' : 'pendências impedem'} a aprovação.</span>
									: !enviado && <span className="text-[12px] text-[var(--base-texto-2)]">Ainda não enviada por quem edita; você pode aprovar assim mesmo.</span>}
							</div>
						</div>
					)}
					{v.situacao === 'rascunho' && !p.podeAprovar && p.podeEditar && (
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<Botao secundario={enviado} onClick={p.onEnviar} disabled={p.ocupado || p.impede > 0}>{enviado ? 'Enviar de novo' : 'Enviar para aprovação'}</Botao>
							<span className="text-[12px] text-[var(--base-texto-2)]">{enviado ? `Enviada em ${dataCurta(v.enviado_aprovacao_em)}. Enviar de novo avisa quem aprova outra vez.` : 'Quem tem Aprovar roteiro de voz aprova.'}</span>
						</div>
					)}
					{v.situacao === 'aprovado_empresa' && (
						<div className="mt-3 flex flex-wrap items-center gap-2">
							{p.podeAprovar ? <Botao onClick={p.onUsar} disabled={p.ocupado}>Colocar em uso</Botao> : null}
							<span className="text-[12px] text-[var(--base-texto-2)]">Aprovada{v.aprovado_em ? ` em ${dataCurta(v.aprovado_em)}` : ''}. {p.podeAprovar ? 'Vale a partir da próxima ligação.' : 'Quem tem Aprovar roteiro de voz coloca em uso.'}</span>
						</div>
					)}
				</section>

				<section className={card} style={sombra} aria-labelledby="o-que-muda">
					{escolhida && padrao && <VoltarBotao rotulo={`Comparação com a ${rotV(padrao)}`} onClick={() => p.onComparar(null)} />}
					<h2 id="o-que-muda" className="text-[15px] font-semibold text-[var(--base-texto)]">{antes ? `O que muda da ${rotV(antes)} para a ${rotV(depois)}` : 'O que muda'}</h2>
					{antes ? (
						<>
							<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Em palavras, para quem aprova não precisar comparar o desenho. {resumoDiferencas(difs)}</p>
							<ListaDiferencas itens={difs} onAbrirEtapa={depois.id === v.id ? p.onAbrirEtapa : undefined} />
						</>
					) : <p className="mt-1 text-[13px] text-[var(--base-texto-2)]">É a primeira versão deste fluxo: não há com o que comparar. Todas as etapas são novas.</p>}
				</section>
			</div>

			<div className="min-w-0 space-y-4">
				<section className={card} style={sombra} aria-labelledby="lista-versoes">
					<h2 id="lista-versoes" className="text-[15px] font-semibold text-[var(--base-texto)]">Versões</h2>
					<ul className="mt-1 divide-y" style={{ borderColor: 'var(--base-borda)' }}>
						{versoes.map(x => {
							const sub = x.situacao === 'em_uso' ? `em uso desde ${dataCurta(x.em_uso_em)}`
								: x.situacao === 'arquivado' ? `até ${dataCurta(x.arquivado_em)}`
								: x.situacao === 'aprovado_empresa' ? `aprovada em ${dataCurta(x.aprovado_em)}`
								: x.enviado_aprovacao_em ? `enviada em ${dataCurta(x.enviado_aprovacao_em)}` : `editada em ${dataCurta(x.atualizado_em ?? x.criado_em)}`;
							const aberta = x.id === v.id;
							const comparando = base?.id === x.id;
							return (
								<li key={x.id} data-versao={x.versao} className="py-2" style={{ borderColor: 'var(--base-borda)' }}>
									<div className="flex flex-wrap items-start justify-between gap-2">
										<span className="min-w-0 text-[13px]">
											<b className="font-semibold tnum">v{x.versao}</b> <Pilula tom={SITUACOES[x.situacao].tom}>{x.situacao === 'rascunho' && x.enviado_aprovacao_em ? 'aguardando aprovação' : SITUACOES[x.situacao].nome}</Pilula>
											{aberta && <span className="text-[var(--base-texto-3)]"> · aberta</span>}
											<small className="block text-[12px] text-[var(--base-texto-2)]">{sub}{x.motivo ? ` · ${x.motivo}` : ''}</small>
										</span>
										<span className="flex flex-wrap gap-x-3 gap-y-1">
											{!aberta && <button type="button" className={link} onClick={() => p.onAbrir(x.id)}>Abrir</button>}
											{!aberta && (comparando ? <span className="text-[12.5px] text-[var(--base-texto-3)]">comparando</span> : <button type="button" className={link} onClick={() => p.onComparar(x.id)}>Comparar</button>)}
											{x.situacao === 'arquivado' && p.podeAprovar && <button type="button" className={link} onClick={() => { setVoltar(voltar === x.versao ? null : x.versao); setMotivo(''); }}>Voltar para esta</button>}
										</span>
									</div>
									{voltar === x.versao && (
										<div className="mt-2 space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
											<Campo rotulo={`Por que voltar para a v${x.versao}?`} ajuda="5 a 300 caracteres. Vale a partir da próxima ligação; a versão em uso vai para o arquivo. Nada é apagado.">
												<input value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} className={`${campoCls} w-full`} style={campoStyle} />
											</Campo>
											<Botao disabled={p.ocupado || motivo.trim().length < 5} onClick={() => void p.onVoltar(x.versao, motivo.trim()).then(ok => { if (ok) { setVoltar(null); setMotivo(''); } })}>Voltar para a v{x.versao}</Botao>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</section>
				<section className={card} style={sombra}>
					<h2 className="mb-2 text-[15px] font-semibold text-[var(--base-texto)]">Quem faz o quê</h2>
					<RegrasQuem />
				</section>
			</div>
		</div>
	);
}
