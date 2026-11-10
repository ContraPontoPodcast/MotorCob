// Roteiro: a vista principal do editor do fluxo (PR3 do redesenho; SPEC §2.1). O fluxo se lê como a conversa, de
// cima para baixo, em capítulos ("Começo da ligação", "Negociação", 'Se disser "Já paguei"'…). Cada etapa mostra:
// o que o agente diz · o que o cliente pode responder → então [nome da etapa] · se não entender · se não ouvir nada.
// Só o que o executor faz hoje (voz/fluxo.py); o que ainda não existe aparece como "Ainda sem tratamento próprio".
// Os capítulos derivam de quadroPorRamos (site/src/lib/fluxo.ts), sem campo novo na definição. Só apresentação;
// testado em site/src/components/fluxo/componentes.test.tsx. Desde o PR4, cada etapa traz o "O que corrigir" dela, com
// o botão de correção de um clique quando há (corrigir.tsx). Desde o PR6, com o teste aberto ao lado, a etapa em que
// a conversa está fica acesa e as que já passaram ficam com o número cheio.
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Lock, Settings2 } from 'lucide-react';
import { Pilula } from '@/components/voz/ui';
import {
	MODOS, acaoSistema, comoCorrigir, ehFinal, nomeDestino, nomesEtapas, numerosRoteiro, resultadoFinal, roteiro, seNaoEntender, seNaoOuvir, textoVolta,
	type Bloco, type Capitulo, type Definicao, type Pendencia,
} from '@/lib/fluxo';
import { FALA_PERGUNTA, textoFonte, textoPerguntas, usaArquivo, type ConfigIdentidade, type PerguntaIdentidade } from '@/lib/identidade-mailing';
import { OQueCorrigir, type AcaoCorrigir } from './corrigir';
import { Ponto } from './ds';
import { temTrava, type Marca } from './quadro';

const ancora = (id: string) => `etapa-${id}`;
const SO_SEM_ENTENDER = ['nao_entendido', 'sem_resposta'];

/** Fala com as variáveis {{ }} em destaque (o que muda a cada cliente). */
export function Fala({ texto }: { texto: string }) {
	const partes = texto.split(/(\{\{[^}]*\}\})/g);
	return <>{partes.map((p, i) => (/^\{\{[^}]*\}\}$/.test(p)
		? <span key={i} className="rounded px-1 font-mono text-[12px]" style={{ backgroundColor: 'color-mix(in srgb, var(--area-voz) 14%, transparent)', color: 'var(--area-voz)' }}>{p}</span>
		: <span key={i}>{p}</span>))}</>;
}

/** Chip do modo da etapa, em palavras (cor + nome). */
export function ModoChip({ b }: { b: Bloco }) {
	const m = MODOS[b.modo];
	if (!m) return null;
	return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-[var(--base-texto-2)]" style={{ backgroundColor: 'var(--base-fill)' }}><Ponto cor={m.cor} tam={7} />{m.nome}</span>;
}

/** Link para a etapa de destino, dentro do próprio roteiro (rola até o cartão). */
function Destino({ nomes, para }: { nomes: Map<string, string>; para: string }) {
	const nome = nomeDestino(nomes, para);
	if (!nomes.has(para)) return <b className="font-semibold text-[var(--estado-erro-texto)]">{nome}</b>;
	return <a href={`#${ancora(para)}`} className="font-semibold text-[var(--destaque)] underline-offset-2 hover:underline">{nome}</a>;
}

const Rotulo = ({ children }: { children: ReactNode }) => <span className="block text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--base-texto-3)]">{children}</span>;
const Seta = () => <><span aria-hidden> → </span><span className="sr-only">, </span>então </>;

function Linha({ q, children, fraca }: { q: ReactNode; children: ReactNode; fraca?: boolean }) {
	return (
		<li className="grid gap-x-3 gap-y-0.5 text-[12.5px] sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
			<span className={`min-w-0 font-semibold ${fraca ? 'text-[var(--base-texto-2)]' : 'text-[var(--base-texto)]'}`}>{q}</span>
			<span className="min-w-0 text-[var(--base-texto-2)]">{children}</span>
		</li>
	);
}

