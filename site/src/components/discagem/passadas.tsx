// Cobrança › Estratégia › Discagem › Contato por passada (SQL 65; protótipo aprovado em 01/11/2026).
// As voltas no mesmo dia compensam? Taxa de contato e custo por contato da 1ª, 2ª, 3ª passada… pela RPC
// contato_por_passada (soma no servidor; grupo com menos de 30 chamadas sem percentual). Só contagens.
import { useEffect, useState } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { NOME, SITUACOES_RENITENCIA, calcularPassadas, passadaRuim, type LinhaPassada, type PassadaCalc } from '@/lib/renitencia';
import { Nota, SecaoTitulo } from './renitencia/pecas';

const nf = (n: number) => Math.round(n).toLocaleString('pt-BR');
const pc = (n: number, d = 1) => `${n.toFixed(d).replace('.', ',')}%`;
const rs = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SITS = ['nao_atendida', 'ocupado', 'maquina', 'caixa_postal', 'desligou_sem_conversar'].filter(k => SITUACOES_RENITENCIA.includes(k));

function Barras({ rows, valor, fmt, titulo }: { rows: PassadaCalc[]; valor: (r: PassadaCalc) => number | null; fmt: (v: number) => string; titulo: string }) {
	const W = 420, H = 200, ml = 8, mr = 8, mt = 22, mb = 28, iw = W - ml - mr, ih = H - mt - mb;
	const vs = rows.map(valor).filter((v): v is number => v != null);
	const topo = Math.max(1e-9, ...vs) * 1.15;
	const band = iw / Math.max(1, rows.length), bw = Math.min(56, band * 0.5);
	return (
		<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${titulo} por passada`} className="block h-auto w-full">
			<line x1={ml} x2={W - mr} y1={mt + ih} y2={mt + ih} stroke="var(--base-borda)" />
			{rows.map((r, i) => {
				const cx = ml + band * i + band / 2, v = valor(r);
				const h = v == null ? 0 : Math.max(1, (v / topo) * ih);
				return (
					<g key={r.passada}>
						<title>{`${r.passada}ª passada${r.passada === 1 ? ' (todos os números)' : ''} · ${titulo}: ${v == null ? 'poucos dados (menos de 30 chamadas)' : fmt(v)} · ${nf(r.chamadas)} chamadas · ${nf(r.contatos)} contatos`}</title>
						{v == null ? <text x={cx} y={mt + ih - 8} textAnchor="middle" fontSize="12" fill="var(--base-texto-3)">—</text> : <>
							<rect x={cx - bw / 2} y={mt + ih - h} width={bw} height={h} rx={4} fill="var(--area)" fillOpacity={r.passada === 1 ? 0.45 : 1} />
							<text x={cx} y={mt + ih - h - 6} textAnchor="middle" fontSize="12" fontWeight="650" fill="var(--base-texto)">{fmt(v)}</text>
						</>}
						<text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--base-texto-2)">{r.passada}ª</text>
					</g>
				);
			})}
		</svg>
	);
}

export function ContatoPassada({ irResubmit }: { irResubmit: () => void }) {
	const { empresa, credor, credores } = useMotorAuth();
	const veFat = usePermissao('ver_faturamento');
	const [cart, setCart] = useState<string>(credor ? String(credor.id) : 'todas');
	const [sit, setSit] = useState<string>('todas');
	const [linhas, setLinhas] = useState<LinhaPassada[] | null>(null);
	const [preco, setPreco] = useState<number | null>(null);
	const [erro, setErro] = useState('');
	const [tabela, setTabela] = useState(false);

	useEffect(() => {
		if (!supabase || !empresa) return;
		let ativo = true;
		const hoje = new Date();
		const ate = new Date(hoje.getTime() - 86_400_000).toISOString().slice(0, 10);
		const de = new Date(hoje.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
		setLinhas(null);
		void supabase.rpc('contato_por_passada', { empresa: empresa.id, credor: cart === 'todas' ? null : Number(cart), de, ate, situacao: sit === 'todas' ? null : sit })
			.then(({ data, error }) => {
				if (!ativo) return;
				if (error) { setErro(friendlyError(error)); setLinhas([]); return; }
				setErro('');
				setLinhas(((data ?? []) as Record<string, unknown>[]).map(r => ({
					passada: Number(r.passada), chamadas: Number(r.chamadas), contatos: Number(r.contatos), taxa: r.taxa == null ? null : Number(r.taxa),
					curtas: Number(r.curtas), curtas_pct: r.curtas_pct == null ? null : Number(r.curtas_pct), minutos_ia: Number(r.minutos_ia),
					custo_operadora: Number(r.custo_operadora), sem_custo: Number(r.sem_custo),
				})));
			});
		return () => { ativo = false; };
	}, [empresa?.id, cart, sit]);

	useEffect(() => {
		if (!supabase || !empresa || !veFat) return;
		void supabase.from('precos_empresa').select('preco,modelo,vigente_desde').eq('empresa_id', empresa.id).eq('item', 'voz_minuto_ia')
			.lte('vigente_desde', new Date().toISOString().slice(0, 10)).order('vigente_desde', { ascending: false }).limit(1)
			.then(({ data }) => { const p = (data as { preco: number; modelo: string }[] | null)?.[0]; setPreco(p && p.modelo === 'flat' && p.preco != null ? Number(p.preco) : null); });
	}, [empresa?.id, veFat]);

	const rows = calcularPassadas(linhas ?? [], preco);
	const p1 = rows.find(r => r.passada === 1);
	const extras = rows.filter(r => r.passada > 1);
	const ctExt = extras.reduce((t, r) => t + r.contatos, 0), chExt = extras.reduce((t, r) => t + r.chamadas, 0);
	const custoExt = extras.reduce((t, r) => t + (r.custo ?? 0), 0);
	const ultima = [...rows].reverse().find(r => r.ok);
	const ruim = passadaRuim(rows);
	const nomeSit = sit === 'todas' ? 'todas as situações' : NOME[sit];

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<select aria-label="Carteira" value={cart} onChange={e => setCart(e.target.value)} className="h-9 max-w-full rounded-lg bg-[var(--base-fill)] px-3 text-[13px] font-semibold text-[var(--base-texto)]">
					<option value="todas">Todas as carteiras</option>
					{credores.map(c => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
				</select>
				<span className="inline-flex h-9 items-center rounded-lg bg-[var(--base-fill)] px-3 text-[13px] font-semibold">Últimos 30 dias</span>
			</div>
			<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Situação que gerou a volta">
				<span className="text-[12px] text-[var(--base-texto-2)]">Situação que gerou a volta:</span>
				{[['todas', 'Todas'], ...SITS.map(k => [k, NOME[k]])].map(([k, n]) => (
					<button key={k} type="button" aria-pressed={sit === k} onClick={() => setSit(k)}
						className="h-8 rounded-full border px-3 text-[13px] font-semibold"
						style={sit === k ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)', borderColor: 'var(--base-texto)' } : { borderColor: 'var(--base-borda)', color: 'var(--base-texto-2)' }}>{n}</button>
				))}
			</div>
			{erro && <Nota tom="atencao">{erro}</Nota>}
			{linhas === null ? <p className="text-[13px] text-[var(--base-texto-2)]">Carregando…</p> : rows.length === 0 ? (
				<Nota tom="info"><b className="block">Ainda não há passadas para mostrar.</b>Os números aparecem no dia seguinte às primeiras ligações do agente virtual (a VM soma à noite).</Nota>
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
						{[
							['1ª passada', p1?.taxa != null ? pc(p1.taxa) : '—', p1 ? `${nf(p1.contatos)} contatos em ${nf(p1.chamadas)} chamadas` : ''],
							['Contatos das voltas', nf(ctExt), `${(p1?.contatos ?? 0) + ctExt ? pc(100 * ctExt / ((p1?.contatos ?? 0) + ctExt)) : '—'} de todos os contatos · ${nf(chExt)} chamadas`],
							['Custo por contato', ctExt ? rs(custoExt / ctExt) : '—', `nas voltas · na 1ª: ${p1?.cpc != null ? rs(p1.cpc) : '—'} (${preco != null ? 'minuto de IA + telefonia estimada' : 'só a telefonia estimada'})`],
							[`Curtas na ${ultima ? `${ultima.passada}ª` : 'última'} passada`, ultima?.curtas_pct != null ? pc(ultima.curtas_pct, 0) : '—', `na 1ª: ${p1?.curtas_pct != null ? pc(p1.curtas_pct, 0) : '—'} · MP: 85%`],
						].map(([l, v, dt]) => (
							<div key={l} className="min-w-0 rounded-2xl border p-4" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
								<div className="text-[12px] text-[var(--base-texto-2)]">{l}</div>
								<div className="mt-1 text-[24px] font-bold tabular-nums text-[var(--base-texto)]">{v}</div>
								<div className="mt-0.5 text-[12px] text-[var(--base-texto-2)]">{dt}</div>
							</div>
						))}
					</div>
					{ruim ? (
						<Nota tom="info">
							<b className="block">A partir da {ruim.passada}ª passada, {sit === 'todas' ? 'as voltas quase não compensam' : `${nomeSit} quase não compensa`}: {pc(ruim.taxa ?? 0)} de contato{ruim.cpc != null ? ` a ${rs(ruim.cpc)} por contato` : ''}{p1?.cpc != null ? ` (na 1ª: ${rs(p1.cpc)})` : ''}.</b>
							Sugestão: na regra por sinalização, deixar no máximo {Math.max(0, ruim.passada - 2)} {ruim.passada - 2 === 1 ? 'volta' : 'voltas'} no dia{sit === 'todas' ? ' nas situações com taxa mais baixa' : ` para ${nomeSit}`}. Quem decide são vocês.
							<div className="mt-2"><button type="button" onClick={irResubmit} className="inline-flex h-8 items-center rounded-full border px-4 text-[12.5px] font-semibold" style={{ borderColor: 'var(--base-borda)' }}>Abrir a regra por sinalização</button></div>
						</Nota>
					) : <Nota tom="info"><b className="block">Nenhuma passada abaixo de 1,5% de contato nem acima de 3× o custo por contato da 1ª.</b>As voltas desta seleção estão se pagando.</Nota>}
					<section className="rounded-2xl border p-4" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
						<SecaoTitulo titulo="Taxa de contato por passada" linha={`Contato = falou com o titular (CPC, identidade confirmada, promessa, recusa ou pediu retorno) ÷ chamadas. A 1ª passada é a base toda; da 2ª em diante, só as voltas de ${nomeSit}.`}
							direita={<button type="button" onClick={() => setTabela(t => !t)} className="text-[13px] font-semibold text-[var(--estado-info)]">{tabela ? 'Ver gráfico' : 'Ver como tabela'}</button>} />
						{tabela ? (
							<div className="overflow-x-auto">
								<table className="w-full min-w-[560px] border-collapse text-[13px]">
									<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]">{['Passada', 'Chamadas', 'Contatos', 'Taxa de contato', 'Contatos acumulados', 'Custo por contato', 'Curtas'].map((h, i) => <th key={h} className={`py-2 pr-3 ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
									<tbody>{rows.map(r => (
										<tr key={r.passada} className="border-t" style={{ borderColor: 'var(--base-borda)' }}>
											<td className="py-2 pr-3 font-semibold">{r.passada}ª{r.passada === 1 ? ' · todos' : ''}</td>
											<td className="py-2 pr-3 text-right tabular-nums">{nf(r.chamadas)}</td><td className="py-2 pr-3 text-right tabular-nums">{r.ok ? nf(r.contatos) : '—'}</td>
											<td className="py-2 pr-3 text-right tabular-nums">{r.taxa != null ? pc(r.taxa) : '—'}</td><td className="py-2 pr-3 text-right tabular-nums">{nf(r.acum)}</td>
											<td className="py-2 pr-3 text-right tabular-nums">{r.cpc != null ? rs(r.cpc) : '—'}</td><td className="py-2 text-right tabular-nums">{r.curtas_pct != null ? pc(r.curtas_pct, 0) : '—'}</td>
										</tr>
									))}</tbody>
								</table>
							</div>
						) : <>
							<Barras rows={rows} valor={r => r.taxa} fmt={v => pc(v)} titulo="Taxa de contato" />
							<p className="mt-1 text-[11.5px] text-[var(--base-texto-2)]">Mais clara: 1ª passada (todos) · mais escura: voltas ({nomeSit}) · — grupo com menos de 30 chamadas</p>
						</>}
					</section>
					{!tabela && (
						<section className="rounded-2xl border p-4" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
							<SecaoTitulo titulo="Custo por contato por passada" linha={preco != null ? 'Minuto de IA (fatura MotorCX) + telefonia estimada (paga à operadora), dividido pelos contatos.' : 'Só a telefonia estimada (o preço do minuto de IA aparece para quem vê o faturamento).'} />
							<Barras rows={rows} valor={r => r.cpc} fmt={v => rs(v)} titulo="Custo por contato" />
						</section>
					)}
				</>
			)}
		</div>
	);
}
