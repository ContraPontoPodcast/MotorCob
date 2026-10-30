import { useEffect, useState } from 'react';
import { Archive, Download, FileText, CalendarDays, Users, FlaskConical } from 'lucide-react';
import { Link } from 'react-router';
import { Empty, Loading, Notice, PageHeading, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { channels, dateBR, friendlyError, logAccess, numberBR, signedDownload, supabase, today, type Row } from '@/lib/supabase';
import { numerosPorClienteOpts } from '@/lib/operacao';
import { PorQueHojeApple } from '@/components/fila/por-que-hoje-apple';
import { contarAcaoHojePorFaixa, FAIXAS } from '@/lib/propensao';
import { FaixaBadge, PropensaoHelp } from '@/components/propensao/faixa-badge';
import { Info } from '@/components/glossario/info';
import { fetchExecucao, type Execucao } from '@/lib/execucao';
import { ResumoHoje } from '@/components/fila/resumo-hoje';
import { SemAcaoCard } from '@/components/fila/sem-acao-card';
import { ProximosDias } from '@/components/fila/proximos-dias';
import { EstrategiasBlocos } from '@/components/fila/estrategias-blocos';
import { ReenquadramentoButton } from '@/components/reenquadramento/reenquadramento-button';
import { SaudeContatos } from '@/components/fila/saude-contatos';
import { EscolhaCarteira } from '@/components/escolha-carteira';

export function Queue() {
	const { empresa, credor, credores } = useMotorAuth();
	const [date, setDate] = useState(today());
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [downloading, setDownloading] = useState('');
	const [numeros, setNumeros] = useState<Record<string, number>>({});
	const [numLoading, setNumLoading] = useState(true);
	const [numBusy, setNumBusy] = useState(false);
	const [numSaved, setNumSaved] = useState(false);
	const [bureauOk, setBureauOk] = useState(false);
	const [apiAtivo, setApiAtivo] = useState(false);
	const [execucao, setExecucao] = useState<Execucao | null>(null);
	const [execLoading, setExecLoading] = useState(true);
	const [refreshKey, setRefreshKey] = useState(0);
	const extended = useAllowed(['admin', 'planejamento']);
	const slug = empresa?.slug;
	const codigo = credor?.codigo;
	const precisaCredor = !credor && credores.length > 1;

	const idsPath = (file: string) => `${slug}/${date}/${codigo}/ids/${file}`;
	const oldIdsPath = (file: string) => `${slug}/${date}/ids/${file}`;
	const diaPath = (file: string) => `${slug}/${date}/${codigo}/${file}`;
	const oldDiaPath = (file: string) => `${slug}/${date}/${file}`;

	useEffect(() => {
		if (!supabase || !empresa || !credor) return;
		const client = supabase; let active = true;
		setLoading(true); setError('');
		client.from('resumo_fila').select('*').eq('empresa_id', empresa.id).eq('credor_id', credor.id).eq('data', date).then(({ data, error }) => {
			if (!active) return;
			if (error) setError(friendlyError()); else setRows(data ?? []);
			setLoading(false);
		});
		return () => { active = false; };
	}, [date, empresa?.id, credor?.id, refreshKey]);

	useEffect(() => {
		if (!supabase || !empresa || !credor) { setExecucao(null); setExecLoading(false); return; }
		let active = true;
		setExecLoading(true);
		fetchExecucao(empresa.id, credor.id, date).then(e => { if (active) { setExecucao(e); setExecLoading(false); } });
		return () => { active = false; };
	}, [date, empresa?.id, credor?.id, refreshKey]);

	useEffect(() => {
		if (!supabase || !empresa) return;
		setNumLoading(true);
		supabase.from('canais_empresa').select('canal,numeros_por_cliente').eq('empresa_id', empresa.id).then(({ data }) => {
			const map: Record<string, number> = {};
			(data ?? []).forEach((r: Row) => { const v = r.numeros_por_cliente; map[r.canal as string] = v == null ? 1 : Number(v); });
			setNumeros(map); setNumLoading(false);
		});
	}, [empresa?.id]);

	// Verifica se existe o arquivo do bureau para a data/credor.
	useEffect(() => {
		if (!supabase || !slug || !codigo) { setBureauOk(false); return; }
		let active = true;
		const path = `${slug}/${date}/${codigo}/bureau`;
		supabase.storage.from('saidas').list(path, { limit: 100 }).then(({ data }) => {
			if (!active) return;
			setBureauOk(!!(data ?? []).some((f: Row) => f.name === 'enviar_bureau.csv'));
		}).catch(() => { if (active) setBureauOk(false); });
		return () => { active = false; };
	}, [slug, codigo, date]);

	// Verifica se o módulo API está ativo (link "Mandar pela API" na lista vazia).
	useEffect(() => {
		if (!supabase || !empresa) { setApiAtivo(false); return; }
		let active = true;
		supabase.from('empresa_modulos').select('ativo').eq('empresa_id', empresa.id).eq('modulo', 'api').maybeSingle().then(({ data }) => {
			if (!active) return;
			setApiAtivo(!!(data as { ativo?: boolean } | null)?.ativo);
		});
		return () => { active = false; };
	}, [empresa?.id]);

	async function baixarBureau() {
		if (!empresa || !slug || !codigo) return;
		const path = `${slug}/${date}/${codigo}/bureau/enviar_bureau.csv`;
		setDownloading(path); setError('');
		try { await signedDownload(path, 'enviar_bureau.csv', 'saidas', empresa.id); }
		catch { setError('Ainda não gerado para esta data'); }
		finally { setDownloading(''); }
	}

	async function get(file: string, folder: 'ids' | 'dia') {
		if (!empresa) return;
		const credorP = folder === 'ids' ? idsPath(file) : diaPath(file);
		const oldP = folder === 'ids' ? oldIdsPath(file) : oldDiaPath(file);
		setDownloading(credorP); setError('');
		try { await signedDownload(credorP, undefined, 'saidas', empresa.id); }
		catch { try { await signedDownload(oldP, undefined, 'saidas', empresa.id); } catch { setError('Ainda não gerado para esta data'); } }
		finally { setDownloading(''); }
	}
	async function getAll() {
		if (!supabase || !empresa || !slug || !codigo) return; setDownloading('zip'); setError('');
		try {
			const { zipSync } = await import('fflate');
			const files: Record<string, Uint8Array> = {}; let found = 0;
			const fileNames = channels.filter(c => rows.some(r => r.canal === c.id && !r.reserva && Number(r.clientes) > 0)).map(c => `${c.id}.csv`);
			if (rows.some(r => r.canal === 'discador' && r.reserva && Number(r.clientes) > 0)) fileNames.push('discador_reserva.csv');
			for (const file of fileNames) {
				const credorP = idsPath(file); const oldP = oldIdsPath(file);
				let signedUrl: string | null = null; let usedPath = credorP;
				const r1 = await supabase.storage.from('saidas').createSignedUrl(credorP, 60);
				if (r1.data?.signedUrl) signedUrl = r1.data.signedUrl;
				else { const r2 = await supabase.storage.from('saidas').createSignedUrl(oldP, 60); if (r2.data?.signedUrl) { signedUrl = r2.data.signedUrl; usedPath = oldP; } }
				if (!signedUrl) continue;
				const response = await fetch(signedUrl); if (!response.ok) continue;
				files[file] = new Uint8Array(await response.arrayBuffer()); await logAccess('download', usedPath, empresa.id); found++;
			}
			if (!found) throw new Error('empty');
			const blob = new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ids_${date}.zip`; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
		} catch { setError('Ainda não gerado para esta data'); } finally { setDownloading(''); }
	}

	async function setNumerosCanal(canal: string, valor: number) {
		if (!supabase || !empresa) return;
		const next = { ...numeros, [canal]: valor };
		setNumeros(next); setNumBusy(true); setNumSaved(false);
		const { error } = await supabase.from('canais_empresa').upsert({ empresa_id: empresa.id, canal, numeros_por_cliente: valor === 1 ? null : valor }, { onConflict: 'empresa_id,canal' });
		if (error) setError(friendlyError()); else { setNumSaved(true); window.setTimeout(() => setNumSaved(false), 3000); }
		setNumBusy(false);
	}

	const files = [{ name: 'Fila do dia · detalhe com contato', file: 'fila_do_dia.csv', folder: 'dia' as const }, { name: 'Enriquecimento', file: 'enriquecimento.csv', folder: 'dia' as const }, { name: 'Alertas', file: 'alertas.txt', folder: 'dia' as const }, { name: 'Higienização de contatos · devolva ao CRM/credor', file: 'higienizacao.csv', folder: 'dia' as const }];

	return <>
		<PageHeading eyebrow="OPERAÇÃO / DISTRIBUIÇÃO" title="Lista do dia" description="Baixe a lista de clientes com o contato a acionar, separada por canal." titleExtra={<Info slug="lista-do-dia" />} actions={<div className="flex flex-wrap items-center gap-2">
			<label className="flex h-9 items-center gap-2 rounded-[10px] bg-[#F2F2F7] px-3 text-[13px] font-medium text-[#1D1D1F]"><CalendarDays size={15} className="text-[#8E8E93]"/><span className="sr-only">Selecionar data</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-transparent text-[13px] font-medium outline-none"/></label>
			<button onClick={getAll} disabled={!!downloading || !slug || !codigo} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[15px] font-medium text-white hover:opacity-85 disabled:opacity-50"><Archive size={16}/>{downloading === 'zip' ? 'Preparando...' : 'Baixar lista'}</button>
		</div>}/>
		{!slug ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
			: precisaCredor ? <EscolhaCarteira />
			: !codigo ? <Empty>Nenhum credor cadastrado para esta empresa.</Empty>
			: <div className="space-y-8">
			{error && <Notice variant={error.includes('Ainda') ? 'warning' : 'error'}>{error}</Notice>}
			<p className="max-w-3xl text-sm leading-relaxed text-slate-500">Um contato por cliente em cada canal. O contato HOT do cliente sempre vai primeiro.</p>
			<PorQueHojeApple />
			<ComAcaoPorPropensao />
		{execucao && <ResumoHoje resumo={execucao.resumo} />}
		{execucao?.resumo?.retorno_canal && <SaudeContatos retorno={execucao.resumo.retorno_canal} />}
			{loading ? <Loading/> : rows.length === 0 ? (execLoading ? <Loading/> : !execucao ? <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}><span className="mc-area-tag mb-3">Cobrança</span><h2 className="text-[18px] font-semibold text-[#1D1D1F]">Lista do dia</h2><p className="mx-auto mt-2 max-w-md text-[14px] text-[#6E6E73]">A primeira Lista do dia sai às 6h da manhã seguinte à primeira carga. Ela mostra quem recebe ação hoje, por qual canal e com qual frase.</p><div className="mt-5 flex flex-wrap items-center justify-center gap-3"><Link to="/envios" className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Enviar a primeira carga</Link>{apiAtivo && <Link to="/docs/api" className="text-[14px] font-medium text-[#0A60D0] hover:underline">Mandar pela API</Link>}</div></div> : <SemAcaoCard execucao={execucao} date={date} />) : <EstrategiasBlocos slug={slug} date={date} codigo={codigo} empresaId={empresa.id} fallback={<><div className="mb-4 flex justify-end"><button onClick={getAll} disabled={!!downloading || !slug || !codigo} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white disabled:opacity-50"><Archive size={16}/>{downloading === 'zip' ? 'Preparando...' : 'Baixar tudo (.zip)'}</button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{channels.map((c, i) => { const qty = rows.filter(r => r.canal === c.id && !r.reserva).reduce((n, r) => n + Number(r.clientes ?? 0), 0); const reserve = c.id === 'discador' ? rows.filter(r => r.canal === 'discador' && r.reserva).reduce((n, r) => n + Number(r.clientes ?? 0), 0) : 0; return <div key={c.id} className="rounded-xl border border-[#dfe8ea] bg-white p-6"><div className="flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-xs font-bold text-[#0F4C5C]">{c.code}</span><span className="text-[11px] font-semibold text-slate-400">0{i + 1} / CANAL</span></div><h2 className="mt-5 text-lg font-semibold">{c.name}</h2><p className="mt-2 text-3xl font-semibold tracking-tight text-[#0F4C5C]">{numberBR(qty)} <span className="text-xs font-normal text-slate-400">clientes</span></p><button onClick={() => get(`${c.id}.csv`, 'ids')} disabled={!qty || !!downloading} className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#c9dadd] text-sm font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40"><Download size={16}/>{downloading === idsPath(`${c.id}.csv`) ? 'Baixando...' : 'Baixar lista'}</button>{!qty && <p className="mt-2 text-xs text-slate-400">Ainda não gerado para esta data</p>}{reserve > 0 && <div className="mt-5 border-t border-[#e5edef] pt-4"><p className="text-xs leading-relaxed text-[#80520f]">Reserva: {numberBR(reserve)} clientes — só se o agente virtual não conseguir contato hoje</p><button onClick={() => get('discador_reserva.csv', 'ids')} disabled={!!downloading} className="mt-3 text-xs font-bold text-[#0F4C5C] hover:underline">Baixar reserva ↓</button></div>}</div>; })}</div><p className="text-xs text-slate-400">Estes arquivos têm telefone e e-mail de clientes. Use só na ferramenta do canal e não repasse.</p></>} />}

			{execucao?.resumo?.proximos?.length ? <ProximosDias dias={execucao.resumo.proximos} /> : null}

		{extended && bureauOk && <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><FlaskConical size={19} className="text-[#0F4C5C]"/><div><h2 className="font-semibold">Arquivo para o bureau</h2><p className="text-xs text-slate-500">Clientes a enriquecer nesta data</p></div></div><button disabled={!!downloading} onClick={baixarBureau} className="flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50"><Download size={15}/> {downloading === `${slug}/${date}/${codigo}/bureau/enviar_bureau.csv` ? 'Baixando...' : 'Baixar'}</button></div></section>}

			{extended && <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8"><div className="mb-5 flex items-center gap-3"><FileText size={19} className="text-[#0F4C5C]"/><div><h2 className="font-semibold">Arquivos complementares</h2><p className="text-xs text-slate-500">Disponíveis para administração e planejamento</p></div></div><div className="divide-y divide-[#e9eff0]">{files.map(f => <div key={f.file} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm">{f.name}{f.file === 'fila_do_dia.csv' && <span className="ml-2 rounded-full bg-[#eaf2f3] px-2 py-0.5 text-[10px] font-semibold text-[#0F4C5C]">com status_contato</span>}</span><button disabled={!!downloading} onClick={() => get(f.file, f.folder)} className="flex items-center gap-2 text-xs font-bold text-[#0F4C5C] hover:underline disabled:opacity-50"><Download size={15}/> Baixar</button></div>)}</div></section>}

			{extended && <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
				<div className="mb-5 flex items-center gap-3"><Users size={19} className="text-[#0F4C5C]"/><div><h2 className="font-semibold">Contatos por cliente em cada canal</h2><p className="text-xs text-slate-500">Quantos contatos do cliente mandar por canal</p></div></div>
				{numLoading ? <Loading/> : <div className="space-y-2">{channels.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e9eff0] px-4 py-3"><span className="text-sm font-medium">{c.name}</span><select value={String(numeros[c.id] ?? 1)} disabled={numBusy} onChange={e => void setNumerosCanal(c.id, Number(e.target.value))} className="h-9 rounded border border-[#d8e3e5] bg-white px-2 text-sm outline-none focus:border-[#0F4C5C] disabled:opacity-50">{numerosPorClienteOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>)}</div>}
				{numSaved && <p className="mt-3 text-xs font-semibold text-[#2E7D32]">Salvo. Vale a partir da rotina seguinte.</p>}
				<p className="mt-4 rounded-lg bg-[#f5f8f9] px-4 py-3 text-xs leading-relaxed text-slate-500">Com 1 contato, o CPC da ocorrência marca na hora qual é o contato principal. Com mais de um, o CPC vale para o cliente e o MotorCX descobre o principal testando um telefone por vez nas próximas ações.</p>
			</section>}
		</div>}
	</>;
}

function ComAcaoPorPropensao() {
	const { empresa, credor } = useMotorAuth();
	const [counts, setCounts] = useState<Record<string, number> | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		if (!empresa || !credor) { setCounts(null); setError(''); return; }
		let active = true;
		setError('');
		contarAcaoHojePorFaixa(empresa.id, credor.id)
			.then(c => { if (active) setCounts(c); })
			.catch(e => { if (active) { setError(friendlyError(e)); setCounts(null); } });
		return () => { active = false; };
	}, [empresa?.id, credor?.id]);
	if (error) return (
		<section className="rounded-2xl bg-white p-6 sm:p-7" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<Notice variant="error">{error}</Notice>
		</section>
	);
	if (!counts) return null;
	const items: string[] = [...FAIXAS, 'sem'];
	return (
		<section className="rounded-2xl bg-white p-6 sm:p-7" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<h2 className="mb-4 flex items-center gap-2 text-[18px] font-semibold text-[#1D1D1F]">Com ação hoje, por propensão <PropensaoHelp /></h2>
			<div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
				{items.map(f => (
					<Link key={f} to={`/clientes?comAcaoHoje=1&faixa=${f}`} className="flex flex-col items-center gap-1.5 rounded-lg border border-[#dfe8ea] bg-[#fafcfc] px-2 py-3 text-center hover:bg-[#edf4f5]">
						<FaixaBadge faixa={f === 'sem' ? null : f} size="sm" />
						<span className="text-[16px] font-bold text-[#0F4C5C] tnum">{numberBR(counts[f] ?? 0)}</span>
						<span className="text-[10px] text-slate-400">{f === 'sem' ? 'Sem faixa' : `Faixa ${f}`}</span>
					</Link>
				))}
			</div>
		</section>
	);
}
