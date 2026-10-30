import { useEffect, useState } from 'react';
import { Plus, X, Info, Ban } from 'lucide-react';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { cardShadow } from './console-shell';
import { MENSAGEM_COR } from './console-fornecedor-drawer';

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
/** Lê número no padrão BR (vírgula decimal). */
function parseNum(v: string): number {
	if (v == null) return 0;
	let s = String(v).trim();
	if (!s) return 0;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return isNaN(n) ? 0 : n;
}

type Produto = { codigo: string; canal: string; nome: string };

export function Negociacoes() {
	const [fornecedores, setFornecedores] = useState<Row[]>([]);
	const [produtos, setProdutos] = useState<Produto[]>([]);
	const [vigentes, setVigentes] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	const [forn, setForn] = useState('');
	const [produto, setProduto] = useState('');
	const [modo, setModo] = useState<'flat' | 'por_operadora'>('flat');
	const [flat, setFlat] = useState('');
	const [porOp, setPorOp] = useState<Record<string, string>>({ vivo: '', claro: '', tim: '', outras: '' });
	const [marcadas, setMarcadas] = useState<string[]>([]);
	const [vigente, setVigente] = useState(hojeISO());
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const [fn, pr, vg] = await Promise.all([
			supabase.from('mensageria_fornecedores').select('id,codigo,nome,canais,ativo').order('nome'),
			supabase.rpc('produtos_catalogo'),
			supabase.from('negociacoes_vigentes').select('*'),
		]);
		if (fn.error) { setError(friendlyError(fn.error)); setLoading(false); return; }
		if (pr.error) { setError(friendlyError(pr.error)); setLoading(false); return; }
		setFornecedores((fn.data ?? []) as Row[]);
		setProdutos(((pr.data ?? []) as Row[]).map(r => ({ codigo: String(r.codigo ?? ''), canal: String(r.canal ?? ''), nome: String(r.nome ?? '') })));
		setVigentes((vg.data ?? []) as Row[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	const produtoSel = produtos.find(p => p.codigo === produto);
	const canalSms = produtoSel?.canal === 'sms';
	const modoEfetivo = canalSms ? modo : 'flat';

	function trocarProduto(c: string) {
		setProduto(c);
		const p = produtos.find(x => x.codigo === c);
		if (p && p.canal !== 'sms') setModo('flat');
	}

	const flatNum = parseNum(flat);
	const flatInvalido = flatNum <= 0;
	const porOpNum: Record<string, number> = {};
	let porOpInvalido = false;
	for (const o of OPERADORAS) {
		const n = parseNum(porOp[o.id] ?? '');
		porOpNum[o.id] = n;
		if (marcadas.includes(o.id) && n <= 0) porOpInvalido = true;
	}
	const dataPassada = vigente < hojeISO();
	const podeSalvar = !!forn && !!produto && !dataPassada && !busy && (modoEfetivo === 'flat' ? !flatInvalido : (!porOpInvalido && marcadas.length > 0));

	async function salvar() {
		if (!supabase) return;
		setFormError('');
		if (dataPassada) { setFormError('A data não pode ser no passado.'); return; }
		setBusy(true);
		const valores = modoEfetivo === 'flat'
			? { flat: flatNum }
			: Object.fromEntries(marcadas.map(o => [o, porOpNum[o]]));
		const { error: e } = await supabase.rpc('salvar_negociacao', {
			fornecedor: forn, item: produto, modo: modoEfetivo, valores, vigente_desde: vigente,
		});
		setBusy(false);
		if (e) { setFormError(friendlyError(e)); return; }
		setFlat(''); setPorOp({ vivo: '', claro: '', tim: '', outras: '' }); setMarcadas([]);
		void reload();
	}

	async function encerrar() {
		if (!supabase) return;
		setFormError('');
		if (!forn || !produto) { setFormError('Escolha fornecedor e produto.'); return; }
		setBusy(true);
		const { error: e } = await supabase.rpc('salvar_negociacao', {
			fornecedor: forn, item: produto, modo: 'encerrar', valores: {}, vigente_desde: hojeISO(),
		});
		setBusy(false);
		if (e) { setFormError('Tire o fornecedor da rota antes.'); return; }
		void reload();
	}

	const fornNome = (codigo: string) => fornecedores.find(f => f.codigo === codigo)?.nome ?? codigo;
	const prodNome = (codigo: string) => produtos.find(p => p.codigo === codigo)?.nome ?? codigo;

	return (
		<div className="space-y-6">
			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
				<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Nova negociação</h2>
				{loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
					<div className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Fornecedor</span>
								<select value={forn} onChange={e => setForn(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
									<option value="">—</option>
									{fornecedores.map(f => <option key={f.id} value={f.codigo}>{f.nome}</option>)}
								</select>
							</label>
							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Produto</span>
								<select value={produto} onChange={e => trocarProduto(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
									<option value="">—</option>
									{produtos.map(p => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
								</select>
							</label>
						</div>

						<div>
							<span className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Modo</span>
							<div className="flex gap-2">
								<button type="button" onClick={() => setModo('flat')} className={`h-10 rounded-full px-5 text-[14px] font-medium ${modoEfetivo === 'flat' ? 'text-white' : 'border border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`} style={modoEfetivo === 'flat' ? { backgroundColor: MENSAGEM_COR } : undefined}>Preço único (flat)</button>
								<button type="button" onClick={() => canalSms && setModo('por_operadora')} disabled={!canalSms} className={`h-10 rounded-full px-5 text-[14px] font-medium ${modoEfetivo === 'por_operadora' ? 'text-white' : 'border border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-40'}`} style={modoEfetivo === 'por_operadora' ? { backgroundColor: MENSAGEM_COR } : undefined}>Por operadora</button>
							</div>
							{!canalSms && <p className="mt-1 text-[12px] text-[#8E8E93]">Por operadora só para produtos de SMS.</p>}
						</div>

						{modoEfetivo === 'flat' ? (
							<label className="block max-w-[280px]">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Custo (R$)</span>
								<input value={flat} onChange={e => setFlat(e.target.value)} inputMode="decimal" placeholder="0,0000" className={`h-10 w-full rounded-lg border px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F] ${flat !== '' && flatInvalido ? 'border-[#FF3B30]' : 'border-[#D2D2D7]'}`} />
								{flat !== '' && flatInvalido && <p className="mt-1 text-[12px] text-[#FF3B30]">Custo precisa ser maior que zero.</p>}
							</label>
						) : (
							<div className="space-y-2">
								{OPERADORAS.map(o => {
									const marcada = marcadas.includes(o.id);
									const val = porOp[o.id] ?? '';
									const invalido = marcada && parseNum(val) <= 0;
									return (
										<div key={o.id} className="flex flex-wrap items-center gap-3">
											<label className="flex w-[120px] items-center gap-2 text-[14px] text-[#1D1D1F]">
												<input type="checkbox" checked={marcada} onChange={e => setMarcadas(prev => e.target.checked ? [...new Set([...prev, o.id])] : prev.filter(x => x !== o.id))} />
												{o.nome}
											</label>
											{marcada && (
												<input value={val} onChange={e => setPorOp(prev => ({ ...prev, [o.id]: e.target.value }))} inputMode="decimal" placeholder="0,0000" className={`h-10 w-[160px] rounded-lg border px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F] ${invalido ? 'border-[#FF3B30]' : 'border-[#D2D2D7]'}`} />
											)}
											{marcada && invalido && <span className="text-[12px] text-[#FF3B30]">Custo precisa ser maior que zero.</span>}
										</div>
									);
								})}
							</div>
						)}

						<label className="block max-w-[220px]">
							<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Vale a partir de</span>
							<input type="date" value={vigente} onChange={e => setVigente(e.target.value)} className={`h-10 w-full rounded-lg border px-3 text-[15px] outline-none focus:border-[#1D1D1F] ${dataPassada ? 'border-[#FF3B30]' : 'border-[#D2D2D7]'}`} />
							{dataPassada && <p className="mt-1 text-[12px] text-[#FF3B30]">A data não pode ser no passado.</p>}
						</label>

						{formError && <p role="alert" className="text-[14px] text-[#FF3B30]">{formError}</p>}
						<div className="flex flex-wrap gap-3">
							<button onClick={salvar} disabled={!podeSalvar} className="h-10 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar negociação'}</button>
							<button onClick={encerrar} disabled={!forn || !produto || busy} className="flex h-10 items-center gap-2 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50"><Ban size={15} /> Encerrar negociação</button>
						</div>
					</div>
				)}
			</section>

			<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
				<h2 className="mb-1 flex items-center gap-1.5 text-[16px] font-semibold text-[#1D1D1F]">O que vale hoje <Info size={14} className="text-[#8E8E93]" /></h2>
				<p className="mb-4 text-[13px] text-[#8E8E93]">Custos vigentes por fornecedor e produto.</p>
				{vigentes.length === 0 ? (
					<p className="rounded-xl bg-[#F5F5F7] px-4 py-6 text-center text-[14px] text-[#8E8E93]">Nenhuma negociação vigente.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[640px] text-left text-sm">
							<thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Fornecedor</th><th className="pb-3 font-medium">Produto</th><th className="pb-3 font-medium">Modo</th><th className="pb-3 font-medium">Valores</th><th className="pb-3 font-medium">Desde</th></tr></thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{vigentes.map((v, i) => {
									const valores = (v.valores ?? {}) as Record<string, number>;
									return (
										<tr key={i}>
											<td className="py-3 font-medium text-[#1D1D1F]">{fornNome(String(v.fornecedor ?? ''))}</td>
											<td className="py-3 text-[#1D1D1F]">{prodNome(String(v.item ?? ''))}</td>
											<td className="py-3 text-[#6E6E73]">{v.modo === 'flat' ? 'Preço único' : v.modo === 'por_operadora' ? 'Por operadora' : String(v.modo ?? '')}</td>
											<td className="py-3 text-[#1D1D1F]">
												<div className="flex flex-wrap gap-x-3 gap-y-0.5 tnum">
													{Object.entries(valores).map(([k, n]) => (
														<span key={k} className="text-[13px]"><span className="text-[#8E8E93]">{k}:</span> {preco4BR(n)}</span>
													))}
												</div>
											</td>
											<td className="py-3 text-[#6E6E73]">{v.vigente_desde ? dateBR(v.vigente_desde) : '—'}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
