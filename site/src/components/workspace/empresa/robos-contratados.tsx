// Contratação › Agente de voz › Robôs contratados (licenças), PR 3 do plano (protótipo aprovado, telas 1, 1b e 1c).
// Só a equipe MotorCX edita (salvar_licencas_voz, SQL 93): quantidade, fidelidade e franquia com editar_contratacao;
// preço com editar_precos; abaixo do mínimo do catálogo com preco_abaixo_minimo e motivo. A fatura é a do SQL 98
// (previa_fatura): a tela mostra a prévia real deste ciclo e, na edição, a simulada com as mesmas contas
// (src/lib/licencas-voz.ts). 1 robô = 1 conversa ao mesmo tempo com a IA (não é linha discando nem canal do tronco).
// Avisos dos riscos conhecidos: mudança agendada para o próximo ciclo continua valendo depois de um aumento "agora";
// troca de preço "agora" é cobrada pelos dias de cada preço (pro rata), e preço menor vira crédito.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, moneyBR, dateBR, today, type Row } from '@/lib/supabase';
import { useConsolePerms } from '@/components/workspace/console/console-perms';
import { Aviso, Campo, Cartao, Pilula, Vazio, btnPrim, btnSec, campoCls } from '@/components/comuns/voz-ui';
import { Kpis } from '@/components/ds';
import { ehItemFaturaVoz, lerNumero } from '@/lib/voz';
import {
	FIDELIDADES, FRANQUIA_PADRAO, agendadas, avisos, bloqueios, dataBR, deLinha, diasEntre, ehReducao, licencaEm, limiteReal,
	precoPorRobo, previaCiclo, somarDias, totalMes, valeDesde, vendidoCom, type Edicao, type Licenca, type LinhaPrevia,
} from '@/lib/licencas-voz';

const ROTA = '/empresa/contratacao';
const int = (v: unknown) => Math.round(Number(v ?? 0)).toLocaleString('pt-BR');
const robosTxt = (n: number) => `${int(n)} ${n === 1 ? 'robô' : 'robôs'}`;
const numCampo = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false }));

type Dados = {
	lista: Licenca[];
	hist: Row[];
	todas: (Licenca & { empresa_id: number })[];
	item: Row | null;
	precoMinutoIA: number | null;
	precoTranscricao: number | null;
	precoTronco: number | null;
	ciclo: { inicio: string; fim: string } | null;
	divisao: { canais: number; limite: number } | null;
	teto: number | null;
	previa: Row[];
};

/** Preço flat que vale no mês (precos_empresa já ordenado do mais novo); sem preço da empresa, o de tabela. */
function precoFlat(precos: Row[], itens: Row[], codigo: string): number | null {
	const mes = `${today().slice(0, 7)}-01`;
	const p = precos.find(x => String(x.item) === codigo && String(x.vigente_desde) <= mes);
	if (p) return String(p.modelo) === 'flat' ? Number(p.preco) : null;
	const t = itens.find(x => String(x.codigo) === codigo)?.preco_tabela;
	return t == null ? null : Number(t);
}

function useDadosRobos(empresaId: string | undefined, versao = 0) {
	const [dados, setDados] = useState<Dados | null>(null);
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase || !empresaId) return;
		let ativo = true;
		const sb = supabase;
		const eid = Number(empresaId);
		(async () => {
			const [h, cl, it, pe, ci, dv, ct, pf] = await Promise.all([
				sb.rpc('licencas_voz', { empresa: eid }),
				sb.from('voz_licencas_cliente').select('id,empresa_id,robos,modelo,preco_robo,valor_fechado,franquia_min_robo,transcricao_inclusa,vigente_desde,fidelidade_meses,fidelidade_ate,fidelidade_min'),
				sb.from('cobranca_itens').select('codigo,nome,preco_tabela,preco_minimo,franquia_padrao').in('codigo', ['voz_licenca_robo', 'voz_minuto_ia', 'voz_transcricao', 'gestao_tronco_sip']),
				sb.from('precos_empresa').select('item,modelo,preco,vigente_desde').eq('empresa_id', eid).in('item', ['voz_minuto_ia', 'voz_transcricao', 'gestao_tronco_sip']).order('vigente_desde', { ascending: false }),
				sb.rpc('ciclo_atual', { empresa: eid }),
				sb.from('voz_divisao_concorrencia').select('canais,limite').eq('empresa_id', eid).maybeSingle(),
				sb.from('voz_contrato').select('concorrencia_contratada').maybeSingle(),
				sb.rpc('previa_fatura', { empresa: eid, competencia: today() }),
			]);
			if (!ativo) return;
			if (h.error && cl.error) { setErro('Não foi possível ler os robôs contratados desta empresa.'); return; }
			const todasRows = ((cl.data ?? []) as Row[]);
			const todas = todasRows.map(r => ({ ...deLinha(r), empresa_id: Number(r.empresa_id) }));
			const hist = h.error ? [] : ((h.data ?? []) as Row[]);
			const lista = h.error ? todas.filter(l => l.empresa_id === eid) : hist.map(deLinha);
			const itens = (it.data ?? []) as Row[];
			const precos = (pe.data ?? []) as Row[];
			const c = ((ci.data ?? []) as Row[])[0];
			setDados({
				lista, hist, todas,
				item: itens.find(x => x.codigo === 'voz_licenca_robo') ?? null,
				precoMinutoIA: precoFlat(precos, itens, 'voz_minuto_ia'),
				precoTranscricao: precoFlat(precos, itens, 'voz_transcricao'),
				precoTronco: precoFlat(precos, itens, 'gestao_tronco_sip'),
				ciclo: c?.inicio && c?.fim ? { inicio: String(c.inicio).slice(0, 10), fim: String(c.fim).slice(0, 10) } : null,
				divisao: dv.data ? { canais: Number((dv.data as Row).canais ?? 0), limite: Number((dv.data as Row).limite ?? 0) } : null,
				teto: ct.data ? Number((ct.data as Row).concorrencia_contratada ?? 0) : null,
				previa: ((pf.data ?? []) as Row[]).filter(r => ehItemFaturaVoz(r.item)),
			});
		})().catch(() => { if (ativo) setErro('Não foi possível ler os robôs contratados desta empresa.'); });
		return () => { ativo = false; };
	}, [empresaId, versao]);
	return { dados, erro };
}

