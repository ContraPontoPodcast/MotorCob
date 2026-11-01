// Tela 3 · Mensageria › Agente virtual › Lotes e Ligações em curso.
// Lê voz_lotes, voz_ondas, resumo_lote_voz(), voz_divisao_concorrencia, voz_config e o preço do
// minuto de IA (precos_empresa, só quem vê faturamento). Atualiza a cada 15 s, sem realtime.
// Escreve só por RPC: pausar_lote_voz, retomar_lote_voz, cancelar_lote_voz e configurar_voz_empresa.
// Redesign v2: lista com 4 KPIs do dia e 5 colunas ("Simulado" vira valor da situação); lote ao vivo com Pausar como
// ação principal, 4 KPIs de uma linha, um aviso só, resultado em barras (os 4 principais) e custos/limite recolhidos.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Pause, Play } from 'lucide-react';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import {
	ATUALIZA_MS, PERM_VOZ, SIT_LOTE_VOZ, SIT_ONDA, dataCurta, diaISO, funilDoResumo, horaCurta, inteiro, pct, reais,
} from '@/lib/voz';
import { Aviso, Botao, Cartao, Pilula, Trilho, Vazio, campoCls, campoStyle } from './ui';
import { Detalhes, Kpis, ListaValores, Tabela as TabelaDs } from '@/components/ds';

type Lote = {
	id: number; credor_id: number | null; data: string; modo: string; situacao: string; total: number; encerradas: number;
	abandonos: number; custo_operadora: number; freado_em: string | null; roteiro_id: number | null; atualizado_em: string;
};
type Onda = { id: number; janela: string; tentativa: number; total: number; encerradas: number; situacao: string; abre_em: string | null; fecha_em: string | null };
type Resumo = { resultado: string; chamadas: number; segundos: number; minutos_ia: number; custo_operadora: number; sem_custo: number };

function Cabecalho({ titulo, linha, direita }: { titulo: string; linha?: string; direita?: React.ReactNode }) {
	return (
		<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0">
				<h1 className="text-[24px] font-bold leading-tight tracking-tight text-[var(--base-texto)]">{titulo}</h1>
				{linha && <p className="mt-1 text-[13.5px] text-[var(--base-texto-2)]">{linha}</p>}
			</div>
			{direita && <div className="flex flex-wrap items-center gap-2">{direita}</div>}
		</div>
	);
}

/** Moldura das telas do agente virtual na Mensageria (fora do layout por canal de mensagem). */
function Moldura({ children }: { children: React.ReactNode }) {
	return <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">{children}</div>;
}

/** Situação do lote, com o modo dentro dela (Simulado / Só números de teste). */
function situacaoLote(l: Lote) {
	const s = SIT_LOTE_VOZ[l.situacao];
	const modo = l.modo === 'simulado' ? 'Simulado · ' : l.modo === 'teste' ? 'Teste · ' : '';
	return <Pilula tom={l.modo === 'simulado' ? 'neutro' : s?.tom}>{modo}{s?.label ?? l.situacao}</Pilula>;
}

