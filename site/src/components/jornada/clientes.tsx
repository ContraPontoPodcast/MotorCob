import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Download, Search, X } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading, SemCarteiraCard } from '@/components/jornada/jornada-shell';
import { dateBR, friendlyError, numberBR, supabase, type Row } from '@/lib/supabase';
import { canalMeta } from '@/lib/acoes';
import { CANAL_NOME, MOMENTOS, MOMENTO_NOME } from '@/lib/jornada';
import { faseNome, fetchMapa, periodoDe } from '@/lib/jornada-resultado';

const POR_PAGINA = 25;
const COM_ACAO = 'com ação hoje';
const cartao = { boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' };

type Cliente = { id_cliente: string; fase: string; momento: string; passo: string; motivo: string; data: string };
type Hoje = { canal: string; por_que: string | null };
type Evento = { data: string; fase: string; entrou: boolean; passo: string; passo_texto: string; canal: string; desfecho: string; desfecho_momento: string };

/** % e _ são curingas do like: a busca por prefixo do ID os trata como texto. */
const semCuringa = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

function CanalTag({ c }: { c: string }) {
	if (!c) return <>—</>;
	return (
		<span className="inline-flex items-center gap-1.5">
			<i className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: canalMeta[c]?.cor ?? '#8E8E93' }} />
			{CANAL_NOME[c] ?? c}
		</span>
	);
}

function Pilula({ fase, passo, ativa }: { fase: string; passo?: string; ativa: boolean }) {
	return (
		<span className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
			style={ativa ? { backgroundColor: 'color-mix(in srgb, var(--area) 14%, var(--base-cartao))', color: 'var(--area)' } : { backgroundColor: 'var(--base-fill)', color: 'var(--base-texto-2)' }}>
			{faseNome(fase)}{passo ? ` · ${passo}` : ''}
		</span>
	);
}

const DESFECHO: Record<string, string> = { sucesso: 'deu certo', nao: 'não deu certo', cobranca: 'foi para a cobrança' };

/** Eventos de um dia do histórico (entrou na fase, ação no canal, resultado), na ordem em que aconteceram. */
function eventosDoDia(e: Evento): { titulo: string; detalhe: string }[] {
	const out: { titulo: string; detalhe: string }[] = [];
	const quando = dateBR(e.data);
	if (e.desfecho) out.push({ titulo: `${MOMENTO_NOME[e.desfecho_momento] ?? 'Jornada'}: ${DESFECHO[e.desfecho] ?? e.desfecho}`, detalhe: quando });
	if (e.entrou) out.push({ titulo: e.fase === 'cobranca' ? 'Foi para a cobrança' : e.fase ? `Entrou em ${faseNome(e.fase)}` : 'Saiu da jornada', detalhe: quando });
	if (e.canal) out.push({ titulo: `${CANAL_NOME[e.canal] ?? e.canal}${e.passo ? ` · ${e.passo}` : ''}`, detalhe: [quando, e.passo_texto].filter(Boolean).join(' · ') });
	return out;
}

