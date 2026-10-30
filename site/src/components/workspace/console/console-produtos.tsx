import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, X, Pencil, Route as RouteIcon, Info, Lock } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { Chave } from './chave';
import { useConsolePerms } from './console-perms';

// Abas na ordem pedida: SMS · WhatsApp · RCS · E-mail.
const ABAS = [
	{ id: 'sms', nome: 'SMS', cor: '#7A4FB0' },
	{ id: 'whatsapp', nome: 'WhatsApp', cor: '#1F8A4C' },
	{ id: 'rcs', nome: 'RCS', cor: '#3B5BA9' },
	{ id: 'email', nome: 'E-mail', cor: '#A2552B' },
];

const CANAL_PREFIXO: Record<string, string> = { sms: 'sms_', whatsapp: 'whatsapp_', rcs: 'rcs_', email: 'email_' };
const UNIDADES = ['mensagem', 'envio', 'sessão'];
/** Cor da área Mensageria (mesma do seletor de produto). */
const MENSAGEM_COR = '#7A4FB0';

/** Preço unitário com 4 casas decimais. */
function preco4BR(v: unknown): string {
	return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function pct1(v: unknown): string {
	return `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function canalNome(c: string) { return ABAS.find(a => a.id === c)?.nome ?? c; }

type Produto = {
	codigo: string;
	canal: string;
	nome: string;
	unidade: string;
	preco_minimo: number;
	preco_tabela: number;
	descricao: string | null;
	padrao_canal: boolean;
	custo_previsto: number | null;
	mc_minimo: number | null;
	rota_completa: boolean;
	problemas: string[] | null;
};

function normalizarProduto(r: Row): Produto {
	return {
		codigo: String(r.codigo ?? ''),
		canal: String(r.canal ?? ''),
		nome: String(r.nome ?? ''),
		unidade: String(r.unidade ?? 'mensagem'),
		preco_minimo: Number(r.preco_minimo ?? 0),
		preco_tabela: Number(r.preco_tabela ?? 0),
		descricao: r.descricao ? String(r.descricao) : null,
		padrao_canal: !!r.padrao_canal,
		custo_previsto: r.custo_previsto == null ? null : Number(r.custo_previsto),
		mc_minimo: r.mc_minimo == null ? null : Number(r.mc_minimo),
		rota_completa: !!r.rota_completa,
		problemas: Array.isArray(r.problemas) ? (r.problemas as string[]) : null,
	};
}

/** Balão "i" com a explicação de MC no mínimo (não há glossário publicado). */
function McInfo() {
	const [open, setOpen] = useState(false);
	return (
		<span className="relative inline-flex align-middle">
			<button type="button" onClick={() => setOpen(o => !o)} aria-label="O que é MC no mínimo" aria-expanded={open} className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full border border-[#D2D2D7] text-[10px] italic leading-none text-[#6E6E73] hover:bg-[#1D1D1F] hover:text-white"><Info size={9} /></button>
			{open && (
				<span role="tooltip" className="absolute left-1/2 top-6 z-[120] w-[260px] -translate-x-1/2 rounded-xl bg-white p-3 text-left text-[12.5px] leading-relaxed text-[#1D1D1F]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 12px 40px -8px rgba(0,0,0,.2)' }}>
					<b>MC no mínimo</b> é a margem de contribuição no preço mínimo: quanto sobra entre o preço mínimo vendido e o custo previsto da rota. Abaixo de 20% o número fica âmbar; abaixo de zero, vermelho.
				</span>
			)}
		</span>
	);
}

export function ConsoleProdutosPage() {
	const { can } = useConsolePerms();
	const podeEditar = can('editar_produtos');
	const [produtos, setProdutos] = useState<Produto[]>([]);
	const [aba, setAba] = useState('sms');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [drawer, setDrawer] = useState<{ produto: Produto | null; novo: boolean } | null>(null);

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const { data, error: e } = await supabase.rpc('produtos_catalogo');
		if (e) { setError(friendlyError(e)); setLoading(false); return; }
		setProdutos(((data ?? []) as Row[]).map(normalizarProduto));
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	const daAba = produtos.filter(p => p.canal === aba);

	return (
		<ConsoleShell>
			{error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			{!podeEditar && (
				<div className="mb-4 flex items-start gap-2.5 rounded-xl bg-[#F5F5F7] px-4 py-3 text-[13px] text-[#6E6E73]">
					<Lock size={15} className="mt-0.5 shrink-0 text-[#8E8E93]" />
					<span>Só quem edita produtos (Master e Administrativo) altera estes preços. Você está vendo em modo leitura.</span>
				</div>
			)}

			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<p className="text-[14px] text-[#6E6E73]">Produto = rota vendida. O preço mínimo e o de tabela guiam a negociação; a rota diz se o produto está pronto para vender.</p>
				{podeEditar && (
					<button onClick={() => setDrawer({ produto: null, novo: true })} className="flex h-9 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-white hover:opacity-90" style={{ backgroundColor: MENSAGEM_COR }}>
						<Plus size={16} /> Novo produto
					</button>
				)}
			</div>

			{/* Abas por canal */}
			<div className="no-scrollbar mb-5 flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#EEEEF0] p-1 sm:w-fit">
				{ABAS.map(a => {
					const n = produtos.filter(p => p.canal === a.id).length;
					return (
						<button key={a.id} onClick={() => setAba(a.id)} className={`flex shrink-0 items-center gap-2 rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors ${aba === a.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.cor }} />
							{a.nome}
							{n > 0 && <span className="text-[11px] text-[#8E8E93] tnum">{n}</span>}
						</button>
					);
				})}
			</div>

			{loading ? (
				<p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
			) : daAba.length === 0 ? (
				<div className="rounded-2xl bg-[#F5F5F7] px-6 py-12 text-center text-[14px] text-[#6E6E73]">Nenhum produto em {canalNome(aba)}.</div>
			) : (
				<section className="rounded-2xl bg-white p-4 sm:p-6" style={{ boxShadow: cardShadow }}>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead>
								<tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
									<th className="pb-3 font-medium">Produto</th>
									<th className="pb-3 text-right font-medium">Mínimo</th>
									<th className="pb-3 text-right font-medium">Tabela</th>
									<th className="pb-3 text-right font-medium">Custo previsto</th>
									<th className="pb-3 text-right font-medium">MC no mínimo <McInfo /></th>
									<th className="pb-3 text-center font-medium">Rota</th>
									<th className="pb-3"></th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{daAba.map(p => {
									const mc = p.mc_minimo;
									const mcCor = mc == null ? '#1D1D1F' : mc < 0 ? '#FF3B30' : mc < 20 ? '#9a631b' : '#1D1D1F';
									return (
										<tr key={p.codigo} className="align-top">
											<td className="py-3">
												<div className="flex items-center gap-2">
													<span className="font-medium text-[#1D1D1F]">{p.nome}</span>
													{p.padrao_canal && <span className="rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[10px] font-semibold text-[#9a631b]">Padrão</span>}
												</div>
												<span className="font-mono text-[11px] text-[#8E8E93]">{p.codigo}</span>
											</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{preco4BR(p.preco_minimo)}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{preco4BR(p.preco_tabela)}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">
												{p.custo_previsto == null
													? <span className="text-[#8E8E93]" title="Monte a rota para ver o custo">—</span>
													: preco4BR(p.custo_previsto)}
											</td>
											<td className="py-3 text-right tnum" style={{ color: mcCor }}>
												{mc == null ? <span className="text-[#8E8E93]">—</span> : <>
													{pct1(mc)}
													{mc < 0 && <span className="ml-1 text-[11px] font-medium">abaixo do custo</span>}
												</>}
											</td>
											<td className="py-3 text-center">
												{p.rota_completa
													? <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">Completa</span>
													: (
														<span className="group relative inline-flex">
															<span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[11px] font-semibold text-[#9a631b]">Incompleta</span>
															{p.problemas && p.problemas.length > 0 && (
																<span className="pointer-events-none absolute right-0 top-7 z-[110] w-[220px] rounded-xl bg-white p-3 text-left text-[12px] leading-relaxed text-[#1D1D1F] opacity-0 transition-opacity duration-150 group-hover:opacity-100" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 12px 40px -8px rgba(0,0,0,.2)' }}>
																	<b className="block mb-1 text-[12px]">Falta na rota:</b>
																	{p.problemas.map((pr, i) => <span key={i} className="block text-[#6E6E73]">· {pr}</span>)}
																</span>
															)}
														</span>
													)}
											</td>
											<td className="py-3 text-right">
												{podeEditar && (
													<button onClick={() => setDrawer({ produto: p, novo: false })} className="flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Pencil size={13} /> Editar</button>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					<p className="mt-3 text-[12px] text-[#8E8E93]">Valores em R$ com 4 casas. MC no mínimo abaixo de 20% fica âmbar; abaixo de zero, vermelho.</p>
				</section>
			)}

			<ScorePrecos podeEditar={podeEditar} />

			{drawer && <ProdutoDrawer produto={drawer.produto} novo={drawer.novo} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); void reload(); }} />}
		</ConsoleShell>
	);
}

function ProdutoDrawer({ produto, novo, onClose, onSaved }: { produto: Produto | null; novo: boolean; onClose: () => void; onSaved: () => void }) {
	const [canal, setCanal] = useState(produto?.canal ?? 'sms');
	const [codigo, setCodigo] = useState(produto?.codigo ?? CANAL_PREFIXO['sms']);
	const [nome, setNome] = useState(produto?.nome ?? '');
	const [unidade, setUnidade] = useState(produto?.unidade ?? 'mensagem');
	const [precoMinimo, setPrecoMinimo] = useState(produto ? String(produto.preco_minimo ?? '') : '');
	const [precoTabela, setPrecoTabela] = useState(produto ? String(produto.preco_tabela ?? '') : '');
	const [descricao, setDescricao] = useState(produto?.descricao ?? '');
	const [padrao, setPadrao] = useState(!!produto?.padrao_canal);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [salvo, setSalvo] = useState(false);

	useEffect(() => {
		const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);

	// No modo novo, ao trocar o canal, reinicia o código com o prefixo do canal.
	function trocarCanal(c: string) {
		setCanal(c);
		if (novo) setCodigo(CANAL_PREFIXO[c] ?? '');
	}

	const minNum = parseNum(precoMinimo);
	const tabNum = parseNum(precoTabela);
	const codigoValido = /^[a-z0-9_]+$/.test(codigo) && codigo.length > (CANAL_PREFIXO[canal] ?? '').length;
	const minOk = minNum > 0;
	const tabOk = tabNum >= minNum && minOk;
	const podeSalvar = codigoValido && nome.trim().length >= 2 && minOk && tabOk && !busy;

	async function salvar() {
		if (!supabase) return;
		setError('');
		if (!nome.trim() || nome.trim().length < 2) { setError('Informe o nome (2+ letras).'); return; }
		if (!codigoValido) { setError('Código: só letras minúsculas, números e _.'); return; }
		if (!minOk) { setError('Preço mínimo tem que ser maior que zero.'); return; }
		if (!tabOk) { setError('Preço de tabela tem que ser maior ou igual ao mínimo.'); return; }
		setBusy(true);
		const { error: e } = await supabase.rpc('salvar_produto', {
			codigo, canal, nome: nome.trim(), unidade,
			preco_minimo: minNum, preco_tabela: tabNum,
			descricao: descricao.trim() || null, padrao_canal: padrao,
		});
		setBusy(false);
		if (e) { setError(friendlyError(e)); return; }
		setSalvo(true);
	}

	return (
		<div className="fixed inset-0 z-[100] flex justify-end bg-black/40" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="flex h-full w-full max-w-[440px] flex-col bg-white" style={{ boxShadow: '-12px 0 40px -8px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
				<div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#E5E5EA] px-5">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{novo ? 'Novo produto' : 'Editar produto'}</h2>
					<button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
				</div>

				{salvo ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
						<div className="grid h-14 w-14 place-items-center rounded-full" style={{ backgroundColor: '#E8F8EC' }}><RouteIcon size={26} className="text-[#248A3D]" /></div>
						<div>
							<p className="text-[16px] font-semibold text-[#1D1D1F]">Produto salvo</p>
							<p className="mt-1 text-[14px] text-[#6E6E73]">Agora monte a rota de fornecedores para este produto.</p>
						</div>
						<Link to={`/console/fornecedores?produto=${encodeURIComponent(codigo)}`} onClick={onSaved} className="flex h-10 items-center gap-2 rounded-full px-6 text-[14px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: MENSAGEM_COR }}>
							<RouteIcon size={16} /> Montar a rota
						</Link>
						<button onClick={onSaved} className="text-[13px] font-medium text-[#6E6E73] hover:text-[#1D1D1F]">Fechar</button>
					</div>
				) : (
					<>
						<div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Canal</span>
								<select value={canal} disabled={!novo} onChange={e => trocarCanal(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]">
									{ABAS.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
								</select>
								{!novo && <p className="mt-1 text-[12px] text-[#8E8E93]">Depois de criado, o canal não muda.</p>}
							</label>

							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Código</span>
								<input value={codigo} disabled={!novo} onChange={e => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); setCodigo(v); }} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 font-mono text-[14px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]" />
								<p className="mt-1 text-[12px] text-[#8E8E93]">Prefixo do canal já vem escrito. Só letras minúsculas, números e _.</p>
							</label>

							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome *</span>
								<input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
							</label>

							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Unidade</span>
								<select value={unidade} onChange={e => setUnidade(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
									{UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
								</select>
							</label>

							<div className="grid grid-cols-2 gap-3">
								<label className="block">
									<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Preço mínimo (R$) *</span>
									<input value={precoMinimo} onChange={e => setPrecoMinimo(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" placeholder="0,0000" />
								</label>
								<label className="block">
									<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Preço de tabela (R$) *</span>
									<input value={precoTabela} onChange={e => setPrecoTabela(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" placeholder="0,0000" />
								</label>
							</div>
							{minOk && tabNum < minNum && <p className="text-[12px] text-[#FF3B30]">Tabela tem que ser maior ou igual ao mínimo.</p>}

							<label className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Descrição</span>
								<textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" />
							</label>

							<Chave
								label={<span className="text-[15px] font-medium text-[#1D1D1F]">Padrão do canal</span>}
								desc="Produto usado quando a ação não escolhe um."
								checked={padrao}
								on={setPadrao}
							/>
						</div>

						{error && <p role="alert" className="px-5 pb-2 text-[14px] text-[#FF3B30]">{error}</p>}
						<div className="flex shrink-0 justify-end gap-3 border-t border-[#E5E5EA] px-5 py-4">
							<button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
							<button onClick={salvar} disabled={!podeSalvar} className="h-10 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar'}</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
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

// ---------- Score de Entrega (mínimo e tabela dos dois itens) ----------

const SCORE_ITENS_PRECOS = [
	{ codigo: 'score_analisado', nome: 'Por número analisado', desc: 'Cobre toda a lista enviada ao filtro.' },
	{ codigo: 'score_represado', nome: 'Só pelos represados', desc: 'Cobra só os números que o filtro segurou.' },
];

function ScorePrecos({ podeEditar }: { podeEditar: boolean }) {
	const [itens, setItens] = useState<Record<string, { min: string; tab: string }>>({});
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState<string | null>(null);

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const { data, error: e } = await supabase.from('cobranca_itens').select('*').in('codigo', ['score_analisado', 'score_represado']);
		if (e) { setError(friendlyError(e)); setLoading(false); return; }
		const map: Record<string, { min: string; tab: string }> = {};
		((data ?? []) as Row[]).forEach(r => {
			const c = String(r.codigo ?? '');
			map[c] = { min: r.preco_minimo != null ? String(r.preco_minimo) : '', tab: r.preco_tabela != null ? String(r.preco_tabela) : '' };
		});
		setItens(map);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	async function salvar(codigo: string) {
		if (!supabase) return;
		const ed = itens[codigo];
		if (!ed) return;
		const min = parseNum(ed.min);
		const tab = parseNum(ed.tab);
		setError(''); setSuccess(null);
		if (min <= 0) { setError('O preço mínimo tem que ser maior que zero.'); return; }
		if (tab < min) { setError('O preço de tabela tem que ser maior ou igual ao mínimo.'); return; }
		setBusy(codigo);
		const { error: e } = await supabase.rpc('salvar_preco_score', { item: codigo, preco_minimo: min, preco_tabela: tab });
		setBusy(null);
		if (e) { setError(friendlyError(e)); return; }
		setSuccess(codigo);
	}

	return (
		<section className="rounded-2xl bg-white p-4 sm:p-6" style={{ boxShadow: cardShadow }}>
			<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Score de Entrega</h2>
			<p className="mb-4 text-[13px] text-[#6E6E73]">Preço mínimo e de tabela dos dois itens de Score. O SMS segue com o preço padrão do contrato; o Score é cobrado à parte.</p>
			{loading ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
				<div className="space-y-4">
					{SCORE_ITENS_PRECOS.map(s => {
						const ed = itens[s.codigo] ?? { min: '', tab: '' };
						const minNum = parseNum(ed.min);
						const tabNum = parseNum(ed.tab);
						const tabOk = tabNum >= minNum && minNum > 0;
						return (
							<div key={s.codigo} className="rounded-xl border border-[#F0F0F2] p-4">
								<p className="text-[15px] font-medium text-[#1D1D1F]">{s.nome}</p>
								<p className="mt-0.5 text-[12px] text-[#6E6E73]">{s.desc}</p>
								<div className="mt-3 flex flex-wrap items-end gap-3">
									<label className="block">
										<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Mínimo (R$)</span>
										<input value={ed.min} onChange={e => setItens(prev => ({ ...prev, [s.codigo]: { ...prev[s.codigo], min: e.target.value } }))} disabled={!podeEditar} inputMode="decimal" className="h-9 w-[140px] rounded-lg border border-[#D2D2D7] px-3 text-[14px] tnum outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7] disabled:text-[#8E8E93]" placeholder="0,0000" />
									</label>
									<label className="block">
										<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Tabela (R$)</span>
										<input value={ed.tab} onChange={e => setItens(prev => ({ ...prev, [s.codigo]: { ...prev[s.codigo], tab: e.target.value } }))} disabled={!podeEditar} inputMode="decimal" className={`h-9 w-[140px] rounded-lg border px-3 text-[14px] tnum outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7] disabled:text-[#8E8E93] ${!tabOk ? 'border-[#FF3B30]' : 'border-[#D2D2D7]'}`} placeholder="0,0000" />
									</label>
									{podeEditar && (
										<button onClick={() => salvar(s.codigo)} disabled={busy === s.codigo || !tabOk} className="h-9 rounded-lg px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy === s.codigo ? 'Salvando...' : 'Salvar'}</button>
									)}
									{success === s.codigo && <span className="text-[12px] text-[#248A3D]">Salvo.</span>}
								</div>
							</div>
						);
					})}
				</div>
			)}
			{error && <p role="alert" className="mt-3 text-[13px] text-[#FF3B30]">{error}</p>}
		</section>
	);
}
