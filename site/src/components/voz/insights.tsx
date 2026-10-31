// Tela 6 · Cobrança › Resultados › Insights de voz. Só agregados (insights_voz soma no servidor e devolve
// null para grupos com menos de 30 conversas). Sugestões levam para Frases e Abordagem; quem muda é a pessoa.
// Propensão em modo sombra (voz_resultado_por_motivo): só observação.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { MIN_CONVERSAS, MOTIVO_LABEL, OBJECAO_LABEL, diaISO, inteiro, pct } from '@/lib/voz';
import { BarraAgregado, Botao, Cartao, Kpi, Pilula, Tabela, Vazio, campoCls, campoStyle } from './ui';

type Linha = { campo: string; valor: string; qtd: number | null; conversas: number; pct: number | null };
type PorPersona = { persona: string; conversas: number; esq: number | null; renda: number | null; parcela: number | null; promessa: number | null };

const PERIODOS = [{ d: 7, n: 'Últimos 7 dias' }, { d: 30, n: 'Últimos 30 dias' }, { d: 90, n: 'Últimos 90 dias' }];
const DISPENSADAS_KEY = 'motorcx.voz.sugestoes-dispensadas';

function normal(rows: Row[] | null): Linha[] {
	return (rows ?? []).map(r => ({ campo: String(r.campo), valor: String(r.valor), qtd: r.qtd == null ? null : Number(r.qtd), conversas: Number(r.conversas ?? 0), pct: r.pct == null ? null : Number(r.pct) }));
}
function soma(ls: Linha[], campo: string): number | null {
	const xs = ls.filter(l => l.campo === campo);
	if (xs.length === 0) return 0;
	if (xs.some(l => l.qtd == null)) return null;
	return xs.reduce((t, l) => t + (l.qtd ?? 0), 0);
}
function pctDe(ls: Linha[], campo: string, valor?: string): number | null {
	const xs = ls.filter(l => l.campo === campo && (valor == null || l.valor === valor));
	if (xs.length === 0) return ls.length && ls[0].conversas >= MIN_CONVERSAS ? 0 : null;
	if (xs.some(l => l.pct == null)) return null;
	return xs.reduce((t, l) => t + (l.pct ?? 0), 0);
}

function lerDispensadas(): string[] {
	try { return JSON.parse(localStorage.getItem(DISPENSADAS_KEY) ?? '[]') as string[]; } catch { return []; }
}