/** Uma etapa do roteiro: o que o agente diz, o que o cliente pode responder e para onde vai. */
export function EtapaRoteiro({ b, n, definicao, nomes, numeros, marca, onAbrir, pendencias, acao, identidade, onMudarIdentidade, teste }: {
	b: Bloco; n: number; definicao: Definicao; nomes: Map<string, string>; numeros: Map<string, number>; marca?: Marca; onAbrir: (id: string) => void;
	/** PR6, "Testar conversa" ao lado: 'agora' acende a etapa em que a conversa está; 'passou' marca as que já passaram. */
	teste?: 'agora' | 'fim' | 'passou';
	/** Pendências desta etapa (banco), com "O que corrigir" e o botão de correção. */
	pendencias?: Pendencia[]; acao?: (codigo: string) => AcaoCorrigir | null;
	/** SQL 88: quem confere a identidade na carteira (null = o de hoje; undefined = ainda não carregou). */
	identidade?: ConfigIdentidade | null; onMudarIdentidade?: () => void;
}) {
	const p = b.params ?? {};
	const final = ehFinal(b);
	const ne = seNaoEntender(b);
	const saidaNe = ne ? b.saidas.find(s => s.quando === ne.quando) : undefined;
	const rotuloNe = saidaNe?.rotulo ?? ne?.quando.replace(/_/g, ' ') ?? '';
	// "Não entendi" e "Sem resposta" só acontecem quando o agente não entende: aparecem em "Se não entender", não como resposta.
	const no = seNaoOuvir(b);
	const saidaNo = no?.quando ? b.saidas.find(s => s.quando === no.quando) : undefined;
	const respostas = b.saidas.filter(s => !(ne && s.quando === ne.quando && SO_SEM_ENTENDER.includes(s.quando)) && !(no && s.quando === 'silencio'));
	const fala = typeof p.fala === 'string' ? p.fala.trim() : '';
	const tituloResp = b.tipo === 'generativa' ? 'A conversa termina quando' : b.modo === 'sistema' ? 'Resultado' : 'O cliente pode responder';
	return (
		<li id={ancora(b.id)} data-etapa={b.id} data-teste={teste} className="grid scroll-mt-20 grid-cols-[28px_minmax(0,1fr)] gap-2 sm:gap-3">
			<span aria-hidden className="mt-2.5 grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold tnum" style={{ border: `2px solid ${MODOS[b.modo]?.cor ?? 'var(--base-borda)'}`, color: teste === 'passou' ? 'var(--base-cartao)' : 'var(--base-texto-2)', backgroundColor: teste === 'passou' ? (MODOS[b.modo]?.cor ?? 'var(--base-texto-3)') : 'var(--base-cartao)' }}>{n}</span>
			<article aria-label={`Etapa ${n}: ${nomes.get(b.id)}`} aria-current={teste === 'agora' || teste === 'fim' ? 'step' : undefined} className="min-w-0 rounded-2xl px-3.5 py-3 transition-shadow sm:px-4"
				style={{ backgroundColor: 'var(--base-cartao)', boxShadow: teste === 'agora' || teste === 'fim' ? '0 0 0 2px var(--destaque), 0 6px 18px -8px color-mix(in srgb, var(--destaque) 45%, transparent)' : `0 0 0 ${marca === 'erro' ? 2 : 1}px ${marca === 'erro' ? 'var(--estado-erro)' : 'var(--base-borda)'}` }}>
				<header className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<h3 className="min-w-0 flex-1 text-[14px] font-semibold text-[var(--base-texto)]">
						<button type="button" onClick={() => onAbrir(b.id)} className="text-left underline-offset-2 hover:underline">{nomes.get(b.id)}</button>
					</h3>
					{teste === 'agora' ? <Pilula tom="info">agora no teste</Pilula> : teste === 'fim' ? <Pilula tom="info">o teste terminou aqui</Pilula> : null}
					{marca === 'erro' ? <Pilula tom="erro">impede o envio</Pilula> : marca === 'atencao' ? <Pilula tom="atencao">atenção</Pilula> : null}
					{temTrava(b) && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--area-voz)]"><Lock size={12} aria-hidden />trava</span>}
					<ModoChip b={b} />
				</header>

				{b.modo === 'sistema' ? (
					<p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-[var(--base-texto-2)]"><Settings2 size={14} className="mt-[2px] shrink-0" aria-hidden /><span>{acaoSistema(b)}</span></p>
				) : b.tipo === 'generativa' ? (
					<div className="mt-2">
						<Rotulo>Objetivo da IA</Rotulo>
						<p className="mt-1 rounded-xl px-3 py-2 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: 'var(--base-fill)', borderLeft: `3px solid ${MODOS.generativo.cor}` }}>
							{typeof p.objetivo === 'string' && p.objetivo.trim() ? p.objetivo.trim() : <span className="text-[var(--estado-erro-texto)]">Sem objetivo escrito.</span>}
							<small className="mt-1 block text-[12px] text-[var(--base-texto-2)]">
								{[p.max_turnos ? `até ${String(p.max_turnos)} turnos` : '', p.contrapropostas_max ? `até ${String(p.contrapropostas_max)} contrapropostas` : '', 'só com as ofertas recebidas', '"Transferir para humano" sempre ligado'].filter(Boolean).join(' · ')}
							</small>
						</p>
					</div>
				) : fala ? (
					<div className="mt-2">
						<Rotulo>O agente diz</Rotulo>
						<p className="mt-1 rounded-xl px-3 py-2 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: 'var(--base-fill)' }}><Fala texto={fala} /></p>
					</div>
				) : (
					<p className="mt-2 text-[12.5px] text-[var(--estado-erro-texto)]">Sem fala escrita.</p>
				)}

				{b.tipo === 'identidade' && identidade !== undefined && <QuemConfere b={b} identidade={identidade} onMudar={onMudarIdentidade} />}

				{final ? (
					<ul className="mt-2.5 space-y-1">
						<Linha q="Fim da ligação">{resultadoFinal(b)}</Linha>
						{b.tipo === 'transferir' && <Linha q="Sem atendente livre" fraca>volta ao agente</Linha>}
					</ul>
				) : (
					<div className="mt-2.5">
						<Rotulo>{tituloResp}</Rotulo>
						{b.saidas.length ? (
							<ul className="mt-1 space-y-1" aria-label={tituloResp}>
								{respostas.map(s => {
									const volta = textoVolta(s, b.id, numeros, definicao);
									return (
										<Linha key={s.quando} q={s.tipo === 'falha' ? `Se ${/^\p{Lu}\p{Ll}/u.test(s.rotulo) ? s.rotulo.charAt(0).toLowerCase() + s.rotulo.slice(1) : s.rotulo}` : s.rotulo} fraca={s.tipo === 'falha'}>
											<Seta /><Destino nomes={nomes} para={s.para} />{volta && <span className="text-[var(--base-texto-3)]"> ({volta})</span>}
										</Linha>
									);
								})}
							</ul>
						) : <p className="mt-1 text-[12.5px] font-semibold text-[var(--estado-erro-texto)]">Nenhuma resposta ligada: a ligação pararia aqui.</p>}
					</div>
				)}

				{ne && (
					<ul className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }} aria-label="Se não entender ou não ouvir">
						<Linha q="Se não entender" fraca>
							{ne.repete > 0 && <>pede de novo {ne.repete === 1 ? '1 vez' : `${ne.repete} vezes`} (“<Fala texto={ne.fala} />”) · depois</>}
							{saidaNe ? <><Seta /><Destino nomes={nomes} para={saidaNe.para} /></> : <>{ne.repete > 0 ? ' ' : ''}transfere para um atendente <span className="text-[var(--base-texto-3)]">(“{rotuloNe}” não está ligada a uma etapa)</span></>}
						</Linha>
						{no && (
							<Linha q="Se não ouvir nada" fraca>
								{no.repete > 0 && <>pede de novo {no.repete === 1 ? '1 vez' : `${no.repete} vezes`} (“<Fala texto={no.fala} />”) · depois</>}
								{no.quando === null ? <>{no.repete > 0 ? ' ' : ''}encerra sem recado <span className="text-[var(--base-texto-3)]">(pode ser caixa postal; não conta como terceiro)</span></>
									: saidaNo ? <><Seta /><Destino nomes={nomes} para={saidaNo.para} /></>
									: <>{no.repete > 0 ? ' ' : ''}transfere para um atendente</>}
							</Linha>
						)}
					</ul>
				)}

				{pendencias?.length ? (
					<div className="mt-2.5 space-y-2" aria-label="O que corrigir nesta etapa">
						{pendencias.map(e => <OQueCorrigir key={e.codigo} impede={e.impede} texto={e.texto} como={comoCorrigir(e.codigo)} acao={acao?.(e.codigo)} />)}
					</div>
				) : null}
			</article>
		</li>
	);
}

