// Agente Voz/CX › Visão geral (SPEC Canais §3.3): como uma ligação acontece, "Ligações hoje" (ritmo do dia: modo,
// abandono e curtas, com a frase do freio; V7b) e um cartão por seção. Só cores do tema (claro e escuro).
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeading } from '@/components/app-shell';
import { Aviso, BotaoLink, Cartao } from '@/components/ds';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { ROTA_AGENTE, ROTA_DISCAGEM, ROTA_LIGACOES, ROTA_SPEECH, ROTA_TELEFONIA } from '@/lib/rotas-voz';
import { useMotorAuth } from '@/components/auth-provider';
import { useRitmoHoje } from '@/components/discagem/ritmo';
import { fraseEstado, pct, type RitmoHoje } from '@/lib/ritmo';

/** "Ligações hoje" (Power e Preditivo, V7b; PREDITIVO.md 5.3): "Preditivo · abandono 0,8% · curtas 76%" e, com freio, a
 *  frase do estado. Nada sem ligações hoje. */
export function LigacoesHoje({ h }: { h: RitmoHoje | null }) {
	if (!h || !h.totais.discadas) return null;
	const u = h.ultima, estado = fraseEstado(u?.estado, u?.razao);
	const modo = u?.modo === 'preditivo' ? 'Preditivo' : 'Power';
	return (
		<Cartao titulo="Ligações hoje" linha={`${modo} · abandono ${pct(h.totais.abandono_pct)} · curtas ${pct(h.totais.curtas_pct)}`}
			direita={<BotaoLink pequeno to={ROTA_LIGACOES}>Ver ligações</BotaoLink>}>
			<p className="text-[13px] text-[var(--base-texto-2)]">{h.totais.discadas.toLocaleString('pt-BR')} ligações · {h.totais.atendidas_pessoa.toLocaleString('pt-BR')} atenderam por pessoa.</p>
			{estado && <div className="mt-3"><Aviso tom={estado.tom} titulo={`Com problema: ${estado.titulo.toLowerCase()}`}>{estado.texto}</Aviso></div>}
		</Cartao>
	);
}

type Passo = { quem: string; titulo: string; texto: string; nosso?: boolean };

function passos(agenteVoz: boolean): Passo[] {
	const lista: Passo = { quem: 'MotorCX', titulo: 'Lista do dia', texto: 'Quem ligar hoje, pela estratégia da carteira.' };
	const regras: Passo = { quem: 'Discagem · regras', titulo: 'Quando e quantas vezes', texto: 'Renitência, horários por UF/DDD, resubmit e chamadas curtas.', nosso: true };
	if (!agenteVoz) return [lista, regras,
		{ quem: 'Sua empresa', titulo: 'Seu discador ou AGV liga', texto: 'Com a lista que o MotorCX entrega.' },
		{ quem: 'Sua empresa', titulo: 'O retorno volta ao MotorCX', texto: 'Pelo arquivo do discador e do AGV.' }];
	return [lista, regras,
		{ quem: 'Discador MotorCX', titulo: 'Disca', texto: 'Pela rota da operadora, dentro da janela.', nosso: true },
		{ quem: 'Agente de voz', titulo: 'Conversa', texto: 'Segue o fluxo aprovado da carteira.', nosso: true },
		{ quem: 'Sua empresa', titulo: 'Seu operador', texto: 'Se precisar de humano, o agente transfere para o discador de vocês.' }];
}

const SECOES = [
	{ to: ROTA_AGENTE, titulo: 'Agente de voz', texto: 'Fluxos de conversa por carteira: versões, aprovação, testar conversa, personas e desempenho.', soAgente: true },
	{ to: ROTA_DISCAGEM, titulo: 'Discagem', texto: 'Regras de discagem da carteira: renitência, resubmit, contato por passada, horários por UF/DDD e chamadas curtas.' },
	{ to: ROTA_LIGACOES, titulo: 'Ligações', texto: 'Os lotes de hoje do agente, com reenviar, reciclar e pausar.', soAgente: true },
	{ to: ROTA_TELEFONIA, titulo: 'Telefonia', texto: 'Por onde o MotorCX liga: rota, bina e transferência para os seus operadores.', soAgente: true },
];

export function VisaoGeralVoz() {
	const { agenteVoz } = useAreasLiberadas();
	const { empresa } = useMotorAuth();
	const ritmo = useRitmoHoje(agenteVoz && empresa ? Number(empresa.id) : null, null);
	const lista = passos(agenteVoz);
	return (
		<>
			<PageHeading title="Agente Voz/CX" description="O que liga para os seus clientes: a discagem decide quando e para qual número, e o agente de voz conversa."
				actions={agenteVoz ? <BotaoLink tipo="primario" to={ROTA_AGENTE}>Fluxos do agente</BotaoLink> : undefined} />
			<div className="space-y-4">
				<Cartao titulo="Como uma ligação acontece">
					<ol className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-stretch" aria-label="Como uma ligação acontece">
						{lista.map((p, i) => (
							<li key={p.titulo} className="flex min-w-0 items-stretch gap-2 lg:flex-1">
								<div className="min-w-0 flex-1 rounded-xl p-3" style={p.nosso ? { boxShadow: 'inset 0 0 0 1.5px var(--area)' } : { backgroundColor: 'var(--base-fill)' }}>
									<span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: p.nosso ? 'var(--area)' : 'var(--base-texto-3)' }}>{p.quem}</span>
									<b className="mt-0.5 block text-[14px] text-[var(--base-texto)]">{p.titulo}</b>
									<small className="mt-1 block text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{p.texto}</small>
								</div>
								{i < lista.length - 1 && <ArrowRight size={14} aria-hidden className="hidden shrink-0 self-center text-[var(--base-texto-3)] lg:block" />}
							</li>
						))}
					</ol>
				</Cartao>
				{agenteVoz && <LigacoesHoje h={ritmo} />}
				{!agenteVoz && (
					<Aviso tom="info" titulo="O agente de voz MotorCX não está contratado.">
						As regras de <Link to={ROTA_DISCAGEM} className="font-semibold underline">Discagem</Link> valem do mesmo jeito para o discador e o AGV da sua empresa. Para conhecer o agente, fale com a equipe MotorCX.
					</Aviso>
				)}
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{SECOES.map(s => (
						<Cartao key={s.to} titulo={s.titulo} linha={s.soAgente && !agenteVoz ? 'Precisa do agente de voz MotorCX.' : undefined}>
							<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">{s.texto}</p>
							<div className="mt-3"><BotaoLink pequeno to={s.to}>Abrir</BotaoLink></div>
						</Cartao>
					))}
				</div>
				<p className="text-[12.5px] text-[var(--base-texto-3)]">O que as ligações dizem (notas, motivos e alertas) fica em <Link to={ROTA_SPEECH} className="underline">Speech Analytics</Link>.</p>
			</div>
		</>
	);
}