export function InsightsVoz() {
	const { empresa, credor } = useMotorAuth();
	const [dias, setDias] = useState(30);
	const [persona, setPersona] = useState('');
	const [origem, setOrigem] = useState('');
	const [personas, setPersonas] = useState<string[]>([]);
	const [linhas, setLinhas] = useState<Linha[]>([]);
	const [porPersona, setPorPersona] = useState<PorPersona[]>([]);
	const [sombra, setSombra] = useState<{ motivo: string; conversas: number; pagamentos: number }[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [dispensadas, setDispensadas] = useState<string[]>(lerDispensadas);

	const credorId = credor?.id ?? null;

	useEffect(() => {
		if (!supabase || !empresa) return;
		const sb = supabase;
		let active = true;
		setLoading(true); setError('');
		(async () => {
			const de = diaISO(-(dias - 1));
			const ate = diaISO();
			const base = { credor: credorId, de, ate, origem: origem || null };
			const [geral, ps, rpm] = await Promise.all([
				sb.rpc('insights_voz', { ...base, persona: persona || null }),
				sb.from('voz_insights_dia').select('persona').eq('empresa_id', empresa.id).eq('credor_id', credorId ?? 0).gte('data', de).lte('data', ate).eq('campo', 'conversas').limit(2000),
				sb.from('voz_resultado_por_motivo').select('motivo,conversas,pagamentos').eq('empresa_id', empresa.id).eq('credor_id', credorId ?? 0).gte('data', de).lte('data', ate).limit(5000),
			]);
			if (!active) return;
			if (geral.error) { setError(friendlyError(geral.error)); setLoading(false); return; }
			setLinhas(normal(geral.data as Row[] | null));
			const nomes = [...new Set(((ps.data ?? []) as Row[]).map(r => String(r.persona ?? '')))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR'))).slice(0, 12);
			setPersonas(nomes);
			const pp = await Promise.all(nomes.map(async nome => {
				const { data } = await sb.rpc('insights_voz', { ...base, persona: nome });
				const ls = normal(data as Row[] | null);
				return { persona: nome, conversas: ls[0]?.conversas ?? 0, esq: pctDe(ls, 'motivo', 'esquecimento'), renda: pctDe(ls, 'motivo', 'reducao_renda'), parcela: pctDe(ls, 'objecao', 'parcela_alta'), promessa: pctDe(ls, 'promessa') };
			}));
			if (!active) return;
			setPorPersona(pp);
			const agg = new Map<string, { conversas: number; pagamentos: number }>();
			for (const r of (rpm.data ?? []) as Row[]) {
				const k = String(r.motivo); const a = agg.get(k) ?? { conversas: 0, pagamentos: 0 };
				a.conversas += Number(r.conversas ?? 0); a.pagamentos += Number(r.pagamentos ?? 0); agg.set(k, a);
			}
			setSombra([...agg.entries()].map(([motivo, v]) => ({ motivo, ...v })).filter(x => x.conversas >= MIN_CONVERSAS).sort((a, b) => b.conversas - a.conversas));
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, credorId, dias, persona, origem]);

	function dispensar(id: string) {
		const n = [...dispensadas, id];
		setDispensadas(n);
		try { localStorage.setItem(DISPENSADAS_KEY, JSON.stringify(n.slice(-100))); } catch { /* sem armazenamento: some só nesta visita */ }
	}

	const conversas = linhas[0]?.conversas ?? 0;
	const pequeno = conversas > 0 && conversas < MIN_CONVERSAS;
	const motivos = linhas.filter(l => l.campo === 'motivo');
	const objecoes = linhas.filter(l => l.campo === 'objecao');
	const maxMot = Math.max(1, ...motivos.map(m => m.pct ?? 0));
	const maxObj = Math.max(1, ...objecoes.map(m => m.pct ?? 0));
	const nomePersona = (p: string) => (p === '' ? 'Sem persona' : p);

	const sugestoes: { id: string; titulo: string; texto: string; to: string; botao: string }[] = [];
	for (const p of porPersona) {
		if (p.conversas < MIN_CONVERSAS) continue;
		if (p.esq != null && p.esq >= 25) sugestoes.push({ id: `esq:${p.persona}:${credorId ?? 0}`, titulo: `Na persona ${nomePersona(p.persona)}, ${pct(p.esq, 0)} dizem que esqueceram.`, texto: 'Uma frase de lembrete com o link, num canal digital antes da ligação, costuma resolver esse grupo sem ligar.', to: '/canais?secao=frases', botao: 'Abrir Frases' });
		if (p.parcela != null && p.parcela >= 20) sugestoes.push({ id: `parc:${p.persona}:${credorId ?? 0}`, titulo: `"Parcela alta" aparece em ${pct(p.parcela, 0)} das conversas da persona ${nomePersona(p.persona)}.`, texto: 'Vale testar a Abordagem com proposta de mais parcelas logo na primeira conversa.', to: '/personas', botao: 'Abrir Abordagem' });
	}
	const visiveis = sugestoes.filter(s => !dispensadas.includes(s.id)).slice(0, 4);

	const filtros = (
		<div className="mb-4 flex flex-wrap items-center gap-2">
			<select aria-label="Período" value={dias} onChange={e => setDias(Number(e.target.value))} className={campoCls} style={campoStyle}>{PERIODOS.map(p => <option key={p.d} value={p.d}>{p.n}</option>)}</select>
			<select aria-label="Persona" value={persona} onChange={e => setPersona(e.target.value)} className={campoCls} style={campoStyle}>
				<option value="">Todas as personas</option>
				{personas.map(p => <option key={p} value={p}>{nomePersona(p)}</option>)}
			</select>
			<select aria-label="Origem" value={origem} onChange={e => setOrigem(e.target.value)} className={campoCls} style={campoStyle}>
				<option value="">Agente virtual e discador</option>
				<option value="ia">Só agente virtual</option>
				<option value="discador">Só discador</option>
			</select>
			<span className="text-[12px] text-[var(--base-texto-3)]">{credor ? `Carteira ${credor.nome}` : 'Todas as carteiras'}</span>
		</div>
	);

	return (
		<>
			<PageHeading title="Insights de voz" description="O que as pessoas disseram nas ligações · só números agregados" />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : (
				<>
					{filtros}
					{error ? <Notice>{error}</Notice> : loading ? <Loading /> : conversas === 0 ? (
						<Vazio titulo="Ainda não há conversas analisadas neste período.">Os insights aparecem quando as ligações com identidade confirmada são transcritas e analisadas. Grupos com menos de {MIN_CONVERSAS} conversas não mostram percentual.</Vazio>
					) : (
						<div className="space-y-4">
							{pequeno && <Notice variant="warning">Este recorte tem {inteiro(conversas)} conversas, menos de {MIN_CONVERSAS}: os percentuais ficam escondidos para não expor ninguém. Aumente o período ou tire um filtro.</Notice>}
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
								<Kpi rotulo="Conversas analisadas" valor={inteiro(conversas)} detalhe="com identidade confirmada" />
								<Kpi rotulo="Promessas" valor={soma(linhas, 'promessa') == null ? '—' : inteiro(soma(linhas, 'promessa'))} detalhe={pctDe(linhas, 'promessa') == null ? 'menos de 30 conversas' : `${pct(pctDe(linhas, 'promessa'))} das conversas`} />
								<Kpi rotulo="Pediram retorno" valor={soma(linhas, 'retorno') == null ? '—' : inteiro(soma(linhas, 'retorno'))} detalhe={pctDe(linhas, 'retorno') == null ? 'menos de 30 conversas' : `${pct(pctDe(linhas, 'retorno'))} das conversas`} />
								<Kpi rotulo="Pediram para não ligar" valor={soma(linhas, 'nao_ligar') == null ? '—' : inteiro(soma(linhas, 'nao_ligar'))} detalhe="saíram da voz na hora" />
							</div>

							<div className="grid gap-4 lg:grid-cols-2">
								<Cartao titulo="Motivo do não pagamento">
									{motivos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhum motivo registrado no período.</p> : motivos.map(m => <BarraAgregado key={m.valor} nome={MOTIVO_LABEL[m.valor] ?? m.valor} pct={m.pct} qtd={m.qtd} max={maxMot} />)}
									<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Saúde e luto nunca viram motivo: o detalhe não é guardado.</p>
								</Cartao>
								<Cartao titulo="Objeções" linha="Uma conversa pode ter mais de uma.">
									{objecoes.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma objeção registrada no período.</p> : objecoes.map(m => <BarraAgregado key={m.valor} nome={OBJECAO_LABEL[m.valor] ?? m.valor} pct={m.pct} qtd={m.qtd} max={maxObj} cor="var(--base-texto-2)" />)}
								</Cartao>
							</div>

							<Cartao semPadding titulo="Por persona" linha={`Grupos com menos de ${MIN_CONVERSAS} conversas não mostram percentual.`}>
								<Tabela
									cabecalho={['Persona', 'Conversas', 'Esqueceu', 'Redução de renda', 'Parcela alta', 'Promessa']}
									numericas={[1, 2, 3, 4, 5]}
									vazio={<p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Sem divisão por persona neste período.</p>}
									linhas={porPersona.map(p => {
										const peq = p.conversas < MIN_CONVERSAS;
										const c = (v: number | null) => (peq || v == null ? <span className="text-[var(--base-texto-3)]">&lt;30</span> : pct(v, 0));
										return [nomePersona(p.persona), peq ? '<30' : inteiro(p.conversas), c(p.esq), c(p.renda), c(p.parcela), c(p.promessa)];
									})}
								/>
							</Cartao>

							<section>
								<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Sugestões para Frases e Abordagem</h2>
								<p className="mb-2 text-[12.5px] text-[var(--base-texto-2)]">A ferramenta sugere; quem muda é você.</p>
								{visiveis.length === 0 ? (
									<p className="rounded-xl bg-[var(--base-fill)] px-4 py-3 text-[13px] text-[var(--base-texto-2)]">Sem sugestões por enquanto. Elas aparecem quando uma persona passa de {MIN_CONVERSAS} conversas e um motivo ou uma objeção se destaca.</p>
								) : (
									<div className="space-y-2.5">
										{visiveis.map(s => (
											<div key={s.id} className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--estado-info-fundo)' }}>
												<span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ backgroundColor: 'var(--estado-info)', color: 'var(--base-cartao)' }}>i</span>
												<div className="min-w-0 text-[13px] text-[var(--base-texto)]">
													<b className="block">{s.titulo}</b>{s.texto}
													<div className="mt-2 flex flex-wrap gap-2">
														<Link to={s.to} className="inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>{s.botao}</Link>
														<Botao secundario onClick={() => dispensar(s.id)}>Dispensar</Botao>
													</div>
												</div>
											</div>
										))}
									</div>
								)}
							</section>

							<Cartao titulo={<span className="flex items-center gap-2">Propensão: só observação <Pilula>modo sombra</Pilula></span>}>
								{sombra.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Ainda sem pagamentos suficientes por motivo neste período.</p> : (
									<p className="text-[13px] leading-relaxed text-[var(--base-texto)]">Quem pagou, por motivo: {sombra.slice(0, 5).map(s => `${(MOTIVO_LABEL[s.motivo] ?? s.motivo).toLowerCase()} ${pct((100 * s.pagamentos) / Math.max(1, s.conversas), 0)}`).join(' · ')}.</p>
								)}
								<p className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">O número não muda a ordem nem o canal de ninguém; o comitê decide se vira variável, com pelo menos 200 casos por motivo.</p>
							</Cartao>
						</div>
					)}
				</>
			)}
		</>
	);
}
