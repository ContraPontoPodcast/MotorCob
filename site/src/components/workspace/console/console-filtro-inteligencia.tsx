import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { Chave } from './chave';
import { useConsolePerms } from './console-perms';
import { ErrorDetail } from '@/components/error-detail';

/** Cor da área Mensageria. */
const MENSAGEM_COR = '#7A2E3B';

// ---------- modelo ----------

type ScoreConfig = {
	id?: string;
	plano_id: string | null;
	janela: number;
	meia_vida: number;
	peso_falha: number;
	forca_base: number;
	alto_pct: number;
	baixo_pct: number;
	historico_minimo_baixo: number;
	sem_historico_abaixo: number;
	quarentena: number;
	grupo_controle: number;
};

const DEFAULTS: ScoreConfig = {
	plano_id: null,
	janela: 90,
	meia_vida: 30,
	peso_falha: 3,
	forca_base: 5,
	alto_pct: 70,
	baixo_pct: 30,
	historico_minimo_baixo: 5,
	sem_historico_abaixo: 20,
	quarentena: 30,
	grupo_controle: 2,
};

function normalizeConfig(r: Row): ScoreConfig {
	return {
		id: r.id != null ? String(r.id) : undefined,
		plano_id: r.plano_id == null ? null : String(r.plano_id),
		janela: Number(r.janela ?? DEFAULTS.janela),
		meia_vida: Number(r.meia_vida ?? DEFAULTS.meia_vida),
		peso_falha: Number(r.peso_falha ?? DEFAULTS.peso_falha),
		forca_base: Number(r.forca_base ?? DEFAULTS.forca_base),
		alto_pct: Number(r.alto_pct ?? DEFAULTS.alto_pct),
		baixo_pct: Number(r.baixo_pct ?? DEFAULTS.baixo_pct),
		historico_minimo_baixo: Number(r.historico_minimo_baixo ?? DEFAULTS.historico_minimo_baixo),
		sem_historico_abaixo: Number(r.sem_historico_abaixo ?? DEFAULTS.sem_historico_abaixo),
		quarentena: Number(r.quarentena ?? DEFAULTS.quarentena),
		grupo_controle: Number(r.grupo_controle ?? DEFAULTS.grupo_controle),
	};
}

type Nomes = { id?: string; alto: string; medio: string; baixo: string; sem: string };
const NOMES_DEFAULT: Nomes = { alto: 'Alta qualidade', medio: 'Média qualidade', baixo: 'Baixa qualidade', sem: 'Sem histórico' };

function normalizeNomes(r: Row): Nomes {
	return {
		id: r.id != null ? String(r.id) : undefined,
		alto: String(r.alto ?? ''),
		medio: String(r.medio ?? ''),
		baixo: String(r.baixo ?? ''),
		sem: String(r.sem ?? ''),
	};
}

/** Nomes que imitam status de operadora — recusados pelo banco. */
const STATUS_PALAVRAS = ['entregue', 'delivered', 'delivrd', 'undeliv', 'undelivered', 'dlr'];
function nomeImitaStatus(s: string): boolean {
	const t = s.trim().toLowerCase();
	if (!t) return false;
	return STATUS_PALAVRAS.some(w => t.includes(w));
}

function num(v: string): number {
	let s = String(v ?? '').trim();
	if (!s) return 0;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return isNaN(n) ? 0 : n;
}

// ---------- página ----------

