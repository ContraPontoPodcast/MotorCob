// Tela 3 · Mensageria › Agente virtual › Lotes e Ligações em curso.
// Lê voz_lotes, voz_ondas, resumo_lote_voz(), voz_divisao_concorrencia, voz_config e o preço do
// minuto de IA (precos_empresa, só quem vê faturamento). Atualiza a cada 15 s, sem realtime.
// Escreve só por RPC: pausar_lote_voz, retomar_lote_voz, cancelar_lote_voz e configurar_voz_empresa.
// SQL 65: ondas por origem (1ª passada, retentativa, Resubmit, reenvio manual) e Reenviar agora (reenviar.tsx).
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
import { Aviso, Botao, Cartao, CartaoLinha, Kpi, Pilula, Tabela, Trilho, Vazio, campoCls, campoStyle } from './ui';
import { nomeOnda, type OndaVoz } from '@/lib/renitencia';
import { SemContatoLote, useReenvios } from './reenviar';

type Lote = {
	id: number; credor_id: number | null; data: string; modo: string; situacao: string; total: number; encerradas: number;
	abandonos: number; custo_operadora: number; freado_em: string | null; roteiro_id: number | null; atualizado_em: string;
};
type Onda = OndaVoz;
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
					<Cartao semPadding>
						<Tabela
							cabecalho={['Data', 'Carteira', 'Modo', 'Situação', 'Encerradas', 'Abandono']}
							numericas={[4, 5]}
							onLinha={i => navigate(`/mensageria/voz/lotes/${lotes[i].id}`)}
							linhas={lotes.map(l => [
								dataCurta(l.data), nomeCarteira(l.credor_id), l.modo === 'real' ? 'Real' : l.modo === 'teste' ? 'Só números de teste' : 'Simulado',
								<Pilula key="s" tom={SIT_LOTE_VOZ[l.situacao]?.tom}>{SIT_LOTE_VOZ[l.situacao]?.label ?? l.situacao}</Pilula>,
								`${inteiro(l.encerradas)} de ${inteiro(l.total)}`,
								l.encerradas ? pct((100 * l.abandonos) / Math.max(1, l.encerradas)) : '—',
							])}
							cartoes={lotes.map(l => (
								<CartaoLinha key={l.id} onClick={() => navigate(`/mensageria/voz/lotes/${l.id}`)}>
									<div className="flex items-center justify-between gap-2"><b>{dataCurta(l.data)} · {nomeCarteira(l.credor_id)}</b><Pilula tom={SIT_LOTE_VOZ[l.situacao]?.tom}>{SIT_LOTE_VOZ[l.situacao]?.label ?? l.situacao}</Pilula></div>
									<small className="mt-1 block text-[var(--base-texto-2)]">{inteiro(l.encerradas)} de {inteiro(l.total)} encerradas</small>
								</CartaoLinha>
							))}
						/>
					</Cartao>
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
	const reenv = useReenvios(id ? Number(id) : null);

	const carregar = useCallback(async () => {
		if (!supabase || !empresa || !id) return;
		const sb = supabase;
		const [l, o, r] = await Promise.all([
			sb.from('voz_lotes').select('id,credor_id,data,modo,situacao,total,encerradas,abandonos,custo_operadora,freado_em,roteiro_id,atualizado_em').eq('id', id).eq('empresa_id', empresa.id).maybeSingle(),
			sb.from('voz_ondas').select('id,janela,tentativa,total,encerradas,situacao,abre_em,fecha_em,origem,passada,situacao_origem,prioridade,reenvio_id').eq('lote_id', id).order('tentativa').order('abre_em'),
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
		await reenv.carregar();
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
		: pausado ? <><Botao onClick={() => void mudar('retomar')} disabled={ocupado}><Play size={14} /> Retomar</Botao><Botao secundario onClick={() => setConfirma('cancelar')} disabled={ocupado}>Cancelar o resto</Botao></>
		: <><Botao onClick={() => setConfirma('pausar')} disabled={ocupado}><Pause size={14} /> Pausar</Botao><Botao secundario onClick={() => setConfirma('cancelar')} disabled={ocupado}>Cancelar o resto</Botao></>;

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

	return (
		<Moldura>
			{voltar}
			<div className="space-y-4">
				{lote.modo !== 'real' && <Aviso tom="info" titulo={lote.modo === 'teste' ? 'Só números de teste:' : 'Simulado:'}>{lote.modo === 'teste' ? 'liga de verdade só para os números de teste da equipe.' : 'ninguém recebe ligação e nada entra na fatura.'}</Aviso>}
				{freado && <Aviso tom="erro" titulo={`Lote freado: abandono em ${pct(taxaAb)}, acima do limite de ${pct(limAb)}.`}>As novas ligações começam a {Number(cfg?.freio_ritmo_pct ?? 60)}% do ritmo até a taxa voltar para baixo do limite. Mudar o limite ou pausar é decisão sua.</Aviso>}

				<Cabecalho titulo={`Lote de ${dataCurta(lote.data)} · ${carteira}`} linha={`Agente virtual · ${inteiro(lote.total)} ligações em ${ondas.length} ${ondas.length === 1 ? 'onda' : 'ondas'}`} direita={<>{estado}{botoes}</>} />

				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<Kpi rotulo="Ligações ao mesmo tempo" valor={<>{inteiro(emUso)} <small className="text-[14px] font-medium text-[var(--base-texto-2)]">/ {limiteEmp != null ? inteiro(limiteEmp) : '—'}</small></>}
						detalhe={limiteEmp == null ? 'Limite da empresa ainda não definido (troncos ou contrato).' : `em uso / limite da empresa${freado ? ` · freado a ${Number(cfg?.freio_ritmo_pct ?? 60)}%` : pico > 1 ? ` · pico ligado, até ${inteiro(teto)} (minuto de IA ao dobro)` : ' · pico desligado'}`}>
						<Trilho valor={pico > 1 && teto ? (100 * emUso) / teto : limiteEmp ? (100 * emUso) / limiteEmp : 0} marca={pico > 1 && teto && limiteEmp ? Math.min(100, (100 * limiteEmp) / teto) : undefined} />
					</Kpi>
					<Kpi rotulo="Encerradas" valor={inteiro(encerradasTot)} detalhe={`${pct(lote.total ? (100 * encerradasTot) / lote.total : 0)} do lote, com as retentativas`}>
						<Trilho valor={lote.total ? (100 * encerradasTot) / lote.total : 0} />
					</Kpi>
					<Kpi rotulo="Custo do agente até agora" valor={precoIa != null ? reais(minutosIa * precoIa) : `${inteiro(minutosIa)} min`}
						detalhe={<>
							<span>Minuto de IA · fatura do MotorCX{precoIa != null ? ` · ${inteiro(minutosIa)} min a ${reais(precoIa, 2)}` : ''}</span>
							<span className="mt-1.5 block border-t pt-1.5" style={{ borderColor: 'var(--base-borda)' }}>Telefonia estimada: <b className="text-[var(--base-texto)]">{reais(custoTel)}</b>, paga à operadora, fora da fatura{semCusto ? <span className="text-[var(--estado-atencao-texto)]"> · {inteiro(semCusto)} sem rota cadastrada, sem custo</span> : ''}</span>
						</>} />
					<Kpi rotulo="Abandono do lote" valor={pct(taxaAb)} alerta={taxaAb > limAb}
						detalhe={<>
							<span>atendeu e caiu sem operador livre{cfg?.alo_fake ? ` (Alô fake ligado, espera até ${cfg.alo_fake_max_s} s)` : ' (Alô fake desligado)'}</span>
							<span className="mt-1.5 flex flex-wrap items-center gap-1.5">freia acima de
								{podeLimite ? <>
									<input aria-label="Limite de abandono em %" value={limite} onChange={e => setLimite(e.target.value)} className={`${campoCls} h-7 w-14 px-2`} style={campoStyle} /> %
									{limite.replace(',', '.') !== String(limAb) && <button type="button" onClick={() => void salvarLimite()} className="text-[12px] font-semibold underline">salvar</button>}
								</> : <b className="text-[var(--base-texto)]">{pct(limAb)}</b>}
							</span>
						</>} />
				</div>

				<Cartao semPadding titulo="Ondas de hoje" linha="A 1ª passada abre com a janela UF/DDD. As voltas automáticas (Resubmit) e os reenvios manuais são ondas novas.">
					{ondas.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Vazio titulo="Nenhuma onda ainda.">As ondas aparecem quando a primeira janela UF/DDD abre.</Vazio></div> : (
						<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
							{ondas.map(o => {
								const p = o.total ? (100 * o.encerradas) / o.total : 0;
								const s = cancelado && o.situacao !== 'encerrada' ? SIT_ONDA.cancelada
									: pausado && o.situacao === 'ligando' ? { label: 'Pausada', tom: 'atencao' as const }
									: SIT_ONDA[o.situacao] ?? { label: o.situacao, tom: 'neutro' as const };
								const quando = o.situacao === 'aguardando' && o.abre_em ? `Começa ${horaCurta(o.abre_em)}` : s.label;
								return (
									<div key={o.id} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
										<div className="min-w-0"><b className="block truncate text-[13.5px] text-[var(--base-texto)]">{nomeOnda(o).nome}</b><small className="text-[12px] text-[var(--base-texto-3)]">{o.origem ? nomeOnda(o).detalhe : o.abre_em ? `${horaCurta(o.abre_em)}–${horaCurta(o.fecha_em)}` : 'janela local'}</small></div>
										<div className="text-[12.5px] text-[var(--base-texto-2)]">{o.origem ? 'encerradas' : `${o.tentativa}ª tentativa`} · <b className="tnum text-[var(--base-texto)]">{inteiro(o.encerradas)} de {inteiro(o.total)}</b></div>
										<Trilho valor={p} />
										<div><Pilula tom={s.tom}>{quando}</Pilula></div>
									</div>
								);
							})}
							{reenv.reenvios.filter(r => r.situacao === 'pendente' || r.situacao === 'em_onda').map(r => (
								<div key={`r${r.id}`} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center sm:px-5" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)' }}>
									<div className="min-w-0"><b className="block text-[13.5px] text-[var(--base-texto)]">Reenvio manual · {horaCurta(r.pedido_em)}</b><small className="text-[12px] text-[var(--base-texto-3)]">prioridade {r.prioridade}</small></div>
									<div className="text-[12.5px] text-[var(--base-texto-2)]">números · <b className="tnum text-[var(--base-texto)]">{inteiro(r.previa?.volta ?? 0)}</b></div>
									<Trilho valor={0} />
									<div><Pilula tom="info">Na fila</Pilula></div>
								</div>
							))}
						</div>
					)}
				</Cartao>

				<SemContatoLote loteId={lote.id} ondas={ondas} semContato={reenv.semContato} onPedido={() => void carregar()}
					podeReenviarHoje={lote.data === diaISO() && ['ligando', 'pausado'].includes(lote.situacao)} />

				<Cartao titulo="Resultado até agora">
					{f.total === 0 ? <Vazio titulo="Nenhuma ligação encerrada ainda.">O resultado aparece conforme as ligações terminam.</Vazio> : (
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
							{funil.map(([n, v, sub, alerta]) => (
								<div key={n} className="rounded-xl px-3 py-2" style={{ backgroundColor: alerta ? 'var(--estado-erro-fundo)' : 'var(--base-fill)' }}>
									<span className="block text-[12px] text-[var(--base-texto-2)]">{n}</span>
									<b className="block text-[18px] tnum text-[var(--base-texto)]">{inteiro(v)}</b>
									{sub && <small className="text-[11.5px] text-[var(--base-texto-2)]">{sub}</small>}
								</div>
							))}
						</div>
					)}
				</Cartao>
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
				texto="As ligações que faltam não acontecem hoje. Quem não foi contatado segue a régua (reserva do discador). Não dá para desfazer."
				botao="Cancelar o resto"
				corBotao="var(--estado-erro)"
				onConfirm={() => void mudar('cancelar')}
				onClose={() => setConfirma(null)}
				loading={ocupado}
			/>
		</Moldura>
	);
}
