// Tela 7 · Agente virtual › Testar com personas (roleplay, SQL 59). Conversas simuladas em lote, com um modelo de
// linguagem no papel do devedor seguindo uma persona (só ficção; nunca dado de cliente), contra o MESMO executor da
// ligação. Pedido pela Edge Function simular_fluxo_voz (acao roleplay → rodar_roleplay_voz, editar_canais); resultado em
// resultado_roleplay_voz e roleplay_conversas (só códigos e a transcrição simulada, apagada em 90 dias). É aviso na
// aprovação (fluxo_voz_avisos), nunca bloqueio. Conversa reprovada vira caso de teste (roleplay_para_caso_teste).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Play } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { Aviso, Botao, Cartao, Kpi, Pilula, Tabela, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import { DIFICULDADE, NOMES_TRAVA, QTDS_ROLEPLAY, dataCurta, explicar, nTxt, roleplayValido, totalRoleplay } from '@/lib/fluxo';
import type { ConversaRow, PersonaRow, ResultadoLoteRow } from './api';
import { Barra2, Detalhes, Gaveta, Kv, Linhas, Seg, Selo } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { executar, useCarregar } from './comum';
import { useVersoesParaTeste } from './testar';

export function TestarPersonas() {
	const { api, empresa, rota } = useFluxo();
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const [busca, setBusca] = useSearchParams();
	const versoes = useVersoesParaTeste();
	const versao = Number(busca.get('versao')) || versoes.dados?.find(v => v.situacao === 'rascunho')?.id || versoes.dados?.[0]?.id || 0;
	const [n, setN] = useState<number>(20);
	const [escolhidas, setEscolhidas] = useState<number[] | null>(null);
	const [gaveta, setGaveta] = useState<null | 'custo' | 'personas' | 'fase2' | { persona: number }>(null);
	const [confirma, setConfirma] = useState(false);
	const [ocupado, setOcupado] = useState(false);

	const dados = useCarregar(async () => {
		if (!api || !empresa || !versao) return null;
		const [personas, lotes, avisos, { versoes: todas }] = await Promise.all([api.personas(), api.lotes(versao), api.avisos(versao), api.fluxos(empresa.id)]);
		const v = todas.find(x => x.id === versao);
		const uso = v ? todas.find(x => x.situacao === 'em_uso' && x.credor_id === v.credor_id && x.id !== v.id) ?? null : null;
		const ult = lotes.find(l => l.situacao === 'concluido') ?? null;
		const lotesUso = uso ? await api.lotes(uso.id) : [];
		const ultUso = lotesUso.find(l => l.situacao === 'concluido') ?? null;
		const [res, conv, resUso, convUso] = await Promise.all([
			ult ? api.resultadoLote(ult.id) : Promise.resolve([] as ResultadoLoteRow[]), ult ? api.conversas(ult.id) : Promise.resolve([] as ConversaRow[]),
			ultUso ? api.resultadoLote(ultUso.id) : Promise.resolve([] as ResultadoLoteRow[]), ultUso ? api.conversas(ultUso.id) : Promise.resolve([] as ConversaRow[]),
		]);
		return { personas, lotes, avisos, v, uso, ult, ultUso, res, conv, resUso, convUso };
	}, [api, empresa?.id, versao]);
	const d = dados.dados;
	const rodando = d?.lotes.find(l => l.situacao === 'pendente' || l.situacao === 'rodando') ?? null;
	useEffect(() => {
		if (!rodando) return;
		const t = window.setTimeout(() => void dados.recarregar(), 5000);
		return () => window.clearTimeout(t);
	}, [rodando, dados.recarregar]);
	const personas = d?.personas ?? [];
	const sel = (escolhidas ?? personas.slice(0, 10).map(p => p.id)).slice(0, 10);
	const total = totalRoleplay(sel.length, n);

	const travas = useMemo(() => {
		const conta = (cs: ConversaRow[]) => cs.reduce((m, c) => { for (const t of c.travas) m.set(t, (m.get(t) ?? 0) + 1); return m; }, new Map<string, number>());
		const a = conta(d?.conv ?? []), b = conta(d?.convUso ?? []);
		return [...new Set([...a.keys(), ...b.keys()])].map(t => [t, a.get(t) ?? 0, b.get(t) ?? 0] as const);
	}, [d]);

	async function rodar() {
		if (!api) return;
		setOcupado(true);
		await executar(() => api.rodarRoleplay(versao, sel, n), 'Lote na fila. O resultado aparece aqui em alguns minutos.');
		setOcupado(false); setConfirma(false); void dados.recarregar();
	}

	const vNome = d?.v ? `v${d.v.versao}` : '';
	const usoNome = d?.uso ? `v${d.uso.versao}` : '';
	const botaoRodar = perm.editar ? <Botao onClick={() => setConfirma(true)} disabled={!versao || !!rodando || !roleplayValido(sel.length, n)}><Play size={14} aria-hidden /> Rodar {total} conversas</Botao> : undefined;
	const heading = <CabecalhoAgente titulo="Testar com personas" desc="Conversas simuladas, em lote, para comparar a versão nova com a em uso antes da aprovação."
		acoes={<>{botaoRodar}<button type="button" onClick={() => setGaveta('custo')} className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Custo</button></>} />;
	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!perm.ver) return <>{heading}<Vazio titulo="Seu perfil não vê os fluxos do agente.">Precisa da permissão Editar canais ou Aprovar roteiro de voz.</Vazio></>;
	if (versoes.carregando && !versoes.dados) return <>{heading}<Loading /></>;
	if (!versoes.dados?.length) return <>{heading}<Vazio titulo="Nenhum fluxo para testar." acao={<Botao onClick={() => navigate(rota('lista'))}>Ver os fluxos</Botao>} /></>;

	const filtros = (
		<div className="mb-4 flex flex-wrap items-center gap-2">
			<select aria-label="Versão" value={versao} onChange={e => setBusca(b => { b.set('versao', e.target.value); return b; })} className={`${campoCls} w-full max-w-[460px]`} style={campoStyle}>
				{versoes.dados.map(v => <option key={v.id} value={v.id}>{v.rotulo}</option>)}
			</select>
			<Seg rotulo="Conversas por persona" valor={String(n)} onChange={v => setN(Number(v))} itens={QTDS_ROLEPLAY.map(q => ({ v: String(q), n: String(q) }))} />
			<span className="text-[12px] text-[var(--base-texto-3)]">por persona · {sel.length} {sel.length === 1 ? 'persona' : 'personas'}</span>
			<button type="button" onClick={() => setGaveta('personas')} className="text-[12.5px] font-semibold text-[var(--destaque)]">Escolher personas</button>
			<Selo onClick={() => setGaveta('custo')}>Personas sem dado real</Selo>
		</div>
	);

	const confirmar = (
		<ConfirmaAcao aberto={confirma} titulo={`Rodar ${total} conversas simuladas?`}
			texto={`${vNome}${d?.uso ? ` comparada com a ${usoNome} em uso` : ''}. ${sel.length} personas × ${n} conversas. Os tokens de IA entram no item "roleplay com personas" da fatura do MotorCX (por mil tokens).`}
			botao="Rodar" onConfirm={() => void rodar()} onClose={() => setConfirma(false)} loading={ocupado} />
	);
	const gavetas = (
		<>
			<Gaveta aberta={gaveta === 'custo'} onFechar={() => setGaveta(null)} titulo="Custo do roleplay" sub="Tokens de modelo de linguagem. Entram no item de IA da fatura do MotorCX (roleplay com personas, por mil tokens).">
				<Kv itens={[['Último lote desta versão', d?.ult ? `${nTxt(d.ult.tokens)} tokens · ${nTxt(d.ult.conversas)} conversas` : '—'], ['Média por conversa', d?.ult && d.ult.conversas ? `${nTxt(d.ult.tokens / d.ult.conversas)} tokens` : '—']]} />
				<p className="text-[12.5px] text-[var(--base-texto-2)]">Personas montadas a partir de padrões agregados de conversas. Nunca usam dado de cliente real: o banco recusa frases com cara de documento, telefone ou e-mail.</p>
			</Gaveta>
			<Gaveta aberta={gaveta === 'personas'} onFechar={() => setGaveta(null)} titulo="Personas do lote" sub="Até 10 por lote, até 200 conversas no total.">
				{personas.map(p => (
					<label key={p.id} className="flex items-start gap-2 py-1 text-[13px]">
						<input type="checkbox" className="mt-0.5 accent-[var(--destaque)]" checked={sel.includes(p.id)} onChange={e => setEscolhidas(e.target.checked ? [...sel, p.id].slice(0, 10) : sel.filter(x => x !== p.id))} />
						<span><b className="font-semibold">{p.nome}</b> <Pilula>{DIFICULDADE[p.dificuldade] ?? p.dificuldade}</Pilula><small className="block text-[12px] text-[var(--base-texto-2)]">{p.objetivo}</small></span>
					</label>
				))}
			</Gaveta>
			<Gaveta aberta={gaveta === 'fase2'} onFechar={() => setGaveta(null)} titulo="Fase 2 · treino dos operadores humanos" sub="Vem depois, com clientes piloto. Depende do discador mandar o ID do operador.">
				<Linhas itens={[
					{ e: 'Sessão de treino', s: 'A IA faz o devedor (mesmas personas); o operador conversa por texto. No fim: nota do checklist, pontos fortes e de melhoria.' },
					{ e: 'Trilhas por operador', s: 'Ligadas aos pontos fracos da tela Operadores do Speech Analytics.' },
					{ e: 'Desafios do supervisor', s: 'Persona, meta de nota e acordo para a equipe.' },
				]} />
			</Gaveta>
			{gaveta && typeof gaveta === 'object' && <GavetaPersona p={personas.find(x => x.id === gaveta.persona)} a={d?.res.find(x => x.persona_id === gaveta.persona)} b={d?.resUso.find(x => x.persona_id === gaveta.persona)} vNome={vNome} usoNome={usoNome} onFechar={() => setGaveta(null)} />}
		</>
	);

	if (dados.carregando && !d) return <>{heading}{filtros}<Loading /></>;
	if (dados.erro) return <>{heading}{filtros}<Notice>{dados.erro}</Notice></>;
	if (!d?.ult) {
		return (
			<>
				{heading}{filtros}
				{rodando ? <Aviso tom="info" titulo="Lote rodando…">{nTxt(rodando.conversas)} de {nTxt(rodando.personas.length * rodando.quantidade)} conversas. Esta tela atualiza sozinha.</Aviso>
					: <Vazio titulo="Esta versão ainda não passou por personas." acao={botaoRodar}>Rode um lote antes de enviar para aprovação. Sem lote, o envio mostra o aviso "sem teste com personas", mas não bloqueia.</Vazio>}
				{confirmar}{gavetas}
			</>
		);
	}

	const taxa = (rs: ResultadoLoteRow[]) => { const c = rs.reduce((s, r) => s + Number(r.conversas), 0); return c ? rs.reduce((s, r) => s + Number(r.acordos), 0) / c : null; };
	const t5 = taxa(d.res), t4 = d.resUso.length ? taxa(d.resUso) : null;
	const reprov = d.conv.filter(c => !c.passou);
	const maxPct = Math.max(10, ...d.res.map(r => Number(r.taxa_acordo ?? 0)), ...d.resUso.map(r => Number(r.taxa_acordo ?? 0)));

	return (
		<>
			{heading}{filtros}
			<div className="space-y-4">
				{rodando && <Aviso tom="info" titulo="Lote novo rodando…">{nTxt(rodando.conversas)} de {nTxt(rodando.personas.length * rodando.quantidade)} conversas. Os números abaixo são do último lote concluído.</Aviso>}
				{d.avisos.length > 0 && <Aviso tom="atencao" titulo="Antes de aprovar:">{d.avisos.map(a => explicar(a).texto).join(' ')}</Aviso>}
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<Kpi rotulo={`Acordo simulado · ${vNome}`} valor={t5 == null ? '—' : `${Math.round(t5 * 100)}%`} detalhe={`${t4 != null ? `${usoNome}: ${Math.round(t4 * 100)}% · ` : ''}${dataCurta(d.ult.concluido_em)}`} />
					<Kpi rotulo="Conversas no lote" valor={nTxt(d.ult.conversas)} detalhe={`${d.res.length} personas`} />
					<Kpi rotulo="Travas acionadas" valor={nTxt(travas.reduce((s, t) => s + t[1], 0))} detalhe="revise antes de aprovar" />
					<Kpi rotulo="Onde falhou" valor={nTxt(reprov.length)} detalhe="podem virar caso de teste" alerta={false} />
				</div>
				<div className="grid items-start gap-4 lg:grid-cols-2">
					<Cartao titulo="Acordo simulado por persona" linha={`${vNome}${d.uso ? ` × ${usoNome} (em uso)` : ''} · toque para ver a persona`}>
						<div className="mb-1.5 flex gap-3 text-[12px] text-[var(--base-texto-2)]"><span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-full" style={{ backgroundColor: 'var(--area)' }} />{vNome}</span>{d.uso && <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-full" style={{ backgroundColor: 'var(--base-texto-3)' }} />{usoNome}</span>}</div>
						{d.res.map(r => {
							const u = d.resUso.find(x => x.persona_id === r.persona_id);
							return <Barra2 key={r.persona_id} rotulo={r.persona ?? 'persona'} a={Number(r.taxa_acordo ?? 0)} b={u ? Number(u.taxa_acordo ?? 0) : null} max={maxPct} texto={`${Math.round(Number(r.taxa_acordo ?? 0))}%${u ? ` × ${Math.round(Number(u.taxa_acordo ?? 0))}%` : ''}`} onClick={() => setGaveta({ persona: r.persona_id })} />;
						})}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Simulação serve para comparar versões, não para prometer resultado real.</p>
					</Cartao>
					<Cartao titulo="Onde o fluxo falhou" linha="Conversas simuladas que não chegaram ao resultado esperado da persona">
						{reprov.length ? <div className="space-y-3">{reprov.slice(0, 8).map(c => <Falha key={c.id} c={c} persona={personas.find(p => p.id === c.persona_id)?.nome ?? 'persona'} podeEditar={perm.editar} aoMudar={() => void dados.recarregar()} />)}</div>
							: <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma conversa reprovada neste lote.</p>}
					</Cartao>
				</div>
				<Cartao>
					<Detalhes titulo={`Travas acionadas · ${vNome}${d.uso ? ` × ${usoNome}` : ''}`} qtd="toda trava acionada é revisada antes de aprovar">
						<Tabela cabecalho={['Trava', vNome, ...(d.uso ? [usoNome] : [])]} numericas={[1, 2]} linhas={travas.map(([t, a, b]) => [NOMES_TRAVA[t] ?? t, nTxt(a), ...(d.uso ? [nTxt(b)] : [])])}
							vazio={<p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma trava acionada.</p>} />
					</Detalhes>
					<Detalhes titulo="Fase 2 · treino dos operadores humanos" qtd="em breve">
						<p className="mb-2 text-[12.5px] text-[var(--base-texto-2)]">Vem depois, com clientes piloto.</p>
						<Botao secundario onClick={() => setGaveta('fase2')}>Ver o que vem</Botao>
					</Detalhes>
				</Cartao>
			</div>
			{confirmar}{gavetas}
		</>
	);
}

