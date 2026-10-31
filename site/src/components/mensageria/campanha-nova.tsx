import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Upload, Check } from 'lucide-react';
import { supabase, friendlyError, safeFileName, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { isCanalValido, TIPO_COLUNA_NOME, USO_COLUNA, PRODUTO_MAP, type ScoreFormacao } from '@/lib/mensageria-produtos';
import { ScorePreviaCard, type ScorePrevia } from '@/components/mensageria/score-previa-card';
import { ProcessoLongo } from '@/components/comuns/processo-longo';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';

const PASSOS = ['Dados', 'Lista', 'Layout', 'Envio'];
const FAIXAS_DEFAULT = ['alto', 'medio', 'sem'];

export function CampanhaNova() {
	const { canal } = useParams();
	const { empresa } = useMotorAuth();
	const navigate = useNavigate();
	const [passo, setPasso] = useState(0);
	const [nome, setNome] = useState('');
	const [templateId, setTemplateId] = useState('');
	const [centroId, setCentroId] = useState('');
	const [rcsFallback, setRcsFallback] = useState('config');
	const [rcsFallbackTemplate, setRcsFallbackTemplate] = useState('');
	const [rastrear, setRastrear] = useState(false);
	const [templates, setTemplates] = useState<Row[]>([]);
	const [templatesSms, setTemplatesSms] = useState<Row[]>([]);
	const [centros, setCentros] = useState<Row[]>([]);
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState(false);
	const [campanhaId, setCampanhaId] = useState('');
	const [carregados, setCarregados] = useState(0);
	const [layout, setLayout] = useState<Row | null>(null);
	const [colunaUso, setColunaUso] = useState<Record<string, string>>({});
	const [variavelNomes, setVariavelNomes] = useState<Record<string, string>>({});
	const [agendar, setAgendar] = useState(false);
	const [dataAg, setDataAg] = useState('');
	const [horaAg, setHoraAg] = useState('');
	// Score de Entrega (só SMS com o Score contratado).
	const [scoreAtivo, setScoreAtivo] = useState(false);
	const [previaEstado, setPreviaEstado] = useState<'idle' | 'calculando' | 'pronta'>('idle');
	const [scorePrevia, setScorePrevia] = useState<ScorePrevia | null>(null);
	const [scoreOn, setScoreOn] = useState(true);
	const [faixasSel, setFaixasSel] = useState<string[]>(FAIXAS_DEFAULT);
	const [formacao, setFormacao] = useState<ScoreFormacao | null>(null);
	const [analisando, setAnalisando] = useState(false);
	const [etapaAnalise, setEtapaAnalise] = useState(0);
	const [confirmaAgendar, setConfirmaAgendar] = useState(false);
	const [confirmaCancelar, setConfirmaCancelar] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const isEmail = canal === 'email';
	const isRcs = canal === 'rcs';
	const isSms = canal === 'sms';

	useEffect(() => {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		let active = true;
		(async () => {
			const [t, ts, cc] = await Promise.all([
				supabase.from('mensageria_templates').select('id,nome,variaveis').eq('empresa_id', empresa.id).eq('canal', canal).eq('situacao', 'ativo').order('nome'),
				supabase.from('mensageria_templates').select('id,nome').eq('empresa_id', empresa.id).eq('canal', 'sms').eq('situacao', 'ativo').order('nome'),
				supabase.from('mensageria_centros_custo').select('id,nome').eq('empresa_id', empresa.id).order('nome'),
			]);
			if (!active) return;
			setTemplates(t.data ?? []);
			setTemplatesSms(ts.data ?? []);
			setCentros(cc.data ?? []);
		})();
		return () => { active = false; };
	}, [empresa?.id, canal]);

	// Verifica se o Score de Entrega está contratado (só relevante para SMS) e lê a formação do histórico.
	useEffect(() => {
		if (!supabase || !empresa || !isSms) { setScoreAtivo(false); setFormacao(null); return; }
		let active = true;
		(async () => {
			const { data } = await supabase.from('empresa_score').select('ativo').eq('empresa_id', empresa.id).maybeSingle();
			if (active) setScoreAtivo(!!(data as Row | null)?.ativo);
			const { data: f } = await supabase.rpc('score_formacao');
			if (active) setFormacao((f as ScoreFormacao | null) ?? null);
		})();
		return () => { active = false; };
	}, [empresa?.id, isSms]);

	async function salvarDados() {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		if (!nome.trim()) { setErro('Informe o nome.'); return; }
		if (!templateId && !isEmail) { setErro('Escolha o template.'); return; }
		setBusy(true); setErro('');
		const payload: Record<string, unknown> = { empresa_id: empresa.id, canal, nome: nome.trim(), template_id: isEmail ? null : templateId, centro_custo_id: centroId || null, rastrear_links: rastrear };
		if (isRcs) { payload.rcs_fallback = rcsFallback; payload.rcs_fallback_template = rcsFallbackTemplate || null; }
		const { data, error } = await supabase.from('mensageria_campanhas').insert(payload).select('id').single();
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		setCampanhaId(data.id);
		setPasso(1);
	}

	async function subirArquivo(file: File) {
		if (!supabase || !empresa || !campanhaId) return;
		setAnalisando(true); setEtapaAnalise(0); setErro('');
		const slug = empresa.slug || empresa.id;
		const caminho = `${slug}/mensageria/${crypto.randomUUID()}/${safeFileName(file.name)}`;
		const { error: upErr } = await supabase.storage.from('entradas').upload(caminho, file);
		if (upErr) { setAnalisando(false); setErro(friendlyError(upErr)); return; }
		setEtapaAnalise(1);
		const { error } = await supabase.from('mensageria_campanhas').update({ arquivo_caminho: caminho, arquivo_nome: file.name, situacao: 'analisando' }).eq('id', campanhaId);
		if (error) { setAnalisando(false); setErro(friendlyError(error)); return; }
		pollCampanha();
	}

	async function pollCampanha() {
		const sb = supabase;
		if (!sb || !campanhaId) return;
		let tentativas = 0;
		const tick = async () => {
			const { data } = await sb.from('mensageria_campanhas').select('situacao,carregados,layout_sugerido,erro_texto').eq('id', campanhaId).maybeSingle();
			const c = data as Row | null;
			if (!c) return;
			if (c.situacao === 'aguardando_layout') {
				setAnalisando(false);
				setCarregados(+c.carregados || 0);
				setLayout((c.layout_sugerido as Row | null) ?? null);
				const cols = ((c.layout_sugerido as Row | null)?.colunas as Row[] | undefined) ?? [];
				const uso: Record<string, string> = {};
				cols.forEach(col => { if (col.sugestao) uso[col.nome as string] = col.sugestao as string; });
				setColunaUso(uso);
				setPasso(2);
				return;
			}
			if (c.situacao === 'erro') { setAnalisando(false); setErro(c.erro_texto || 'Erro ao ler a lista.'); return; }
			if (++tentativas < 40) setTimeout(tick, 3000);
		};
		tick();
	}

	async function confirmarLayout() {
		if (!supabase || !campanhaId) return;
		setBusy(true); setErro('');
		const telefone = Object.entries(colunaUso).find(([, u]) => u === 'telefone')?.[0] ?? null;
		const email = Object.entries(colunaUso).find(([, u]) => u === 'email')?.[0] ?? null;
		const id_cliente = Object.entries(colunaUso).find(([, u]) => u === 'id_cliente')?.[0] ?? null;
		const variaveis: Record<string, string> = {};
		Object.entries(colunaUso).forEach(([col, u]) => { if (u === 'variavel') variaveis[variavelNomes[col] || col] = col; });
		const { error } = await supabase.rpc('confirmar_layout', { campanha: campanhaId, layout: { telefone, email, id_cliente, variaveis } });
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		setPasso(3);
		if (isSms && scoreAtivo) {
			setPreviaEstado('calculando');
			void pollPrevia();
		} else {
			setPreviaEstado('pronta');
		}
	}

	// Recarrega a campanha a cada 15 s enquanto o Score calcula a prévia.
	async function pollPrevia() {
		const sb = supabase;
		if (!sb || !campanhaId) return;
		let tentativas = 0;
		const tick = async () => {
			const { data } = await sb.from('mensageria_campanhas').select('situacao,score_previa,erro_texto').eq('id', campanhaId).maybeSingle();
			const c = data as Row | null;
			if (!c) return;
			if (c.situacao === 'pronta') {
				setScorePrevia((c.score_previa as ScorePrevia | null) ?? null);
				setPreviaEstado('pronta');
				return;
			}
			if (c.situacao === 'erro') { setErro(c.erro_texto || 'Erro ao calcular a prévia do Score.'); setPreviaEstado('pronta'); return; }
			if (c.situacao === 'calculando_previa') { setPreviaEstado('calculando'); }
			if (++tentativas < 120) setTimeout(tick, 15000);
		};
		tick();
	}

	function toggleFaixa(id: string) {
		setFaixasSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
	}
	function toggleTodos() {
		setFaixasSel(prev => prev.length === 4 ? FAIXAS_DEFAULT : ['alto', 'medio', 'baixo', 'sem']);
	}

	async function enviar() {
		if (!supabase || !campanhaId) return;
		// Score ligado sem faixa selecionada: não agenda.
		if (isSms && scoreAtivo && scorePrevia && scoreOn && faixasSel.length === 0) return;
		setBusy(true); setErro('');
		const quando = agendar && dataAg && horaAg ? `${dataAg}T${horaAg}:00` : null;
		const params: Record<string, unknown> = { campanha: campanhaId, quando };
		if (isSms && scoreAtivo && scorePrevia) {
			params.faixas = scoreOn ? faixasSel : null;
		}
		const { error } = await supabase.rpc('agendar_campanha', params);
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		navigate(`/mensageria/${canal}/campanhas/${campanhaId}`);
	}

	async function cancelar() {
		if (!supabase || !campanhaId) return;
		await supabase.rpc('cancelar_campanha', { campanha: campanhaId });
		navigate(`/mensageria/${canal}/campanhas`);
	}

	if (!isCanalValido(canal)) return null;
	const colunas = (layout?.colunas as Row[] | undefined) ?? [];
	const avisos = (layout?.avisos as string[] | undefined) ?? [];
	const templateVars = (templates.find(t => t.id === templateId)?.variaveis as string[] | undefined) ?? [];
	const mostrarScore = isSms && scoreAtivo && scorePrevia && previaEstado === 'pronta';
	const scoreSemSelecao = !!(mostrarScore && scoreOn && faixasSel.length === 0);

	// Texto da confirmação de agendamento (item 3).
	const canalNome = isCanalValido(canal) ? (PRODUTO_MAP[canal]?.nome ?? canal) : canal;
	const enviadosAg = mostrarScore && scorePrevia && scoreOn
		? faixasSel.reduce((s, id) => s + Number((scorePrevia.faixas as Record<string, number>)[id] ?? 0), 0)
		: carregados;
	const rotaAg = mostrarScore && scoreOn ? 'Score de Entrega' : 'padrão do canal';
	const quandoAg = agendar && dataAg && horaAg ? `${dataAg.split('-').reverse().join('/')} às ${horaAg}` : 'agora';
	const custoAg = (() => {
		if (!scoreOn || !mostrarScore) return null;
		const sp = scorePrevia;
		if (!sp) return null;
		const n = Math.max(0, sp.analisados - enviadosAg);
		const sc = sp.cobranca === 'analisado' ? sp.analisados * (sp.preco_score ?? 0) : n * (sp.preco_score ?? 0);
		return (enviadosAg * (sp.preco_sms ?? 0) + sc).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
	})();

	return (
		<div className="space-y-5">
			<button onClick={() => navigate(`/mensageria/${canal}/campanhas`)} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0A60D0] hover:underline"><ArrowLeft size={15} /> Voltar</button>

			{/* Indicador de passos */}
			<div className="flex items-center gap-2">
				{PASSOS.map((p, i) => (
					<div key={p} className="flex items-center gap-2">
						<span className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold ${i < passo ? 'bg-[#34C759] text-white' : i === passo ? 'bg-[#1D1D1F] text-white' : 'bg-[#E5E5EA] text-[#8E8E93]'}`}>{i < passo ? <Check size={14} /> : i + 1}</span>
						<span className={`text-[14px] font-medium ${i === passo ? 'text-[#1D1D1F]' : 'text-[#8E8E93]'}`}>{p}</span>
						{i < PASSOS.length - 1 && <span className="mx-1 h-px w-8 bg-[#E5E5EA]" />}
					</div>
				))}
			</div>

			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				{passo === 0 && (
					<div className="max-w-[560px] space-y-4">
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Nome *</label>
							<input value={nome} onChange={e => setNome(e.target.value)} maxLength={120} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
						</div>
						{!isEmail && (
							<div>
								<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Template *</label>
								<select value={templateId} onChange={e => setTemplateId(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
									<option value="">Escolha o template</option>
									{templates.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
								</select>
							</div>
						)}
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Centro de custo (opcional)</label>
							<select value={centroId} onChange={e => setCentroId(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
								<option value="">Sem centro de custo</option>
								{centros.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
							</select>
						</div>
						{isRcs && (
							<div>
								<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Se o aparelho não tiver RCS</label>
								<select value={rcsFallback} onChange={e => setRcsFallback(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
									<option value="config">Usar a configuração da empresa</option>
									<option value="sms">Enviar por SMS</option>
									<option value="whatsapp">Enviar por WhatsApp</option>
									<option value="nenhum">Não enviar</option>
								</select>
								{rcsFallback === 'sms' && (
									<select value={rcsFallbackTemplate} onChange={e => setRcsFallbackTemplate(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">
										<option value="">Template de SMS do fallback (opcional)</option>
										{templatesSms.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
									</select>
								)}
							</div>
						)}
						<div className="flex items-center justify-between rounded-lg border border-[#E5E5EA] px-4 py-3">
							<span className="text-[14px] font-medium text-[#1D1D1F]">Rastrear links</span>
							<button role="switch" aria-checked={rastrear} onClick={() => setRastrear(!rastrear)} className={`relative h-6 w-11 rounded-full transition-colors ${rastrear ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${rastrear ? 'left-6' : 'left-1'}`} /></button>
						</div>
						<div className="flex justify-end pt-2">
							<button onClick={salvarDados} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Avançar'}</button>
						</div>
					</div>
				)}

				{passo === 1 && analisando && (
					<ProcessoLongo
						etapas={['Recebendo o arquivo', 'Lendo as colunas']}
						etapaAtual={etapaAnalise}
						linhas={carregados || undefined}
						aviso="Lendo a lista da campanha."
						onSair={() => navigate(`/mensageria/${canal}/campanhas`)}
					/>
				)}

				{passo === 1 && !analisando && (
					<div className="max-w-[560px]">
						<input ref={fileRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void subirArquivo(f); }} />
						<button onClick={() => fileRef.current?.click()} disabled={busy} className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[#D2D2D7] py-12 text-[#6E6E73] hover:bg-[#F5F5F7] disabled:opacity-50">
							<Upload size={28} />
							<span className="text-[15px] font-medium text-[#1D1D1F]">Arraste ou escolha o arquivo</span>
							<span className="text-[13px]">.csv, .txt, .xlsx · até 20 MB</span>
						</button>
						<p className="mt-3 text-[13px] text-[#6E6E73]">Qualquer layout: o MotorCX identifica as colunas e você confirma.</p>
						<div className="mt-4 flex justify-between">
							<button onClick={() => setConfirmaCancelar(true)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						</div>
					</div>
				)}

				{passo === 2 && (
					<div>
						<p className="mb-4 text-[15px] font-medium text-[#1D1D1F]">{carregados.toLocaleString('pt-BR')} linhas</p>
						{avisos.length > 0 && <div className="mb-4 rounded-xl bg-[#FFF8E1] px-4 py-3 text-[14px] text-[#9a631b]" style={{ border: '1px solid #FFE08A' }}>{avisos.map((a, i) => <p key={i}>{a}</p>)}</div>}
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-[14px]">
								<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
									<th className="py-2 pr-4">Coluna</th><th className="py-2 pr-4">Tipo identificado</th><th className="py-2 pr-4 text-right">% preenchida</th><th className="py-2 pr-4">Uso</th>
								</tr></thead>
								<tbody>
									{colunas.map((col, i) => {
										const uso = colunaUso[col.nome as string] ?? 'ignorar';
										return (
											<tr key={i} className="border-b border-[#F0F0F2]">
												<td className="py-2.5 pr-4 font-medium text-[#1D1D1F]">{col.nome}</td>
												<td className="py-2.5 pr-4 text-[#6E6E73]">{TIPO_COLUNA_NOME[col.tipo as string] ?? col.tipo}</td>
												<td className="py-2.5 pr-4 text-right tnum text-[#6E6E73]">{col.pct != null ? `${Math.round(+col.pct)}%` : '—'}</td>
												<td className="py-2.5 pr-4">
													<select value={uso} onChange={e => setColunaUso(prev => ({ ...prev, [col.nome as string]: e.target.value }))} className="h-9 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">
														{USO_COLUNA.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
													</select>
													{uso === 'variavel' && <input value={variavelNomes[col.nome as string] ?? ''} onChange={e => setVariavelNomes(prev => ({ ...prev, [col.nome as string]: e.target.value }))} placeholder="nome" className="ml-2 h-9 w-24 rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none" />}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						{templateVars.length > 0 && templateVars.filter(v => !Object.values(colunaUso).includes('variavel') || !Object.values(variavelNomes).includes(v)).length > 0 && (
							<p className="mt-3 text-[13px] text-[#FF3B30]">Variáveis sem coluna: {templateVars.filter(v => !Object.values(variavelNomes).includes(v)).join(', ')}</p>
						)}
						<div className="mt-5 flex justify-between">
							<button onClick={() => setConfirmaCancelar(true)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
							<button onClick={confirmarLayout} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Confirmando...' : 'Confirmar layout'}</button>
						</div>
					</div>
				)}

				{passo === 3 && previaEstado === 'calculando' && (
					<ProcessoLongo
						etapas={['Limpando telefones e repetidos', 'Calculando a prévia do Score']}
						etapaAtual={1}
						linhas={carregados || undefined}
						aviso="Calculando a prévia do Score de Entrega."
						onSair={() => navigate(`/mensageria/${canal}/campanhas`)}
					/>
				)}

				{passo === 3 && previaEstado !== 'calculando' && (
					<div className="max-w-[640px] space-y-4">
						<div className="rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-4">
							<p className="text-[14px] text-[#1D1D1F]">Prévia do template com as variáveis como etiquetas ({'{{nome}}'}). Nunca mostramos dados da lista.</p>
						</div>

						{mostrarScore && scorePrevia && (
							<ScorePreviaCard
								previa={scorePrevia}
								scoreOn={scoreOn}
								onScoreOn={setScoreOn}
								faixasSel={faixasSel}
								onToggleFaixa={toggleFaixa}
								onToggleTodos={toggleTodos}
								formacao={formacao}
							/>
						)}

						<div className="flex items-center justify-between rounded-lg border border-[#E5E5EA] px-4 py-3">
							<span className="text-[14px] font-medium text-[#1D1D1F]">Agendar</span>
							<button role="switch" aria-checked={agendar} onClick={() => setAgendar(!agendar)} className={`relative h-6 w-11 rounded-full transition-colors ${agendar ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${agendar ? 'left-6' : 'left-1'}`} /></button>
						</div>
						{agendar && (
							<div className="flex gap-3">
								<input type="date" value={dataAg} onChange={e => setDataAg(e.target.value)} className="h-10 flex-1 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" />
								<input type="time" value={horaAg} onChange={e => setHoraAg(e.target.value)} className="h-10 w-32 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" />
							</div>
						)}
						<p className="text-[13px] text-[#6E6E73]">Os envios respeitam o horário do canal, o orçamento do centro de custo e as listas de bloqueio.</p>
						<div className="flex justify-between pt-2">
							<button onClick={() => setConfirmaCancelar(true)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
							<button onClick={() => setConfirmaAgendar(true)} disabled={busy || scoreSemSelecao} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Enviando...' : agendar ? 'Agendar envio' : 'Enviar agora'}</button>
						</div>
					</div>
				)}
			</div>

			<ConfirmaAcao
				aberto={confirmaAgendar}
				titulo={agendar ? 'Agendar envio' : 'Enviar agora'}
				texto={<>{enviadosAg.toLocaleString('pt-BR')} {canalNome} serão enviados em {quandoAg}, pela rota {rotaAg}.{custoAg ? <> Custo previsto de {custoAg}.</> : null} Até o horário você ainda pode cancelar.</>}
				botao={agendar ? `Agendar ${enviadosAg.toLocaleString('pt-BR')} ${canalNome}` : `Enviar ${enviadosAg.toLocaleString('pt-BR')} ${canalNome}`}
				onConfirm={() => { setConfirmaAgendar(false); void enviar(); }}
				onClose={() => setConfirmaAgendar(false)}
				loading={busy}
			/>

			<ConfirmaAcao
				aberto={confirmaCancelar}
				titulo="Cancelar a campanha"
				texto="A campanha não será enviada. A prévia e o agendamento são descartados."
				botao="Cancelar a campanha"
				corBotao="#FF3B30"
				onConfirm={() => { setConfirmaCancelar(false); void cancelar(); }}
				onClose={() => setConfirmaCancelar(false)}
			/>
		</div>
	);
}