function Gaveta({ c, hoje, credorId, carteiraNome, carteiraCodigo, onClose }: { c: Cliente; hoje: Hoje | undefined; credorId: string; carteiraNome: string; carteiraCodigo: string; onClose: () => void }) {
	const [hist, setHist] = useState<Evento[] | null>(null);
	const [passoTexto, setPassoTexto] = useState('');
	const fechar = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		fechar.current?.focus();
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	useEffect(() => {
		if (!supabase) return;
		let active = true;
		setHist(null); setPassoTexto('');
		// Histórico de 90 dias (SQL 55). Sem a função no banco, a gaveta mostra só o bloco de hoje.
		supabase.rpc('historico_cliente_jornada', { credor: Number(credorId), id_cliente: c.id_cliente })
			.then(({ data, error }) => { if (active) setHist(error ? null : [...((data ?? []) as Evento[])].reverse()); });
		if (c.passo) {
			supabase.rpc('rotulo_passo_jornada', { momento: c.momento || c.fase, passo: c.passo })
				.then(({ data }) => { if (active && typeof data === 'string') setPassoTexto(data); });
		}
		return () => { active = false; };
	}, [c.id_cliente, c.passo, c.momento, c.fase, credorId]);

	const canal = hoje?.canal ?? '';
	const eventos = (hist ?? []).flatMap(eventosDoDia);
	return (
		<>
			<div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} aria-hidden="true" />
			<aside role="dialog" aria-modal="true" aria-label={`Cliente ${c.id_cliente}`} className="fixed bottom-0 right-0 top-0 z-[61] flex w-full max-w-[420px] flex-col border-l border-[#E5E5EA] bg-white" style={{ boxShadow: '0 18px 48px rgba(0,0,0,.18)' }}>
				<div className="flex items-center gap-2.5 border-b border-[#E5E5EA] px-[18px] py-4">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F] tnum">{c.id_cliente}</h2>
					<Pilula fase={c.fase} ativa={c.motivo === COM_ACAO} />
					<button ref={fechar} type="button" onClick={onClose} aria-label="Fechar" className="ml-auto grid h-[34px] w-[34px] place-items-center rounded-[9px] text-[#6E6E73] hover:bg-[#F5F5F7]"><X size={16} /></button>
				</div>
				<div className="flex flex-col gap-4 overflow-auto px-[18px] py-4">
					<dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px] sm:grid-cols-[130px_minmax(0,1fr)]">
						<dt className="text-[#6E6E73]">Fase hoje</dt><dd className="font-semibold text-[#1D1D1F]">{faseNome(c.fase)}</dd>
						<dt className="text-[#6E6E73]">Passo</dt><dd className="font-semibold text-[#1D1D1F]">{c.passo ? `${c.passo}${passoTexto && passoTexto !== c.passo ? ` · ${passoTexto}` : ''}` : '—'}</dd>
						<dt className="text-[#6E6E73]">Por que hoje</dt><dd className="font-semibold text-[#1D1D1F]">{c.motivo}</dd>
						<dt className="text-[#6E6E73]">Canal de hoje</dt><dd className="font-semibold text-[#1D1D1F]">{canal ? CANAL_NOME[canal] ?? canal : 'nenhum'}</dd>
						<dt className="text-[#6E6E73]">Carteira</dt><dd className="font-semibold text-[#1D1D1F]">{carteiraNome}</dd>
					</dl>
					{canal && hoje?.por_que && (
						<div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] text-[#1D1D1F]" style={{ backgroundColor: 'var(--estado-info-fundo)' }}>
							<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold" style={{ backgroundColor: 'var(--estado-info)', color: 'var(--base-cartao)' }}>i</span>
							<span><b>Por que {CANAL_NOME[canal] ?? canal}?</b> {hoje.por_que}</span>
						</div>
					)}
					{hist !== null && (
						<div>
							<h3 className="mb-2.5 text-[12.5px] font-bold uppercase tracking-wide text-[#8E8E93]">Últimos 90 dias</h3>
							{eventos.length === 0 ? <p className="text-[12.5px] text-[#6E6E73]">Nada registrado nos últimos 90 dias.</p> : (
								<ol className="ml-1.5 border-l-2 border-[#E5E5EA]">
									{eventos.map((e, i) => (
										<li key={i} className="relative pb-3 pl-4 text-[12.5px] text-[#1D1D1F]">
											<span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: 'var(--area)' }} />
											<b>{e.titulo}</b>
											<small className="block text-[#6E6E73]">{e.detalhe}</small>
										</li>
									))}
								</ol>
							)}
						</div>
					)}
					<Link to={`/jornada/lista?carteira=${encodeURIComponent(carteiraCodigo)}`} className="inline-flex h-[30px] w-fit items-center rounded-full border border-[#D2D2D7] px-3 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Ver na Lista do dia</Link>
				</div>
			</aside>
		</>
	);
}