function Falha({ c, persona, podeEditar, aoMudar }: { c: ConversaRow; persona: string; podeEditar: boolean; aoMudar: () => void }) {
	const { api } = useFluxo();
	const ultimo = c.caminho[c.caminho.length - 1] ?? '—';
	const trecho = (c.transcricao ?? []).slice(-3).map(t => `${t.quem === 'pessoa' ? 'Persona' : 'IA'}: "${t.texto}"`).join(' → ');
	return (
		<div className="rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
			<div className="flex flex-wrap items-center gap-2 text-[13px]"><b className="font-semibold">SIM-{String(c.id).padStart(4, '0')}</b><span className="text-[var(--base-texto-2)]">{persona} · {ultimo}</span><Pilula tom="atencao">{c.resultado.replace(/_/g, ' ')}</Pilula></div>
			{trecho ? <p className="mt-1.5 rounded-lg bg-[var(--base-fill)] px-2.5 py-1.5 text-[12.5px] text-[var(--base-texto)]">{trecho}</p> : <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Transcrição simulada já apagada (90 dias).</p>}
			<div className="mt-2">
				{c.caso_teste_id ? <Pilula tom="ok">caso de teste #{c.caso_teste_id}</Pilula>
					: podeEditar && c.transcricao ? <Botao secundario onClick={() => void executar(() => api!.paraCaso(c.id), 'Entrou nos casos de teste do fluxo.').then(aoMudar)}>Virar caso de teste</Botao> : null}
			</div>
		</div>
	);
}

