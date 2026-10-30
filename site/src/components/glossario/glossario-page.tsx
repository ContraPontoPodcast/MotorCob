import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { BookOpen, Pencil, Plus, Search, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase } from '@/lib/supabase';
import { buscarGlossario, parseAntes, slugValido, type GlossarioTerm } from '@/lib/glossario';
import { useGlossario } from '@/components/glossario/glossario-provider';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

export function GlossarioPage() {
	const { perfil } = useMotorAuth();
	const canEdit = !!perfil?.equipe && perfil?.papel === 'admin';
	const { terms, reload } = useGlossario();
	const location = useLocation();

	const [query, setQuery] = useState('');
	const [debounced, setDebounced] = useState('');
	const [results, setResults] = useState<GlossarioTerm[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [grupo, setGrupo] = useState<string | null>(null);
	const [editing, setEditing] = useState<GlossarioTerm | null>(null);
	const [creating, setCreating] = useState(false);
	const [highlight, setHighlight] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Debounce de 300 ms na busca.
	useEffect(() => {
		const t = window.setTimeout(() => setDebounced(query.trim()), 300);
		return () => window.clearTimeout(t);
	}, [query]);

	// Busca via rpc buscar_glossario(texto). Texto vazio = todos (usa o cache do provider).
	useEffect(() => {
		if (debounced === '') {
			setResults(null);
			setSearching(false);
			return;
		}
		let active = true;
		setSearching(true);
		buscarGlossario(debounced)
			.then((r) => {
				if (active) setResults(r);
			})
			.catch(() => {
				if (active) setResults([]);
			})
			.finally(() => {
				if (active) setSearching(false);
			});
		return () => {
			active = false;
		};
	}, [debounced]);

	// Grupos distintos, na ordem do menor "ordem" de cada grupo.
	const grupos = useMemo(() => {
		const minOrdem = new Map<string, number>();
		for (const t of terms) {
			const cur = minOrdem.get(t.grupo);
			if (cur === undefined || t.ordem < cur) minOrdem.set(t.grupo, t.ordem);
		}
		return [...minOrdem.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g);
	}, [terms]);

	const lista = useMemo(() => {
		const base = results ?? terms;
		return grupo ? base.filter((t) => t.grupo === grupo) : base;
	}, [results, terms, grupo]);

	// #slug na URL → rola até o cartão e destaca a borda por 2 s.
	useEffect(() => {
		if (terms.length === 0) return;
		const hash = location.hash.replace(/^#/, '');
		if (!hash) return;
		const el = document.getElementById(hash);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			setHighlight(hash);
			const t = window.setTimeout(() => setHighlight(null), 2000);
			return () => window.clearTimeout(t);
		}
	}, [location.hash, terms.length]);

	return (
		<div className="mx-auto max-w-[960px] px-4 py-8">
			<div className="mb-6">
				<h1 className="text-[28px] font-bold tracking-tight text-[#1D1D1F]">O que significa</h1>
				<p className="mt-1 text-[15px] text-[#6E6E73]">Um nome para cada coisa. Procure pelo nome de hoje ou por um nome antigo.</p>
			</div>

			<div className="mb-5 flex flex-wrap items-center gap-3">
				<div className="relative min-w-[260px] flex-1">
					<Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Buscar um termo ou um nome antigo"
						className="h-12 w-full rounded-2xl bg-white pl-11 pr-10 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/30"
						style={{ boxShadow: cardShadow }}
					/>
					{query && (
						<button onClick={() => setQuery('')} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1D1D1F]"><X size={16} /></button>
					)}
				</div>
				{canEdit && (
					<button onClick={() => setCreating(true)} className="flex h-12 items-center gap-2 rounded-2xl bg-[#1D1D1F] px-5 text-[14px] font-semibold text-white hover:opacity-85">
						<Plus size={16} /> Novo termo
					</button>
				)}
			</div>

			{/* Pílulas de grupo (lidas dos dados) */}
			<div className="no-scrollbar mb-6 flex items-center gap-2 overflow-x-auto pb-1">
				<Pill ativo={grupo === null} onClick={() => setGrupo(null)}>Todos</Pill>
				{grupos.map((g) => (
					<Pill key={g} ativo={grupo === g} onClick={() => setGrupo(g)}>{g}</Pill>
				))}
			</div>

			{searching ? (
				<p className="py-10 text-center text-[14px] text-[#8E8E93]">Buscando...</p>
			) : lista.length === 0 ? (
				<div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: cardShadow }}>
					<BookOpen className="mx-auto mb-3 text-[#8E8E93]" size={28} />
					<p className="text-[14px] text-[#6E6E73]">Nenhum termo encontrado. Tente outra palavra ou fale com o suporte.</p>
					<Link to="/suporte/novo" className="mt-3 inline-flex h-9 items-center rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Falar com o suporte</Link>
				</div>
			) : (
				<div ref={listRef} className="grid gap-4 sm:grid-cols-2">
					{lista.map((t) => (
						<TermoCard key={t.slug} term={t} canEdit={canEdit} destaque={highlight === t.slug} onEdit={() => setEditing(t)} />
					))}
				</div>
			)}

			{editing && <TermoModal term={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
			{creating && <TermoModal term={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void reload(); }} />}
		</div>
	);
}