/** Uso do ciclo até agora, tirado da prévia real (minutos de IA com o pico, transcrição e troncos). */
function usoDaPrevia(previa: Row[]) {
	const q = (...itens: string[]) => previa.filter(r => itens.includes(String(r.item))).reduce((t, r) => t + Number(r.quantidade ?? 0), 0);
	return { minutosIA: q('voz_minuto_ia', 'voz_minuto_ia_pico', 'voz_minuto_ia_franquia'), minutosTranscricao: q('voz_transcricao'), troncos: q('gestao_tronco_sip') };
}

/** Próximo ciclo: começa no dia seguinte ao fim do atual e tem a mesma forma (mensal ou de N dias). */
function proximoCicloDe(ciclo: { inicio: string; fim: string }): { inicio: string; fim: string } {
	const inicio = somarDias(ciclo.fim, 1);
	if (inicio.slice(8) === ciclo.inicio.slice(8)) {
		const [a, m] = [Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7))];
		const seg = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-${inicio.slice(8)}`;
		return { inicio, fim: somarDias(seg, -1) };
	}
	return { inicio, fim: somarDias(inicio, diasEntre(ciclo.inicio, ciclo.fim)) };
}

function precoTxt(l: Licenca): string {
	return l.modelo === 'valor_fechado'
		? `${moneyBR(l.valor_fechado)} por mês (valor fechado) · equivale a ${moneyBR(precoPorRobo(l))} por robô`
		: `${moneyBR(l.preco_robo)} por robô por mês · ${moneyBR(totalMes(l))} por mês`;
}

/** Prévia em lista (cabe na coluna lateral e no celular): item com "qtd × preço" embaixo e o valor à direita. */
function TabelaPrevia({ linhas, rodape }: { linhas: { descricao: ReactNode; quantidade: number; preco: number; valor: number }[]; rodape?: ReactNode }) {
	const total = linhas.reduce((t, l) => t + Number(l.valor ?? 0), 0);
	const linha = 'flex items-start justify-between gap-3 border-b border-[var(--base-borda)] py-2.5';
	return (
		<ul className="text-[13.5px]" aria-label="Prévia da fatura do Agente de voz">
			{linhas.map((l, i) => (
				<li key={i} className={linha}>
					<span className="min-w-0 text-[var(--base-texto)]">{l.descricao}
						<span className="block text-[12px] text-[var(--base-texto-3)] tnum">{Number(l.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} × {moneyBR(l.preco)}</span>
					</span>
					<b className="shrink-0 tnum text-[var(--base-texto)]">{moneyBR(l.valor)}</b>
				</li>
			))}
			<li className={linha}>
				<span className="font-semibold text-[var(--base-texto)]">Total do Agente de voz{rodape ? <span className="block text-[12px] font-normal text-[var(--base-texto-3)]">{rodape}</span> : null}</span>
				<b className="shrink-0 text-[15px] tnum text-[var(--base-texto)]">{moneyBR(total)}</b>
			</li>
			<li className="flex items-start justify-between gap-3 py-2.5 text-[var(--base-texto-3)]">
				<span>Telefonia (paga à operadora do cliente) · não entra na fatura do MotorCX</span><span className="shrink-0">fora</span>
			</li>
		</ul>
	);
}

// ================================================================ resumo (seção da Contratação)
export function RobosContratadosSecao({ empresaId, moduloLigado }: { empresaId: string; moduloLigado: boolean }) {
	const { can } = useConsolePerms();
	const { dados, erro } = useDadosRobos(empresaId);
	const hoje = today();
	if (erro) return <Cartao titulo="Agente de voz · robôs contratados"><Aviso tom="erro">{erro}</Aviso></Cartao>;
	if (!dados) return <Cartao titulo="Agente de voz · robôs contratados"><p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p></Cartao>;
	if (!moduloLigado && dados.lista.length === 0) return null;
	const podeEditar = can('editar_contratacao');
	const podeHist = podeEditar || can('ver_faturamento');
	const atual = licencaEm(dados.lista, hoje);
	const futuras = agendadas(dados.lista, hoje);
	const acoes = (
		<>
			{podeHist && dados.lista.length > 0 && <Link to={`${ROTA}/robos/historico`} className={btnSec}>Histórico</Link>}
			{podeEditar && <Link to={`${ROTA}/robos`} className={btnPrim}>{dados.lista.length ? 'Editar robôs' : 'Cadastrar robôs'}</Link>}
		</>
	);
	const desc = 'Licença fixa por robô, preço fechado mensal. 1 robô = 1 conversa ao mesmo tempo com a IA (não é linha discando).';
	if (!atual || atual.robos === 0) {
		return (
			<Cartao titulo="Agente de voz · robôs contratados" desc={desc} acoes={acoes}>
				<div className="space-y-3">
					<Aviso titulo={atual ? 'Licença com 0 robôs.' : 'Nenhuma licença cadastrada.'}>A empresa segue no modelo antigo: plataforma, minuto de IA e minuto no pico cobrados à parte, e o limite vem da divisão do teto global pelos canais.</Aviso>
					{futuras.map(f => <Aviso key={f.vigente_desde} tom="info" titulo={`Agendado para ${dataBR(f.vigente_desde)}:`}>{robosTxt(f.robos)} · {precoTxt(f)}.</Aviso>)}
				</div>
			</Cartao>
		);
	}
	const lim = limiteReal(atual.robos, dados.divisao?.canais ?? null, dados.divisao?.limite ?? null);
	const temFatura98 = dados.previa.some(r => String(r.item) === 'voz_minuto_ia_franquia');
	return (
		<Cartao titulo="Agente de voz · robôs contratados" desc={desc} acoes={acoes}>
			<div className="space-y-4">
				<Kpis itens={[
					{ rotulo: 'Robôs contratados', valor: int(atual.robos), detalhe: `licenças desde ${dataBR(atual.vigente_desde)}` },
					dados.divisao
						? { rotulo: 'Limite real agora', valor: int(lim.limite), detalhe: lim.motivo === 'licencas' ? 'igual às licenças' : lim.motivo === 'tronco' ? `o tronco tem ${int(dados.divisao.canais)} canais` : 'parte do teto global', tom: lim.limite < atual.robos ? 'atencao' : undefined }
						: { rotulo: 'Limite real agora', valor: '—', detalhe: 'sem tronco ativo: ainda sem dado' },
					{ rotulo: 'Total do mês', valor: moneyBR(totalMes(atual)), detalhe: atual.modelo === 'valor_fechado' ? 'valor fechado' : `${moneyBR(atual.preco_robo)} por robô` },
					{ rotulo: 'Franquia de minutos de IA', valor: int(atual.robos * atual.franquia_min_robo), detalhe: `${int(atual.franquia_min_robo)} min por robô` },
				]} />
				{dados.divisao && lim.limite < atual.robos && (
					<Aviso tom={lim.motivo === 'teto' ? 'erro' : 'atencao'}>
						{lim.motivo === 'tronco'
							? <>O tronco tem <b>{int(dados.divisao.canais)} canais</b>: limita a {int(lim.limite)}, não {int(atual.robos)}. O cliente paga {int(atual.robos)} e só usa {int(lim.limite)}: avise para ampliar os canais com a operadora ou ajuste as licenças.</>
							: <>A parte do teto global desta empresa hoje é <b>{int(lim.limite)}</b>, abaixo das {int(atual.robos)} licenças. Quem cuida do contrato com o provedor de voz precisa ampliar o teto.</>}
					</Aviso>
				)}
				{futuras.map(f => <Aviso key={f.vigente_desde} tom="info" titulo={`Mudança agendada para ${dataBR(f.vigente_desde)}:`}>{robosTxt(f.robos)} · {precoTxt(f)}. Ela vale a partir dessa data mesmo que alguém grave um aumento antes.</Aviso>)}
				<dl className="grid gap-x-4 gap-y-2 text-[13.5px] sm:grid-cols-[180px_1fr]">
					<dt className="font-semibold text-[var(--base-texto-2)]">Preço</dt><dd className="text-[var(--base-texto)]">{precoTxt(atual)}</dd>
					<dt className="font-semibold text-[var(--base-texto-2)]">Fidelidade</dt><dd className="text-[var(--base-texto)]">{atual.fidelidade_ate ? `${atual.fidelidade_meses} meses · até ${dataBR(atual.fidelidade_ate)} · mínimo de ${robosTxt(Number(atual.fidelidade_min ?? 0))}` : 'Sem fidelidade'}</dd>
					<dt className="font-semibold text-[var(--base-texto-2)]">Incluso na licença</dt><dd className="text-[var(--base-texto)]">IA completa com franquia de <b>{int(atual.franquia_min_robo)} min por robô</b> por mês, somada entre os robôs ({int(atual.robos * atual.franquia_min_robo)} min). Plataforma do agente inclusa{atual.transcricao_inclusa ? ' e transcrição inclusa' : ''}. Sem minuto no pico: quem precisa de mais compra robôs.</dd>
					<dt className="font-semibold text-[var(--base-texto-2)]">Cobrado à parte</dt><dd className="text-[var(--base-texto)]">Minuto de IA acima da franquia ({dados.precoMinutoIA != null ? `${moneyBR(dados.precoMinutoIA)}/min` : 'preço do minuto de IA da empresa'}){atual.transcricao_inclusa ? '' : ' · transcrição por minuto'} · gestão de tronco SIP · Speech Analytics, se ligado.</dd>
					<dt className="font-semibold text-[var(--base-texto-2)]">Fora da fatura</dt><dd className="text-[var(--base-texto)]">Telefonia: paga pelo cliente à operadora dele (troncos próprios).</dd>
				</dl>
				<div>
					<h3 className="mb-2 text-[15px] font-semibold text-[var(--base-texto)]">Prévia da fatura deste ciclo · Agente de voz</h3>
					{!temFatura98 && <Aviso className="mb-3" titulo="A fatura ainda não lê as licenças.">Falta aplicar o SQL 98 no banco: até lá, o valor fechado aparece como mensalidade sem pro rata e a plataforma continua cobrada.</Aviso>}
					{dados.previa.length
						? <TabelaPrevia linhas={dados.previa.map(r => ({ descricao: String(r.descricao ?? r.item), quantidade: Number(r.quantidade ?? 0), preco: Number(r.preco ?? 0), valor: Number(r.valor ?? 0) }))} rodape={dados.ciclo ? `ciclo de ${dataBR(dados.ciclo.inicio)} a ${dataBR(dados.ciclo.fim)}, até agora` : 'até agora'} />
						: <Vazio titulo="Sem itens do agente neste ciclo" />}
				</div>
			</div>
		</Cartao>
	);
}

// ================================================================ editar (tela 1b)
function Opcao({ checked, disabled, onChange, titulo, children, name }: { checked: boolean; disabled?: boolean; onChange: () => void; titulo: ReactNode; children?: ReactNode; name: string }) {
	return (
		<label className={`flex min-w-0 flex-1 basis-[220px] cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 ${checked ? 'border-[var(--destaque)]' : 'border-[var(--base-borda)]'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
			<input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="mt-1" />
			<span className="min-w-0"><span className="block text-[14px] font-semibold text-[var(--base-texto)]">{titulo}</span>{children && <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{children}</span>}</span>
		</label>
	);
}