/** Etapa "Confirmar identidade" (SQL 88): a 2ª pergunta (quando a carteira pede duas) e quem confere, com "Mudar". */
export function QuemConfere({ b, identidade, onMudar }: { b: Bloco; identidade: ConfigIdentidade | null; onMudar?: () => void }) {
	const da = typeof b.params?.pergunta === 'string' ? b.params.pergunta : null;
	const perguntas = identidade ? identidade.perguntas.slice(0, identidade.quantas) : [];
	const depois = perguntas.filter((p, i) => !(i === 0 && p === da));
	return (
		<div className="mt-2 space-y-2" data-quem-confere={identidade?.fonte ?? 'hoje'}>
			{depois.map((p, i) => (
				<div key={p}>
					<Rotulo>{i === 0 && perguntas[0] !== da ? 'Pergunta' : 'Depois'}</Rotulo>
					<p className="mt-1 rounded-xl px-3 py-2 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: 'var(--base-fill)' }}>{FALA_PERGUNTA[p as PerguntaIdentidade]}</p>
				</div>
			))}
			<p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-[12.5px]" style={{ backgroundColor: 'var(--base-fill)', boxShadow: '0 0 0 1px var(--base-borda)' }}>
				<b className="font-semibold text-[var(--base-texto)]">Quem confere:</b>
				<span className="text-[var(--base-texto)]">{textoFonte(identidade)}</span>
				{identidade && <span className="text-[var(--base-texto-2)]">· {textoPerguntas(identidade)}</span>}
				{usaArquivo(identidade) && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--area-voz)]"><Lock size={11} aria-hidden />a resposta vira código; a IA não vê</span>}
				{onMudar && <button type="button" onClick={onMudar} className="ml-auto text-[12.5px] font-semibold text-[var(--destaque)] underline-offset-2 hover:underline">Mudar ›</button>}
			</p>
		</div>
	);
}