export function JornadaClientes() {
	const { empresa, carteiras, carteira, loading: cLoading } = useJornadaCarteira();
	const [fase, setFase] = useState<string>('todas');
	const [acao, setAcao] = useState<'todos' | 'com' | 'sem'>('todos');
	const [buscaTxt, setBuscaTxt] = useState('');
	const [busca, setBusca] = useState('');
	const [pagina, setPagina] = useState(0);
	const [rows, setRows] = useState<Cliente[]>([]);
	const [total, setTotal] = useState(0);
	const [hoje, setHoje] = useState<Record<string, Hoje>>({});
	const [contagem, setContagem] = useState<Record<string, number>>({});
	const [rodada, setRodada] = useState('');
	const [loading, setLoading] = useState(true);
	const [baixando, setBaixando] = useState(false);
	const [error, setError] = useState('');
	const [aberto, setAberto] = useState<Cliente | null>(null);
	const fecharGaveta = useCallback(() => setAberto(null), []);

	// Busca pelo ID: espera a pessoa parar de digitar.
	useEffect(() => { const t = window.setTimeout(() => setBusca(buscaTxt.trim()), 300); return () => window.clearTimeout(t); }, [buscaTxt]);
	useEffect(() => { setPagina(0); }, [fase, acao, busca, carteira?.id]);

	// Números dos chips: mapa_jornada (no momento hoje) + o total da carteira; Fora da jornada = o que sobra.
	useEffect(() => {
		if (!supabase || !empresa || !carteira) { setContagem({}); return; }
		let active = true;
		(async () => {
			try {
				const [mapa, tot, ult] = await Promise.all([
					fetchMapa(carteira.id, periodoDe(1)),
					supabase!.from('jornada_cliente').select('id_cliente', { count: 'exact', head: true }).eq('empresa_id', empresa.id).eq('credor_id', carteira.id),
					supabase!.from('jornada_cliente').select('data').eq('empresa_id', empresa.id).eq('credor_id', carteira.id).order('data', { ascending: false }).limit(1),
				]);
				if (!active) return;
				const c: Record<string, number> = { todas: tot.count ?? 0 };
				for (const m of mapa) c[m.momento] = m.no_momento;
				c[''] = Math.max(0, (tot.count ?? 0) - mapa.reduce((s, m) => s + m.no_momento, 0));
				setContagem(c);
				setRodada(String(((ult.data ?? []) as Row[])[0]?.data ?? ''));
			} catch { if (active) setContagem({}); }
		})();
		return () => { active = false; };
	}, [empresa?.id, carteira?.id]);

	function consulta(cols: string, count = false) {
		let q = supabase!.from('jornada_cliente').select(cols, count ? { count: 'exact' } : undefined)
			.eq('empresa_id', empresa!.id).eq('credor_id', carteira!.id);
		if (fase !== 'todas') q = q.eq('fase', fase);
		if (acao === 'com') q = q.eq('motivo', COM_ACAO);
		if (acao === 'sem') q = q.neq('motivo', COM_ACAO);
		if (busca) q = q.like('id_cliente', `${semCuringa(busca)}%`);
		return q.order('id_cliente');
	}

	async function canaisDeHoje(ids: string[], data: string): Promise<Record<string, Hoje>> {
		const out: Record<string, Hoje> = {};
		for (let i = 0; i < ids.length; i += 200) {
			const { data: f } = await supabase!.from('fila_dia').select('id_cliente,canal,por_que,reserva')
				.eq('empresa_id', empresa!.id).eq('credor_id', carteira!.id).eq('data', data).in('id_cliente', ids.slice(i, i + 200));
			for (const r of (f ?? []) as Row[]) {
				const id = String(r.id_cliente);
				if (!out[id] || out[id].canal === '' || r.reserva === false) out[id] = { canal: String(r.canal ?? ''), por_que: r.por_que ? String(r.por_que) : null };
			}
		}
		return out;
	}

	useEffect(() => {
		if (!supabase || !empresa || !carteira) { setRows([]); setTotal(0); setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		(async () => {
			const { data, count, error } = await consulta('id_cliente,fase,momento,passo,motivo,data', true).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
			if (!active) return;
			if (error) { setError(friendlyError()); setLoading(false); return; }
			const lista = ((data ?? []) as unknown as Row[]).map(r => ({ id_cliente: String(r.id_cliente), fase: String(r.fase ?? ''), momento: String(r.momento ?? ''), passo: String(r.passo ?? ''), motivo: String(r.motivo ?? ''), data: String(r.data ?? '') }));
			setRows(lista); setTotal(count ?? lista.length);
			const ids = lista.filter(c => c.motivo === COM_ACAO).map(c => c.id_cliente);
			const h = ids.length && lista[0] ? await canaisDeHoje(ids, lista[0].data).catch(() => ({})) : {};
			if (!active) return;
			setHoje(h); setLoading(false);
		})();
		return () => { active = false; };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [empresa?.id, carteira?.id, fase, acao, busca, pagina]);

	async function baixarCSV() {
		if (!supabase || !empresa || !carteira) return;
		setBaixando(true); setError('');
		try {
			const todos: Cliente[] = [];
			for (let de = 0; de < 200000; de += 1000) {
				const { data, error } = await consulta('id_cliente,fase,momento,passo,motivo,data').range(de, de + 999);
				if (error) throw error;
				const lote = (data ?? []) as unknown as Cliente[];
				todos.push(...lote);
				if (lote.length < 1000) break;
			}
			const comAcao = todos.filter(c => c.motivo === COM_ACAO).map(c => c.id_cliente);
			const h = comAcao.length && todos[0] ? await canaisDeHoje(comAcao, todos[0].data) : {};
			const q = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
			const linhas = todos.map(c => [c.id_cliente, faseNome(c.fase), c.passo, c.motivo, CANAL_NOME[h[c.id_cliente]?.canal ?? ''] ?? ''].map(q).join(';'));
			const csv = ['id_cliente;fase_hoje;passo;por_que_hoje;canal_de_hoje', ...linhas].join('\n');
			const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
			const a = document.createElement('a');
			a.href = url; a.download = `jornada-clientes-${carteira.codigo}.csv`;
			document.body.appendChild(a); a.click(); a.remove();
			URL.revokeObjectURL(url);
		} catch { setError(friendlyError()); }
		finally { setBaixando(false); }
	}

	const chips = useMemo(() => [
		{ id: 'todas', nome: 'Todos' },
		...MOMENTOS.map(m => ({ id: m.id as string, nome: m.nome })),
		{ id: 'cobranca', nome: 'Em atraso' },
		{ id: '', nome: 'Fora da jornada' },
	], []);

	if (cLoading) return <div className="mc-platform"><Loading /></div>;
	if (carteiras.length === 0) return <><JornadaHeading title="Clientes" /><SemCarteiraCard /></>;
	if (!carteira) return <div className="mc-platform"><Loading /></div>;

	const vazio = <div className="px-6 py-7 text-center text-[13.5px] text-[#6E6E73]">{busca ? 'Nenhum cliente com esse ID nesta carteira.' : 'Nenhum cliente neste filtro.'}</div>;
	const ini = total === 0 ? 0 : pagina * POR_PAGINA + 1;
	const fim = Math.min(total, (pagina + 1) * POR_PAGINA);

	return (
		<>
			<JornadaHeading title="Clientes" linha={`Onde cada cliente está na jornada hoje${rodada ? ` · rodada de ${dateBR(rodada)}` : ''}`} />
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}
			<div className="flex flex-col gap-4">
				<div role="group" aria-label="Fase" className="flex flex-wrap gap-1.5">
					{chips.map(ch => {
						const on = fase === ch.id;
						return (
							<button key={ch.id || 'fora'} type="button" aria-pressed={on} onClick={() => setFase(ch.id)}
								className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold ${on ? 'border-[#1D1D1F] bg-[#1D1D1F] text-white' : 'border-[#E5E5EA] text-[#6E6E73]'}`}>
								{ch.nome} {contagem[ch.id] != null && <b className={`font-semibold tnum ${on ? 'text-white' : 'text-[#1D1D1F]'}`}>{numberBR(contagem[ch.id])}</b>}
							</button>
						);
					})}
				</div>
				<div className="flex flex-wrap items-center gap-2.5">
					<label className="flex h-9 min-w-0 flex-[1_1_100%] items-center gap-2 rounded-[10px] border border-[#D2D2D7] bg-white px-3 sm:min-w-[240px] sm:flex-none">
						<Search size={16} className="shrink-0 text-[#8E8E93]" />
						<input value={buscaTxt} onChange={e => setBuscaTxt(e.target.value)} placeholder="Buscar pelo ID do cliente" aria-label="Buscar pelo ID do cliente" maxLength={60} className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
					</label>
					<select aria-label="Ação hoje" value={acao} onChange={e => setAcao(e.target.value as 'todos' | 'com' | 'sem')} className="h-9 flex-1 rounded-[10px] border border-[#D2D2D7] bg-white px-2.5 text-[13px] outline-none sm:flex-none">
						<option value="todos">Com e sem ação hoje</option>
						<option value="com">Só com ação hoje</option>
						<option value="sem">Só quem ficou sem ação</option>
					</select>
					<button type="button" onClick={() => void baixarCSV()} disabled={baixando || total === 0} className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">
						<Download size={13} /> {baixando ? 'Preparando...' : 'Baixar a lista (CSV)'}
					</button>
				</div>
				<section className="rounded-2xl bg-white" style={cartao}>
					{loading ? <div className="p-6"><Loading /></div> : (
						<>
							<div className="hidden overflow-x-auto sm:block">
								{rows.length === 0 ? vazio : (
									<table className="w-full border-collapse text-[13px]">
										<thead>
											<tr className="border-b border-[#E5E5EA] text-left text-[11px] uppercase tracking-wide text-[#8E8E93]">
												<th className="whitespace-nowrap px-3.5 py-2.5 font-semibold">ID do cliente</th>
												<th className="whitespace-nowrap px-3.5 py-2.5 font-semibold">Fase hoje</th>
												<th className="whitespace-nowrap px-3.5 py-2.5 font-semibold">Passo</th>
												<th className="whitespace-nowrap px-3.5 py-2.5 font-semibold">Por que hoje</th>
												<th className="whitespace-nowrap px-3.5 py-2.5 font-semibold">Canal de hoje</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[color:var(--base-separator)] text-[#6E6E73]">
											{rows.map(c => (
												<tr key={c.id_cliente} tabIndex={0} onClick={() => setAberto(c)} onKeyDown={e => { if (e.key === 'Enter') setAberto(c); }} className="cursor-pointer hover:bg-[#F5F5F7]">
													<td className="whitespace-nowrap px-3.5 py-[11px] font-semibold text-[#1D1D1F] tnum">{c.id_cliente}</td>
													<td className="whitespace-nowrap px-3.5 py-[11px]">{faseNome(c.fase)}</td>
													<td className="whitespace-nowrap px-3.5 py-[11px]">{c.passo || '—'}</td>
													<td className="whitespace-nowrap px-3.5 py-[11px]">{c.motivo}</td>
													<td className="whitespace-nowrap px-3.5 py-[11px]"><CanalTag c={hoje[c.id_cliente]?.canal ?? ''} /></td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</div>
							<div className="flex flex-col sm:hidden">
								{rows.length === 0 ? vazio : rows.map(c => (
									<button key={c.id_cliente} type="button" onClick={() => setAberto(c)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-b border-[#F0F0F2] px-3.5 py-3 text-left">
										<b className="text-[14px] text-[#1D1D1F] tnum">{c.id_cliente}</b>
										<Pilula fase={c.fase} passo={c.passo} ativa={c.motivo === COM_ACAO} />
										<small className="text-[12px] text-[#6E6E73]">{c.motivo}</small>
										<small className="text-right text-[12px] text-[#6E6E73]">{hoje[c.id_cliente]?.canal ? CANAL_NOME[hoje[c.id_cliente].canal] ?? hoje[c.id_cliente].canal : ''}</small>
									</button>
								))}
							</div>
						</>
					)}
					<div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#F0F0F2] px-3.5 py-2.5 text-[12.5px] text-[#6E6E73]">
						<span className="tnum">{ini}–{fim} de {numberBR(total)}</span>
						<span className="flex gap-1.5">
							<button type="button" disabled={pagina === 0 || loading} onClick={() => setPagina(p => Math.max(0, p - 1))} className="inline-flex h-[30px] items-center rounded-full border border-[#D2D2D7] px-3 text-[12.5px] font-semibold text-[#1D1D1F] disabled:opacity-50">Anterior</button>
							<button type="button" disabled={fim >= total || loading} onClick={() => setPagina(p => p + 1)} className="inline-flex h-[30px] items-center rounded-full border border-[#D2D2D7] px-3 text-[12.5px] font-semibold text-[#1D1D1F] disabled:opacity-50">Próxima</button>
						</span>
					</div>
				</section>
				<p className="text-[11.5px] text-[#8E8E93]">Só o ID do cliente. Sem nome, documento, telefone ou e-mail na tela; para acionar, use o arquivo da Lista do dia.</p>
			</div>
			{aberto && <Gaveta c={aberto} hoje={hoje[aberto.id_cliente]} credorId={carteira.id} carteiraNome={carteira.nome} carteiraCodigo={carteira.codigo} onClose={fecharGaveta} />}
		</>
	);
}