export function RobosContratadosEditar({ empresaId }: { empresaId: string }) {
	const navigate = useNavigate();
	const { can, isMaster } = useConsolePerms();
	const { dados, erro } = useDadosRobos(empresaId);
	const hoje = today();
	const [ed, setEd] = useState<Edicao | null>(null);
	const [txt, setTxt] = useState({ robos: '', preco: '', fechado: '', franquia: '', fidMin: '' });
	const [motivoAbaixo, setMotivoAbaixo] = useState('');
	const [confirmaOver, setConfirmaOver] = useState(false);
	const [overServidor, setOverServidor] = useState('');
	const [passo, setPasso] = useState<'form' | 'revisao'>('form');
	const [salvando, setSalvando] = useState(false);
	const [erroSalvar, setErroSalvar] = useState('');

	const atual = dados ? licencaEm(dados.lista, hoje) : null;
	// pré-preenchido: o que vale; sem licença, a tabela e a franquia padrão (regra do dono, padrão do SQL 92)
	useEffect(() => {
		if (!dados || ed) return;
		const tabela = dados.item?.preco_tabela == null ? null : Number(dados.item.preco_tabela);
		const robos = atual?.robos || 10;
		const preco = atual?.modelo === 'por_robo' ? atual.preco_robo : tabela;
		const fechado = atual?.modelo === 'valor_fechado' ? atual.valor_fechado : tabela != null ? robos * tabela : null;
		const fidCorrendo = !!atual?.fidelidade_ate && atual.fidelidade_ate >= hoje;
		const inicial: Edicao = {
			robos, modelo: atual?.modelo ?? 'por_robo', preco, fechado, inicio: 'agora',
			fidelidade: fidCorrendo ? Number(atual?.fidelidade_meses ?? 0) : 0,
			fidelidadeMin: fidCorrendo ? Number(atual?.fidelidade_min ?? 0) : 0,
			franquia: atual?.franquia_min_robo ?? Number(dados.item?.franquia_padrao ?? FRANQUIA_PADRAO),
			transcricao: atual?.transcricao_inclusa ?? true, motivo: '',
		};
		setEd(inicial);
		setTxt({ robos: String(robos), preco: numCampo(preco), fechado: numCampo(fechado), franquia: String(inicial.franquia), fidMin: String(inicial.fidelidadeMin) });
	}, [dados, ed, atual, hoje]);

	const calc = useMemo(() => {
		if (!dados || !ed || !dados.ciclo) return null;
		const proximo = proximoCicloDe(dados.ciclo);
		const d = valeDesde(ed, hoje, proximo.inicio);
		const ciclo = ed.inicio === 'agora' ? dados.ciclo : proximo;
		const nova: Licenca = { id: Number.MAX_SAFE_INTEGER, vigente_desde: d, robos: ed.robos, modelo: ed.modelo,
			preco_robo: ed.modelo === 'por_robo' ? ed.preco : null, valor_fechado: ed.modelo === 'valor_fechado' ? ed.fechado : null,
			franquia_min_robo: ed.franquia, transcricao_inclusa: ed.transcricao };
		const uso = usoDaPrevia(dados.previa);
		const previa = previaCiclo({ licencas: [...dados.lista, nova], inicio: ciclo.inicio, fim: ciclo.fim, ...uso,
			precoMinutoIA: dados.precoMinutoIA, precoTranscricao: dados.precoTranscricao, precoTronco: dados.precoTronco });
		const antes = licencaEm(dados.lista, d);
		const vend = vendidoCom(dados.todas, empresaId, d, ed.robos);
		const over = dados.teto != null && ed.robos > (antes?.robos ?? 0) && vend > dados.teto;
		const lim = limiteReal(ed.robos, dados.divisao?.canais ?? null, dados.divisao?.limite ?? null);
		return { proximo, d, ciclo, previa, antes, vend, over, lim, bloq: bloqueios(ed, atual, d), avs: avisos({ ed, atual, lista: dados.lista, hoje, proximoCiclo: proximo.inicio }) };
	}, [dados, ed, hoje, atual, empresaId]);

	if (erro) return <Aviso tom="erro">{erro}</Aviso>;
	if (!dados || !ed) return <p className="py-8 text-center text-[13px] text-[var(--base-texto-3)]">Carregando...</p>;
	if (!dados.ciclo || !calc) return <Aviso tom="erro">Não foi possível ler o ciclo de cobrança desta empresa (Contratação › Ciclo e cobrança).</Aviso>;

	const podePreco = can('editar_precos');
	const reduz = ehReducao(ed, atual);
	const porRobo = precoPorRobo({ modelo: ed.modelo, robos: ed.robos, preco_robo: ed.preco, valor_fechado: ed.fechado });
	const minimo = dados.item?.preco_minimo == null ? null : Number(dados.item.preco_minimo);
	const precoMudou = !atual || atual.modelo !== ed.modelo || (ed.modelo === 'por_robo' ? atual.preco_robo !== ed.preco : atual.valor_fechado !== ed.fechado);
	const abaixo = minimo != null && ed.robos > 0 && precoMudou && Math.round(porRobo * 100) / 100 < minimo;
	const podeAbaixo = isMaster || can('preco_abaixo_minimo');
	const precisaConfirmar = calc.over || !!overServidor;
	const faltas = [...calc.bloq,
		...(abaixo && !podeAbaixo ? [`Preço abaixo do mínimo (${moneyBR(minimo)} por robô): só o Administrativo ou o Master aprovam.`] : []),
		...(abaixo && motivoAbaixo.trim().length < 3 ? ['Informe o motivo do preço abaixo do mínimo.'] : []),
		...(precisaConfirmar && !confirmaOver ? ['Confirme o overbooking.'] : [])];
	// redução (robôs, franquia ou transcrição) só no próximo ciclo: a opção "Agora" sai sozinha
	const set = (p: Partial<Edicao>) => {
		setEd(e => { if (!e) return e; const n = { ...e, ...p }; return ehReducao(n, atual) ? { ...n, inicio: 'proximo' } : n; });
		setErroSalvar(''); setOverServidor('');
	};
	const setNum = (k: keyof typeof txt, v: string, aplicar: (n: number) => Partial<Edicao>) => {
		setTxt(t => ({ ...t, [k]: v }));
		const n = k === 'robos' || k === 'franquia' || k === 'fidMin' ? Number(v.replace(/\./g, '')) : lerNumero(v);
		set(aplicar(Number.isFinite(n) ? n : NaN));
	};
	const passoRobos = (delta: number) => { const n = Math.max(0, Math.min(5000, (Number.isFinite(ed.robos) ? ed.robos : 0) + delta)); setTxt(t => ({ ...t, robos: String(n) })); set({ robos: n }); };

	async function salvar() {
		if (!supabase || !ed) return;
		setSalvando(true);
		setErroSalvar('');
		const { error } = await supabase.rpc('salvar_licencas_voz', {
			empresa: Number(empresaId), robos: ed.robos, motivo: ed.motivo.trim(), modelo: ed.modelo,
			preco_robo: ed.modelo === 'por_robo' ? ed.preco : null, valor_fechado: ed.modelo === 'valor_fechado' ? ed.fechado : null,
			franquia_min_robo: ed.franquia, transcricao_inclusa: ed.transcricao, inicio: ed.inicio,
			fidelidade_meses: ed.fidelidade, fidelidade_min: ed.fidelidade > 0 ? ed.fidelidadeMin : 0,
			overbooking_confirmado: confirmaOver, motivo_abaixo: abaixo ? motivoAbaixo.trim() : null,
		});
		setSalvando(false);
		if (error) {
			const m = String(error.message ?? '');
			if (/^overbooking/i.test(m)) { setOverServidor(m); setConfirmaOver(false); setPasso('form'); return; }
			setErroSalvar(m || 'Não foi possível salvar os robôs contratados.');
			return;
		}
		toast.success(`Robôs contratados salvos: ${robosTxt(ed.robos)} desde ${dataBR(calc!.d)}. Ficou no histórico e na Auditoria.`);
		navigate(ROTA, { replace: true });
	}

	const rotuloAgora = <>Agora · {dataBR(hoje)}</>;
	const rotuloProx = <>Próximo ciclo · {dataBR(calc.proximo.inicio)}</>;
	const tituloPrevia = ed.inicio === 'agora' ? `Ciclo atual (${dataBR(dados.ciclo.inicio)} a ${dataBR(dados.ciclo.fim)}), com o ajuste` : `Próximo ciclo (${dataBR(calc.proximo.inicio)} a ${dataBR(calc.proximo.fim)})`;

	if (passo === 'revisao') {
		const mud: [string, string, string][] = [];
		const ant = calc.antes;
		if ((ant?.robos ?? 0) !== ed.robos) mud.push(['Robôs', ant ? int(ant.robos) : '—', int(ed.robos)]);
		const pAnt = ant ? (ant.modelo === 'valor_fechado' ? `${moneyBR(ant.valor_fechado)}/mês fechado` : `${moneyBR(ant.preco_robo)} por robô`) : '—';
		const pNov = ed.modelo === 'valor_fechado' ? `${moneyBR(ed.fechado)}/mês fechado` : `${moneyBR(ed.preco)} por robô`;
		if (pAnt !== pNov) mud.push(['Preço', pAnt, pNov]);
		const fAnt = ant?.fidelidade_ate ? `${ant.fidelidade_meses} meses · mín. ${ant.fidelidade_min}` : 'sem';
		const fNov = ed.fidelidade > 0 ? `${ed.fidelidade} meses · mín. ${ed.fidelidadeMin}` : 'sem';
		if (fAnt !== fNov) mud.push(['Fidelidade', fAnt, fNov]);
		if ((ant?.franquia_min_robo ?? null) !== ed.franquia) mud.push(['Franquia por robô', ant ? `${int(ant.franquia_min_robo)} min` : '—', `${int(ed.franquia)} min`]);
		if ((ant?.transcricao_inclusa ?? null) !== ed.transcricao) mud.push(['Transcrição', ant ? (ant.transcricao_inclusa ? 'inclusa' : 'à parte') : '—', ed.transcricao ? 'inclusa' : 'à parte']);
		return (
			<Cartao titulo="Revisar e salvar" className="max-w-[760px]">
				<div className="space-y-4">
					{mud.length
						? <ul className="space-y-1.5 text-[14px]">{mud.map(m => <li key={m[0]} className="flex flex-wrap gap-x-2"><span className="w-[150px] shrink-0 font-semibold text-[var(--base-texto-2)]">{m[0]}</span><span><s className="text-[var(--base-texto-3)]">{m[1]}</s> → <b className="text-[var(--base-texto)]">{m[2]}</b></span></li>)}</ul>
						: <p className="text-[13px] text-[var(--base-texto-3)]">Nenhuma mudança nos valores: grava uma vigência nova com o motivo.</p>}
					<dl className="grid gap-x-4 gap-y-1.5 text-[13.5px] sm:grid-cols-[150px_1fr]">
						<dt className="font-semibold text-[var(--base-texto-2)]">Vale a partir de</dt><dd>{dataBR(calc.d)}{ed.inicio === 'agora' ? ' (pro rata neste ciclo)' : ''}</dd>
						<dt className="font-semibold text-[var(--base-texto-2)]">Limite real</dt><dd>{dados.divisao ? `${robosTxt(calc.lim.limite)} ao mesmo tempo` : 'sem tronco ativo'}</dd>
						<dt className="font-semibold text-[var(--base-texto-2)]">Total do mês</dt><dd>{moneyBR(totalMes({ modelo: ed.modelo, robos: ed.robos, preco_robo: ed.preco, valor_fechado: ed.fechado }))}</dd>
						<dt className="font-semibold text-[var(--base-texto-2)]">Motivo</dt><dd>{ed.motivo.trim()}</dd>
						{abaixo && <><dt className="font-semibold text-[var(--base-texto-2)]">Abaixo do mínimo</dt><dd>{motivoAbaixo.trim()}</dd></>}
						{precisaConfirmar && <><dt className="font-semibold text-[var(--base-texto-2)]">Overbooking</dt><dd>{calc.over ? `${int(calc.vend)} vendidos para ${int(dados.teto)} contratados` : overServidor} (confirmado)</dd></>}
					</dl>
					{calc.avs.map(a => <Aviso key={a}>{a}</Aviso>)}
					{erroSalvar && <Aviso tom="erro">{erroSalvar}</Aviso>}
					<div className="flex flex-wrap gap-2">
						<button type="button" className={btnPrim} disabled={salvando} onClick={() => void salvar()}>{salvando ? 'Salvando...' : 'Salvar'}</button>
						<button type="button" className={btnSec} disabled={salvando} onClick={() => setPasso('form')}>Voltar a editar</button>
					</div>
					<p className="text-[12px] text-[var(--base-texto-3)]">Grava uma vigência nova (a anterior nunca é apagada), entra no histórico e na Auditoria. Ligações em andamento nunca caem.</p>
				</div>
			</Cartao>
		);
	}

	const sobra = dados.divisao?.limite ?? null;
	return (
		<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
			<div className="min-w-0 space-y-5">
				<Cartao titulo="Robôs contratados (licenças)" desc="1 robô = 1 conversa ao mesmo tempo com a IA. Não é linha discando nem canal do tronco.">
					<div className="flex flex-wrap items-center gap-3">
						<div className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--base-field-border)]">
							<button type="button" aria-label="Menos um robô" onClick={() => passoRobos(-1)} className="grid h-10 w-10 place-items-center text-[var(--base-texto)] hover:bg-[var(--base-fill)]"><Minus size={16} /></button>
							<input aria-label="Robôs contratados" inputMode="numeric" value={txt.robos} onChange={e => { const v = e.target.value; setNum('robos', v, n => ({ robos: n })); }} className="h-10 w-20 border-x border-[var(--base-field-border)] bg-[var(--base-cartao)] text-center text-[16px] font-semibold text-[var(--base-texto)] outline-none tnum" />
							<button type="button" aria-label="Mais um robô" onClick={() => passoRobos(1)} className="grid h-10 w-10 place-items-center text-[var(--base-texto)] hover:bg-[var(--base-fill)]"><Plus size={16} /></button>
						</div>
						<span className="text-[13px] text-[var(--base-texto-2)]">hoje: {atual ? robosTxt(atual.robos) : 'nenhum'}</span>
					</div>
				</Cartao>

				<Cartao titulo="Preço fechado mensal" desc={podePreco ? 'Escolha como o contrato foi fechado.' : 'Sem a permissão editar_precos: o preço fica o que vale (ou o de tabela).'}>
					<div className="flex flex-wrap gap-2">
						<Opcao name="modelo" checked={ed.modelo === 'por_robo'} disabled={!podePreco} onChange={() => set({ modelo: 'por_robo' })} titulo="Preço por robô">Valor × robôs. Mais robôs, mais valor.</Opcao>
						<Opcao name="modelo" checked={ed.modelo === 'valor_fechado'} disabled={!podePreco} onChange={() => set({ modelo: 'valor_fechado' })} titulo="Valor fechado total">Um valor por mês para N robôs.</Opcao>
					</div>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						{ed.modelo === 'por_robo'
							? <Campo rotulo="Preço por robô por mês (R$)" htmlFor="lic-preco" ajuda={`Tabela: ${dados.item?.preco_tabela != null ? moneyBR(dados.item.preco_tabela) : '—'} · mínimo: ${minimo != null ? moneyBR(minimo) : '—'} (com ${int(dados.item?.franquia_padrao ?? FRANQUIA_PADRAO)} min por robô)`}><input id="lic-preco" inputMode="decimal" disabled={!podePreco} value={txt.preco} onChange={e => setNum('preco', e.target.value, n => ({ preco: n }))} className={campoCls} /></Campo>
							: <Campo rotulo="Valor fechado por mês (R$)" htmlFor="lic-fechado" ajuda={`Equivale a ${moneyBR(porRobo)} por robô`}><input id="lic-fechado" inputMode="decimal" disabled={!podePreco} value={txt.fechado} onChange={e => setNum('fechado', e.target.value, n => ({ fechado: n }))} className={campoCls} /></Campo>}
						<div><p className="mb-1 text-[13px] font-semibold text-[var(--base-texto)]">Total por mês</p><p className="pt-1.5 text-[20px] font-bold text-[var(--base-texto)] tnum">{moneyBR(totalMes({ modelo: ed.modelo, robos: ed.robos, preco_robo: ed.preco, valor_fechado: ed.fechado }))}</p></div>
					</div>
					{abaixo && (
						<div className="mt-3 space-y-3">
							<Aviso>Abaixo do preço mínimo ({moneyBR(minimo)} por robô). {podeAbaixo ? 'Salvar pede o motivo.' : 'Só o Administrativo (preco_abaixo_minimo) ou o Master aprovam.'} O guarda de margem da IA confere ao salvar se a franquia ainda cabe no preço, e nem o Master passa abaixo disso.</Aviso>
							{podeAbaixo && <Campo rotulo="Motivo do preço abaixo do mínimo" htmlFor="lic-abaixo"><input id="lic-abaixo" value={motivoAbaixo} onChange={e => setMotivoAbaixo(e.target.value)} className={campoCls} placeholder="Ex.: cliente estratégico, contrato de 24 meses" /></Campo>}
						</div>
					)}
				</Cartao>

				<Cartao titulo="Início e fidelidade" desc="Aumento pode valer já, com pro rata dos dias que faltam; redução só no próximo ciclo.">
					<div className="flex flex-wrap gap-2">
						<Opcao name="inicio" checked={ed.inicio === 'agora'} disabled={reduz} onChange={() => set({ inicio: 'agora' })} titulo={rotuloAgora}>{reduz ? 'Redução não vale na hora.' : `Já vale. Neste ciclo, cobra só os ${diasEntre(hoje, dados.ciclo.fim) + 1} dias que faltam (até ${dataBR(dados.ciclo.fim)}).`}</Opcao>
						<Opcao name="inicio" checked={ed.inicio === 'proximo'} onChange={() => set({ inicio: 'proximo' })} titulo={rotuloProx}>Este ciclo continua como está.</Opcao>
					</div>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<Campo rotulo="Fidelidade" htmlFor="lic-fid" ajuda={atual?.fidelidade_ate && atual.fidelidade_ate >= hoje ? `Atual: até ${dataBR(atual.fidelidade_ate)} (só mantém ou estende)` : 'Opcional'}>
							<select id="lic-fid" value={ed.fidelidade} onChange={e => { const f = Number(e.target.value); const min = f > 0 && ed.fidelidadeMin === 0 ? ed.robos : ed.fidelidadeMin; setTxt(t => ({ ...t, fidMin: String(f > 0 ? min : 0) })); set({ fidelidade: f, fidelidadeMin: f > 0 ? min : 0 }); }} className={campoCls}>
								{FIDELIDADES.map(f => <option key={f} value={f}>{f === 0 ? 'Sem fidelidade' : `${f} meses`}</option>)}
							</select>
						</Campo>
						<Campo rotulo="Mínimo de robôs na fidelidade" htmlFor="lic-fidmin" ajuda="Não reduz abaixo disso até o fim"><input id="lic-fidmin" inputMode="numeric" disabled={ed.fidelidade === 0} value={txt.fidMin} onChange={e => setNum('fidMin', e.target.value, n => ({ fidelidadeMin: n }))} className={campoCls} /></Campo>
					</div>
				</Cartao>

				<Cartao titulo="O que está incluso na licença" desc="Padrão recomendado; os valores podem ser trocados por contrato.">
					<div className="grid gap-4 sm:grid-cols-2">
						<Campo rotulo="Franquia de minutos de IA por robô/mês" htmlFor="lic-franq" ajuda={`Somada entre os robôs: ${int(ed.robos * (Number.isFinite(ed.franquia) ? ed.franquia : 0))} min no mês`}><input id="lic-franq" inputMode="numeric" value={txt.franquia} onChange={e => setNum('franquia', e.target.value, n => ({ franquia: n }))} className={campoCls} /></Campo>
						<div><p className="mb-1 text-[13px] font-semibold text-[var(--base-texto)]">Excedente</p><p className="pt-1.5 text-[13.5px] text-[var(--base-texto)]">{dados.precoMinutoIA != null ? `${moneyBR(dados.precoMinutoIA)} por minuto` : 'Pelo preço'} do minuto de IA desta empresa</p></div>
					</div>
					<div className="mt-4 space-y-2 text-[13.5px] text-[var(--base-texto)]">
						<label className="flex items-start gap-2"><input type="checkbox" checked disabled className="mt-1" /><span><b>IA completa</b> (fala → texto, modelo e texto → fala). Sempre inclusa.</span></label>
						<label className="flex items-start gap-2"><input type="checkbox" checked disabled className="mt-1" /><span><b>Plataforma do agente</b>: inclusa, deixa de ser cobrada. Sem minuto no pico.</span></label>
						<label className="flex items-start gap-2"><input type="checkbox" checked={ed.transcricao} onChange={e => set({ transcricao: e.target.checked })} className="mt-1" /><span><b>Transcrição</b> inclusa (sem isso, a transcrição é cobrada por minuto).</span></label>
						<Aviso tom="neutro"><b>Telefonia fica fora:</b> a operadora é do cliente e ele paga direto a ela. Gestão de tronco SIP e Speech Analytics continuam itens à parte.</Aviso>
					</div>
				</Cartao>

				<Cartao titulo="Motivo" desc="Vai para o histórico. O cliente não vê.">
					<Campo rotulo="Por que mudar" htmlFor="lic-motivo" ajuda="De 5 a 300 letras"><input id="lic-motivo" value={ed.motivo} maxLength={300} onChange={e => set({ motivo: e.target.value })} className={campoCls} placeholder="Ex.: cliente ampliou a carteira" /></Campo>
				</Cartao>
			</div>

			<div className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
				<Cartao titulo={`Limite real com ${robosTxt(Number.isFinite(ed.robos) ? ed.robos : 0)}`} desc="O menor dos três vale.">
					{dados.divisao ? (
						<>
							<div className="grid grid-cols-3 gap-2 text-center">
								{([['Licenças', ed.robos, 'licencas'], ['Canais do tronco', dados.divisao.canais, 'tronco'], ['Parte do teto hoje', sobra, 'teto']] as const).map(([r, v, m]) => (
									<div key={r} className={`rounded-xl border px-2 py-2 ${calc.lim.motivo === m ? 'border-[var(--destaque)]' : 'border-[var(--base-borda)]'}`}><p className="text-[11.5px] text-[var(--base-texto-2)]">{r}</p><p className="text-[18px] font-bold tnum text-[var(--base-texto)]">{int(v)}</p></div>
								))}
							</div>
							<p className="mt-3 text-[14px] text-[var(--base-texto)]"><b className="text-[22px] tnum">{int(calc.lim.limite)}</b> robôs ao mesmo tempo</p>
							<p className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">{calc.lim.motivo === 'tronco' ? `O tronco tem ${int(dados.divisao.canais)} canais: limita a ${int(dados.divisao.canais)}.` : calc.lim.motivo === 'teto' ? 'A parte do teto global de hoje fica abaixo das licenças.' : 'Igual às licenças.'}</p>
						</>
					) : <p className="text-[13px] text-[var(--base-texto-2)]">Sem tronco ativo: o limite real aparece quando a empresa tiver tronco cadastrado.</p>}
					{precisaConfirmar ? (
						<div className="mt-3">
							<Aviso tom="erro">
								<b>Overbooking:</b> {calc.over ? <>o vendido passa a <b>{int(calc.vend)}</b> para um teto de <b>{int(dados.teto)}</b> com o provedor de voz.</> : overServidor} Nos horários em que todos usam juntos, o limite de cada empresa cai proporcionalmente.
								<label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={confirmaOver} onChange={e => setConfirmaOver(e.target.checked)} className="mt-1" /><span>Entendi. Salvar assim e avisar quem cuida do contrato com o provedor.</span></label>
							</Aviso>
						</div>
					) : dados.teto != null && <p className="mt-3 text-[12.5px] text-[var(--base-texto-3)]">Vendido no total: {int(calc.vend)} de {int(dados.teto)} contratados com o provedor{calc.vend > dados.teto ? ' (já em overbooking; esta mudança não aumenta)' : ''}.</p>}
				</Cartao>

				<Cartao titulo="Prévia da fatura" desc={`${tituloPrevia}. Minutos e troncos: o uso deste ciclo até agora.`}>
					<TabelaPrevia linhas={calc.previa.linhas.map((l: LinhaPrevia) => ({ descricao: l.descricao, quantidade: l.quantidade, preco: l.preco, valor: l.valor }))} rodape="estimado" />
				</Cartao>

				{calc.avs.map(a => <Aviso key={a}>{a}</Aviso>)}
				<div className="flex flex-wrap gap-2">
					<button type="button" className={btnPrim} disabled={faltas.length > 0} onClick={() => setPasso('revisao')}>Revisar mudanças</button>
					<Link to={ROTA} replace className={btnSec}>Cancelar</Link>
				</div>
				{faltas.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-[var(--base-texto-2)]">{faltas.map(f => <li key={f}>{f}</li>)}</ul>}
			</div>
		</div>
	);
}

