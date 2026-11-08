// Descrever segmentos e régua (etapa 5; protótipo proto-segmentacao v2, telas 2 a 6). A IA só PROPÕE: nada muda até
// Aplicar, que roda numa transação do banco (aplicar_segmentacao, SQL 79) e deixa os segmentos e estratégias novos
// PAUSADOS até o usuário conferir e ligar. Responder perguntas, recalcular contagens e aplicar não usam IA nem crédito;
// cada geração usa 2 créditos de IA (SQL 78), estornados se a geração não entregar proposta.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Aviso, Botao, Pilula, textareaCls } from '@/components/ds';
import { AvisoCreditosIA, useCreditosIA } from '@/components/ia/creditos-ia';
import { rotuloCreditos } from '@/lib/creditos-ia';
import { erroDaFuncao } from '@/lib/funcoes';
import { CANAL_COR, nomeCanal } from '@/lib/personas';
import { friendlyError, numberBR, supabase, type Condicao } from '@/lib/supabase';
import { dataCurta, type ResultadoPrevia } from '@/lib/previa-segmentacao';
import {
	CREDITOS_DESCREVER, LIMITE_TEXTO, MOTIVO_FORA, ROTULO_ACAO, bloqueiosAplicar, comRespostas, conectorModo, conferencias,
	contarAcoes, corpoPrevia, desligados, emOrdem, estagiosDoSegmento, explicarErrosGeracao, lerContagens, matrizDeOnde,
	naoCriados, nomeAcao, respostasPadrao, tabelaRegua, textoCondicao, trocarOrdem,
	type Contagens, type PedidoSegmentacao, type PersonaInfo, type Pergunta, type Proposta, type Respostas, type SegmentoProposto,
} from '@/lib/segmentacao-ia';
import type { Acao } from '@/lib/estrategia';

type Tela = 'texto' | 'aguardando' | 'proposta' | 'segmento' | 'revisar';
const CAMPOS_PEDIDO = 'id,situacao,texto,proposta,resultado,hash_base,pedido_em,credor_id';
const POLL_MS = 2500;
const CALCULADOS: [string, string, string][] = [
	['Saldo total', 'saldo', 'número'], ['Dias de atraso', 'dias_atraso', 'número'], ['Quantidade de contratos', 'qtd_contratos', 'número'],
	['Idade (anos)', 'idade', 'número'], ['Qtd. de telefones', 'qtd_telefones', 'número'], ['Tem e-mail', 'tem_email', 'sim/não'],
	['Tem celular', 'tem_celular', 'sim/não'], ['Só fixo', 'so_fixo', 'sim/não'], ['Persona', 'persona', 'texto'],
];
const OPERADORES = ['é igual a', 'maior / menor que', 'está entre (faixa)', 'é um destes', 'não é nenhum destes', 'contém', 'vazio / preenchido'];
const CANAIS = ['whatsapp', 'rcs', 'sms', 'email', 'agente_voz', 'discador'];

const cartao = 'rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)]';

export type DescreverProps = {
	empresaId: string;
	credorId: string;
	credorNome: string;
	outrasCarteiras: { id: string; nome: string }[];
	personas: PersonaInfo[];
	colunas: { nome: string; tipo: string }[];
	segmentosHoje: number;
	onFechar: () => void;
	onAplicado: (aplicacao: string) => void;
};