function Pill({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			onClick={onClick}
			className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${ativo ? 'border-[#1D1D1F] bg-[#1D1D1F] text-white' : 'border-[#E5E5EA] bg-white text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}
		>
			{children}
		</button>
	);
}

function TermoCard({ term, canEdit, destaque, onEdit }: { term: GlossarioTerm; canEdit: boolean; destaque: boolean; onEdit: () => void }) {
	const antes = parseAntes(term.antes);
	return (
		<article
			id={term.slug}
			className="scroll-mt-24 rounded-2xl bg-white p-5 transition-shadow"
			style={{ boxShadow: cardShadow, ...(destaque ? { boxShadow: '0 0 0 2px var(--destaque), 0 2px 12px rgba(0,0,0,.04)' } : {}) }}
		>
			<div className="mb-2 flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h2 className="text-[16px] font-bold text-[#1D1D1F]">{term.termo}</h2>
					<span className="mt-1 inline-block rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-semibold text-[#6E6E73]">{term.grupo}</span>
				</div>
				{canEdit && (
					<button onClick={onEdit} aria-label={`Editar ${term.termo}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#1D1D1F]"><Pencil size={15} /></button>
				)}
			</div>
			<p className="text-[14px] leading-relaxed text-[#1D1D1F]">{term.definicao}</p>
			{term.exemplo && <p className="mt-2 text-[13px] leading-relaxed text-[#6E6E73]">{term.exemplo}</p>}
			{antes.length > 0 && (
				<p className="mt-2 text-[12px] text-[#8E8E93]">
					Antes:{' '}
					{antes.map((a, i) => (
						<span key={i}>
							{i > 0 ? ', ' : ''}
							<del>{a}</del>
						</span>
					))}
				</p>
			)}
		</article>
	);
}

function TermoModal({ term, onClose, onSaved }: { term: GlossarioTerm | null; onClose: () => void; onSaved: () => void }) {
	const { terms } = useGlossario();
	const gruposExistentes = useMemo(() => [...new Set(terms.map((t) => t.grupo))].sort(), [terms]);
	const [slug, setSlug] = useState(term?.slug ?? '');
	const [termo, setTermo] = useState(term?.termo ?? '');
	const [grupo, setGrupo] = useState(term?.grupo ?? '');
	const [novoGrupo, setNovoGrupo] = useState('');
	const [definicao, setDefinicao] = useState(term?.definicao ?? '');
	const [exemplo, setExemplo] = useState(term?.exemplo ?? '');
	const [antes, setAntes] = useState(term?.antes ?? '');
	const [ordem, setOrdem] = useState(String(term?.ordem ?? ''));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const grupoFinal = grupo === '__novo' ? novoGrupo.trim() : grupo;

	async function salvar() {
		if (!supabase) return;
		setError('');
		if (!termo.trim()) {
			setError('O termo é obrigatório.');
			return;
		}
		if (!term) {
			if (!slugValido(slug)) {
				setError('O endereço (slug) usa só letras minúsculas, números e hífens (ex.: score-de-entrega).');
				return;
			}
		}
		if (!grupoFinal) {
			setError('Escolha ou crie um grupo.');
			return;
		}
		if (definicao.length > 600) {
			setError('A definição tem no máximo 600 caracteres.');
			return;
		}
		if (termo.length > 80) {
			setError('O termo tem no máximo 80 caracteres.');
			return;
		}
		setBusy(true);
		const payload = {
			termo: termo.trim(),
			grupo: grupoFinal,
			definicao: definicao.trim(),
			exemplo: exemplo.trim() || null,
			antes: antes.trim() || null,
			ordem: ordem ? Number(ordem) : 0,
		};
		let res;
		if (term) {
			res = await supabase.from('glossario').update(payload).eq('slug', term.slug);
		} else {
			res = await supabase.from('glossario').insert({ slug: slug.trim(), ...payload });
		}
		setBusy(false);
		if (res.error) {
			const code = (res.error as { code?: string }).code;
			if (code === '23505') setError('Já existe um termo com esse nome ou endereço.');
			else if (code === '42501') setError('Só o admin da equipe edita o glossário.');
			else setError(friendlyError(res.error));
			return;
		}
		onSaved();
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="my-auto w-full max-w-[560px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={(e) => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between">
					<h2 className="text-[18px] font-semibold text-[#1D1D1F]">{term ? 'Editar termo' : 'Novo termo'}</h2>
					<button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
				</div>
				<div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
					{!term && (
						<label className="block">
							<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Endereço (slug) <span className="text-[#FF3B30]">*</span></span>
							<input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ex.: score-de-entrega" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
							<span className="mt-1 block text-[11px] text-[#8E8E93]">Só letras minúsculas, números e hífens. Não muda depois de criado.</span>
						</label>
					)}
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Termo <span className="text-[#FF3B30]">*</span></span>
						<input value={termo} maxLength={80} onChange={(e) => setTermo(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
					</label>
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Grupo</span>
						<select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
							<option value="">—</option>
							{gruposExistentes.map((g) => <option key={g} value={g}>{g}</option>)}
							<option value="__novo">+ Novo grupo...</option>
						</select>
					</label>
					{grupo === '__novo' && (
						<label className="block">
							<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome do novo grupo</span>
							<input value={novoGrupo} onChange={(e) => setNovoGrupo(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
						</label>
					)}
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Definição <span className="text-[#FF3B30]">*</span></span>
						<textarea value={definicao} maxLength={600} onChange={(e) => setDefinicao(e.target.value)} rows={4} className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
						<span className="mt-1 block text-[11px] text-[#8E8E93]">{definicao.length}/600</span>
					</label>
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Exemplo</span>
						<textarea value={exemplo} onChange={(e) => setExemplo(e.target.value)} rows={2} className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
					</label>
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Antes (nomes antigos, separados por vírgula)</span>
						<input value={antes} onChange={(e) => setAntes(e.target.value)} placeholder="3C, Contato · Canal · Mensagem" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
					</label>
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Ordem</span>
						<input type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} className="h-10 w-24 rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
					</label>
				</div>
				{error && <p role="alert" className="mt-4 text-[14px] text-[#FF3B30]">{error}</p>}
				<div className="mt-5 flex justify-end gap-3">
					<button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
					<button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button>
				</div>
			</div>
		</div>
	);
}