// ================================================================ histórico (tela 1c)
export function RobosContratadosHistorico({ empresaId }: { empresaId: string }) {
	const { dados, erro } = useDadosRobos(empresaId);
	if (erro) return <Aviso tom="erro">{erro}</Aviso>;
	if (!dados) return <p className="py-8 text-center text-[13px] text-[var(--base-texto-3)]">Carregando...</p>;
	const h = dados.hist;
	if (!h.length) return <Cartao titulo="Histórico dos robôs"><Vazio titulo="Nenhuma licença cadastrada">Quando a equipe cadastrar os robôs, cada mudança aparece aqui com quem, quando, de → para e o motivo.</Vazio></Cartao>;
	const tomSit: Record<string, 'ok' | 'info' | 'neutro'> = { vigente: 'ok', agendada: 'info', anterior: 'neutro' };
	return (
		<Cartao titulo="Histórico dos robôs" desc="Cada mudança é uma vigência nova. Nada é apagado.">
			<ul className="divide-y divide-[var(--base-borda)]">
				{h.map((r, i) => {
					const l = deLinha(r);
					const ant = h[i + 1] ? deLinha(h[i + 1]) : null;
					const mud: [string, string | null, string][] = [];
					mud.push(['Robôs', ant ? int(ant.robos) : null, int(l.robos)]);
					const p = (x: Licenca) => (x.modelo === 'valor_fechado' ? `${moneyBR(x.valor_fechado)}/mês fechado` : `${moneyBR(x.preco_robo)} por robô`);
					if (!ant || p(ant) !== p(l)) mud.push(['Preço', ant ? p(ant) : null, p(l)]);
					if (!ant || ant.franquia_min_robo !== l.franquia_min_robo) mud.push(['Franquia por robô', ant ? `${int(ant.franquia_min_robo)} min` : null, `${int(l.franquia_min_robo)} min`]);
					if (ant && ant.transcricao_inclusa !== l.transcricao_inclusa) mud.push(['Transcrição', ant.transcricao_inclusa ? 'inclusa' : 'à parte', l.transcricao_inclusa ? 'inclusa' : 'à parte']);
					const fid = (x: Licenca) => (x.fidelidade_ate ? `${x.fidelidade_meses} meses · até ${dataBR(x.fidelidade_ate)} · mín. ${x.fidelidade_min}` : 'sem');
					if (ant ? fid(ant) !== fid(l) : !!l.fidelidade_ate) mud.push(['Fidelidade', ant ? fid(ant) : null, fid(l)]);
					return (
						<li key={String(r.id)} className="grid gap-2 py-3 sm:grid-cols-[180px_1fr]">
							<div className="text-[13px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{dateBR(r.criado_em)}</b><br />{String(r.quem ?? 'Equipe MotorCX')}<div className="mt-1"><Pilula tom={tomSit[String(r.situacao)] ?? 'neutro'}>{String(r.situacao ?? '')}</Pilula></div></div>
							<div className="min-w-0 text-[13.5px]">
								{mud.map(m => <div key={m[0]}>{m[0]}: {m[1] != null && <><s className="text-[var(--base-texto-3)]">{m[1]}</s> → </>}<b className="text-[var(--base-texto)]">{m[2]}</b></div>)}
								<div className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">Vale desde {dataBR(l.vigente_desde)} · total {moneyBR(totalMes(l))} por mês{r.overbooking_confirmado ? ' · overbooking confirmado' : ''}</div>
								<div className="mt-0.5 text-[12.5px] text-[var(--base-texto-3)]">Motivo: {String(r.motivo ?? '—')}</div>
							</div>
						</li>
					);
				})}
			</ul>
		</Cartao>
	);
}