/** Cabeçalho de um capítulo, que recolhe (fluxo grande, até 60 etapas). */
function CabCapitulo({ c, aberto, onTrocar }: { c: Capitulo; aberto: boolean; onTrocar: () => void }) {
	const Ico = aberto ? ChevronDown : ChevronRight;
	return (
		<h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
			<button type="button" onClick={onTrocar} aria-expanded={aberto} aria-controls={`cap-${c.id}`} className="inline-flex min-w-0 items-center gap-1 text-left text-[15px] font-semibold text-[var(--base-texto)]">
				<Ico size={16} className="shrink-0 self-center text-[var(--base-texto-3)]" aria-hidden />{c.titulo}
			</button>
			{c.sub && <span className="text-[12.5px] font-normal text-[var(--base-texto-3)]">{c.sub}</span>}
			<span className="ml-auto text-[12px] font-normal text-[var(--base-texto-3)]">{c.blocos.length} {c.blocos.length === 1 ? 'etapa' : 'etapas'}</span>
		</h2>
	);
}

/** O roteiro inteiro: capítulos na ordem da conversa, etapas numeradas de 1 a N. */
export function Roteiro({ definicao, marcas, onAbrir, recolhidos: recolhidosIniciais, pendencias, acao, identidade, onMudarIdentidade, teste }: {
	definicao: Definicao; marcas: Map<string, Marca>; onAbrir: (id: string) => void; recolhidos?: string[];
	/** PR6: a etapa acesa pelo teste ao lado e as que já passaram (etapaDoTeste). */
	teste?: { atual: string | null; passou: Set<string>; terminou: boolean } | null;
	pendencias?: Map<string, Pendencia[]>; acao?: (codigo: string) => AcaoCorrigir | null;
	identidade?: ConfigIdentidade | null; onMudarIdentidade?: () => void;
}) {
	const caps = roteiro(definicao);
	const nomes = nomesEtapas(definicao);
	const numeros = numerosRoteiro(caps);
	const [recolhidos, setRecolhidos] = useState<Set<string>>(() => new Set(recolhidosIniciais ?? []));
	const trocar = (id: string) => setRecolhidos(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
	return (
		<div className="space-y-6">
			{caps.map(c => {
				// o capítulo da etapa acesa nunca fica recolhido
				const aberto = !recolhidos.has(c.id) || (!!teste?.atual && c.blocos.some(b => b.id === teste.atual));
				return (
					<section key={c.id} aria-label={c.titulo} data-capitulo={c.tipo}
						className={c.tipo === 'conversa' ? '' : 'border-l-2 pl-3 sm:pl-4'} style={c.tipo === 'conversa' ? undefined : { borderColor: c.tipo === 'solto' ? 'var(--estado-erro)' : 'var(--base-borda)' }}>
						<CabCapitulo c={c} aberto={aberto} onTrocar={() => trocar(c.id)} />
						<ol id={`cap-${c.id}`} hidden={!aberto} className="mt-2.5 space-y-2.5">
							{c.blocos.map(b => (
								<EtapaRoteiro key={b.id} b={b} n={numeros.get(b.id) ?? 0} definicao={definicao} nomes={nomes} numeros={numeros} marca={marcas.get(b.id)} onAbrir={onAbrir} pendencias={pendencias?.get(b.id)} acao={acao} identidade={identidade} onMudarIdentidade={onMudarIdentidade}
									teste={teste?.atual === b.id ? (teste.terminou ? 'fim' : 'agora') : teste?.passou.has(b.id) ? 'passou' : undefined} />
							))}
						</ol>
					</section>
				);
			})}
		</div>
	);
}