export function ConsoleFiltroInteligenciaPage() {
	const { can, loading: permsLoading } = useConsolePerms();
	const podeEditar = can('configurar_score');

	const [rotas, setRotas] = useState<Row[]>([]);
	const [configs, setConfigs] = useState<Record<string, ScoreConfig>>({});
	const [selected, setSelected] = useState(''); // '' = Padrão
	const [form, setForm] = useState<ScoreConfig>(DEFAULTS);
	const [fornecedores, setFornecedores] = useState<Row[]>([]);
	const [fornConsiderar, setFornConsiderar] = useState<Record<string, boolean>>({});
	const [nomes, setNomes] = useState<Nomes>(NOMES_DEFAULT);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [busyNomes, setBusyNomes] = useState(false);
	const [busyForn, setBusyForn] = useState<string | null>(null);
	const [error, setError] = useState('');
	const [errorNomes, setErrorNomes] = useState('');
	const [success, setSuccess] = useState('');
	const [successNomes, setSuccessNomes] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const [rt, cf, fn, sf, nm] = await Promise.all([
			supabase.from('mensageria_planos_rota').select('id,nome').order('nome'),
			supabase.from('mensageria_score_config').select('*'),
			supabase.from('mensageria_fornecedores').select('id,codigo,nome,ativo').order('nome'),
			supabase.from('mensageria_score_fornecedores').select('*'),
			supabase.from('mensageria_score_nomes').select('*').limit(1),
		]);
		if (rt.error) { setError(friendlyError(rt.error)); setLoading(false); return; }
		setRotas((rt.data ?? []) as Row[]);
		const cfgMap: Record<string, ScoreConfig> = {};
		((cf.data ?? []) as Row[]).forEach(r => {
			const key = r.plano_id == null ? '' : String(r.plano_id);
			cfgMap[key] = normalizeConfig(r);
		});
		setConfigs(cfgMap);
		setFornecedores((fn.data ?? []) as Row[]);
		const cons: Record<string, boolean> = {};
		((sf.data ?? []) as Row[]).forEach(r => {
			const fid = String(r.fornecedor_id ?? r.fornecedor ?? '');
			cons[fid] = r.considerar !== false;
		});
		setFornConsiderar(cons);
		if (nm.data && nm.data.length > 0) setNomes(normalizeNomes(nm.data[0] as Row));
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	// sincroniza o formulário quando a rota selecionada muda.
	const isPadrao = selected === '';
	const ownConfig = configs[selected];
	const displayConfig = ownConfig ?? configs[''] ?? DEFAULTS;
	const usandoPadrao = !isPadrao && !ownConfig;

	useEffect(() => {
		setForm({ ...displayConfig });
		setSuccess(''); setSuccessNomes('');
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selected, configs]);

	function configurarSoEstaRota() {
		const base = configs[''] ?? form;
		const copia: ScoreConfig = { ...base, id: undefined, plano_id: selected };
		setConfigs(prev => ({ ...prev, [selected]: copia }));
	}

	function setField<K extends keyof ScoreConfig>(k: K, v: number) {
		setForm(prev => ({ ...prev, [k]: v }));
	}

	const quarentenaInvalida = form.quarentena > form.janela;
	const altoInvalido = form.alto_pct <= form.baixo_pct;
	const podeSalvar = podeEditar && !usandoPadrao && !busy && !quarentenaInvalida && !altoInvalido && form.janela >= 7 && form.janela <= 180;

	async function salvarConfig() {
		if (!supabase) return;
		setError(''); setSuccess('');
		if (form.janela < 7 || form.janela > 180) { setError('A janela deve ser entre 7 e 180 dias.'); return; }
		if (quarentenaInvalida) { setError('A quarentena não pode passar da janela.'); return; }
		if (altoInvalido) { setError('O limite Alto deve ser maior que o Baixo.'); return; }
		setBusy(true);
		const row: Record<string, unknown> = {
			plano_id: isPadrao ? null : selected,
			janela: form.janela,
			meia_vida: form.meia_vida,
			peso_falha: form.peso_falha,
			forca_base: form.forca_base,
			alto_pct: form.alto_pct,
			baixo_pct: form.baixo_pct,
			historico_minimo_baixo: form.historico_minimo_baixo,
			sem_historico_abaixo: form.sem_historico_abaixo,
			quarentena: form.quarentena,
			grupo_controle: form.grupo_controle,
		};
		let res;
		if (ownConfig?.id) {
			res = await supabase.from('mensageria_score_config').update(row).eq('id', ownConfig.id).select('*').single();
		} else {
			res = await supabase.from('mensageria_score_config').insert(row).select('*').single();
		}
		setBusy(false);
		if (res.error) { setError(friendlyError(res.error)); return; }
		const saved = normalizeConfig(res.data as Row);
		setConfigs(prev => ({ ...prev, [isPadrao ? '' : selected]: saved }));
		setSuccess('Filtro da rota salvo.');
	}

	async function toggleForn(f: Row, on: boolean) {
		if (!supabase || !podeEditar) return;
		setBusyForn(String(f.id));
		const fid = String(f.id);
		const existente = fornConsiderar[fid] !== undefined;
		let res;
		if (existente) {
			res = await supabase.from('mensageria_score_fornecedores').update({ considerar: on }).eq('fornecedor_id', fid);
		} else {
			res = await supabase.from('mensageria_score_fornecedores').insert({ fornecedor_id: fid, considerar: on });
		}
		setBusyForn(null);
		if (res.error) { setError(friendlyError(res.error)); return; }
		setFornConsiderar(prev => ({ ...prev, [fid]: on }));
	}

	async function salvarNomes() {
		if (!supabase) return;
		setErrorNomes(''); setSuccessNomes('');
		// validação client-side espelha a do banco.
		const campos: ('alto' | 'medio' | 'baixo' | 'sem')[] = ['alto', 'medio', 'baixo', 'sem'];
		const imita = campos.find(c => nomeImitaStatus(nomes[c]));
		if (imita) { setErrorNomes('Esse nome imita status de operadora. Escolha outro.'); return; }
		setBusyNomes(true);
		const row = { alto: nomes.alto.trim(), medio: nomes.medio.trim(), baixo: nomes.baixo.trim(), sem: nomes.sem.trim() };
		let res;
		if (nomes.id) {
			res = await supabase.from('mensageria_score_nomes').update(row).eq('id', nomes.id);
		} else {
			res = await supabase.from('mensageria_score_nomes').insert(row);
		}
		setBusyNomes(false);
		if (res.error) {
			// o banco recusa nomes que imitam status de operadora.
			const msg = String(res.error.message ?? '').toLowerCase();
			if (msg.includes('status') || msg.includes('operadora') || STATUS_PALAVRAS.some(w => msg.includes(w))) {
				setErrorNomes('Esse nome imita status de operadora. Escolha outro.');
			} else {
				setErrorNomes(friendlyError(res.error));
			}
			return;
		}
		setSuccessNomes('Nomes salvos. A mudança foi para a Auditoria.');
		void reload();
	}

	if (permsLoading) {
		return <ConsoleShell><p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p></ConsoleShell>;
	}

	return (
		<ConsoleShell>
			<div className="mb-5">
				<h2 className="mc-page-title text-[22px] font-bold text-[#1D1D1F]">Filtro de inteligência</h2>
				<p className="mt-1 text-[14px] text-[#6E6E73]">Define quais números valem a pena tentar no SMS, por rota. {podeEditar ? '' : 'Você está vendo em modo leitura.'}</p>
			</div>

			{error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}<ErrorDetail /></div>}

			{loading ? <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
				<div className="space-y-5">
					{/* Seletor de rota */}
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<label className="block max-w-[420px]">
							<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Rota</span>
							<select value={selected} onChange={e => setSelected(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
								<option value="">Padrão (todas as rotas sem configuração própria)</option>
								{rotas.map(r => <option key={String(r.id)} value={String(r.id)}>{String(r.nome)}</option>)}
							</select>
						</label>
						{usandoPadrao && (
							<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FFF7E8] px-4 py-3">
								<p className="text-[13px] text-[#9a631b]">Esta rota usa a configuração padrão.</p>
								{podeEditar && <button onClick={configurarSoEstaRota} className="h-9 rounded-full px-4 text-[13px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: MENSAGEM_COR }}>Configurar só esta rota</button>}
							</div>
						)}
					</section>

					{/* Modelo */}
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<h3 className="mb-1 text-[16px] font-semibold text-[#1D1D1F]">Modelo</h3>
						<p className="mb-4 text-[13px] text-[#6E6E73]">Probabilidade = (base da operadora × força + entregas ponderadas) ÷ (força + tentativas ponderadas). Peso de cada tentativa = ½ elevado a (idade ÷ meia-vida); “número inexistente” pesa mais.</p>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<NumField label="Janela (dias)" hint="7 a 180" value={form.janela} on={v => setField('janela', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Meia-vida do peso (dias)" value={form.meia_vida} on={v => setField('meia_vida', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Peso da falha permanente" hint="1 a 5" value={form.peso_falha} on={v => setField('peso_falha', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Força da base" hint="0 a 10" value={form.forca_base} on={v => setField('forca_base', v)} disabled={!podeEditar || usandoPadrao} />
						</div>
					</section>

					{/* Faixas */}
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<h3 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Faixas</h3>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<NumField label="Alto ≥ (%)" value={form.alto_pct} on={v => setField('alto_pct', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Baixo < (%)" value={form.baixo_pct} on={v => setField('baixo_pct', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Histórico mínimo para Baixo" value={form.historico_minimo_baixo} on={v => setField('historico_minimo_baixo', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Sem histórico abaixo de" value={form.sem_historico_abaixo} on={v => setField('sem_historico_abaixo', v)} disabled={!podeEditar || usandoPadrao} />
						</div>
						<p className="mt-3 text-[12px] text-[#8E8E93]">Médio = entre os dois limites.</p>
						{altoInvalido && <p className="mt-2 text-[12px] text-[#FF3B30]">O limite Alto deve ser maior que o Baixo.</p>}
					</section>

					{/* Quarentena + Grupo de controle */}
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<div className="grid gap-4 sm:grid-cols-2">
							<NumField label="Quarentena (dias)" hint="até um número Baixo voltar a ser tentado" value={form.quarentena} on={v => setField('quarentena', v)} disabled={!podeEditar || usandoPadrao} />
							<NumField label="Grupo de controle (%)" hint="0 a 5" value={form.grupo_controle} on={v => setField('grupo_controle', v)} disabled={!podeEditar || usandoPadrao} />
						</div>
						{quarentenaInvalida && <p className="mt-2 text-[12px] text-[#FF3B30]">A quarentena não pode passar da janela.</p>}
						<p className="mt-3 text-[12px] text-[#8E8E93]">Uma amostra sorteada dos números fora das faixas sai mesmo assim, para medir a entrega real. É cobrada como SMS normal.</p>
					</section>

					{/* Fornecedores */}
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<h3 className="mb-1 text-[16px] font-semibold text-[#1D1D1F]">Fornecedores que entram na análise</h3>
						<p className="mb-4 text-[13px] text-[#6E6E73]">DLR de fornecedor desmarcado é ignorada no cálculo.</p>
						{fornecedores.length === 0 ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Nenhum fornecedor cadastrado.</p> : (
							<div className="divide-y divide-[#F0F0F2]">
								{fornecedores.map(f => {
									const fid = String(f.id);
									const considerar = fornConsiderar[fid] !== false;
									return (
										<div key={fid} className="flex items-center justify-between gap-3 py-3">
											<div className="min-w-0">
												<p className="text-[15px] font-medium text-[#1D1D1F]">{f.nome}</p>
												<p className="font-mono text-[11px] text-[#8E8E93]">{f.codigo}</p>
											</div>
											<Chave checked={considerar} disabled={!podeEditar || busyForn === fid} on={v => toggleForn(f, v)} />
										</div>
									);
								})}
							</div>
						)}
					</section>

					{/* Nomes devolvidos ao cliente */}
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<h3 className="mb-1 text-[16px] font-semibold text-[#1D1D1F]">Nomes devolvidos ao cliente</h3>
						<p className="mb-4 text-[13px] text-[#6E6E73]">Como o cliente vê cada faixa. Nomes que imitam status de operadora (Entregue, Delivered, DELIVRD, UNDELIV, DLR…) são recusados. Toda mudança vai para a Auditoria.</p>
						<div className="grid gap-4 sm:grid-cols-2">
							<NomeField label="Alto" value={nomes.alto} on={v => setNomes(p => ({ ...p, alto: v }))} invalid={nomeImitaStatus(nomes.alto)} disabled={!podeEditar} />
							<NomeField label="Médio" value={nomes.medio} on={v => setNomes(p => ({ ...p, medio: v }))} invalid={nomeImitaStatus(nomes.medio)} disabled={!podeEditar} />
							<NomeField label="Baixo" value={nomes.baixo} on={v => setNomes(p => ({ ...p, baixo: v }))} invalid={nomeImitaStatus(nomes.baixo)} disabled={!podeEditar} />
							<NomeField label="Sem histórico" value={nomes.sem} on={v => setNomes(p => ({ ...p, sem: v }))} invalid={nomeImitaStatus(nomes.sem)} disabled={!podeEditar} />
						</div>
						{errorNomes && <p role="alert" className="mt-3 text-[13px] text-[#FF3B30]">{errorNomes}</p>}
						{successNomes && <p role="status" className="mt-3 text-[13px] text-[#248A3D]">{successNomes}</p>}
						{podeEditar && (
							<button onClick={salvarNomes} disabled={busyNomes} className="mt-4 h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">{busyNomes ? 'Salvando...' : 'Salvar nomes'}</button>
						)}
					</section>

					{/* Salvar filtro da rota */}
					{podeEditar && !usandoPadrao && (
						<div className="flex items-center gap-4">
							<button onClick={salvarConfig} disabled={!podeSalvar} className="h-11 rounded-xl px-6 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar filtro da rota'}</button>
							{success && <span className="text-[14px] text-[#248A3D]">{success}</span>}
						</div>
					)}
				</div>
			)}
		</ConsoleShell>
	);
}

// ---------- subcomponentes ----------

function NumField({ label, hint, value, on, disabled }: { label: string; hint?: string; value: number; on: (v: number) => void; disabled?: boolean }) {
	return (
		<label className="block">
			<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{label}</span>
			<input
				type="number"
				value={Number.isFinite(value) ? value : 0}
				onChange={e => on(num(e.target.value))}
				disabled={disabled}
				className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7] disabled:text-[#8E8E93]"
			/>
			{hint && <span className="mt-1 flex items-center gap-1 text-[11px] text-[#8E8E93]"><Info size={11} /> {hint}</span>}
		</label>
	);
}

function NomeField({ label, value, on, invalid, disabled }: { label: string; value: string; on: (v: string) => void; invalid: boolean; disabled?: boolean }) {
	return (
		<label className="block">
			<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{label}</span>
			<input
				value={value}
				onChange={e => on(e.target.value)}
				disabled={disabled}
				className={`h-10 w-full rounded-lg border px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7] disabled:text-[#8E8E93] ${invalid ? 'border-[#FF3B30] text-[#FF3B30]' : 'border-[#D2D2D7] text-[#1D1D1F]'}`}
			/>
			{invalid && <span className="mt-1 block text-[11px] text-[#FF3B30]">Esse nome imita status de operadora. Escolha outro.</span>}
		</label>
	);
}
