// Resultado formativo de uma sessão de treino (SPEC §2.4), o mesmo para o operador (pelo link) e para a Qualidade.
// Ordem: faixa do item crítico com "não" (se houver) → pílula da meta → "O que você fez bem" → "Para treinar" (o trecho
// da fala e "O que dizer") → "Não se aplicou" (recolhido) → a conversa (recolhida). O operador tem "Discordo deste
// ponto" em cada item "não" (uma linha). A Qualidade tem "Revisar avaliação" (item a item: sim / não / não se aplica)
// e vê as discordâncias com "Marcar como resolvida". Nunca "reprovado": "Item crítico", "Ainda não chegou na meta".
import { useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Aviso, Botao, Cartao, Detalhes, Pilula, campoCls, campoStyle } from '@/components/ds';
import { textoTemDadoPessoal } from '@/lib/speech';
import { GRAVIDADE_RP } from '@/lib/roleplay';
import { organizarResultado, pilulaResultado, validarDiscordancia, type ItemResultado, type ResultadoTreino } from '@/lib/treino-sessao';

const RESP: Record<string, string> = { sim: 'Sim', nao: 'Não', na: 'Não se aplica' };

export function ResultadoView({ r, quem, restantes, prazo, onDiscordar, revisando, onRevisar, onResolver }: {
	r: ResultadoTreino; quem: 'operador' | 'qualidade'; restantes?: number | null; prazo?: string | null;
	/** Operador: "Discordo deste ponto" (só em item "não"). */
	onDiscordar?: (item: string, texto: string) => Promise<void>;
	/** Qualidade: modo "Revisar avaliação" e a gravação de cada item. */
	revisando?: boolean; onRevisar?: (item: string, valor: string | null) => Promise<void>;
	onResolver?: (discordancia: number) => Promise<void>;
}) {
	const o = organizarResultado(r);
	const voce = quem === 'operador';
	if (r.situacao !== 'avaliada' || r.nota == null) {
		return <Aviso tom="neutro" titulo={r.situacao === 'abandonada' ? 'Saiu sem contar.' : r.situacao === 'falhou' ? 'Não deu para avaliar.' : 'Sessão em andamento.'}>
			{r.situacao === 'em_andamento' ? 'A sessão ainda está aberta.' : 'Esta tentativa não contou e não tem nota.'}
		</Aviso>;
	}
	const p = pilulaResultado({ nota: r.nota, reprovada: r.reprovada, nota_minima: r.nota_minima, restantes, prazo });
	const discord = (id: string) => r.discordancias.find(d => d.item === id) ?? null;
	return (
		<div className="space-y-4">
			{o.critico && (
				<div role="status" className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13.5px]" style={{ backgroundColor: 'var(--estado-erro-fundo)', color: 'var(--estado-erro-texto)' }}>
					<CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
					<span><b className="font-semibold">{GRAVIDADE_RP.bloqueante} com “não”:</b> {o.critico.texto ?? 'item do checklist'}. {voce ? 'Nas ligações reais, este item zera a conformidade; vale treinar primeiro.' : 'Este item reprova a sessão, como nas ligações.'}</span>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<span className="tnum text-[32px] font-bold leading-none">{Math.round(Number(r.nota))}</span>
				<Pilula tom={p.tom}>{p.texto}</Pilula>
				{r.objetivo_ok != null && <Pilula tom={r.objetivo_ok ? 'ok' : 'neutro'}>{r.objetivo_ok ? 'Objetivo da ligação cumprido' : 'Objetivo da ligação ainda não cumprido'}</Pilula>}
			</div>
			{voce && restantes === 0 && Number(r.nota) < (r.nota_minima ?? 0) && <Aviso tom="neutro" titulo={`Você usou as tentativas deste treino.`}>A Qualidade vai combinar com você o próximo passo.</Aviso>}

			<Cartao titulo={voce ? 'O que você fez bem' : 'O que fez bem'} linha={o.bem.length ? undefined : 'Nenhum item com “sim” desta vez.'}>
				{o.bem.length > 0 && <ul className="space-y-1.5">{o.bem.map(i => <Linha key={i.id} i={i} icone={<CheckCircle2 size={15} aria-hidden="true" style={{ color: 'var(--estado-pronto)' }} />} revisando={revisando} onRevisar={onRevisar} valor={o.valor(i)} />)}</ul>}
			</Cartao>

			<Cartao titulo="Para treinar" linha={o.treinar.length ? 'O trecho da conversa e o que dizer da próxima vez.' : 'Nada para treinar nesta sessão.'}>
				{o.treinar.length > 0 && (
					<ul className="space-y-4">
						{o.treinar.map(i => (
							<li key={i.id} className="space-y-1.5">
								<Linha i={i} revisando={revisando} onRevisar={onRevisar} valor={o.valor(i)} />
								{i.feedback?.trecho && <blockquote className="rounded-lg bg-[var(--base-fill)] px-3 py-2 text-[13px] text-[var(--base-texto-2)]">{voce ? 'Você disse: ' : 'Disse: '}“{i.feedback.trecho}”</blockquote>}
								{i.feedback?.dica && <p className="text-[13.5px]"><b className="font-semibold">O que dizer:</b> {i.feedback.dica}</p>}
								{voce && onDiscordar && <Discordar item={i.id} ja={discord(i.id)?.texto ?? null} onEnviar={onDiscordar} />}
								{!voce && discord(i.id) && (
									<div className="rounded-lg px-3 py-2 text-[13px]" style={{ boxShadow: 'inset 0 0 0 1px var(--base-borda)' }}>
										<p><b className="font-semibold">Discordou deste ponto:</b> “{discord(i.id)!.texto}”</p>
										{discord(i.id)!.resolvida ? <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Resolvida.</p>
											: onResolver && discord(i.id)!.id != null && <div className="mt-1.5"><Botao tipo="secundario" pequeno onClick={() => void onResolver(discord(i.id)!.id!)}>Marcar como resolvida</Botao></div>}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</Cartao>

			{o.naoSeAplicou.length > 0 && (
				<Detalhes resumo={`Não se aplicou nesta conversa (${o.naoSeAplicou.length})`}>
					<ul className="space-y-1.5 pt-2">{o.naoSeAplicou.map(i => <Linha key={i.id} i={i} revisando={revisando} onRevisar={onRevisar} valor={o.valor(i)} />)}</ul>
				</Detalhes>
			)}
			{r.transcricao && r.transcricao.length > 0 && (
				<Detalhes resumo="A conversa (fica 90 dias)">
					<ol className="space-y-1.5 pt-2 text-[13px]">
						{r.transcricao.map((t, k) => <li key={k}><b className="font-semibold">{t.quem === 'operador' ? (voce ? 'Você' : 'Operador') : 'Cliente'}:</b> {t.texto}</li>)}
					</ol>
				</Detalhes>
			)}
		</div>
	);
}

function Linha({ i, icone, revisando, onRevisar, valor }: { i: ItemResultado; icone?: ReactNode; revisando?: boolean; onRevisar?: (item: string, valor: string | null) => Promise<void>; valor: string }) {
	const revisado = i.revisado != null && i.revisado !== i.resposta;
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
			<span className="flex min-w-0 items-center gap-2">{icone}<span className="min-w-0">{i.texto ?? 'Item do checklist da empresa'}</span>
				{i.gravidade === 'bloqueante' && <Pilula tom="erro">{GRAVIDADE_RP.bloqueante}</Pilula>}
				{revisado && <Pilula tom="info" title={`A IA disse “${RESP[i.resposta]}”`}>Revisado pela Qualidade</Pilula>}
			</span>
			{revisando && onRevisar && (
				<label className="inline-flex items-center gap-1.5 text-[12px] text-[var(--base-texto-2)]">Qualidade:
					<select aria-label={`Revisar: ${i.texto ?? i.id}`} value={valor} onChange={e => void onRevisar(i.id, e.target.value === i.resposta ? null : e.target.value)} className={campoCls} style={campoStyle}>
						{Object.entries(RESP).map(([v, n]) => <option key={v} value={v}>{n}{v === i.resposta ? ' (IA)' : ''}</option>)}
					</select>
				</label>
			)}
		</div>
	);
}

function Discordar({ item, ja, onEnviar }: { item: string; ja: string | null; onEnviar: (item: string, texto: string) => Promise<void> }) {
	const [aberto, setAberto] = useState(false);
	const [texto, setTexto] = useState(ja ?? '');
	const [erro, setErro] = useState('');
	const [enviado, setEnviado] = useState<string | null>(ja);
	const [ocupado, setOcupado] = useState(false);
	if (enviado && !aberto) return (
		<p className="text-[12.5px] text-[var(--base-texto-2)]">Você discordou: “{enviado}”. A Qualidade vai olhar. <button type="button" className="font-semibold text-[var(--destaque)] hover:underline" onClick={() => setAberto(true)}>Mudar</button></p>
	);
	if (!aberto) return <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)] hover:underline" onClick={() => setAberto(true)}>Discordo deste ponto</button>;
	async function enviar() {
		const e = validarDiscordancia(texto, textoTemDadoPessoal);
		setErro(e);
		if (e) return;
		setOcupado(true);
		try { await onEnviar(item, texto.trim()); setEnviado(texto.trim()); setAberto(false); } catch (x) { setErro(x instanceof Error ? x.message : 'Não deu para enviar agora.'); } finally { setOcupado(false); }
	}
	return (
		<div className="flex flex-wrap items-start gap-2">
			<label className="sr-only" htmlFor={`disc-${item}`}>Por que você discorda</label>
			<input id={`disc-${item}`} value={texto} maxLength={200} onChange={e => setTexto(e.target.value)} placeholder="Em uma linha: por que você discorda" className={`${campoCls} flex-[1_1_260px]`} style={campoStyle} />
			<Botao tipo="secundario" pequeno onClick={() => void enviar()} disabled={ocupado}>Enviar</Botao>
			<Botao tipo="fantasma" pequeno onClick={() => setAberto(false)}>Cancelar</Botao>
			{erro && <p role="alert" className="w-full text-[12px] font-medium text-[var(--estado-erro-texto)]">{erro}</p>}
		</div>
	);
}
