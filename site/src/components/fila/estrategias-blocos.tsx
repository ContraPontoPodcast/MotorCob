import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, Download, ChevronDown } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { channels, logAccess, numberBR, signedDownload, slugify, supabase } from '@/lib/supabase';

export type EstagioIndice = {
	estagio: string;
	rotulo: string;
	pasta: string;
	clientes: number;
	canais: Record<string, number>;
	reserva?: Record<string, number>;
	passos?: Record<string, number>;
};

export type EstrategiaIndice = {
	pasta: string;
	estrategia: string;
	estrategia_id: number;
	clientes: number;
	canais: Record<string, number>;
	reserva?: Record<string, number>;
	estagios?: EstagioIndice[];
};

/** Ordem canônica dos estágios. */
const STAGE_ORDER = ['localizacao', 'cpa', 'cpb', 'giro', 'preventivo', 'quebra'];
const STAGE_LABEL: Record<string, string> = {
	localizacao: 'Cliente novo',
	cpa: 'CPC A',
	cpb: 'CPC B',
	giro: 'Não CPC',
	preventivo: 'Acordo · preventivo',
	quebra: 'Acordo · quebra',
};
const stageLabel = (e: EstagioIndice) => e.rotulo?.trim() || STAGE_LABEL[e.estagio] || e.estagio;
const stageSort = (a: EstagioIndice, b: EstagioIndice) => STAGE_ORDER.indexOf(a.estagio) - STAGE_ORDER.indexOf(b.estagio);

const canalNome = (id: string) => channels.find(c => c.id === id)?.name ?? id;
const canalCode = (id: string) => channels.find(c => c.id === id)?.code ?? id.slice(0, 2).toUpperCase();

/** Tenta ler o indice.json de estratégias do dia/credor. Retorna null se não existir (lista antiga). */
async function fetchIndice(slug: string, date: string, codigo: string): Promise<EstrategiaIndice[] | null> {
	if (!supabase) return null;
	const path = `${slug}/${date}/${codigo}/ids/estrategias/indice.json`;
	const { data, error } = await supabase.storage.from('saidas').createSignedUrl(path, 60);
	if (error || !data?.signedUrl) return null;
	try {
		const response = await fetch(data.signedUrl);
		if (!response.ok) return null;
		const text = await response.text();
		const parsed = JSON.parse(text);
		if (!Array.isArray(parsed)) return null;
		return parsed as EstrategiaIndice[];
	} catch {
		return null;
	}
}

async function baixarArquivo(path: string, empresaId: string): Promise<Uint8Array | null> {
	if (!supabase) return null;
	const { data, error } = await supabase.storage.from('saidas').createSignedUrl(path, 60);
	if (error || !data?.signedUrl) return null;
	const response = await fetch(data.signedUrl);
	if (!response.ok) return null;
	await logAccess('download', path, empresaId);
	return new Uint8Array(await response.arrayBuffer());
}