function GavetaPersona({ p, a, b, vNome, usoNome, onFechar }: { p?: PersonaRow; a?: ResultadoLoteRow; b?: ResultadoLoteRow; vNome: string; usoNome: string; onFechar: () => void }) {
	return (
		<Gaveta aberta onFechar={onFechar} titulo={p?.nome ?? a?.persona ?? 'Persona'} sub={p ? `Dificuldade: ${DIFICULDADE[p.dificuldade] ?? p.dificuldade}` : undefined}>
			{p && <p className="text-[13px] text-[var(--base-texto)]">{p.objetivo}</p>}
			<Kv itens={[
				[`Acordo simulado · ${vNome}`, a ? `${Math.round(Number(a.taxa_acordo ?? 0))}%` : '—'],
				...(usoNome ? [[`Acordo simulado · ${usoNome}`, b ? `${Math.round(Number(b.taxa_acordo ?? 0))}%` : '—'] as [string, string]] : []),
				['Conversas', a ? `${nTxt(a.conversas)} · ${nTxt(a.passaram)} passaram` : '—'],
				['Transferidas · opt-out', a ? `${nTxt(a.transferidas)} · ${nTxt(a.opt_out)}` : '—'],
				['Turnos médios', a?.turnos_medio != null ? String(a.turnos_medio).replace('.', ',') : '—'],
			]} />
			{p && <p className="text-[12px] text-[var(--base-texto-3)]">Acerto do agente para esta persona: {p.resultados_aceitos.join(', ').replace(/_/g, ' ')}.</p>}
			<p className="text-[12px] text-[var(--base-texto-3)]">Persona de ficção. Nunca usa dado de cliente real.</p>
		</Gaveta>
	);
}