// ============================================================================ lista
export function LotesVoz() {
	const { empresa, credores } = useMotorAuth();
	const navigate = useNavigate();
	const [lotes, setLotes] = useState<Lote[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		setLoading(true);
		(async () => {
			const { data, error } = await supabase!.from('voz_lotes')
				.select('id,credor_id,data,modo,situacao,total,encerradas,abandonos,custo_operadora,freado_em,roteiro_id,atualizado_em')
				.eq('empresa_id', empresa.id).order('data', { ascending: false }).order('id', { ascending: false }).limit(60);
			if (!active) return;
			if (error) { setError(friendlyError(error)); setLoading(false); return; }
			setLotes((data ?? []) as Lote[]); setError(''); setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	const nomeCarteira = (id: number | null) => (id == null ? 'Todas as carteiras' : credores.find(c => String(c.id) === String(id))?.nome ?? `Carteira ${id}`);
	// Resumo do dia mais recente da lista (só o que voz_lotes já traz).
	const hoje = lotes.filter(l => l.data === diaISO());
	const doDia = hoje.length ? hoje : lotes.filter(l => l.data === lotes[0]?.data);
	const dia = doDia.reduce((t, l) => ({ total: t.total + Number(l.total || 0), encerradas: t.encerradas + Number(l.encerradas || 0), abandonos: t.abandonos + Number(l.abandonos || 0), custo: t.custo + Number(l.custo_operadora || 0), vivos: t.vivos + (['agendado', 'ligando', 'aguardando_aprovacao'].includes(l.situacao) ? 1 : 0) }), { total: 0, encerradas: 0, abandonos: 0, custo: 0, vivos: 0 });

	return (
		<Moldura>
			<Cabecalho titulo="Lotes do agente virtual" linha={[empresa?.nome, 'Mensageria', 'Agente virtual'].filter(Boolean).join(' · ')} />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
				: loading ? <Loading />
				: error ? <Notice>{error}</Notice>
				: lotes.length === 0 ? (
					<Vazio titulo="Nenhum lote do agente virtual ainda." acao={<Link to="/canais/agente-virtual" className="inline-flex h-9 items-center rounded-lg border px-4 text-[13px] font-semibold text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>Ver o roteiro</Link>}>
						O lote do dia aparece aqui quando a Lista do dia manda clientes para o agente virtual. Antes, o roteiro precisa estar em uso.
					</Vazio>
				) : (
					<div className="space-y-4">
						<Kpis itens={[
							{ rotulo: `Ligações ${hoje.length ? 'hoje' : 'no último dia'}`, valor: inteiro(dia.total), detalhe: `${inteiro(dia.encerradas)} encerradas` },
							{ rotulo: 'Em andamento', valor: inteiro(dia.vivos), detalhe: dia.vivos === 1 ? 'lote ligando ou agendado' : 'lotes ligando ou agendados' },
							{ rotulo: 'Abandono', valor: dia.encerradas ? pct((100 * dia.abandonos) / Math.max(1, dia.encerradas)) : '—', detalhe: 'atendeu e caiu sem operador livre' },
							{ rotulo: 'Telefonia estimada', valor: reais(dia.custo), detalhe: 'paga à operadora, fora da fatura' },
						]} />
						<Cartao semPadding>
							<TabelaDs rotulo="Lotes do agente virtual" linhas={lotes} chave={l => l.id} onAbrir={l => navigate(`/mensageria/voz/lotes/${l.id}`)}
								colunas={[
									{ id: 'data', titulo: 'Data', celula: l => dataCurta(l.data) },
									{ id: 'cart', titulo: 'Carteira', celula: l => nomeCarteira(l.credor_id) },
									{ id: 'sit', titulo: 'Situação', celula: situacaoLote },
									{ id: 'enc', titulo: 'Encerradas', num: true, celula: l => `${inteiro(l.encerradas)} de ${inteiro(l.total)}` },
									{ id: 'ab', titulo: 'Abandono', num: true, celula: l => (l.encerradas ? pct((100 * l.abandonos) / Math.max(1, l.encerradas)) : '—') },
								]}
								celular={l => ({ titulo: <>{dataCurta(l.data)} · {nomeCarteira(l.credor_id)}</>, valor: situacaoLote(l), resumo: <>{inteiro(l.encerradas)} de {inteiro(l.total)} · abandono {l.encerradas ? pct((100 * l.abandonos) / Math.max(1, l.encerradas)) : '—'}</> })} />
						</Cartao>
					</div>
				)}
		</Moldura>
	);
}

// ============================================================================ ligações em curso
export function LoteVozCurso() {
	const { id } = useParams();
	const { empresa, credores } = useMotorAuth();
	const podeMudar = usePermissao(PERM_VOZ.enviarMensagens);
	const podeLimite = usePermissao(PERM_VOZ.editarCanais);
	const [lote, setLote] = useState<Lote | null>(null);
	const [ondas, setOndas] = useState<Onda[]>([]);
	const [resumo, setResumo] = useState<Resumo[]>([]);
	const [div, setDiv] = useState<Row | null>(null);
	const [cfg, setCfg] = useState<Row | null>(null);
	const [precoIa, setPrecoIa] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
	const [confirma, setConfirma] = useState<null | 'pausar' | 'cancelar'>(null);
	const [ocupado, setOcupado] = useState(false);
	const [limite, setLimite] = useState('');
	const primeira = useRef(true);

	const carregar = useCallback(async () => {
		if (!supabase || !empresa || !id) return;
		const sb = supabase;
		const [l, o, r] = await Promise.all([
			sb.from('voz_lotes').select('id,credor_id,data,modo,situacao,total,encerradas,abandonos,custo_operadora,freado_em,roteiro_id,atualizado_em').eq('id', id).eq('empresa_id', empresa.id).maybeSingle(),
			sb.from('voz_ondas').select('id,janela,tentativa,total,encerradas,situacao,abre_em,fecha_em').eq('lote_id', id).order('tentativa').order('abre_em'),
			sb.rpc('resumo_lote_voz', { lote: Number(id) }),
		]);
		if (l.error) { setError(friendlyError(l.error)); setLoading(false); return; }
		setLote((l.data as Lote | null) ?? null);
		setOndas((o.data ?? []) as Onda[]);
		setResumo(((r.data ?? []) as Resumo[]).map(x => ({ ...x, chamadas: Number(x.chamadas), segundos: Number(x.segundos), minutos_ia: Number(x.minutos_ia), custo_operadora: Number(x.custo_operadora), sem_custo: Number(x.sem_custo) })));
		if (primeira.current) {
			primeira.current = false;
			const [d, c, p] = await Promise.all([
				sb.from('voz_divisao_concorrencia').select('limite,teto,pico_multiplo,canais').eq('empresa_id', empresa.id).maybeSingle(),
				sb.from('voz_config').select('abandono_max_pct,freio_ritmo_pct,alo_fake,alo_fake_max_s,pico_multiplo').eq('empresa_id', empresa.id).maybeSingle(),
				sb.from('precos_empresa').select('preco,modelo,vigente_desde').eq('empresa_id', empresa.id).eq('item', 'voz_minuto_ia').lte('vigente_desde', diaISO()).order('vigente_desde', { ascending: false }).limit(1),
			]);
			setDiv((d.data as Row | null) ?? null);
			setCfg((c.data as Row | null) ?? null);
			setLimite(String((c.data as Row | null)?.abandono_max_pct ?? 3).replace('.', ','));
			const pr = (p.data as Row[] | null)?.[0];
			setPrecoIa(pr && pr.modelo === 'flat' && pr.preco != null ? Number(pr.preco) : null);
		}
		setError(''); setAtualizadoEm(new Date()); setLoading(false);
	}, [empresa?.id, id]);

	useEffect(() => { primeira.current = true; setLoading(true); void carregar(); }, [carregar]);

	// A cada 15 s, só com a aba visível e o lote vivo. Sem realtime.
	const vivo = lote ? ['agendado', 'ligando', 'aguardando_aprovacao'].includes(lote.situacao) : false;
	useEffect(() => {
		if (!vivo) return;
		const t = window.setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, ATUALIZA_MS);
		return () => window.clearInterval(t);
	}, [vivo, carregar]);

	async function mudar(acao: 'pausar' | 'retomar' | 'cancelar') {
		if (!supabase || !lote) return;
		setOcupado(true);
		const fn = acao === 'pausar' ? 'pausar_lote_voz' : acao === 'retomar' ? 'retomar_lote_voz' : 'cancelar_lote_voz';
		const { error } = await supabase.rpc(fn, { lote: lote.id });
		setOcupado(false); setConfirma(null);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(acao === 'pausar' ? 'Lote pausado. As ligações em curso terminam normalmente.' : acao === 'retomar' ? 'Lote retomado. Cada onda volta se a janela ainda estiver aberta.' : 'O resto do lote foi cancelado.');
		await carregar();
	}

	async function salvarLimite() {
		if (!supabase || !empresa) return;
		const v = Number(limite.replace(',', '.'));
		if (!(v >= 0.5 && v <= 20)) { toast.error('O limite de abandono vai de 0,5% a 20%.'); return; }
		const { error } = await supabase.rpc('configurar_voz_empresa', { empresa: empresa.id, ajustes: { abandono_max_pct: v } });
		if (error) { toast.error(friendlyError(error)); return; }
		setCfg(c => ({ ...(c ?? {}), abandono_max_pct: v }));
		toast.success('Limite de abandono salvo. Vale para os lotes da empresa.');
	}

	const voltar = <Link to="/mensageria/voz/lotes" className="mb-3 inline-flex items-center gap-1 text-[13px] text-[var(--base-texto-2)] hover:text-[var(--base-texto)]"><ArrowLeft size={14} /> Lotes do agente virtual</Link>;

	if (!empresa) return <Moldura><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></Moldura>;
	if (loading) return <Moldura>{voltar}<Loading /></Moldura>;
	if (error) return <Moldura>{voltar}<Notice>{error}</Notice></Moldura>;
	if (!lote) return <Moldura>{voltar}<Vazio titulo="Lote não encontrado.">Ele pode ser de outra empresa ou ter sido apagado.</Vazio></Moldura>;

	const f = funilDoResumo(resumo);
	const minutosIa = resumo.reduce((t, x) => t + x.minutos_ia, 0);
	const custoTel = resumo.length ? resumo.reduce((t, x) => t + x.custo_operadora, 0) : Number(lote.custo_operadora || 0);
	const semCusto = resumo.reduce((t, x) => t + x.sem_custo, 0);
	const atendidas = Math.max(f.atendidas, 0);
	const abandonos = Math.max(Number(lote.abandonos || 0), f.abandono);
	const taxaAb = atendidas ? (100 * abandonos) / atendidas : 0;
	const limAb = Number(cfg?.abandono_max_pct ?? 3);
	const pausado = lote.situacao === 'pausado';
	const cancelado = lote.situacao === 'cancelado';
	const freado = !!lote.freado_em && lote.situacao === 'ligando';
	const limiteEmp = div ? Number(div.limite) : null;
	const teto = div ? Number(div.teto) : null;
	const pico = Number(div?.pico_multiplo ?? cfg?.pico_multiplo ?? 1);
	const emUso = pausado || cancelado ? 0 : f.andamento;
	const carteira = lote.credor_id == null ? 'Todas as carteiras' : credores.find(c => String(c.id) === String(lote.credor_id))?.nome ?? `Carteira ${lote.credor_id}`;
	const encerradasTot = Math.max(Number(lote.encerradas || 0), f.encerradas);
	const sit = SIT_LOTE_VOZ[lote.situacao];

	const estado = cancelado ? <Pilula>Cancelado</Pilula>
		: pausado ? <Pilula tom="atencao">Pausado</Pilula>
		: vivo ? <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--base-texto-2)]"><span className="h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: 'var(--estado-pronto)' }} />Ao vivo · atualiza a cada 15 s{atualizadoEm ? ` · ${atualizadoEm.toLocaleTimeString('pt-BR')}` : ''}</span>
		: <Pilula tom={sit?.tom}>{sit?.label ?? lote.situacao}</Pilula>;
	const botoes = !podeMudar || cancelado || lote.situacao === 'concluido' ? null
		: pausado ? <><Botao secundario onClick={() => setConfirma('cancelar')} disabled={ocupado}>Cancelar o resto</Botao><Botao onClick={() => void mudar('retomar')} disabled={ocupado}><Play size={14} /> Retomar</Botao></>
		: <><Botao secundario onClick={() => setConfirma('cancelar')} disabled={ocupado}>Cancelar o resto</Botao><Botao onClick={() => setConfirma('pausar')} disabled={ocupado}><Pause size={14} /> Pausar</Botao></>;

	const funil: [string, number, string?, boolean?][] = [
		['Discadas', encerradasTot],
		['Atendidas', atendidas],
		['Identidade confirmada', f.identidade],
		['Promessas', f.promessas],
		['Pediu retorno', f.retorno],
		['Pediu para não ligar', f.naoLigar],
		['Caixa postal', f.caixa],
		['Abandono', abandonos, atendidas ? `${pct(taxaAb)} das atendidas` : undefined, taxaAb > limAb],
	];

	const principais = funil.slice(0, 4);
	const outros = funil.slice(4);
	const maxF = Math.max(1, ...principais.map(x => x[1]));
	const aviso = freado
		? <Aviso tom="erro" titulo={`Lote freado: abandono em ${pct(taxaAb)}, acima de ${pct(limAb)}.`}>As novas ligações começam a {Number(cfg?.freio_ritmo_pct ?? 60)}% do ritmo até a taxa voltar para baixo do limite.</Aviso>
		: lote.modo !== 'real' ? <Aviso tom="info" titulo={lote.modo === 'teste' ? 'Só números de teste:' : 'Simulado:'}>{lote.modo === 'teste' ? 'liga de verdade só para os números de teste da equipe.' : 'ninguém recebe ligação e nada entra na fatura.'}</Aviso> : null;

	return (
		<Moldura>
			{voltar}
			<div className="space-y-4">
				<Cabecalho titulo={`Lote de ${dataCurta(lote.data)} · ${carteira}`} linha={`Agente virtual · ${inteiro(lote.total)} ligações em ${ondas.length} ${ondas.length === 1 ? 'onda' : 'ondas'}`} direita={<>{estado}{botoes}</>} />
				{aviso}

				<Kpis itens={[
					{ rotulo: 'Ao mesmo tempo', valor: <>{inteiro(emUso)} <small className="text-[14px] font-medium text-[var(--base-texto-2)]">/ {limiteEmp != null ? inteiro(limiteEmp) : '—'}</small></>, extra: <Trilho valor={pico > 1 && teto ? (100 * emUso) / teto : limiteEmp ? (100 * emUso) / limiteEmp : 0} marca={pico > 1 && teto && limiteEmp ? Math.min(100, (100 * limiteEmp) / teto) : undefined} />, detalhe: pico > 1 ? `pico até ${inteiro(teto)}` : 'pico desligado' },
					{ rotulo: 'Encerradas', valor: inteiro(encerradasTot), extra: <Trilho valor={lote.total ? (100 * encerradasTot) / lote.total : 0} />, detalhe: `${pct(lote.total ? (100 * encerradasTot) / lote.total : 0)} do lote` },
					{ rotulo: 'Custo do agente', valor: precoIa != null ? reais(minutosIa * precoIa) : `${inteiro(minutosIa)} min`, detalhe: 'minuto de IA · fatura do MotorCX' },
					{ rotulo: 'Abandono', valor: pct(taxaAb), tom: taxaAb > limAb ? 'alerta' : undefined, detalhe: `freia acima de ${pct(limAb)}` },
				]} />

				<div className="grid gap-4 lg:grid-cols-2">
					<Cartao titulo="Resultado até agora">
						{f.total === 0 ? <Vazio titulo="Nenhuma ligação encerrada ainda.">O resultado aparece conforme as ligações terminam.</Vazio> : <>
							{principais.map(([n, v]) => (
								<div key={n} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-[13px]">
									<span className="truncate text-[var(--base-texto)]">{n}</span>
									<span className="h-2 overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full" style={{ width: `${(100 * v) / maxF}%`, backgroundColor: 'var(--destaque)' }} /></span>
									<b className="tnum">{inteiro(v)}</b>
								</div>
							))}
							<div className="mt-3"><Detalhes resumo="Mais resultados" qtd={outros.length}>
								<ListaValores itens={outros.map(([n, v, sub, alerta]) => [n, <span key={n} style={{ color: alerta ? 'var(--estado-erro-texto)' : undefined }}>{inteiro(v)}{sub ? ` · ${sub}` : ''}</span>])} />
							</Detalhes></div>
						</>}
					</Cartao>
					<Cartao semPadding titulo="Ondas por janela UF/DDD" linha="Cada onda abre e fecha com a janela local. A retentativa é uma onda nova.">
						{ondas.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Vazio titulo="Nenhuma onda ainda.">As ondas aparecem quando a primeira janela UF/DDD abre.</Vazio></div> : (
							<div className="divide-y [&>*]:border-[var(--base-borda)]">
								{ondas.map(o => {
									const p = o.total ? (100 * o.encerradas) / o.total : 0;
									const s = cancelado && o.situacao !== 'encerrada' ? SIT_ONDA.cancelada
										: pausado && o.situacao === 'ligando' ? { label: 'Pausada', tom: 'atencao' as const }
										: SIT_ONDA[o.situacao] ?? { label: o.situacao, tom: 'neutro' as const };
									const quando = o.situacao === 'aguardando' && o.abre_em ? `Começa ${horaCurta(o.abre_em)}` : s.label;
									return (
										<div key={o.id} className="px-4 py-2.5 sm:px-5">
											<div className="flex items-center justify-between gap-2 text-[13px]"><b className="min-w-0 truncate text-[var(--base-texto)]">{o.janela} <small className="font-normal text-[var(--base-texto-3)]">· {o.tentativa}ª · {o.abre_em ? `${horaCurta(o.abre_em)}–${horaCurta(o.fecha_em)}` : 'janela local'}</small></b><Pilula tom={s.tom}>{quando}</Pilula></div>
											<div className="mt-1 flex items-center gap-3"><div className="flex-1"><Trilho valor={p} /></div><small className="tnum text-[12px] text-[var(--base-texto-2)]">{inteiro(o.encerradas)} de {inteiro(o.total)}</small></div>
										</div>
									);
								})}
							</div>
						)}
					</Cartao>
				</div>

				<Detalhes solto resumo="Custos e limites">
					<ListaValores itens={[
						['Minuto de IA (fatura do MotorCX)', precoIa != null ? `${inteiro(minutosIa)} min a ${reais(precoIa, 2)} = ${reais(minutosIa * precoIa)}` : `${inteiro(minutosIa)} min`],
						['Telefonia estimada (paga à operadora)', reais(custoTel)],
						['Tentativas sem rota cadastrada', semCusto ? <span key="s" className="text-[var(--estado-atencao-texto)]">{inteiro(semCusto)} sem custo</span> : 'nenhuma'],
						['Alô fake', cfg?.alo_fake ? `ligado, espera até ${cfg.alo_fake_max_s} s` : 'desligado'],
					]} />
					<div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[var(--base-texto)]">
						<span>Freia o lote quando o abandono passa de</span>
						{podeLimite ? <>
							<input aria-label="Limite de abandono em %" value={limite} onChange={e => setLimite(e.target.value)} className={`${campoCls} h-8 w-16 px-2`} style={campoStyle} /> %
							{limite.replace(',', '.') !== String(limAb) && <Botao secundario onClick={() => void salvarLimite()}>Salvar limite</Botao>}
						</> : <b>{pct(limAb)}</b>}
					</div>
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Freado, o lote começa as novas ligações a {Number(cfg?.freio_ritmo_pct ?? 60)}% do ritmo até a taxa voltar para baixo do limite. Mudar o limite ou pausar é decisão sua.</p>
				</Detalhes>
			</div>

			<ConfirmaAcao
				aberto={confirma === 'pausar'}
				titulo="Pausar o lote?"
				texto="As ligações em curso terminam normalmente; nenhuma nova começa. Ao retomar, cada onda volta só se a janela UF/DDD ainda estiver aberta."
				botao="Pausar"
				onConfirm={() => void mudar('pausar')}
				onClose={() => setConfirma(null)}
				loading={ocupado}
			/>
			<ConfirmaAcao
				aberto={confirma === 'cancelar'}
				titulo="Cancelar o resto do lote?"
				texto="As ligações que faltam não acontecem hoje e vão para a reserva do discador (quem não foi contatado segue a régua). Não dá para desfazer."
				botao="Cancelar o resto"
				corBotao="var(--estado-erro)"
				onConfirm={() => void mudar('cancelar')}
				onClose={() => setConfirma(null)}
				loading={ocupado}
			/>
		</Moldura>
	);
}
