import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, X, Info, AlertTriangle } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { cardShadow } from './console-shell';
import { Chave } from './chave';
import { FornecedorDrawer, MENSAGEM_COR } from './console-fornecedor-drawer';

const OPERADORAS = [
	{ id: 'vivo', nome: 'Vivo' },
	{ id: 'claro', nome: 'Claro' },
	{ id: 'tim', nome: 'TIM' },
	{ id: 'outras', nome: 'Outras' },
];

function hojeISO() {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function preco4BR(v: unknown) {
	return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function parseNum(v: string): number {
	if (v == null) return 0;
	let s = String(v).trim();
	if (!s) return 0;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return isNaN(n) ? 0 : n;
}

type Produto = { codigo: string; canal: string; nome: string };
type Linha = { fornecedor: string; percentual: number; ordem_reserva: number };
type Bloco = { operadora: string; linhas: Linha[] };

export function Rotas() {
	const [params] = useSearchParams();
	const [produtos, setProdutos] = useState<Produto[]>([]);
	const [fornecedores, setFornecedores] = useState<Row[]>([]);
	const [vigentes, setVigentes] = useState<Row[]>([]);
	const [produto, setProduto] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [drawerForn, setDrawerForn] = useState(false);

	async function reloadFornecedores() {
		if (!supabase) return;
		const { data } = await supabase.from('mensageria_fornecedores').select('id,codigo,nome,canais,ativo').order('nome');
		setFornecedores((data ?? []) as Row[]);
	}

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const [pr, fn, vg] = await Promise.all([
			supabase.rpc('produtos_catalogo'),
			supabase.from('mensageria_fornecedores').select('id,codigo,nome,canais,ativo').order('nome'),
			supabase.from('negociacoes_vigentes').select('*'),
		]);
		if (pr.error) { setError(friendlyError(pr.error)); setLoading(false); return; }
		setProdutos(((pr.data ?? []) as Row[]).map(r => ({ codigo: String(r.codigo ?? ''), canal: String(r.canal ?? ''), nome: String(r.nome ?? '') })));
		setFornecedores((fn.data ?? []) as Row[]);
		setVigentes((vg.data ?? []) as Row[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);
	useEffect(() => {
		if (produtos.length === 0) return;
		const q = params.get('produto');
		if (q && produtos.some(p => p.codigo === q)) setProduto(q);
		else if (!produto) setProduto(produtos[0].codigo);
	}, [produtos, params, produto]);

	const produtoSel = produtos.find(p => p.codigo === produto);

	return (
		<div className="space-y-6">
			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : produtos.length === 0 ? (
				<p className="rounded-xl bg-[#F5F5F7] px-4 py-6 text-center text-[14px] text-[#8E8E93]">Nenhum produto cadastrado.</p>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-3">
						<label className="block">
							<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Produto</span>
							<select value={produto} onChange={e => setProduto(e.target.value)} className="h-10 w-full min-w-[260px] rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
								{produtos.map(p => <option key={p.codigo} value={p.codigo}>{p.nome} · {p.codigo}</option>)}
							</select>
						</label>
					</div>

					{produtoSel && (
						<RotaEditor
							produto={produtoSel}
							fornecedores={fornecedores}
							vigentes={vigentes}
							onNovoForn={() => setDrawerForn(true)}
							onVigentesUpdate={setVigentes}
						/>
					)}

					<Mistura />
				</>
			)}

			{drawerForn && (
				<FornecedorDrawer fornecedor={null} novo onClose={() => setDrawerForn(false)} onSaved={() => { setDrawerForn(false); void reloadFornecedores(); }} />
			)}
		</div>
	);
}

/** Custo de um fornecedor para um produto+operadora, a partir de negociacoes_vigentes. */
function custoDe(vigentes: Row[], fornecedor: string, item: string, operadora: string): number | null {
	const neg = vigentes.find(v => String(v.fornecedor ?? '') === fornecedor && String(v.item ?? '') === item);
	if (!neg) return null;
	const valores = (neg.valores ?? {}) as Record<string, number>;
	const modo = String(neg.modo ?? '');
	if (modo === 'flat') return valores.flat != null ? Number(valores.flat) : null;
	if (modo === 'por_operadora') {
		if (valores[operadora] != null) return Number(valores[operadora]);
		if (valores.outras != null) return Number(valores.outras);
		return null;
	}
	return null;
}

function RotaEditor({ produto, fornecedores, vigentes, onNovoForn, onVigentesUpdate }: {
	produto: Produto; fornecedores: Row[]; vigentes: Row[]; onNovoForn: () => void; onVigentesUpdate: (rows: Row[]) => void;
}) {
	const canalSms = produto.canal === 'sms';
	const [tipo, setTipo] = useState<'flat' | 'por_operadora'>('flat');
	const [blocos, setBlocos] = useState<Bloco[]>([{ operadora: '', linhas: [{ fornecedor: '', percentual: 100, ordem_reserva: 1 }] }]);
	const [marcadas, setMarcadas] = useState<string[]>([]);
	const [demais, setDemais] = useState(false);
	const [loadingRota, setLoadingRota] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [custoPrev, setCustoPrev] = useState<number | null>(null);
	const [problemas, setProblemas] = useState<string[] | null>(null);
	const [custoEdicao, setCustoEdicao] = useState<Record<string, string>>({});
	const [custoBusy, setCustoBusy] = useState<string | null>(null);

	async function carregarRota() {
		if (!supabase) return;
		setLoadingRota(true);
		// A rota de um produto vive em mensageria_planos_rota (1 linha) +
		// mensageria_plano_fornecedores (linhas por operadora/fornecedor).
		const { data: planoData } = await supabase.from('mensageria_planos_rota').select('id,tipo,item,ativo').eq('item', produto.codigo).maybeSingle();
		const plano = (planoData ?? null) as Row | null;
		let itens: { fornecedor: string; operadora: string; percentual: number; ordem_reserva: number }[] = [];
		if (plano) {
			const { data: linhasData } = await supabase.from('mensageria_plano_fornecedores').select('operadora,fornecedor,percentual,ordem_reserva').eq('plano_id', String(plano.id));
			itens = ((linhasData ?? []) as Row[]).map(r => ({
				fornecedor: String(r.fornecedor ?? ''),
				operadora: String(r.operadora ?? ''),
				percentual: Number(r.percentual ?? 0),
				ordem_reserva: Number(r.ordem_reserva ?? 1),
			}));
		}
		if (itens.length === 0) {
			setTipo('flat');
			setBlocos([{ operadora: '', linhas: [{ fornecedor: '', percentual: 0, ordem_reserva: 1 }] }]);
			setMarcadas([]); setDemais(false);
		} else {
			const porOp = itens.some(i => i.operadora !== '');
			setTipo(porOp ? 'por_operadora' : 'flat');
			if (porOp) {
				const ops = Array.from(new Set(itens.map(i => i.operadora)));
				setMarcadas(ops.filter(o => o !== ''));
				setDemais(ops.includes(''));
				setBlocos(ops.map(o => ({ operadora: o, linhas: itens.filter(i => i.operadora === o).map(({ fornecedor, percentual, ordem_reserva }) => ({ fornecedor, percentual, ordem_reserva })) })));
			} else {
				setMarcadas([]); setDemais(false);
				setBlocos([{ operadora: '', linhas: itens.map(({ fornecedor, percentual, ordem_reserva }) => ({ fornecedor, percentual, ordem_reserva })) }]);
			}
		}
		setLoadingRota(false);
		void lerCustoEProblemas();
	}
	useEffect(() => { void carregarRota(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [produto.codigo]);

	async function lerCustoEProblemas() {
		if (!supabase) return;
		const [cp, pr] = await Promise.all([
			supabase.rpc('custo_previsto', { item_produto: produto.codigo }),
			supabase.rpc('problemas_rota', { item_produto: produto.codigo }),
		]);
		setCustoPrev(cp.error ? null : (cp.data == null ? null : Number(cp.data)));
		setProblemas(pr.error ? null : (Array.isArray(pr.data) ? (pr.data as string[]) : null));
	}

	function trocarTipo(t: 'flat' | 'por_operadora') {
		setTipo(t);
		if (t === 'flat') {
			setBlocos([{ operadora: '', linhas: [{ fornecedor: '', percentual: 0, ordem_reserva: 1 }] }]);
		} else {
			setMarcadas([]); setDemais(false);
			setBlocos([]);
		}
	}

	function toggleOperadora(op: string, on: boolean) {
		if (on) {
			setMarcadas(prev => [...new Set([...prev, op])]);
			setBlocos(prev => [...prev, { operadora: op, linhas: [{ fornecedor: '', percentual: 0, ordem_reserva: 1 }] }]);
		} else {
			setMarcadas(prev => prev.filter(x => x !== op));
			setBlocos(prev => prev.filter(b => b.operadora !== op));
		}
	}
	function toggleDemais(on: boolean) {
		setDemais(on);
		if (on) setBlocos(prev => [...prev, { operadora: '', linhas: [{ fornecedor: '', percentual: 0, ordem_reserva: 1 }] }]);
		else setBlocos(prev => prev.filter(b => b.operadora !== ''));
	}

	function setLinha(bi: number, li: number, patch: Partial<Linha>) {
		setBlocos(prev => prev.map((b, i) => i === bi ? { ...b, linhas: b.linhas.map((l, j) => j === li ? { ...l, ...patch } : l) } : b));
	}
	function addLinha(bi: number) {
		setBlocos(prev => prev.map((b, i) => i === bi ? { ...b, linhas: [...b.linhas, { fornecedor: '', percentual: 0, ordem_reserva: b.linhas.length + 1 }] } : b));
	}
	function removeLinha(bi: number, li: number) {
		setBlocos(prev => prev.map((b, i) => i === bi ? { ...b, linhas: b.linhas.filter((_, j) => j !== li) } : b));
	}

	const somaBloco = (b: Bloco) => b.linhas.reduce((s, l) => s + (l.percentual || 0), 0);
	const blocosParaSalvar = useMemo(() => tipo === 'flat' ? blocos : blocos, [blocos, tipo]);

	const semCusto = blocos.some(b => b.linhas.some(l => l.fornecedor && custoDe(vigentes, l.fornecedor, produto.codigo, b.operadora) == null));
	const podeSalvar = !busy && !semCusto && blocos.every(b => b.linhas.length > 0 && b.linhas.every(l => l.fornecedor)) && blocos.every(b => somaBloco(b) === 100);

	async function salvar() {
		if (!supabase) return;
		setError('');
		setBusy(true);
		const itens = blocos.flatMap(b => b.linhas.map(l => ({ fornecedor: l.fornecedor, operadora: tipo === 'flat' ? '' : b.operadora, percentual: l.percentual, ordem_reserva: l.ordem_reserva })));
		const { error: e } = await supabase.rpc('salvar_rota_produto', { item_produto: produto.codigo, tipo, itens });
		setBusy(false);
		if (e) { setError(friendlyError(e)); return; }
		void lerCustoEProblemas();
	}

	async function salvarCustoInline(fornecedor: string, operadora: string) {
		if (!supabase) return;
		const key = `${fornecedor}|${operadora}`;
		const val = custoEdicao[key] ?? '';
		const n = parseNum(val);
		if (n <= 0) return;
		setCustoBusy(key);
		// Preserva valores por operadora já negociados para não clobber.
		const existente = vigentes.find(v => String(v.fornecedor ?? '') === fornecedor && String(v.item ?? '') === produto.codigo);
		const valoresAtuais = (existente?.valores ?? {}) as Record<string, number>;
		const valores = operadora === '' || tipo === 'flat'
			? { flat: n }
			: { ...valoresAtuais, [operadora]: n };
		const { error: e } = await supabase.rpc('salvar_negociacao', {
			fornecedor, item: produto.codigo, modo: operadora === '' || tipo === 'flat' ? 'flat' : 'por_operadora', valores, vigente_desde: hojeISO(),
		});
		setCustoBusy(null);
		if (e) { setError(friendlyError(e)); return; }
		setCustoEdicao(prev => { const c = { ...prev }; delete c[key]; return c; });
		// recarrega vigentes
		const { data } = await supabase.from('negociacoes_vigentes').select('*');
		onVigentesUpdate((data ?? []) as Row[]);
	}

	const fornCanal = fornecedores.filter(f => Array.isArray(f.canais) && (f.canais as string[]).includes(produto.canal));

	return (
		<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Rota de {produto.nome}</h2>
					<p className="text-[12px] text-[#8E8E93]">Canal: {produto.canal.toUpperCase()}</p>
				</div>
				<div className="flex gap-2">
					<button type="button" onClick={() => trocarTipo('flat')} className={`h-9 rounded-full px-4 text-[13px] font-medium ${tipo === 'flat' ? 'text-white' : 'border border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`} style={tipo === 'flat' ? { backgroundColor: MENSAGEM_COR } : undefined}>Preço único</button>
					<button type="button" onClick={() => canalSms && trocarTipo('por_operadora')} disabled={!canalSms} className={`h-9 rounded-full px-4 text-[13px] font-medium ${tipo === 'por_operadora' ? 'text-white' : 'border border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-40'}`} style={tipo === 'por_operadora' ? { backgroundColor: MENSAGEM_COR } : undefined}>Por operadora</button>
				</div>
			</div>

			{loadingRota ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando rota...</p> : (
				<>
					{tipo === 'por_operadora' && (
						<div className="mb-4 rounded-xl bg-[#F5F5F7] p-3">
							<p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Operadoras com bloco próprio</p>
							<div className="flex flex-wrap gap-4">
								{OPERADORAS.map(o => (
									<label key={o.id} className="flex items-center gap-1.5 text-[14px] text-[#1D1D1F]">
										<input type="checkbox" checked={marcadas.includes(o.id)} onChange={e => toggleOperadora(o.id, e.target.checked)} /> {o.nome}
									</label>
								))}
								<label className="flex items-center gap-1.5 text-[14px] text-[#1D1D1F]">
									<input type="checkbox" checked={demais} onChange={e => toggleDemais(e.target.checked)} /> Demais operadoras
								</label>
							</div>
							<p className="mt-2 text-[12px] text-[#8E8E93]">Operadora sem bloco e sem "Demais" usa a rota do canal.</p>
						</div>
					)}

					{blocos.length === 0 ? (
						<p className="rounded-xl bg-[#F5F5F7] px-4 py-6 text-center text-[14px] text-[#8E8E93]">Marque ao menos uma operadora.</p>
					) : blocos.map((b, bi) => {
						const soma = somaBloco(b);
						const rotulo = tipo === 'flat' ? 'Tráfego' : (b.operadora === '' ? 'Demais operadoras' : OPERADORAS.find(o => o.id === b.operadora)?.nome ?? b.operadora);
						return (
							<div key={bi} className="mb-4 rounded-xl border border-[#F0F0F2] p-4">
								<div className="mb-3 flex items-center justify-between">
									<p className="text-[14px] font-semibold text-[#1D1D1F]">{rotulo}</p>
									<span className={`text-[13px] font-semibold ${soma === 100 ? 'text-[#248A3D]' : 'text-[#9a631b]'}`}>Soma: {soma}%</span>
								</div>
								<div className="space-y-2">
									{b.linhas.map((l, li) => {
										const custo = l.fornecedor ? custoDe(vigentes, l.fornecedor, produto.codigo, b.operadora) : null;
										const ck = `${l.fornecedor}|${b.operadora}`;
										return (
											<div key={li} className="flex flex-wrap items-center gap-2">
												<select value={l.fornecedor} onChange={e => setLinha(bi, li, { fornecedor: e.target.value })} className="h-9 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[14px] outline-none focus:border-[#1D1D1F]">
													<option value="">—</option>
													{fornCanal.map(f => <option key={f.id} value={f.codigo}>{f.nome}</option>)}
												</select>
												<input type="range" min={0} max={100} value={l.percentual} onChange={e => setLinha(bi, li, { percentual: Number(e.target.value) })} className="w-20 accent-[#1D1D1F]" />
												<input type="number" min={0} max={100} value={l.percentual} onChange={e => setLinha(bi, li, { percentual: Number(e.target.value) })} className="h-9 w-14 rounded-lg border border-[#D2D2D7] px-2 text-[14px] tnum outline-none focus:border-[#1D1D1F]" />
												<input type="number" min={1} max={10} value={l.ordem_reserva} onChange={e => setLinha(bi, li, { ordem_reserva: Number(e.target.value) })} title="Ordem de reserva" className="h-9 w-12 rounded-lg border border-[#D2D2D7] px-2 text-[14px] tnum outline-none focus:border-[#1D1D1F]" />
												{l.fornecedor ? (
													custo == null ? (
														<span className="flex items-center gap-1">
															<input value={custoEdicao[ck] ?? ''} onChange={e => setCustoEdicao(prev => ({ ...prev, [ck]: e.target.value }))} inputMode="decimal" placeholder="Custo" className={`h-9 w-[110px] rounded-lg border px-2 text-[13px] tnum outline-none focus:border-[#1D1D1F] ${custoEdicao[ck] && parseNum(custoEdicao[ck]) <= 0 ? 'border-[#FF3B30]' : 'border-[#D2D2D7]'}`} />
															<button onClick={() => salvarCustoInline(l.fornecedor, b.operadora)} disabled={custoBusy === ck || !custoEdicao[ck] || parseNum(custoEdicao[ck]) <= 0} className="h-9 rounded-lg bg-[#1D1D1F] px-2 text-[12px] font-medium text-white disabled:opacity-50">OK</button>
														</span>
													) : <span className="w-[110px] text-right text-[13px] tnum text-[#248A3D]">{preco4BR(custo)}</span>
												) : <span className="w-[110px]" />}
												<button onClick={() => removeLinha(bi, li)} className="text-[#8E8E93] hover:text-[#FF3B30]"><X size={16} /></button>
											</div>
										);
									})}
								</div>
								<div className="mt-3 flex items-center gap-3">
									<button onClick={() => addLinha(bi)} className="flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Plus size={13} /> Fornecedor</button>
									<button onClick={onNovoForn} className="text-[12px] font-medium text-[#6E6E73] hover:text-[#1D1D1F]">+ Novo fornecedor</button>
								</div>
							</div>
						);
					})}

					{semCusto && <p className="mb-3 text-[13px] text-[#FF3B30]">Há fornecedor sem custo cadastrado. Informe o custo na linha antes de salvar.</p>}
					{error && <p role="alert" className="mb-3 text-[14px] text-[#FF3B30]">{error}</p>}

					<div className="flex flex-wrap items-center gap-4">
						<button onClick={salvar} disabled={!podeSalvar} className="h-10 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar rota'}</button>
						{problemas && problemas.length > 0 && (
							<span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3E8] px-2.5 py-1 text-[12px] font-semibold text-[#9a631b]"><AlertTriangle size={13} /> Rota incompleta</span>
						)}
					</div>

					<div className="mt-5 grid gap-3 border-t border-[#F0F0F2] pt-4 sm:grid-cols-2">
						<div>
							<p className="flex items-center gap-1 text-[13px] font-semibold text-[#6E6E73]">Custo previsto <Info size={13} className="text-[#8E8E93]" /></p>
							<p className="mt-1 text-[20px] font-semibold tnum text-[#1D1D1F]">{custoPrev == null ? <span className="text-[#8E8E93]">—</span> : preco4BR(custoPrev)}</p>
						</div>
						<div>
							<p className="text-[13px] font-semibold text-[#6E6E73]">Problemas da rota</p>
							{problemas == null || problemas.length === 0
								? <p className="mt-1 text-[14px] text-[#248A3D]">Nenhum problema.</p>
								: <ul className="mt-1 space-y-0.5">{problemas.map((p, i) => <li key={i} className="text-[13px] text-[#9a631b]">· {p}</li>)}</ul>}
						</div>
					</div>
				</>
			)}
		</section>
	);
}

function Mistura() {
	const [valores, setValores] = useState<Record<string, number>>({ vivo: 0, claro: 0, tim: 0, outras: 0 });
	const [fonte, setFonte] = useState('');
	const [fonteGravada, setFonteGravada] = useState('');
	const [atualizadoEm, setAtualizadoEm] = useState('');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true);
		// Uma linha por operadora (operadora, percentual, fonte, atualizado_em).
		const { data } = await supabase.from('mensageria_mistura_operadoras').select('operadora,percentual,fonte,atualizado_em').order('atualizado_em', { ascending: false });
		const rows = (data ?? []) as Row[];
		const map: Record<string, number> = { vivo: 0, claro: 0, tim: 0, outras: 0 };
		for (const r of rows) {
			const op = String(r.operadora ?? '').toLowerCase();
			if (op in map) map[op] = Number(r.percentual ?? 0);
		}
		setValores(map);
		// A fonte é a da linha mais recente.
		setFonte(String(rows[0]?.fonte ?? ''));
		setFonteGravada(String(rows[0]?.fonte ?? ''));
		setAtualizadoEm(String(rows[0]?.atualizado_em ?? ''));
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	const soma = valores.vivo + valores.claro + valores.tim + valores.outras;
	const podeSalvar = soma === 100 && !busy;

	async function salvar() {
		if (!supabase) return;
		setError('');
		setBusy(true);
		const { error: e } = await supabase.rpc('salvar_mistura_operadoras', { valores, fonte: fonte.trim() || null });
		setBusy(false);
		if (e) { setError(friendlyError(e)); return; }
		void reload();
	}

	return (
		<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
			<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Mistura de operadoras</h2>
			<p className="text-[13px] text-[#8E8E93]">Usada no custo previsto das rotas por operadora.</p>
			<p className="mb-4 text-[13px] text-[#6E6E73]">
				Atualizada automaticamente todo mês (Anatel).
				{fonteGravada && <> Fonte atual: <span className="font-semibold text-[#1D1D1F]">{fonteGravada}</span></>}
				{atualizadoEm && <>, gravada em {new Date(atualizadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</>}
				{fonteGravada && '.'} Salvar aqui é um ajuste manual: vale até a atualização automática do mês seguinte.
			</p>
			{loading ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
				<div className="space-y-3">
					<div className="grid gap-3 sm:grid-cols-4">
						{OPERADORAS.map(o => (
							<label key={o.id} className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{o.nome} (%)</span>
								<input type="number" min={0} max={100} value={valores[o.id]} onChange={e => setValores(prev => ({ ...prev, [o.id]: Number(e.target.value) }))} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" />
							</label>
						))}
					</div>
					<label className="block max-w-[320px]">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Fonte</span>
						<input value={fonte} onChange={e => setFonte(e.target.value)} placeholder="ex.: Anatel 2024" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
					</label>
					<p className={`text-[13px] font-semibold ${soma === 100 ? 'text-[#248A3D]' : 'text-[#9a631b]'}`}>Soma: {soma}%</p>
					{error && <p role="alert" className="text-[14px] text-[#FF3B30]">{error}</p>}
					<button onClick={salvar} disabled={!podeSalvar} className="h-10 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar mistura'}</button>
				</div>
			)}
		</section>
	);
}