export function DescreverSegmentacao(p: DescreverProps) {
	const [tela, setTela] = useState<Tela>('texto');
	const [pedido, setPedido] = useState<PedidoSegmentacao | null>(null);
	const [texto, setTexto] = useState('');
	const [enviando, setEnviando] = useState(false);
	const [erro, setErro] = useState('');
	const [respostas, setRespostas] = useState<Respostas>({});
	const [trocas, setTrocas] = useState<[string, string][]>([]);
	const [contagens, setContagens] = useState<Contagens | null>(null);
	const [hashAtual, setHashAtual] = useState<string | null>(null);
	const [canaisAtivos, setCanaisAtivos] = useState<Set<string>>(new Set(CANAIS));
	const [segAba, setSegAba] = useState<string>('');
	const [extras, setExtras] = useState<string[]>([]);
	const [confirmou, setConfirmou] = useState(false);
	const [aplicando, setAplicando] = useState(false);
	const [recarregar, setRecarregar] = useState(0);
	const creditos = useCreditosIA(p.empresaId, recarregar);
	const topo = useRef<HTMLDivElement>(null);

	// retoma o último pedido desta carteira (em geração ou gerado, ainda não aplicado)
	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		void (async () => {
			const [{ data }, ce] = await Promise.all([
				supabase!.from('segmentacao_pedidos').select(CAMPOS_PEDIDO).eq('credor_id', p.credorId)
					.in('situacao', ['pendente', 'gerando', 'gerado', 'com_erros']).order('pedido_em', { ascending: false }).limit(1),
				supabase!.from('canais_empresa').select('canal,ativo').eq('empresa_id', p.empresaId),
			]);
			if (!ativo) return;
			const off = new Set(((ce.data ?? []) as { canal: string; ativo: boolean }[]).filter(c => !c.ativo).map(c => c.canal));
			setCanaisAtivos(new Set(CANAIS.filter(c => !off.has(c))));
			const ult = (data?.[0] ?? null) as PedidoSegmentacao | null;
			if (ult) abrirPedido(ult);
		})();
		return () => { ativo = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [p.credorId, p.empresaId]);

	function abrirPedido(x: PedidoSegmentacao) {
		setPedido(x);
		setTexto(x.texto);
		if (x.situacao === 'gerado' && x.proposta) {
			setRespostas(respostasPadrao(x.proposta));
			setTrocas([]);
			setConfirmou(false);
			setTela('proposta');
			setRecarregar(n => n + 1);
		} else if (x.situacao === 'pendente' || x.situacao === 'gerando') setTela('aguardando');
		else setTela('texto');
	}

	// enquanto gera: consulta o pedido
	useEffect(() => {
		if (tela !== 'aguardando' || !pedido || !supabase) return;
		const t = setInterval(async () => {
			const { data } = await supabase!.from('segmentacao_pedidos').select(CAMPOS_PEDIDO).eq('id', pedido.id).maybeSingle();
			if (data && (data as PedidoSegmentacao).situacao !== pedido.situacao) abrirPedido(data as PedidoSegmentacao);
		}, POLL_MS);
		return () => clearInterval(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tela, pedido?.id, pedido?.situacao]);

	const final: Proposta | null = useMemo(() => {
		if (!pedido?.proposta) return null;
		let x = comRespostas(pedido.proposta, respostas);
		for (const [a, b] of trocas) x = trocarOrdem(x, a, b);
		return x;
	}, [pedido?.proposta, respostas, trocas]);

	// contagens do banco (só contagens), recalculadas quando uma resposta muda condição ou ordem
	const chavePrevia = final ? JSON.stringify(corpoPrevia(final)) : '';
	useEffect(() => {
		if (!final || !supabase) return;
		let ativo = true;
		const t = setTimeout(async () => {
			const [r, h] = await Promise.all([
				supabase!.rpc('previa_segmentacao', { empresa: p.empresaId, credor: p.credorId, proposta: corpoPrevia(final) }),
				supabase!.rpc('hash_segmentacao', { empresa: p.empresaId, credor: p.credorId }),
			]);
			if (!ativo) return;
			setContagens(r.error || !r.data ? null : lerContagens(final, r.data as ResultadoPrevia));
			setHashAtual(h.error ? null : (h.data as string));
		}, 300);
		return () => { ativo = false; clearTimeout(t); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chavePrevia, p.empresaId, p.credorId]);

	function irPara(t: Tela) { setTela(t); topo.current?.scrollIntoView({ block: 'start' }); }

	async function gerar() {
		if (!supabase) return;
		setEnviando(true); setErro('');
		const { data, error } = await supabase.rpc('pedir_segmentacao', { empresa: p.empresaId, credor: p.credorId, texto });
		setEnviando(false);
		if (error) { setErro(friendlyError(error)); return; }
		const id = String((data as { pedido: number }).pedido);
		setPedido({ id, situacao: 'pendente', texto, proposta: null, resultado: null, hash_base: null, pedido_em: new Date().toISOString(), credor_id: p.credorId });
		setRecarregar(n => n + 1);
		irPara('aguardando');
	}

	async function descartar() {
		if (!supabase || !pedido) { p.onFechar(); return; }
		const { error } = await supabase.rpc('descartar_segmentacao', { pedido: pedido.id });
		if (error) { toast.error(friendlyError(error)); return; }
		setPedido(null); setTela('texto'); setRecarregar(n => n + 1);
		toast.success('Proposta descartada. Nada mudou na carteira.');
	}

	async function aplicar() {
		if (!supabase || !pedido || !final) return;
		setAplicando(true);
		const { data, error } = await supabase.rpc('aplicar_segmentacao', {
			pedido: pedido.id, proposta: final, previa_hash: final.hash_base ?? pedido.hash_base, carteiras_extra: extras,
		});
		setAplicando(false);
		if (error) { toast.error(erroDaFuncao(error, data) || friendlyError(error)); return; }
		toast.success(`Aplicado em ${p.credorNome}. Os segmentos novos estão pausados até você conferir e ligar.`);
		p.onAplicado(String((data as { aplicacao: number }).aplicacao));
	}

	const tituloFaixa = (sub: ReactNode) => (
		<div className="flex items-start gap-2 rounded-xl border border-[var(--estado-info)] bg-[var(--estado-info-fundo)] px-4 py-3 text-[13px] text-[var(--base-texto)]" data-faixa-rascunho>
			<Sparkles size={16} className="mt-0.5 flex-none text-[var(--estado-info)]" />
			<div><b>Rascunho gerado por IA · nada vale até aplicar.</b> {sub}</div>
		</div>
	);

	return (
		<div ref={topo} className="space-y-3" data-descrever-segmentacao>
			{tela === 'texto' && <TelaTexto {...p} texto={texto} setTexto={setTexto} erro={erro} enviando={enviando} gerar={gerar} creditos={creditos} pedido={pedido} canaisAtivos={canaisAtivos} />}
			{tela === 'aguardando' && (
				<div className={`${cartao} p-5`} role="status" aria-live="polite">
					<p className="flex items-center gap-2 text-[15px] font-bold text-[var(--base-texto)]"><Sparkles size={16} className="animate-pulse text-[var(--estado-info)]" /> Gerando a proposta…</p>
					<p className="mt-1 text-[13px] text-[var(--base-texto-2)]">A IA lê o texto e o motor confere cada condição e cada régua. Costuma levar menos de 1 minuto; pode sair desta tela e voltar depois.</p>
					<div className="mt-3 flex gap-2"><Botao tipo="secundario" onClick={() => void descartar()}>Descartar</Botao></div>
				</div>
			)}
			{(tela === 'proposta' || tela === 'segmento' || tela === 'revisar') && final && pedido && (
				<>
					{tela === 'proposta' && tituloFaixa(<>Contagens da carga de hoje{contagens?.dataBase ? ` (rotina de ${dataCurta(contagens.dataBase)})` : ''}, calculadas pelo banco com as mesmas regras do motor.{' '}
						<ResumoPilulas prop={final} /></>)}
					{tela === 'segmento' && tituloFaixa('Cada segmento tem o seu “o que entendi”, perguntas e a tabela da régua.')}
					{tela === 'revisar' && tituloFaixa('Tudo abaixo é feito de uma vez (ou nada é feito) e pode ser desfeito até a próxima rotina.')}
					{tela === 'proposta' && <TelaProposta prop={final} c={contagens} respostas={respostas} setResposta={(k, v) => setRespostas(r => ({ ...r, [k]: v }))}
						canaisAtivos={canaisAtivos} trocar={(a, b) => setTrocas(t => [...t, [a, b]])} texto={pedido.texto} credorNome={p.credorNome}
						onDescartar={() => void descartar()} onEditar={() => { setTexto(pedido.texto); irPara('texto'); }}
						onSegmentos={() => { setSegAba(emOrdem(final).find(s => s.estrategia === 'nova')?.ref ?? 'tabela'); irPara('segmento'); }} onRevisar={() => irPara('revisar')} />}
					{tela === 'segmento' && <TelaSegmento prop={final} c={contagens} aba={segAba} setAba={setSegAba} respostas={respostas}
						setResposta={(k, v) => setRespostas(r => ({ ...r, [k]: v }))} personas={p.personas} onVoltar={() => irPara('proposta')} onRevisar={() => irPara('revisar')} />}
					{tela === 'revisar' && <TelaRevisar prop={final} c={contagens} credorNome={p.credorNome} outras={p.outrasCarteiras} extras={extras} setExtras={setExtras}
						confirmou={confirmou} setConfirmou={setConfirmou} aplicando={aplicando} onVoltar={() => irPara('proposta')} onAplicar={() => void aplicar()}
						bloqueios={bloqueiosAplicar(final, { canaisAtivos, hashAtual, confirmou })} nPerguntas={final.perguntas.length + conferencias(final, contagens, canaisAtivos).filter(x => x.troca).length} />}
				</>
			)}
			{tela === 'texto' && <div className="flex justify-end"><Botao tipo="fantasma" onClick={p.onFechar}><X size={14} /> Fechar</Botao></div>}
		</div>
	);
}

function ResumoPilulas({ prop }: { prop: Proposta }) {
	const n = contarAcoes(prop);
	return (
		<span className="mt-1.5 flex flex-wrap gap-1.5">
			<Pilula>{n.novos} novos</Pilula><Pilula>{n.alterados} alterados</Pilula><Pilula>{n.mantidos} mantidos</Pilula>
			<Pilula>{n.desligados} desligado{n.desligados === 1 ? '' : 's'} aqui</Pilula>
			{prop.perguntas.length > 0 && <Pilula tom="atencao">{prop.perguntas.length} perguntas</Pilula>}
			<Pilula tom="ok">validado pelo motor</Pilula>
		</span>
	);
}

// ================================================================== tela 2 · descrever
function TelaTexto(p: DescreverProps & { texto: string; setTexto: (t: string) => void; erro: string; enviando: boolean; gerar: () => void;
	creditos: ReturnType<typeof useCreditosIA>; pedido: PedidoSegmentacao | null; canaisAtivos: Set<string> }) {
	const n = p.texto.length;
	const longo = n > LIMITE_TEXTO;
	const falhou = p.pedido?.situacao === 'com_erros';
	return (
		<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
			<div className={`${cartao} min-w-0 p-4 sm:p-5`}>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="flex items-center gap-2 text-[16px] font-bold text-[var(--base-texto)]">Descrever segmentos e régua <Pilula tom="info">IA</Pilula></h2>
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1 text-[11.5px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{p.credorNome}</b> · {p.segmentosHoje} segmentos + Demais</span>
				</div>
				<p className="mt-1.5 text-[13px] text-[var(--base-texto-2)]">Diga <b>para quem</b> (faixas, ticket, colunas da carga) e <b>o que fazer</b> com cada grupo (dias, canais, personas). Um parágrafo por grupo ajuda, mas não é obrigatório.</p>
				{falhou && (
					<div className="mt-3 rounded-lg border border-[var(--estado-erro)] bg-[var(--estado-erro-fundo)] px-4 py-3 text-[13px] text-[var(--estado-erro-texto)]" role="alert" data-erro-geracao>
						<b>Não deu para montar nada válido</b> com este texto: nenhuma proposta foi criada, nada mudou na carteira e os créditos desta geração foram estornados.
						<ul className="mt-1 list-disc pl-5">{explicarErrosGeracao(p.pedido?.resultado?.erros).map(t => <li key={t}>{t}</li>)}</ul>
					</div>
				)}
				<label className="sr-only" htmlFor="texto-segmentacao">Texto com os segmentos e a régua</label>
				<textarea id="texto-segmentacao" value={p.texto} onChange={e => p.setTexto(e.target.value)} rows={16} maxLength={LIMITE_TEXTO + 500}
					placeholder="Ex.: Para clientes de 0 a 30 dias de atraso, Dia 1 SMS, Dia 2 WhatsApp… Para 31 a 90 dias com saldo acima de R$ 2 mil…"
					className={`${textareaCls} mt-3 min-h-[280px] leading-relaxed`} style={{ borderColor: longo ? 'var(--estado-erro)' : 'var(--base-field-border, var(--base-borda))' }} />
				<p className={`mt-1 text-[11.5px] ${longo ? 'font-semibold text-[var(--estado-erro-texto)]' : 'text-[var(--base-texto-3)]'}`}>{numberBR(n)} / {numberBR(LIMITE_TEXTO)} caracteres{longo ? ' · encurte o texto ou divida em dois' : ''}</p>
				<p className="mt-1 text-[11.5px] text-[var(--base-texto-3)]">A IA não vê clientes, CPF, telefones nem valores individuais: só nomes de campos, canais, personas e os segmentos atuais.</p>
				{p.creditos && <div className="mt-3"><AvisoCreditosIA resumo={p.creditos} /></div>}
				{p.erro && <p role="alert" className="mt-2 text-[13px] text-[var(--estado-erro-texto)]">{p.erro}</p>}
				<div className="mt-3 flex flex-wrap items-center justify-end gap-2">
					<Botao tipo="fantasma" onClick={p.onFechar}>Cancelar</Botao>
					<Botao onClick={p.gerar} disabled={p.enviando || longo || p.texto.trim().length < 10}>
						<Sparkles size={14} /> {p.enviando ? 'Enviando…' : `Gerar proposta · ${rotuloCreditos(CREDITOS_DESCREVER, p.creditos)}`}
					</Botao>
				</div>
				<p className="mt-2 text-right text-[11.5px] text-[var(--base-texto-3)]">Uma geração para o texto inteiro (cerca de 30 s). As contagens de clientes vêm do banco, não da IA. Responder às perguntas, recalcular e aplicar não gastam crédito; geração sem proposta é estornada.</p>
			</div>
			<div className="min-w-0 space-y-3">
				<div className={`${cartao} p-4`}>
					<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Campos que viram condição de segmento</h3>
					<p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Calculados</p>
					<ul className="mt-1 space-y-0.5 text-[12.5px]">{CALCULADOS.map(([r, n, t]) => <li key={n} className="flex justify-between gap-2"><span className="text-[var(--base-texto)]">{r} <code className="text-[11px] text-[var(--base-texto-3)]">{n}</code></span><span className="text-[var(--base-texto-3)]">{t}</span></li>)}</ul>
					{p.colunas.length > 0 && <>
						<p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Colunas da carga desta carteira</p>
						<ul className="mt-1 space-y-0.5 text-[12.5px]">{p.colunas.map(c => <li key={c.nome} className="flex justify-between gap-2"><code className="truncate text-[12px] text-[var(--base-texto)]">{c.nome}</code><span className="text-[var(--base-texto-3)]">{c.tipo === 'numero' ? 'número' : 'texto'}</span></li>)}</ul>
					</>}
					<p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Operadores</p>
					<div className="mt-1 flex flex-wrap gap-1.5">{OPERADORES.map(o => <span key={o} className="rounded-full border border-[var(--base-borda)] px-2 py-0.5 text-[11.5px] text-[var(--base-texto-2)]">{o}</span>)}</div>
					<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Todas as condições de um segmento precisam bater (“e”). Propensão (A–E) e score do bureau <b>não</b> são campos de segmento.</p>
				</div>
				<div className={`${cartao} p-4`}>
					<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Canais desta carteira</h3>
					<div className="mt-2 flex flex-wrap gap-1.5">{CANAIS.map(c => <CanalChip key={c} canal={c} desligado={!p.canaisAtivos.has(c)} />)}<CanalChip canal="enriquecimento" /></div>
					{p.personas.length > 0 && <>
						<p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Personas e mapeamento de canais</p>
						<ul className="mt-1 space-y-1 text-[12.5px]">{p.personas.map(x => <li key={x.id}><b className="text-[var(--base-texto)]">{x.nome}</b> <span className="text-[var(--base-texto-2)]">{x.canais.length ? x.canais.map(nomeCanal).join(' → ') : 'sem mapeamento'}</span></li>)}</ul>
					</>}
					<p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Estágios do motor (a régua entra neles)</p>
					<div className="mt-1 flex flex-wrap gap-1.5">{['Cliente novo', 'Não CPC (ciclo)', 'CPC · sem resposta', 'Acordo · antes do vencimento', 'Acordo · parcela vencida'].map(e => <span key={e} className="rounded-full border border-[var(--base-borda)] px-2 py-0.5 text-[11.5px] text-[var(--base-texto-2)]">{e}</span>)}</div>
				</div>
				<div className={`${cartao} p-4`}>
					<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Limites</h3>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-[var(--base-texto-2)]">
						<li>Até 8 segmentos novos ou alterados por texto; código de 1 a 4 letras/números.</li>
						<li>Ciclo do Não CPC: 2 a 15 dias, até 6 voltas. Intervalo entre ações ≥ 12 h; horário 08:00–20:00.</li>
						<li>Não escreve valores, descontos nem ofertas (alçada/CRM). Não escolhe mensagens.</li>
						<li>Não apaga segmento: o que sair desta carteira é <b>desligado aqui</b>, e você confirma.</li>
						<li>Nada vale até você clicar em <b>Aplicar</b> na revisão; o que for aplicado nasce <b>pausado</b> até você conferir e ligar.</li>
					</ul>
				</div>
			</div>
		</div>
	);
}

function CanalChip({ canal, desligado }: { canal: string; desligado?: boolean }) {
	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--base-borda)] px-2.5 py-1 text-[12px] ${desligado ? 'text-[var(--base-texto-3)] line-through' : 'text-[var(--base-texto)]'}`}>
			<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CANAL_COR[canal] ?? '#8E8E93' }} />{nomeAcao(canal)}{desligado ? ' · desligado' : ''}
		</span>
	);
}

// ================================================================== peças comuns
function Codigo({ s, apagado }: { s: { codigo: string }; apagado?: boolean }) {
	return <span className="inline-grid h-6 min-w-[28px] place-items-center rounded-md px-1.5 text-[11px] font-bold" style={{ backgroundColor: 'var(--area)', color: 'var(--area-ativo-texto)', opacity: apagado ? 0.55 : 1 }}>{s.codigo}</span>;
}

function SeloAcao({ s }: { s: SegmentoProposto }) {
	const tom = s.acao === 'novo' ? 'info' : s.acao === 'alterar' ? 'atencao' : s.acao === 'desligar' ? 'erro' : 'neutro';
	return <Pilula tom={tom} className="uppercase !text-[10px] tracking-wide">{ROTULO_ACAO[s.acao]}</Pilula>;
}

function Cond({ c, antes }: { c: Condicao; antes?: boolean }) {
	return <span className={`rounded-full px-2 py-0.5 text-[11.5px] ${antes ? 'bg-[var(--base-fill)] text-[var(--base-texto-3)] line-through' : 'bg-[var(--estado-info-fundo)] text-[var(--base-texto)]'}`}>{textoCondicao(c)}</span>;
}

function Condicoes({ s }: { s: SegmentoProposto }) {
	const mudou = s.acao === 'alterar' && JSON.stringify(s.condicoes_antes) !== JSON.stringify(s.condicoes);
	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
			{mudou && (s.condicoes_antes ?? []).map((c, i) => <Cond key={`a${i}`} c={c} antes />)}
			{s.condicoes.length ? s.condicoes.map((c, i) => <Cond key={i} c={c} />) : <span className="text-[11.5px] italic text-[var(--base-texto-3)]">sem condições (vale para todos)</span>}
		</div>
	);
}

function textoEstrategia(s: SegmentoProposto): string {
	if (s.estrategia === 'nova') return `Nova · rascunho IA${s.estrategia_antes ? ` (a atual “${s.estrategia_antes}” fica guardada)` : s.acao === 'alterar' ? ' (antes: régua padrão do motor)' : ''}`;
	if (s.nao_citado) return 'não citado no texto: nada muda';
	return s.acao === 'novo' ? 'régua padrão do motor' : 'mantida';
}

function PerguntaCard({ q, n, valor, onEscolher }: { q: Pergunta; n: number; valor: string; onEscolher: (v: string) => void }) {
	return (
		<div className="rounded-lg border border-[var(--base-borda)] p-3" data-pergunta={q.codigo}>
			<p className="text-[13px] font-semibold text-[var(--base-texto)]">{n}. {q.texto}</p>
			{q.contexto && <p className="mt-0.5 text-[12px] text-[var(--base-texto-2)]">{q.contexto}</p>}
			<div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.texto}>
				{q.opcoes.map(o => {
					const on = o.valor === valor;
					return (
						<button key={o.valor} type="button" role="radio" aria-checked={on} onClick={() => onEscolher(o.valor)}
							className={`max-w-full rounded-lg border px-3 py-1.5 text-left text-[12.5px] ${on ? 'border-[var(--destaque)] bg-[var(--destaque-suave)] font-semibold text-[var(--base-texto)]' : 'border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]'}`}>
							{o.rotulo}{o.detalhe && <small className="block text-[11px] font-normal text-[var(--base-texto-3)]">{o.detalhe}</small>}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function Barra({ v, max }: { v: number; max: number }) {
	return <span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full bg-[var(--destaque)]" style={{ width: `${max > 0 ? Math.max(2, (v / max) * 100) : 0}%` }} /></span>;
}

/** O texto do usuário com os trechos que ficaram de fora marcados (tela 6). */
function TextoMarcado({ texto, trechos }: { texto: string; trechos: { trecho: string; tom: 'erro' | 'atencao' }[] }) {
	const partes: ReactNode[] = [];
	let resto = texto;
	let k = 0;
	const alvos = trechos.filter(t => t.trecho.length > 2);
	while (resto) {
		let melhor: { i: number; t: (typeof alvos)[number] } | null = null;
		for (const t of alvos) {
			const i = resto.toLowerCase().indexOf(t.trecho.toLowerCase().replace(/_/g, ' '));
			if (i >= 0 && (!melhor || i < melhor.i)) melhor = { i, t };
		}
		if (!melhor) { partes.push(resto); break; }
		partes.push(resto.slice(0, melhor.i));
		const cor = melhor.t.tom === 'erro' ? 'bg-[var(--estado-erro-fundo)] text-[var(--estado-erro-texto)]' : 'bg-[var(--estado-atencao-fundo)] text-[var(--estado-atencao-texto)]';
		partes.push(<mark key={k++} className={`rounded px-0.5 ${cor}`}>{resto.slice(melhor.i, melhor.i + melhor.t.trecho.length)}</mark>);
		resto = resto.slice(melhor.i + melhor.t.trecho.length);
	}
	return <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--base-texto)]">{partes}</p>;
}

// ================================================================== tela 3 · como ficou a carteira
function TelaProposta({ prop, c, respostas, setResposta, canaisAtivos, trocar, texto, credorNome, onDescartar, onEditar, onSegmentos, onRevisar }: {
	prop: Proposta; c: Contagens | null; respostas: Respostas; setResposta: (k: string, v: string) => void; canaisAtivos: Set<string>;
	trocar: (a: string, b: string) => void; texto: string; credorNome: string;
	onDescartar: () => void; onEditar: () => void; onSegmentos: () => void; onRevisar: () => void;
}) {
	const fica = emOrdem(prop);
	const max = Math.max(1, ...fica.map(s => c?.porRef[s.ref] ?? 0), c?.demais ?? 0);
	const confs = conferencias(prop, c, canaisAtivos);
	const qCarteira = prop.perguntas.filter(q => q.ref === 'carteira' || prop.segmentos[q.ref]?.acao === 'desligar');
	const matriz = c ? matrizDeOnde(prop, c) : null;
	const fora = prop.fora;
	return (
		<>
			{fora.length > 0 && (
				<div className={`${cartao} p-4`} data-fora>
					<h3 className="text-[15px] font-bold text-[var(--base-texto)]">{fora.length} {fora.length === 1 ? 'ponto precisa' : 'pontos precisam'} de você</h3>
					<p className="text-[12.5px] text-[var(--base-texto-2)]">Nada foi inventado: o que não existe aqui ficou fora da proposta.</p>
					<div className="mt-2 rounded-lg border border-[var(--base-borda)] p-3"><TextoMarcado texto={texto} trechos={fora.map(f => ({ trecho: f.trecho, tom: MOTIVO_FORA[f.motivo]?.tom ?? 'atencao' }))} /></div>
					<ul className="mt-2 space-y-2">
						{fora.map((f, i) => {
							const m = MOTIVO_FORA[f.motivo];
							return (
								<li key={i} className="flex gap-2 text-[12.5px]">
									<span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold ${m?.tom === 'erro' ? 'bg-[var(--estado-erro-fundo)] text-[var(--estado-erro-texto)]' : 'bg-[var(--estado-atencao-fundo)] text-[var(--estado-atencao-texto)]'}`}>{m?.tom === 'erro' ? '×' : '!'}</span>
									<span><b className="text-[var(--base-texto)]">{m ? m.titulo(f.trecho) : f.trecho}</b>{f.ref !== 'carteira' && prop.segmentos[f.ref] ? ` (${prop.segmentos[f.ref].codigo})` : ''} <span className="text-[var(--base-texto-2)]">{m?.texto}</span></span>
								</li>
							);
						})}
					</ul>
				</div>
			)}
			<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
				<div className="min-w-0 space-y-2">
					<div className="flex flex-wrap items-baseline gap-2"><h2 className="text-[15px] font-bold text-[var(--base-texto)]">Como ficou a carteira</h2><span className="text-[12px] text-[var(--base-texto-3)]">na ordem de prioridade</span></div>
					<p className="flex items-center gap-2 rounded-lg bg-[var(--base-fill)] px-3 py-2 text-[12px] text-[var(--base-texto-2)]"><ArrowDown size={13} /> O cliente fica no 1º segmento em que se encaixa. Cada número abaixo já conta só quem fica naquele segmento.</p>
					{fica.map((s, i) => (
						<div key={s.ref} className={`${cartao} flex gap-3 p-3 sm:p-4`} data-seg={s.codigo}>
							<span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--base-fill)] text-[11px] font-semibold text-[var(--base-texto-2)]">{i + 1}</span>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-1.5">
									<Codigo s={s} /><b className="text-[14px] text-[var(--base-texto)]">{s.nome}</b><SeloAcao s={s} />
									{s.acao === 'alterar' && s.nome_antes && s.nome_antes !== s.nome && <span className="text-[11.5px] text-[var(--base-texto-3)]">era “{s.nome_antes}”</span>}
									{s.acao === 'alterar' && s.compartilhado_com.length > 0 && <Pilula tom="atencao">muda também em {s.compartilhado_com.join(', ')}</Pilula>}
								</div>
								<Condicoes s={s} />
								{s.trechos[0] && <p className="mt-1.5 border-l-2 border-[var(--estado-info)] pl-2 text-[12px] italic text-[var(--base-texto-2)]">{s.trechos[0]}</p>}
								<p className="mt-1.5 text-[12px] text-[var(--base-texto-2)]">Estratégia: <b className="text-[var(--base-texto)]">{textoEstrategia(s)}</b>{s.resumo_regua ? ` · ${s.resumo_regua}` : ''}</p>
							</div>
							<div className="flex-none text-right">
								<p className="text-[18px] font-bold tabular-nums text-[var(--base-texto)]" data-contagem={s.codigo}>{c ? numberBR(c.porRef[s.ref] ?? 0) : '…'}</p>
								<p className="text-[11px] text-[var(--base-texto-3)]">clientes hoje</p>
								<Barra v={c?.porRef[s.ref] ?? 0} max={max} />
							</div>
						</div>
					))}
					<div className={`${cartao} flex gap-3 p-3 sm:p-4`}>
						<span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--base-fill)] text-[11px] text-[var(--base-texto-3)]">··</span>
						<div className="min-w-0 flex-1"><b className="text-[14px] text-[var(--base-texto)]">Demais</b> <Pilula className="uppercase !text-[10px]">{prop.demais === 'desligar' ? 'desligar' : 'manter'}</Pilula>
							<p className="mt-1 text-[12px] text-[var(--base-texto-2)]">Quem não se encaixa em nenhum segmento. Estratégia: <b className="text-[var(--base-texto)]">{prop.demais === 'desligar' ? 'desligado: sem ação (acordos continuam)' : 'estratégia da carteira'}</b></p></div>
						<div className="flex-none text-right"><p className="text-[18px] font-bold tabular-nums text-[var(--base-texto)]" data-contagem="Demais">{c ? numberBR(c.demais) : '…'}</p><p className="text-[11px] text-[var(--base-texto-3)]">clientes hoje</p></div>
					</div>
					{desligados(prop).length > 0 && <>
						<p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Sai desta carteira (nada é apagado)</p>
						{desligados(prop).map(s => (
							<div key={s.ref} className="flex gap-3 rounded-xl border border-dashed border-[var(--base-borda)] p-3 sm:p-4" data-seg={s.codigo}>
								<span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--base-fill)] text-[11px] text-[var(--base-texto-3)]">–</span>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-1.5"><Codigo s={s} apagado /><b className="text-[14px] text-[var(--base-texto)]">{s.nome}</b><SeloAcao s={s} /></div>
									<Condicoes s={s} />
									<p className="mt-1.5 text-[12px] text-[var(--base-texto-2)]">O segmento sai só de {credorNome}{s.compartilhado_com.length ? `; continua em ${s.compartilhado_com.join(', ')}` : ''}. A estratégia não é apagada. Dá para religar aqui a qualquer momento.</p>
								</div>
								<div className="flex-none text-right"><p className="text-[18px] font-bold tabular-nums text-[var(--base-texto-3)]">{c ? numberBR(c.hoje[s.codigo] ?? 0) : '…'}</p><p className="text-[11px] text-[var(--base-texto-3)]">saem daqui</p></div>
							</div>
						))}
					</>}
					{naoCriados(prop).length > 0 && <p className="text-[12px] text-[var(--base-texto-3)]">Não criados (recorte sem cliente hoje ou pela sua resposta): {naoCriados(prop).map(s => s.codigo).join(', ')}.</p>}
				</div>
				<div className="min-w-0 space-y-3">
					<div className={`${cartao} p-4`}>
						<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Cobertura · {c ? numberBR(c.total) : '…'} clientes</h3>
						{c && c.total > 0 && <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-[var(--base-fill)]" aria-hidden="true">
							{fica.map((s, i) => <span key={s.ref} className="h-full border-r border-[var(--base-cartao)]" style={{ width: `${((c.porRef[s.ref] ?? 0) / c.total) * 100}%`, backgroundColor: 'var(--destaque)', opacity: 1 - (i % 4) * 0.18 }} />)}
							<span className="h-full" style={{ width: `${(c.demais / c.total) * 100}%`, backgroundColor: 'var(--base-texto-3)' }} />
						</div>}
						<table className="mt-2 w-full text-[12.5px]"><thead><tr className="text-[10.5px] uppercase text-[var(--base-texto-3)]"><th className="py-1 text-left font-semibold">Segmento</th><th className="text-right font-semibold">Clientes</th><th className="text-right font-semibold">%</th></tr></thead>
							<tbody>{fica.map(s => <tr key={s.ref} className="border-t border-[var(--base-borda)]"><td className="py-1"><Codigo s={s} /></td><td className="text-right tabular-nums">{c ? numberBR(c.porRef[s.ref] ?? 0) : '…'}</td><td className="text-right tabular-nums">{c && c.total ? `${(((c.porRef[s.ref] ?? 0) / c.total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : '—'}</td></tr>)}
								<tr className="border-t border-[var(--base-borda)]"><td className="py-1 text-[var(--base-texto-2)]">Demais</td><td className="text-right tabular-nums">{c ? numberBR(c.demais) : '…'}</td><td className="text-right tabular-nums">{c && c.total ? `${((c.demais / c.total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : '—'}</td></tr>
								<tr className="border-t border-[var(--base-borda)] font-bold"><td className="py-1">Total</td><td className="text-right tabular-nums">{c ? numberBR(c.total) : '…'}</td><td className="text-right">100%</td></tr></tbody></table>
					</div>
					<div className={`${cartao} p-4`} data-conferencias>
						<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Conferências</h3>
						<ul className="mt-2 space-y-2">{confs.map((x, i) => (
							<li key={i} className="flex gap-2 text-[12.5px]">
								<span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold ${x.tom === 'ok' ? 'bg-[var(--estado-pronto-fundo)] text-[var(--estado-pronto-texto)]' : x.tom === 'erro' ? 'bg-[var(--estado-erro-fundo)] text-[var(--estado-erro-texto)]' : 'bg-[var(--estado-atencao-fundo)] text-[var(--estado-atencao-texto)]'}`}>{x.tom === 'ok' ? <Check size={12} /> : '!'}</span>
								<div className="min-w-0"><b className="text-[var(--base-texto)]">{x.titulo}</b> <span className="text-[var(--base-texto-2)]">{x.texto}</span>
									{x.troca && <div className="mt-1.5 flex flex-wrap gap-1.5">
										<span className="rounded-lg border border-[var(--destaque)] bg-[var(--destaque-suave)] px-2.5 py-1 text-[12px] font-semibold">Manter a ordem</span>
										<button type="button" onClick={() => trocar(x.troca!.a, x.troca!.b)} className="rounded-lg border border-[var(--base-borda)] px-2.5 py-1 text-[12px] hover:bg-[var(--base-fill)]">{prop.segmentos[x.troca.b]?.codigo} primeiro</button>
									</div>}</div>
							</li>))}</ul>
					</div>
					<div className={`${cartao} p-4`}>
						<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Perguntas sobre a carteira</h3>
						<p className="text-[12px] text-[var(--base-texto-2)]">A opção marcada já está na proposta. Trocar recalcula as contagens, sem nova geração.</p>
						<div className="mt-2 space-y-2">{qCarteira.length ? qCarteira.map((q, i) => <PerguntaCard key={q.codigo} q={q} n={i + 1} valor={respostas[q.codigo] ?? q.padrao} onEscolher={v => setResposta(q.codigo, v)} />) : <p className="text-[12.5px] text-[var(--base-texto-3)]">Nenhuma pergunta sobre a carteira.</p>}</div>
					</div>
				</div>
			</div>
			{matriz && matriz.linhas.length > 0 && (
				<div className={`${cartao} p-4`} data-matriz>
					<div className="flex flex-wrap items-baseline gap-2"><h3 className="text-[15px] font-bold text-[var(--base-texto)]">De onde vêm os clientes</h3><span className="text-[12px] text-[var(--base-texto-3)]">segmento hoje → segmento proposto</span></div>
					<div className="mt-2 overflow-x-auto">
						<table className="min-w-[560px] w-full text-[12.5px] tabular-nums">
							<thead><tr className="text-[10.5px] uppercase text-[var(--base-texto-3)]"><th className="py-1 text-left font-semibold">Hoje ↓ · proposto →</th>{matriz.colunas.map(col => <th key={col.ref} className="text-right font-semibold">{col.codigo}</th>)}<th className="text-right font-semibold">Total hoje</th></tr></thead>
							<tbody>
								{matriz.linhas.map(l => <tr key={l.de} className="border-t border-[var(--base-borda)]"><td className="py-1 font-semibold">{l.de}</td>{l.valores.map((v, j) => <td key={j} className={`text-right ${v ? (matriz.colunas[j].codigo === l.de ? '' : 'font-bold') : 'text-[var(--base-texto-3)]'}`}>{v ? numberBR(v) : '—'}</td>)}<td className="text-right">{numberBR(l.total)}</td></tr>)}
								<tr className="border-t border-[var(--base-borda)] font-bold"><td className="py-1">Total proposto</td>{matriz.totais.map((v, j) => <td key={j} className="text-right">{numberBR(v)}</td>)}<td className="text-right">{c ? numberBR(c.total) : ''}</td></tr>
							</tbody>
						</table>
					</div>
					<p className="mt-1 text-[11.5px] text-[var(--base-texto-3)]">Ninguém fica sem segmento por engano: cada linha soma o total que tinha, e cada coluna o total que terá.</p>
				</div>
			)}
			<div className="flex flex-wrap justify-end gap-2">
				<Botao tipo="fantasma" onClick={onDescartar}>Descartar</Botao>
				<Botao tipo="secundario" onClick={onEditar}>Editar o texto e gerar de novo</Botao>
				<Botao tipo="secundario" onClick={onSegmentos}>Ver a régua de cada segmento</Botao>
				<Botao onClick={onRevisar}>Revisar e aplicar <ArrowRight size={14} /></Botao>
			</div>
		</>
	);
}

// ================================================================== tela 4 · por segmento
function Celula({ acoes, segue }: { acoes: Acao[]; segue?: boolean }) {
	if (!acoes.length) return <span className="text-[var(--base-texto-3)]">—</span>;
	return (
		<span className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${segue ? 'opacity-60' : ''}`}>
			{acoes.map((a, i) => (
				<Fragment key={i}>
					{conectorModo(a.modo, i === 0) && <span className="rounded bg-[var(--base-fill)] px-1 text-[10.5px] text-[var(--base-texto-3)]">{conectorModo(a.modo, i === 0)}</span>}
					<span className="inline-flex items-center gap-1 font-medium text-[var(--base-texto)]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CANAL_COR[a.canal] ?? '#8E8E93' }} />{nomeAcao(a.canal)}</span>
				</Fragment>
			))}
			{segue && <span className="text-[10.5px] text-[var(--base-texto-3)]">(segue o Público geral)</span>}
		</span>
	);
}

function TabelaRegua({ s, personas, c }: { s: SegmentoProposto; personas: PersonaInfo[]; c: Contagens | null }) {
	const linhas = tabelaRegua(s.definicao, personas);
	if (!linhas.length) return <p className="text-[12.5px] text-[var(--base-texto-3)]">Sem régua própria do texto neste segmento.</p>;
	return (
		<div className="overflow-x-auto">
			<table className="min-w-[620px] w-full text-[12.5px]">
				<thead><tr className="bg-[var(--base-fill)] text-[10.5px] uppercase text-[var(--base-texto-3)]"><th className="px-2 py-1.5 text-left font-semibold">Segmento</th><th className="px-2 text-left font-semibold">Perfil do cliente</th><th className="px-2 text-left font-semibold">Prioridade</th><th className="px-2 text-left font-semibold">Dia do ciclo</th><th className="px-2 text-left font-semibold">Canais</th></tr></thead>
				<tbody>
					{linhas.map((l, li) => l.dias.map((d, di) => (
						<tr key={`${li}-${di}`} className={di === 0 ? 'border-t-2 border-[var(--base-borda)]' : 'border-t border-[var(--base-borda)]'}>
							{li === 0 && di === 0 && <td rowSpan={linhas.reduce((n, x) => n + x.dias.length, 0)} className="bg-[var(--base-fill)] px-2 py-1.5 align-top"><Codigo s={s} /> <b>{s.nome}</b><span className="block text-[11px] text-[var(--base-texto-3)]">Cliente novo · Não CPC{c ? ` · ${numberBR(c.porRef[s.ref] ?? 0)} clientes` : ''}</span></td>}
							{di === 0 && <td rowSpan={l.dias.length} className="px-2 py-1.5 align-top"><b className="text-[var(--base-texto)]">{l.perfil}</b>{l.detalhe && <span className="block text-[11px] text-[var(--base-texto-3)]">{l.detalhe}</span>}</td>}
							{di === 0 && <td rowSpan={l.dias.length} className="px-2 py-1.5 align-top"><span className="inline-grid h-6 w-6 place-items-center rounded-md bg-[var(--base-fill)] text-[11px] font-bold">{l.prioridade}</span></td>}
							<td className="px-2 py-1.5 whitespace-nowrap">Dia {d.dia}</td>
							<td className="px-2 py-1.5"><Celula acoes={d.acoes} segue={d.segue} /></td>
						</tr>
					)))}
				</tbody>
			</table>
		</div>
	);
}

function TelaSegmento({ prop, c, aba, setAba, respostas, setResposta, personas, onVoltar, onRevisar }: {
	prop: Proposta; c: Contagens | null; aba: string; setAba: (a: string) => void; respostas: Respostas; setResposta: (k: string, v: string) => void;
	personas: PersonaInfo[]; onVoltar: () => void; onRevisar: () => void;
}) {
	const segs = emOrdem(prop).filter(s => s.estrategia === 'nova' || s.acao !== 'manter');
	const s = prop.segmentos[aba];
	const qs = (ref: string) => prop.perguntas.filter(q => q.ref === ref);
	return (
		<>
			<div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Segmentos da proposta">
				{segs.map(x => (
					<button key={x.ref} type="button" role="tab" aria-selected={aba === x.ref} onClick={() => setAba(x.ref)}
						className={`flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px] ${aba === x.ref ? 'border-[var(--base-texto)] bg-[var(--base-texto)] text-[var(--base-cartao)]' : 'border-[var(--base-borda)] text-[var(--base-texto)] hover:bg-[var(--base-fill)]'}`}>
						<Codigo s={x} /> {x.nome}{qs(x.ref).length > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--estado-atencao-fundo)] px-1 text-[10px] font-bold text-[var(--estado-atencao-texto)]">{qs(x.ref).length}</span>}
					</button>
				))}
				<button type="button" role="tab" aria-selected={aba === 'tabela'} onClick={() => setAba('tabela')} className={`flex-none rounded-full border px-3 py-1.5 text-[12.5px] ${aba === 'tabela' ? 'border-[var(--base-texto)] bg-[var(--base-texto)] text-[var(--base-cartao)]' : 'border-[var(--base-borda)] hover:bg-[var(--base-fill)]'}`}>≡ Tabela única</button>
			</div>
			{aba === 'tabela' && <div className={`${cartao} space-y-4 p-4`}><h3 className="text-[15px] font-bold text-[var(--base-texto)]">Régua por perfil · todos os segmentos</h3>{segs.filter(x => x.definicao).map(x => <TabelaRegua key={x.ref} s={x} personas={personas} c={c} />)}</div>}
			{s && aba !== 'tabela' && <>
				<div className={`${cartao} p-4`} data-segmento-aba={s.codigo}>
					<div className="flex flex-wrap items-center gap-1.5"><Codigo s={s} /><b className="text-[15px] text-[var(--base-texto)]">{s.nome}</b><SeloAcao s={s} /><span className="text-[12px] text-[var(--base-texto-3)]">· {c ? numberBR(c.porRef[s.ref] ?? 0) : '…'} clientes hoje</span></div>
					<Condicoes s={s} />
					{s.definicao && <>
						<p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">Onde a régua entra (estágios do motor)</p>
						<div className="mt-1.5 flex flex-wrap gap-1.5">{estagiosDoSegmento(s.definicao).map(e => (
							<span key={e.id} className={`rounded-lg border px-2.5 py-1.5 text-[12px] ${e.doTexto ? 'border-dashed border-[var(--estado-info)]' : 'border-[var(--base-borda)]'}`}><b className="text-[var(--base-texto)]">{e.nome}</b><span className="block text-[11px] text-[var(--base-texto-3)]">{e.resumo}</span></span>
						))}</div>
					</>}
					{(s.so_digital || (s.canais_bloqueados ?? []).length > 0) && <p className="mt-2 text-[12px] text-[var(--estado-atencao-texto)]">{s.so_digital ? 'Segmento só digital (sem voz em nenhum estágio). ' : ''}{(s.canais_bloqueados ?? []).length ? `Canais bloqueados no segmento: ${(s.canais_bloqueados ?? []).map(nomeCanal).join(', ')}.` : ''}</p>}
				</div>
				<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
					<div className={`${cartao} min-w-0 p-4`}>
						<h3 className="text-[15px] font-bold text-[var(--base-texto)]">O que entendi</h3>
						<p className="text-[12px] text-[var(--base-texto-2)]">Cada trecho do texto e o que virou: <Pilula tom="destaque" className="!text-[10px]">SEGMENTO</Pilula> é para quem, <Pilula tom="info" className="!text-[10px]">RÉGUA</Pilula> é o que fazer.</p>
						<ul className="mt-2 divide-y divide-[var(--base-borda)]">{prop.entendi.filter(e => e.ref === s.ref).map((e, i) => (
							<li key={i} className="grid gap-1 py-2 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,1.2fr)] sm:gap-2">
								<span className="italic text-[var(--base-texto-2)]">{e.frase}</span><ArrowRight size={13} className="hidden text-[var(--base-texto-3)] sm:block" />
								<span><Pilula tom={e.tipo === 'segmento' ? 'destaque' : e.tipo === 'fora' ? 'erro' : 'info'} className="mr-1 !text-[10px] uppercase">{e.tipo === 'regua' ? 'régua' : e.tipo}</Pilula>{e.item}</span>
							</li>))}
							{!prop.entendi.some(e => e.ref === s.ref) && <li className="py-2 text-[12.5px] text-[var(--base-texto-3)]">Nenhum trecho só deste segmento.</li>}
						</ul>
					</div>
					<div className="min-w-0 space-y-3">
						<div className={`${cartao} p-4`}>
							<h3 className="text-[15px] font-bold text-[var(--base-texto)]">Perguntas</h3>
							<p className="text-[12px] text-[var(--base-texto-2)]">A opção marcada já está na proposta. Trocar aplica na hora, sem nova geração.</p>
							<div className="mt-2 space-y-2">{qs(s.ref).length ? qs(s.ref).map((q, i) => <PerguntaCard key={q.codigo} q={q} n={i + 1} valor={respostas[q.codigo] ?? q.padrao} onEscolher={v => setResposta(q.codigo, v)} />) : <p className="text-[12.5px] text-[var(--base-texto-3)]">Nenhuma pergunta neste segmento.</p>}</div>
						</div>
						<div className={`${cartao} p-4`}>
							<h3 className="text-[15px] font-bold text-[var(--base-texto)]">Suposições</h3>
							<ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] text-[var(--base-texto-2)]">{[...prop.suposicoes.filter(x => x.ref === s.ref), ...prop.suposicoes.filter(x => x.ref === 'carteira')].map((x, i) => <li key={i}>{x.texto}</li>)}</ul>
						</div>
					</div>
				</div>
				{s.definicao && <div className={`${cartao} p-4`}><div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="text-[15px] font-bold text-[var(--base-texto)]">Régua por perfil</h3><span className="text-[12px] text-[var(--base-texto-3)]">a tabela que você pediu · prioridade = ordem das raias</span></div><TabelaRegua s={s} personas={personas} c={c} />
					<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">{s.resumo_regua}. Persona com raia no dia recebe só a raia dela; sem contato para esse canal, segue o Público geral (regra do motor).</p></div>}
			</>}
			<div className="flex flex-wrap justify-end gap-2"><Botao tipo="secundario" onClick={onVoltar}>Voltar: como ficou a carteira</Botao><Botao onClick={onRevisar}>Revisar e aplicar <ArrowRight size={14} /></Botao></div>
		</>
	);
}

// ================================================================== tela 5 · revisar e aplicar
function frasesMudanca(s: SegmentoProposto, credorNome: string): ReactNode {
	const conds = s.condicoes.map(textoCondicao).join(' e ');
	const estr = s.estrategia === 'nova' ? ` e cria a estratégia “${s.nome} · ${credorNome}”` : '';
	if (s.acao === 'novo') return <>Cria o segmento {s.codigo} na empresa com <b>{conds || 'sem condições'}</b>, liga em {credorNome}{estr}.</>;
	if (s.acao === 'alterar') {
		const antes = (s.condicoes_antes ?? []).map(textoCondicao).join(' e ');
		return <>Condição: {antes !== conds ? <><span className="line-through">{antes}</span> → <b>{conds}</b></> : 'igual'}{s.nome_antes && s.nome_antes !== s.nome ? ` · nome: “${s.nome_antes}” → “${s.nome}”` : ''}.{s.estrategia === 'nova' ? ` ${s.estrategia_antes ? `Troca a estratégia por “${s.nome} · ${credorNome}”; a atual fica guardada.` : `Cria a estratégia “${s.nome} · ${credorNome}” (antes: régua padrão do motor).`}` : ''}{s.compartilhado_com.length ? ` Muda também em ${s.compartilhado_com.join(', ')}.` : ''}</>;
	}
	if (s.acao === 'desligar') return <>Desliga só em {credorNome}{s.compartilhado_com.length ? `. Continua em ${s.compartilhado_com.join(', ')}` : ''}. A estratégia não é apagada. Religar desfaz.</>;
	return s.nao_citado ? <>Nada muda.</> : <>Mantido.{s.estrategia === 'nova' ? ` Cria a estratégia “${s.nome} · ${credorNome}”.` : ''}</>;
}

function TelaRevisar({ prop, c, credorNome, outras, extras, setExtras, confirmou, setConfirmou, aplicando, onVoltar, onAplicar, bloqueios, nPerguntas }: {
	prop: Proposta; c: Contagens | null; credorNome: string; outras: { id: string; nome: string }[]; extras: string[]; setExtras: (x: string[]) => void;
	confirmou: boolean; setConfirmou: (v: boolean) => void; aplicando: boolean; onVoltar: () => void; onAplicar: () => void; bloqueios: string[]; nPerguntas: number;
}) {
	const fica = emOrdem(prop);
	const novos = fica.filter(s => s.acao === 'novo');
	const pausados = fica.filter(s => s.acao === 'novo' || s.acao === 'alterar' || s.estrategia === 'nova');
	return (
		<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
			<div className={`${cartao} min-w-0 p-4 sm:p-5`}>
				<h2 className="text-[16px] font-bold text-[var(--base-texto)]">O que vai mudar</h2>
				<p className="text-[12.5px] text-[var(--base-texto-2)]">Na ordem em que fica. Segmento é da empresa; estratégia é desta carteira.</p>
				<ol className="mt-2 divide-y divide-[var(--base-borda)]">
					{[...fica, ...desligados(prop)].map((s, i) => (
						<li key={s.ref} className="flex gap-3 py-2.5" data-mudanca={s.codigo}>
							<span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--base-fill)] text-[11px] text-[var(--base-texto-2)]">{s.acao === 'desligar' ? '–' : i + 1}</span>
							<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><Codigo s={s} apagado={s.acao === 'desligar'} /><b className="text-[13.5px]">{s.nome}</b><SeloAcao s={s} />{pausados.includes(s) && <Pilula tom="atencao" className="!text-[10px] uppercase">nasce pausado</Pilula>}</div>
								<p className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">{frasesMudanca(s, credorNome)}</p></div>
							<span className="flex-none text-[13px] tabular-nums text-[var(--base-texto-2)]">{c ? numberBR(s.acao === 'desligar' ? c.hoje[s.codigo] ?? 0 : c.porRef[s.ref] ?? 0) : '…'}</span>
						</li>
					))}
					<li className="flex gap-3 py-2.5"><span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--base-fill)] text-[11px]">··</span><div className="flex-1"><b className="text-[13.5px]">Demais</b> <Pilula className="!text-[10px] uppercase">{prop.demais === 'desligar' ? 'desligar' : 'manter'}</Pilula><p className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">{prop.demais === 'desligar' ? 'Desligado: sem ação (acordos continuam).' : 'Mantido com a estratégia da carteira.'}</p></div><span className="flex-none text-[13px] tabular-nums text-[var(--base-texto-2)]">{c ? numberBR(c.demais) : '…'}</span></li>
					<li className="flex gap-3 py-2.5"><span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--base-fill)]"><ArrowDown size={12} /></span><div><b className="text-[13.5px]">Ordem final</b><p className="text-[12.5px] text-[var(--base-texto-2)]">{fica.map(s => s.codigo).join(' › ')} › Demais. A posição dos outros segmentos da empresa não muda.</p></div></li>
				</ol>
			</div>
			<div className="min-w-0 space-y-3">
				<div className={`${cartao} p-4`}>
					<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Em quais carteiras</h3>
					<div className="mt-2 rounded-lg border border-[var(--destaque)] bg-[var(--destaque-suave)] p-3 text-[12.5px]"><b>{credorNome}</b> · {c ? numberBR(c.total) : '…'} clientes<span className="block text-[var(--base-texto-2)]">Segmentos ligados e estratégias próprias desta carteira.</span></div>
					{novos.length > 0 && outras.map(o => (
						<label key={o.id} className="mt-2 flex cursor-pointer gap-2 rounded-lg border border-[var(--base-borda)] p-3 text-[12.5px]">
							<input type="checkbox" checked={extras.includes(o.id)} onChange={e => setExtras(e.target.checked ? [...extras, o.id] : extras.filter(x => x !== o.id))} className="mt-0.5" />
							<span><b>{o.nome}</b><span className="block text-[var(--base-texto-2)]">Liga os segmentos novos lá também ({novos.map(s => s.codigo).join(', ')}), pausados, cada um com uma <b>cópia</b> da estratégia (mudar uma não muda a outra).</span></span>
						</label>
					))}
				</div>
				<div className={`${cartao} p-4`}>
					<h3 className="text-[14px] font-bold text-[var(--base-texto)]">Antes de aplicar</h3>
					<dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[12.5px]">
						<dt className="text-[var(--base-texto-2)]">Clientes que mudam de segmento</dt><dd className="font-bold tabular-nums" data-mudam>{c ? numberBR(c.mudam) : '…'}</dd>
						<dt className="text-[var(--base-texto-2)]">Perguntas</dt><dd><Pilula tom="ok">{nPerguntas} respondidas</Pilula></dd>
						<dt className="text-[var(--base-texto-2)]">Validação</dt><dd><Pilula tom="ok">aceitas pelo motor</Pilula></dd>
						<dt className="text-[var(--base-texto-2)]">Vale a partir de</dt><dd className="text-right">quando você ligar</dd>
					</dl>
					<Aviso tom="atencao" titulo={`${pausados.length} segmento${pausados.length === 1 ? '' : 's'} nasce${pausados.length === 1 ? '' : 'm'} pausado${pausados.length === 1 ? '' : 's'}`}>
						Até você conferir a régua e ligar, quem cairia neles segue no próximo segmento ligado ou em Demais (estratégia da carteira).
					</Aviso>
					<label className="mt-3 flex cursor-pointer gap-2 text-[12.5px]">
						<input type="checkbox" checked={confirmou} onChange={e => setConfirmou(e.target.checked)} className="mt-0.5" data-confirmar />
						<span>Entendi que <b>{c ? numberBR(c.mudam) : '…'}</b> clientes mudam de segmento e passam a seguir outra régua quando os segmentos forem ligados. Mensagens já enviadas não voltam.</span>
					</label>
					{bloqueios.filter(b => !b.startsWith('Confirme')).map(b => <p key={b} role="alert" className="mt-2 text-[12.5px] font-semibold text-[var(--estado-erro-texto)]">{b}</p>)}
					<div className="mt-3 flex gap-2"><Botao tipo="secundario" onClick={onVoltar}>Voltar</Botao><Botao onClick={onAplicar} disabled={aplicando || bloqueios.length > 0} className="flex-1">{aplicando ? 'Aplicando…' : `Aplicar em ${credorNome}`}</Botao></div>
					<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]"><b>Depois de aplicar:</b> Desfazer volta segmentos, ordem e estratégias ao que eram (versão anterior guardada), até a próxima rotina. Esta geração já usou {CREDITOS_DESCREVER} créditos de IA; aplicar não gasta.</p>
				</div>
			</div>
		</div>
	);
}
