import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Pencil, Copy, Trash2, Plus, Lock, Search, Star, Mail, FileText } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import {
	PRODUTO_REL_LABEL,
	envioDescricao,
	type ProdutoRelatorio,
	type RelatorioBase,
	type RelatorioCampo,
	type ModeloRelatorio,
	type EnvioRelatorio,
} from '@/lib/relatorios';
import { RelatorioAberto } from '@/components/relatorios/relatorio-aberto';
import { MontarRelatorio } from '@/components/relatorios/montar-relatorio';
import { MeusArquivos } from '@/components/relatorios/meus-arquivos';

export function RelatoriosLista() {
	const { empresa, perfil } = useMotorAuth();
	const [params, setParams] = useSearchParams();
	const [modulos, setModulos] = useState({ mensageria: false, orquestracao: false, jornada: false });
	const [produto, setProduto] = useState<ProdutoRelatorio>('mensageria');
	const [bases, setBases] = useState<RelatorioBase[]>([]);
	const [camposByBase, setCamposByBase] = useState<Record<string, RelatorioCampo[]>>({});
	const [padrao, setPadrao] = useState<ModeloRelatorio[]>([]);
	const [daEmpresa, setDaEmpresa] = useState<ModeloRelatorio[]>([]);
	const [envios, setEnvios] = useState<Record<string, EnvioRelatorio>>({});
	const [criadores, setCriadores] = useState<Record<string, string>>({});
	const [scoreAtivo, setScoreAtivo] = useState(false);
	const [busca, setBusca] = useState('');
	const [abaEmpresa, setAbaEmpresa] = useState<'todos' | 'meus'>('todos');
	const [aberto, setAberto] = useState<ModeloRelatorio | null>(null);
	const [montar, setMontar] = useState(false);
	const [verArquivos, setVerArquivos] = useState(false);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	// Query params: ?produto= e ?exportacao=
	useEffect(() => {
		const exp = params.get('exportacao');
		if (exp) setVerArquivos(true);
	}, [params]);

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true);
		setErro('');
		// Módulos contratados.
		const { data: mods } = await supabase.from('empresa_modulos').select('modulo,ativo').eq('empresa_id', empresa.id);
		const m: Record<string, boolean> = {};
		(mods ?? []).forEach((r: Row) => { m[r.modulo] = !!r.ativo; });
		const mod = {
			mensageria: !!m.mensageria,
			orquestracao: !!(m.orquestracao || m.cobranca),
			jornada: !!m.jornada,
		};
		setModulos(mod);

		// Score ativo.
		const { data: sc } = await supabase.from('empresa_score').select('ativo').eq('empresa_id', empresa.id).maybeSingle();
		setScoreAtivo(!!(sc as Row | null)?.ativo);

		// Bases visíveis.
		const { data: bs } = await supabase.from('relatorio_bases').select('*').eq('visivel', true).order('ordem');
		const basesList = (bs ?? []) as RelatorioBase[];
		setBases(basesList);

		// Campos por base.
		const { data: cs } = await supabase.from('relatorio_campos').select('*').order('ordem');
		const map: Record<string, RelatorioCampo[]> = {};
		(cs ?? []).forEach((c: Row) => { (map[c.base] ??= []).push(c as RelatorioCampo); });
		setCamposByBase(map);

		// Modelos prontos (empresa_id nulo).
		const { data: pr } = await supabase.from('relatorios_modelos').select('*').is('empresa_id', null).order('categoria').order('nome');
		setPadrao((pr ?? []) as ModeloRelatorio[]);

		// Modelos da empresa.
		const { data: em } = await supabase.from('relatorios_modelos').select('*').eq('empresa_id', empresa.id).order('nome');
		const emList = (em ?? []) as ModeloRelatorio[];
		setDaEmpresa(emList);

		// Envios por e-mail.
		if (emList.length) {
			const { data: evs } = await supabase.from('relatorio_envios').select('*').in('modelo', emList.map(m => m.id));
			const evMap: Record<string, EnvioRelatorio> = {};
			(evs ?? []).forEach((e: Row) => { evMap[e.modelo] = e as EnvioRelatorio; });
			setEnvios(evMap);
			// Nomes dos criadores.
			const uids = [...new Set(emList.map(m => m.criado_por).filter(Boolean))] as string[];
			if (uids.length) {
				const { data: us } = await supabase.from('perfis').select('id,nome').in('id', uids);
				const uMap: Record<string, string> = {};
				(us ?? []).forEach((u: Row) => { uMap[u.id] = u.nome; });
				setCriadores(uMap);
			}
		} else {
			setEnvios({});
			setCriadores({});
		}
		setLoading(false);
	}
	useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [empresa?.id]);

	// Produto ativo pela query ou padrão.
	useEffect(() => {
		const q = params.get('produto') as ProdutoRelatorio | null;
		if (q && modulos[q]) { setProduto(q); return; }
		if (modulos.mensageria) setProduto('mensageria');
		else if (modulos.orquestracao) setProduto('orquestracao');
		else if (modulos.jornada) setProduto('jornada');
	}, [params, modulos]);

	const basesProduto = useMemo(() => bases.filter(b => b.produto === produto), [bases, produto]);
	const basesIds = useMemo(() => new Set(basesProduto.map(b => b.id)), [basesProduto]);

	const padraoFiltrado = useMemo(() => {
		const list = padrao.filter(m => basesIds.has(m.base));
		const q = busca.trim().toLowerCase();
		if (!q) return list;
		return list.filter(m => (m.nome ?? '').toLowerCase().includes(q) || (m.descricao ?? '').toLowerCase().includes(q));
	}, [padrao, basesIds, busca]);

	const categorias = useMemo(() => {
		const map: Record<string, ModeloRelatorio[]> = {};
		padraoFiltrado.forEach(m => { const c = m.categoria ?? 'Outros'; (map[c] ??= []).push(m); });
		return map;
	}, [padraoFiltrado]);

	const daEmpresaFiltrada = useMemo(() => {
		const list = daEmpresa.filter(m => basesIds.has(m.base));
		if (abaEmpresa === 'meus') return list.filter(m => m.criado_por === perfil?.id);
		return list;
	}, [daEmpresa, basesIds, abaEmpresa, perfil?.id]);

	function trocarProduto(p: ProdutoRelatorio) {
		setProduto(p);
		const next = new URLSearchParams(params);
		next.set('produto', p);
		setParams(next, { replace: true });
	}

	function sobreModelo(m: ModeloRelatorio): string {
		const base = bases.find(b => b.id === m.base);
		const partes: string[] = [];
		if (base) partes.push(base.nome);
		const campos = camposByBase[m.base] ?? [];
		const seps = (m.agrupar ?? []).map(a => campos.find(c => c.nome === a)?.rotulo ?? a);
		if (seps.length) partes.push(seps.join(' · '));
		return partes.join(' · ');
	}

	async function apagar(m: ModeloRelatorio) {
		if (!supabase) return;
		if (!confirm('Apagar este relatório? O envio por e-mail também para.')) return;
		const { error } = await supabase.from('relatorios_modelos').delete().eq('id', m.id);
		if (error) { setErro(friendlyError(error)); return; }
		void reload();
	}

	async function duplicar(m: ModeloRelatorio) {
		if (!supabase || !empresa) return;
		const { error } = await supabase.from('relatorios_modelos').insert({
			empresa_id: empresa.id, criado_por: perfil?.id, nome: `${m.nome} (cópia)`, descricao: m.descricao,
			categoria: m.categoria, base: m.base, colunas: m.colunas, agrupar: m.agrupar, metricas: m.metricas, ordem: m.ordem,
		});
		if (error) { setErro(friendlyError(error)); return; }
		void reload();
	}

	const podeGerenciar = (m: ModeloRelatorio) => m.criado_por === perfil?.id || perfil?.papel === 'admin';

	if (loading) return <div className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando relatórios…</div>;

	if (verArquivos) return <MeusArquivos onBack={() => { setVerArquivos(false); const n = new URLSearchParams(params); n.delete('exportacao'); setParams(n, { replace: true }); }} />;

	if (aberto) return <RelatorioAberto modelo={aberto} bases={bases} camposByBase={camposByBase} onBack={() => setAberto(null)} onSaved={reload} />;

	if (montar) return <MontarRelatorio bases={basesProduto} camposByBase={camposByBase} onBack={() => setMontar(false)} onSaved={m => { setMontar(false); void reload(); setAberto(m); }} />;

	const produtosDisponiveis = (['mensageria', 'orquestracao', 'jornada'] as ProdutoRelatorio[]).filter(p => modulos[p]);

	return (
		<div className="mx-auto max-w-[1080px]">
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-[28px] font-bold tracking-tight text-[#1D1D1F]">Relatórios</h1>
					<p className="mt-1 text-[14px] text-[#6E6E73]">Prontos para usar ou montados para a sua empresa.</p>
				</div>
				<div className="flex items-center gap-2">
					<button onClick={() => setVerArquivos(true)} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Download size={15} /> Meus arquivos</button>
					<button onClick={() => setMontar(true)} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-semibold text-white hover:opacity-85"><Plus size={15} /> Montar relatório</button>
				</div>
			</div>

			{erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{/* Abas por produto */}
			{produtosDisponiveis.length > 1 && (
				<div className="no-scrollbar mb-5 flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1">
					{produtosDisponiveis.map(p => (
						<button key={p} onClick={() => trocarProduto(p)} className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[14px] font-medium ${produto === p ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{PRODUTO_REL_LABEL[p]}</button>
					))}
				</div>
			)}

			{/* Busca */}
			<div className="relative mb-6">
				<Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
				<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar relatório pelo nome ou pela descrição" className="h-10 w-full rounded-xl bg-[#F5F5F7] pl-10 pr-4 text-[14px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-[#D2D2D7]" />
			</div>

			{/* Prontos */}
			{Object.keys(categorias).length > 0 && (
				<div className="mb-8">
					<h2 className="mb-3 text-[15px] font-semibold text-[#6E6E73]">Prontos</h2>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{Object.entries(categorias).map(([cat, modelos]) => modelos.map(m => {
							const bloqueado = m.requer === 'score' && !scoreAtivo;
							return (
								<button key={m.id} onClick={() => bloqueado ? null : setAberto(m)} disabled={bloqueado} className={`relative rounded-2xl bg-white p-5 text-left transition ${bloqueado ? 'cursor-not-allowed opacity-70' : 'hover:-translate-y-0.5'}`} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
									{m.destaque && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[11px] font-semibold text-[#9a631b]"><Star size={10} /> Mais usado</span>}
									<p className="pr-16 text-[15px] font-semibold text-[#1D1D1F]">{m.nome}</p>
									<p className="mt-1 text-[13px] text-[#6E6E73]">{m.descricao ?? '—'}</p>
									{bloqueado && <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> Disponível com o Score de Entrega</p>}
								</button>
							);
						}))}
					</div>
				</div>
			)}

			{/* Da empresa */}
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-[15px] font-semibold text-[#6E6E73]">Da empresa</h2>
				{daEmpresa.filter(m => basesIds.has(m.base)).length > 0 && (
					<div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
						<button onClick={() => setAbaEmpresa('todos')} className={`rounded-[7px] px-3 py-1 text-[13px] font-medium ${abaEmpresa === 'todos' ? 'bg-white text-[#1D1D1F] font-semibold shadow' : 'text-[#1D1D1F]'}`}>Todos</button>
						<button onClick={() => setAbaEmpresa('meus')} className={`rounded-[7px] px-3 py-1 text-[13px] font-medium ${abaEmpresa === 'meus' ? 'bg-white text-[#1D1D1F] font-semibold shadow' : 'text-[#1D1D1F]'}`}>Meus</button>
					</div>
				)}
			</div>

			{daEmpresaFiltrada.length === 0 ? (
				<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					Nenhum relatório da empresa ainda. Monte um com “Montar relatório”.
				</div>
			) : (
				<div className="overflow-x-auto rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<table className="w-full border-collapse text-[14px]">
						<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
							<th className="px-5 py-3">Nome</th><th className="px-5 py-3">Sobre</th><th className="px-5 py-3">Criado por</th><th className="px-5 py-3">Envio por e-mail</th><th className="px-5 py-3 text-right">Ações</th>
						</tr></thead>
						<tbody>
							{daEmpresaFiltrada.map(m => {
								const ev = envios[m.id];
								const criador = m.criado_por === perfil?.id ? 'Você' : (criadores[m.criado_por ?? ''] ?? '—');
								const gerencia = podeGerenciar(m);
								return (
									<tr key={m.id} className="border-b border-[#F0F0F2]">
										<td className="px-5 py-3"><button onClick={() => setAberto(m)} className="font-medium text-[#0A60D0] hover:underline">{m.nome}</button></td>
										<td className="px-5 py-3 text-[#6E6E73]">{sobreModelo(m)}</td>
										<td className="px-5 py-3 text-[#6E6E73]">{criador}</td>
										<td className="px-5 py-3">
											{ev ? (
												<span className="inline-flex items-center gap-1.5 text-[13px] text-[#1D1D1F]"><Mail size={13} className="text-[#8E8E93]" /> {envioDescricao(ev)}</span>
											) : <span className="text-[13px] text-[#8E8E93]">Não</span>}
											{ev?.ultimo_erro && <p className="mt-0.5 text-[11px] text-[#9a631b]">{ev.ultimo_erro}</p>}
										</td>
										<td className="px-5 py-3"><div className="flex justify-end gap-1">
											<button onClick={() => setAberto(m)} title="Abrir" className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><FileText size={15} /></button>
											{gerencia ? (
												<>
													<button onClick={() => setAberto(m)} title="Editar" className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><Pencil size={15} /></button>
													<button onClick={() => apagar(m)} title="Apagar" className="grid h-8 w-8 place-items-center rounded-lg text-[#FF3B30] hover:bg-[#FFE8E6]"><Trash2 size={15} /></button>
												</>
											) : (
												<button onClick={() => duplicar(m)} title="Duplicar" className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><Copy size={15} /></button>
											)}
										</div></td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			<p className="mt-8 text-center text-[12px] text-[#8E8E93]">Os relatórios não mostram telefone, e-mail, nome nem CPF: só o ID do cliente e o destino mascarado.</p>
		</div>
	);
}