function triggerZip(files: Record<string, Uint8Array>, name: string) {
	// import dinâmico para não carregar fflate à toa
	return import('fflate').then(({ zipSync }) => {
		const blob = new Blob([zipSync(files) as BlobPart], { type: 'application/zip' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = name;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
	});
}

export function EstrategiasBlocos({ slug, date, codigo, empresaId, fallback }: {
	slug: string; date: string; codigo: string; empresaId: string; fallback?: ReactNode;
}) {
	const [indice, setIndice] = useState<EstrategiaIndice[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [antiga, setAntiga] = useState(false);
	const [filtroEstr, setFiltroEstr] = useState<Set<string>>(new Set());
	const [filtroEstagio, setFiltroEstagio] = useState<Set<string>>(new Set());
	const [downloading, setDownloading] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		if (!slug || !codigo) { setLoading(false); setIndice(null); return; }
		let active = true;
		setLoading(true); setError(''); setAntiga(false);
		fetchIndice(slug, date, codigo).then(res => {
			if (!active) return;
			if (res === null) { setAntiga(true); setIndice(null); }
			else {
				setIndice(res);
				setFiltroEstr(new Set(res.map(e => e.pasta)));
				const estagios = new Set<string>();
				res.forEach(e => (e.estagios ?? []).forEach(s => estagios.add(s.estagio)));
				setFiltroEstagio(estagios);
			}
			setLoading(false);
		}).catch(() => { if (active) { setAntiga(true); setLoading(false); } });
		return () => { active = false; };
	}, [slug, date, codigo]);

	const base = `${slug}/${date}/${codigo}/ids/estrategias`;

	// Há estagios em alguma estratégia? (rotina nova)
	const temEstagios = useMemo(() => !!indice?.some(e => Array.isArray(e.estagios) && e.estagios.length > 0), [indice]);

	async function baixarCanal(estr: EstrategiaIndice, estagio: EstagioIndice, canal: string, reserva: boolean) {
		const file = reserva ? `${canal}_reserva.csv` : `${canal}.csv`;
		const path = `${base}/${estagio.pasta}/${file}`;
		const nomeArq = `${date}_${slugify(estr.estrategia)}_${slugify(estagio.estagio)}${reserva ? '_reserva' : ''}_${canal}.csv`;
		setDownloading(path); setError('');
		try { await signedDownload(path, nomeArq, 'saidas', empresaId); }
		catch { setError('Ainda não gerado para esta data'); }
		finally { setDownloading(''); }
	}

	async function baixarZipEstagio(estr: EstrategiaIndice, estagio: EstagioIndice) {
		const key = `zip:${estr.pasta}:${estagio.pasta}`;
		setDownloading(key); setError('');
		try {
			const files: Record<string, Uint8Array> = {};
			for (const canal of Object.keys(estagio.canais)) {
				const bytes = await baixarArquivo(`${base}/${estagio.pasta}/${canal}.csv`, empresaId);
				if (bytes) files[`${canal}.csv`] = bytes;
			}
			for (const canal of Object.keys(estagio.reserva ?? {})) {
				const bytes = await baixarArquivo(`${base}/${estagio.pasta}/${canal}_reserva.csv`, empresaId);
				if (bytes) files[`${canal}_reserva.csv`] = bytes;
			}
			if (Object.keys(files).length === 0) throw new Error('empty');
			await triggerZip(files, `${date}_${slugify(estr.estrategia)}_${slugify(estagio.estagio)}.zip`);
		} catch { setError('Ainda não gerado para esta data'); }
		finally { setDownloading(''); }
	}

	async function baixarZipEstrategia(estr: EstrategiaIndice) {
		const key = `zip:${estr.pasta}`;
		setDownloading(key); setError('');
		try {
			const files: Record<string, Uint8Array> = {};
			for (const estagio of estr.estagios ?? []) {
				for (const canal of Object.keys(estagio.canais)) {
					const bytes = await baixarArquivo(`${base}/${estagio.pasta}/${canal}.csv`, empresaId);
					if (bytes) files[`${slugify(estagio.estagio)}/${canal}.csv`] = bytes;
				}
				for (const canal of Object.keys(estagio.reserva ?? {})) {
					const bytes = await baixarArquivo(`${base}/${estagio.pasta}/${canal}_reserva.csv`, empresaId);
					if (bytes) files[`${slugify(estagio.estagio)}/${canal}_reserva.csv`] = bytes;
				}
			}
			if (Object.keys(files).length === 0) throw new Error('empty');
			await triggerZip(files, `${date}_${slugify(estr.estrategia)}.zip`);
		} catch { setError('Ainda não gerado para esta data'); }
		finally { setDownloading(''); }
	}

	async function baixarTudo() {
		if (!indice) return;
		setDownloading('zip'); setError('');
		try {
			const files: Record<string, Uint8Array> = {};
			for (const estr of indice) {
				for (const estagio of estr.estagios ?? []) {
					for (const canal of Object.keys(estagio.canais)) {
						const bytes = await baixarArquivo(`${base}/${estagio.pasta}/${canal}.csv`, empresaId);
						if (bytes) files[`${slugify(estr.estrategia)}/${slugify(estagio.estagio)}/${canal}.csv`] = bytes;
					}
					for (const canal of Object.keys(estagio.reserva ?? {})) {
						const bytes = await baixarArquivo(`${base}/${estagio.pasta}/${canal}_reserva.csv`, empresaId);
						if (bytes) files[`${slugify(estr.estrategia)}/${slugify(estagio.estagio)}/${canal}_reserva.csv`] = bytes;
					}
				}
			}
			if (Object.keys(files).length === 0) throw new Error('empty');
			await triggerZip(files, `ids_${date}.zip`);
		} catch { setError('Ainda não gerado para esta data'); }
		finally { setDownloading(''); }
	}

	function toggleEstr(pasta: string) {
		setFiltroEstr(prev => { const n = new Set(prev); if (n.has(pasta)) n.delete(pasta); else n.add(pasta); return n; });
	}
	function toggleEstagio(estagio: string) {
		setFiltroEstagio(prev => { const n = new Set(prev); if (n.has(estagio)) n.delete(estagio); else n.add(estagio); return n; });
	}

	if (loading) return <Loading />;
	if (antiga) return <div className="space-y-4"><Notice variant="warning">Lista anterior à separação por estratégia. Rode “Reenquadrar agora” para separar por estágio.</Notice>{fallback}</div>;
	if (!indice || indice.length === 0) return <Notice>Nenhum bloco de estratégia disponível em {date}.</Notice>;

	// Modo legado: indice.json sem estagios → cartões por estratégia como hoje + nota
	if (!temEstagios) {
		return (
			<div className="space-y-5">
				<Notice variant="warning">Rode “Reenquadrar agora” para separar por estágio.</Notice>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs font-semibold text-slate-500">Estratégias:</span>
					{indice.map(e => {
						const active = filtroEstr.has(e.pasta);
						return (
							<button key={e.pasta} type="button" onClick={() => toggleEstr(e.pasta)}
								className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? 'bg-[#0F4C5C] text-white' : 'border border-[#c9dadd] text-slate-400 hover:bg-[#edf4f5]'}`}>
								{e.estrategia}
							</button>
						);
					})}
				</div>
				<div className="space-y-4">
					{indice.filter(e => filtroEstr.has(e.pasta)).map(entry => (
						<BlocoEstrategiaLegado key={entry.pasta} entry={entry} base={base}
							downloading={downloading}
							onBaixarCanal={(canal, reserva) => baixarCanalLegado(entry, canal, reserva, base, empresaId, date, setDownloading, setError)}
							onBaixarZip={() => baixarZipEstrategiaLegado(entry, base, empresaId, date, setDownloading, setError)} />
					))}
				</div>
				<p className="text-xs text-slate-400">Estes arquivos têm telefone e e-mail de clientes. Use só na ferramenta do canal e não repasse.</p>
			</div>
		);
	}

	// Modo novo: estratégia → estágio → canal
	const todosEstagios = (() => {
		const set = new Set<string>();
		indice.forEach(e => (e.estagios ?? []).forEach(s => set.add(s.estagio)));
		return [...set].sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
	})();

	const visiveis = indice.filter(e => filtroEstr.has(e.pasta));
	const totalClientes = visiveis.reduce((n, e) => n + Number(e.clientes ?? 0), 0);

	return (
		<div className="space-y-5">
			{error && <Notice variant={error.includes('Ainda') ? 'warning' : 'error'}>{error}</Notice>}

			{/* Filtros: estratégias */}
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs font-semibold text-slate-500">Estratégias:</span>
				{indice.map(e => {
					const active = filtroEstr.has(e.pasta);
					return (
						<button key={e.pasta} type="button" onClick={() => toggleEstr(e.pasta)}
							className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? 'bg-[#0F4C5C] text-white' : 'border border-[#c9dadd] text-slate-400 hover:bg-[#edf4f5]'}`}>
							{e.estrategia}
						</button>
					);
				})}
			</div>
			{/* Filtros: estágios */}
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs font-semibold text-slate-500">Estágios:</span>
				{todosEstagios.map(s => {
					const active = filtroEstagio.has(s);
					return (
						<button key={s} type="button" onClick={() => toggleEstagio(s)}
							className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? 'bg-[#0F4C5C] text-white' : 'border border-[#c9dadd] text-slate-400 hover:bg-[#edf4f5]'}`}>
							{STAGE_LABEL[s] ?? s}
						</button>
					);
				})}
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-xs text-slate-400">{numberBR(totalClientes)} clientes no total · {visiveis.length} estratégia{visiveis.length !== 1 ? 's' : ''}</p>
				<button onClick={baixarTudo} disabled={!!downloading} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white disabled:opacity-50">
					<Archive size={16} />{downloading === 'zip' ? 'Preparando...' : 'Baixar todas (.zip)'}
				</button>
			</div>

			<div className="space-y-4">
				{visiveis.map(entry => {
					const estagios = (entry.estagios ?? []).filter(s => filtroEstagio.has(s.estagio)).sort(stageSort);
					return (
						<BlocoEstrategiaComEstagios key={entry.pasta} entry={entry} estagios={estagios} downloading={downloading}
							onBaixarCanal={(estagio, canal, reserva) => baixarCanal(entry, estagio, canal, reserva)}
							onBaixarZipEstagio={(estagio) => baixarZipEstagio(entry, estagio)}
							onBaixarZipEstrategia={() => baixarZipEstrategia(entry)} />
					);
				})}
			</div>
			<p className="text-xs text-slate-400">Estes arquivos têm telefone e e-mail de clientes. Use só na ferramenta do canal e não repasse.</p>
		</div>
	);
}

function BlocoEstrategiaComEstagios({ entry, estagios, downloading, onBaixarCanal, onBaixarZipEstagio, onBaixarZipEstrategia }: {
	entry: EstrategiaIndice;
	estagios: EstagioIndice[];
	downloading: string;
	onBaixarCanal: (estagio: EstagioIndice, canal: string, reserva: boolean) => void;
	onBaixarZipEstagio: (estagio: EstagioIndice) => void;
	onBaixarZipEstrategia: () => void;
}) {
	const [aberto, setAberto] = useState(true);
	const zipKey = `zip:${entry.pasta}`;
	return (
		<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
			<button type="button" onClick={() => setAberto(v => !v)} className="flex w-full items-center justify-between gap-3 text-left">
				<div className="flex items-center gap-3">
					<span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e9f1f3] text-xs font-bold text-[#0F4C5C]">{entry.estrategia_id}</span>
					<div>
						<h2 className="text-base font-semibold text-[#163943]">{entry.estrategia}</h2>
						<p className="text-xs text-slate-500">{numberBR(entry.clientes)} clientes · {estagios.length} estágio{estagios.length !== 1 ? 's' : ''}</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<span onClick={e => { e.stopPropagation(); }} className="hidden sm:block">
						<button type="button" onClick={(e) => { e.stopPropagation(); onBaixarZipEstrategia(); }} disabled={!!downloading}
							className="flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50">
							<Download size={15} /> {downloading === zipKey ? 'Preparando...' : `Baixar ${entry.estrategia} (.zip)`}
						</button>
					</span>
					<ChevronDown size={18} className={`text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
				</div>
			</button>

			{aberto && (
				<div className="mt-5 space-y-4">
					{estagios.map(estagio => (
						<SubBlocoEstagio key={estagio.pasta} estagio={estagio} downloading={downloading}
							onBaixarCanal={(canal, reserva) => onBaixarCanal(estagio, canal, reserva)}
							onBaixarZip={() => onBaixarZipEstagio(estagio)} />
					))}
					<div className="sm:hidden">
						<button type="button" onClick={onBaixarZipEstrategia} disabled={!!downloading}
							className="flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50">
							<Download size={15} /> {downloading === zipKey ? 'Preparando...' : `Baixar ${entry.estrategia} (.zip)`}
						</button>
					</div>
				</div>
			)}
		</section>
	);
}

function SubBlocoEstagio({ estagio, downloading, onBaixarCanal, onBaixarZip }: {
	estagio: EstagioIndice;
	downloading: string;
	onBaixarCanal: (canal: string, reserva: boolean) => void;
	onBaixarZip: () => void;
}) {
	const canais = Object.entries(estagio.canais).filter(([, n]) => Number(n) > 0);
	const reservas = Object.entries(estagio.reserva ?? {}).filter(([, n]) => Number(n) > 0);
	const passos = estagio.passos ?? {};
	const zipKey = `zip:${estagio.pasta}`;
	return (
		<div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-5">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h3 className="text-sm font-bold text-[#163943]">{stageLabel(estagio)}</h3>
					<p className="text-xs text-slate-500">{numberBR(estagio.clientes)} clientes</p>
				</div>
				<button type="button" onClick={onBaixarZip} disabled={!!downloading}
					className="flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50">
					<Download size={15} /> {downloading === zipKey ? 'Preparando...' : 'Baixar estágio (.zip)'}
				</button>
			</div>

			{Object.keys(passos).length > 0 && (
				<div className="mb-4 flex flex-wrap gap-2">
					{Object.entries(passos).map(([dia, n]) => (
						<span key={dia} className="rounded-full bg-[#eaf2f3] px-3 py-1 text-xs font-semibold text-[#0F4C5C]">{dia} · {numberBR(n)}</span>
					))}
				</div>
			)}

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{canais.map(([canal, qty], i) => {
					const path = `${canal}.csv`;
					const reserva = reservas.find(([c]) => c === canal);
					return (
						<div key={canal} className="rounded-xl border border-[#dfe8ea] bg-white p-6">
							<div className="flex items-start justify-between">
								<span className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-xs font-bold text-[#0F4C5C]">{canalCode(canal)}</span>
								<span className="text-[11px] font-semibold text-slate-400">0{i + 1} / CANAL</span>
							</div>
							<h3 className="mt-5 text-lg font-semibold">{canalNome(canal)}</h3>
							<p className="mt-2 text-3xl font-semibold tracking-tight text-[#0F4C5C]">{numberBR(qty)} <span className="text-xs font-normal text-slate-400">clientes</span></p>
							<button onClick={() => onBaixarCanal(canal, false)} disabled={!!downloading}
								className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#c9dadd] text-sm font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40">
								<Download size={16} />{downloading.endsWith(`/${estagio.pasta}/${canal}.csv`) ? 'Baixando...' : 'Baixar lista'}
							</button>
							{reserva && (
								<div className="mt-3 border-t border-[#e5edef] pt-3">
									<p className="text-xs leading-relaxed text-[#80520f]">Reserva: {numberBR(reserva[1])} clientes — só se o agente virtual não conseguir contato hoje</p>
									<button onClick={() => onBaixarCanal(canal, true)} disabled={!!downloading}
										className="mt-2 text-xs font-bold text-[#0F4C5C] hover:underline disabled:opacity-50">Baixar reserva ↓</button>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ---- Modo legado (indice.json sem estagios) ----

async function baixarCanalLegado(entry: EstrategiaIndice, canal: string, reserva: boolean, base: string, empresaId: string, date: string, setDownloading: (s: string) => void, setError: (s: string) => void) {
	const file = reserva ? `${canal}_reserva.csv` : `${canal}.csv`;
	const path = `${base}/${entry.pasta}/${file}`;
	const nomeArq = `${date}_${slugify(entry.estrategia)}${reserva ? '_reserva' : ''}_${canal}.csv`;
	setDownloading(path); setError('');
	try { await signedDownload(path, nomeArq, 'saidas', empresaId); }
	catch { setError('Ainda não gerado para esta data'); }
	finally { setDownloading(''); }
}

async function baixarZipEstrategiaLegado(entry: EstrategiaIndice, base: string, empresaId: string, date: string, setDownloading: (s: string) => void, setError: (s: string) => void) {
	const key = `zip:${entry.pasta}`;
	setDownloading(key); setError('');
	try {
		const files: Record<string, Uint8Array> = {};
		for (const canal of Object.keys(entry.canais)) {
			const bytes = await baixarArquivo(`${base}/${entry.pasta}/${canal}.csv`, empresaId);
			if (bytes) files[`${canal}.csv`] = bytes;
		}
		for (const canal of Object.keys(entry.reserva ?? {})) {
			const bytes = await baixarArquivo(`${base}/${entry.pasta}/${canal}_reserva.csv`, empresaId);
			if (bytes) files[`${canal}_reserva.csv`] = bytes;
		}
		if (Object.keys(files).length === 0) throw new Error('empty');
		await triggerZip(files, `${date}_${slugify(entry.estrategia)}.zip`);
	} catch { setError('Ainda não gerado para esta data'); }
	finally { setDownloading(''); }
}

function BlocoEstrategiaLegado({ entry, base, downloading, onBaixarCanal, onBaixarZip }: {
	entry: EstrategiaIndice; base: string; downloading: string;
	onBaixarCanal: (canal: string, reserva: boolean) => void; onBaixarZip: () => void;
}) {
	const canais = Object.entries(entry.canais).filter(([, n]) => Number(n) > 0);
	const reservas = Object.entries(entry.reserva ?? {}).filter(([, n]) => Number(n) > 0);
	const zipKey = `zip:${entry.pasta}`;
	return (
		<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e9f1f3] text-xs font-bold text-[#0F4C5C]">{entry.estrategia_id}</span>
					<div>
						<h2 className="text-base font-semibold text-[#163943]">{entry.estrategia}</h2>
						<p className="text-xs text-slate-500">{numberBR(entry.clientes)} clientes</p>
					</div>
				</div>
				<button type="button" onClick={onBaixarZip} disabled={!!downloading}
					className="flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50">
					<Download size={15} /> {downloading === zipKey ? 'Preparando...' : `Baixar ${entry.estrategia} (.zip)`}
				</button>
			</div>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{canais.map(([canal, qty], i) => {
					const reserva = reservas.find(([c]) => c === canal);
					return (
						<div key={canal} className="rounded-xl border border-[#dfe8ea] bg-white p-6">
							<div className="flex items-start justify-between">
								<span className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-xs font-bold text-[#0F4C5C]">{canalCode(canal)}</span>
								<span className="text-[11px] font-semibold text-slate-400">0{i + 1} / CANAL</span>
							</div>
							<h3 className="mt-5 text-lg font-semibold">{canalNome(canal)}</h3>
							<p className="mt-2 text-3xl font-semibold tracking-tight text-[#0F4C5C]">{numberBR(qty)} <span className="text-xs font-normal text-slate-400">clientes</span></p>
							<button onClick={() => onBaixarCanal(canal, false)} disabled={!!downloading}
								className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#c9dadd] text-sm font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40">
								<Download size={16} />{downloading === `${base}/${entry.pasta}/${canal}.csv` ? 'Baixando...' : 'Baixar lista'}
							</button>
							{reserva && (
								<div className="mt-3 border-t border-[#e5edef] pt-3">
									<p className="text-xs leading-relaxed text-[#80520f]">Reserva: {numberBR(reserva[1])} clientes — só se o agente virtual não conseguir contato hoje</p>
									<button onClick={() => onBaixarCanal(canal, true)} disabled={!!downloading}
										className="mt-2 text-xs font-bold text-[#0F4C5C] hover:underline disabled:opacity-50">Baixar reserva ↓</button>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
}
