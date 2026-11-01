// Tela 4 · Agente virtual › Testar conversa. Por texto, sem ligar para ninguém: a Edge Function simular_fluxo_voz roda
// o MESMO executor da ligação na VM, com o cliente de teste (CLI-00001), dados fictícios e os conectores trocados pelo
// exemplo de resposta (ou falhando, em "Opções"). O simulador não guarda estado: cada fala reenvia a conversa toda.
// Casos de teste guardados (voz_fluxo_casos_teste) rodam por "rodar_casos"; caso que falha segura a aprovação.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Lock, RotateCcw, Settings2 } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { Botao, Cartao, Pilula, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import { MODOS, NOMES_TRAVA, SITUACOES, falaOk, type Modo } from '@/lib/fluxo';
import type { CasoRow, Simulacao } from './api';
import { Campo, Detalhes, Gaveta, Kv, Linhas } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { executar, mensagem, useCarregar, useNomeCarteira } from './comum';

const SUGESTOES_FIXAS = ['Sou eu.', 'Não, aqui não é essa pessoa.', 'Quero parcelar.', 'Já paguei.', 'Não reconheço essa dívida.', 'Agora não dá, estou sem dinheiro.'];

export function useVersoesParaTeste() {
	const { api, empresa } = useFluxo();
	const nome = useNomeCarteira();
	return useCarregar(async () => {
		if (!api || !empresa) return [];
		const { fluxos, versoes } = await api.fluxos(empresa.id);
		return versoes.filter(v => v.situacao !== 'arquivado').map(v => {
			const f = fluxos.find(x => x.id === v.fluxo_id);
			return { id: v.id, fluxo: v.fluxo_id, credor: v.credor_id, situacao: v.situacao, rotulo: `${f?.nome ?? 'Fluxo'} · ${nome(v.credor_id)} · v${v.versao} ${SITUACOES[v.situacao].nome}` };
		}).sort((a, b) => a.rotulo.localeCompare(b.rotulo));
	}, [api, empresa?.id]);
}

export function TestarConversa() {
	const { api, empresa, rota } = useFluxo();
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const [busca, setBusca] = useSearchParams();
	const versoes = useVersoesParaTeste();
	const versao = Number(busca.get('versao')) || versoes.dados?.find(v => v.situacao === 'rascunho')?.id || versoes.dados?.[0]?.id || 0;
	const atual = versoes.dados?.find(v => v.id === versao) ?? null;
	const [falas, setFalas] = useState<string[]>([]);
	const [sim, setSim] = useState<Simulacao | null>(null);
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [texto, setTexto] = useState('');
	const [painel, setPainel] = useState<'caminho' | 'intencao' | 'travas' | 'con'>('caminho');
	const [falhar, setFalhar] = useState<number[]>([]);
	const [opcoes, setOpcoes] = useState(false);
	const fim = useRef<HTMLDivElement>(null);
	const { dados: conectores } = useCarregar(async () => (api && empresa ? api.conectores(empresa.id) : []), [api, empresa?.id]);

	async function rodar(lista: string[]) {
		if (!api || !versao) return;
		setOcupado(true); setErro('');
		try { setSim(await api.simular(versao, lista, falhar)); setFalas(lista); } catch (e) { setErro(mensagem(e)); } finally { setOcupado(false); }
	}
	useEffect(() => { setSim(null); setFalas([]); if (versao && perm.editar) void rodar([]); }, [versao, falhar.join(','), perm.editar]);
	useEffect(() => { fim.current?.scrollIntoView?.({ block: 'nearest' }); }, [sim]);

	const travas = useMemo(() => (sim?.turnos ?? []).flatMap(t => t.travas), [sim]);
	const chamadas = useMemo(() => (sim?.turnos ?? []).flatMap(t => t.conectores), [sim]);
	const ultimaIntencao = [...(sim?.turnos ?? [])].reverse().find(t => t.intencao)?.intencao ?? null;
	const textoOk = falaOk(texto.trim());
	function enviar(t: string) {
		const f = t.trim();
		if (!falaOk(f) || ocupado || sim?.encerrada) return;
		setTexto(''); void rodar([...falas, f]);
	}

	const heading = <CabecalhoAgente titulo="Testar conversa" desc="Por texto, sem ligar para ninguém. Cliente de teste CLI-00001 e conectores com resposta simulada." atual="testar"
		acoes={<><button type="button" onClick={() => setOpcoes(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Settings2 size={15} aria-hidden /> Opções</button><Botao secundario onClick={() => void rodar([])} disabled={!versao || ocupado}><RotateCcw size={14} aria-hidden /> Recomeçar</Botao></>} />;
	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!perm.editar) return <>{heading}<Vazio titulo="Testar conversa é para quem edita o fluxo.">Precisa da permissão Editar canais (o simulador confere no servidor).</Vazio></>;
	if (versoes.carregando && !versoes.dados) return <>{heading}<Loading /></>;
	if (!versoes.dados?.length) return <>{heading}<Vazio titulo="Nenhum fluxo para testar." acao={<Botao onClick={() => navigate(rota('lista'))}>Ver os fluxos</Botao>}>Crie um fluxo primeiro.</Vazio></>;

	return (
		<>
			{heading}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<select aria-label="Versão" value={versao} onChange={e => setBusca(b => { b.set('versao', e.target.value); return b; })} className={`${campoCls} w-full max-w-[520px]`} style={campoStyle}>
					{versoes.dados.map(v => <option key={v.id} value={v.id}>{v.rotulo}</option>)}
				</select>
				{atual && <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => navigate(rota('editor', atual.id))}>Abrir no editor</button>}
			</div>
			{erro && <div className="mb-4"><Notice>{erro}</Notice></div>}
			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
				<Cartao titulo="Conversa" linha={falhar.length ? `Simulando falha em ${falhar.map(id => `C${id}`).join(', ')}.` : undefined}>
					<div className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite">
						{!sim && ocupado && <p className="text-[13px] text-[var(--base-texto-3)]">Começando a conversa…</p>}
						{(sim?.turnos ?? []).map((t, i) => (
							<div key={i} className="flex flex-col gap-2.5">
								{t.pessoa && <div className="max-w-[85%] self-end rounded-[12px_12px_4px_12px] px-3 py-2 text-[13.5px] text-[var(--base-texto)]" style={{ backgroundColor: 'var(--destaque-suave)' }}>{t.pessoa}</div>}
								{t.falas.map((f, j) => (
									<div key={j} className="max-w-[85%]">
										<div className="rounded-[12px_12px_12px_4px] bg-[var(--base-fill)] px-3 py-2 text-[13.5px] text-[var(--base-texto)]">{f.texto}</div>
										<div className="mt-0.5 text-[11.5px] text-[var(--base-texto-3)]">{[f.bloco, MODOS[f.modo as Modo]?.nome, j === t.falas.length - 1 && t.intencao ? `intenção: ${t.intencao.intencao} (${t.intencao.confianca})` : null, j === t.falas.length - 1 && t.conectores.length ? t.conectores.map(c => `C${c.conector} ${c.status ?? c.classe}`).join(' · ') : null].filter(Boolean).join(' · ')}</div>
									</div>
								))}
								{t.travas.map(tr => <div key={tr} className="inline-flex items-center gap-1.5 self-center text-[12px] text-[var(--base-texto-2)]"><Lock size={12} aria-hidden /> trava: {NOMES_TRAVA[tr] ?? tr}</div>)}
								{t.fim && <div className="self-center text-[12px] font-semibold text-[var(--base-texto-2)]">Conversa encerrada · {t.fim}</div>}
							</div>
						))}
						<div ref={fim} />
					</div>
					{!sim?.encerrada && (
						<>
							<div className="mt-3.5 flex flex-wrap gap-1.5">
								{SUGESTOES_FIXAS.map(s => <button key={s} type="button" disabled={ocupado} onClick={() => enviar(s)} className="h-8 rounded-full border px-3 text-[12.5px] text-[var(--base-texto)] hover:bg-[var(--base-fill)] disabled:opacity-50" style={{ borderColor: 'var(--base-borda)' }}>{s}</button>)}
								<button type="button" disabled={ocupado} onClick={() => enviar('Não me ligue mais.')} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12.5px] text-[var(--base-texto)] hover:bg-[var(--base-fill)]" style={{ borderColor: 'var(--base-borda)' }}><Lock size={12} aria-hidden /> Não me ligue mais</button>
								<button type="button" disabled={ocupado} onClick={() => enviar('Quero falar com uma pessoa.')} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12.5px] text-[var(--base-texto)] hover:bg-[var(--base-fill)]" style={{ borderColor: 'var(--base-borda)' }}><Lock size={12} aria-hidden /> Quero falar com uma pessoa</button>
							</div>
							<form className="mt-2.5 flex gap-2" onSubmit={e => { e.preventDefault(); enviar(texto); }}>
								<input aria-label="Mensagem" value={texto} maxLength={300} onChange={e => setTexto(e.target.value)} placeholder="Escreva como se fosse a pessoa…" className={`${campoCls} h-10 min-w-0 flex-1`} style={campoStyle} />
								<Botao type="submit" disabled={!textoOk || ocupado}>Enviar</Botao>
							</form>
							{texto && !textoOk && <p className="mt-1 text-[12px] text-[var(--estado-erro-texto)]">Até 300 caracteres, sem número de documento, telefone ou e-mail.</p>}
						</>
					)}
					{sim?.encerrada && <div className="mt-3"><Botao secundario onClick={() => void rodar([])}>Recomeçar</Botao></div>}
				</Cartao>
				<Cartao titulo="O que aconteceu">
					<select aria-label="Painel" value={painel} onChange={e => setPainel(e.target.value as typeof painel)} className={`${campoCls} mb-3 w-full`} style={campoStyle}>
						<option value="caminho">Caminho no fluxo</option><option value="intencao">Intenção reconhecida</option><option value="travas">Travas acionadas</option><option value="con">Chamadas a conectores</option>
					</select>
					{painel === 'intencao' ? (ultimaIntencao ? <Kv itens={[['Intenção', ultimaIntencao.intencao], ['Confiança', ultimaIntencao.confianca], ['Dados entendidos', (ultimaIntencao.entidades ?? []).join(', ') || '—']]} /> : <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhuma intenção até aqui.</p>)
						: painel === 'travas' ? (travas.length ? <Linhas itens={travas.map(t => ({ e: NOMES_TRAVA[t] ?? t }))} /> : <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhuma até aqui. Experimente "não me ligue mais" ou pedir 24 parcelas.</p>)
						: painel === 'con' ? (<>{chamadas.length ? <Linhas itens={chamadas.map(c => ({ e: `C${c.conector}${c.nome ? ` · ${c.nome}` : ''}`, d: `${c.status ?? c.classe}${c.ms != null ? ` · ${c.ms} ms` : ''}`, s: c.codigo ?? undefined }))} /> : <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhum conector chamado até aqui.</p>}<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Resposta de exemplo; nada vai ao CRM.</p></>)
						: (<>
							<Linhas itens={(sim?.caminho ?? []).map((b, i, arr) => ({ e: <b className="font-semibold">{b}</b>, d: i === arr.length - 1 && !sim?.encerrada ? <Pilula tom="info">agora</Pilula> : <Pilula tom="ok">passou</Pilula> }))} />
							{sim?.resultado && <p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">Resultado: <b>{sim.resultado}</b></p>}
						</>)}
				</Cartao>
			</div>
			{atual && <Casos versao={atual.id} fluxo={atual.fluxo} sim={sim} falas={falas} falhar={falhar} />}
			<Gaveta aberta={opcoes} onFechar={() => setOpcoes(false)} titulo="Opções do teste">
				<Campo rotulo="Cliente de teste"><input value="CLI-00001" readOnly className={`${campoCls} w-full`} style={campoStyle} /></Campo>
				<div>
					<b className="text-[12.5px] font-semibold">Simular falha do conector</b>
					<p className="mb-1.5 text-[12px] text-[var(--base-texto-2)]">O conector marcado responde como se tivesse caído: o fluxo segue pelo ramo de falha (ou pela alternativa da carteira).</p>
					{(conectores ?? []).length ? (conectores ?? []).map(c => (
						<label key={c.id} className="flex items-center gap-2 py-1 text-[13px]"><input type="checkbox" className="accent-[var(--destaque)]" checked={falhar.includes(c.id)} onChange={e => setFalhar(f => (e.target.checked ? [...f, c.id] : f.filter(x => x !== c.id)).slice(0, 10))} /> C{c.id} · {c.nome}</label>
					)) : <p className="text-[12.5px] text-[var(--base-texto-3)]">Nenhum conector cadastrado.</p>}
				</div>
			</Gaveta>
		</>
	);
}

function Casos({ versao, fluxo, sim, falas, falhar }: { versao: number; fluxo: number; sim: Simulacao | null; falas: string[]; falhar: number[] }) {
	const { api } = useFluxo();
	const { dados, recarregar } = useCarregar(async () => {
		if (!api) return { casos: [] as CasoRow[], res: [] };
		const [casos, res] = await Promise.all([api.casos(fluxo), api.resultadosCasos(versao)]);
		return { casos, res };
	}, [api, fluxo, versao]);
	const [nome, setNome] = useState('');
	const [rodando, setRodando] = useState(false);
	const casos = dados?.casos ?? [];
	async function rodarTodos() {
		if (!api) return;
		setRodando(true);
		await executar(async () => { const r = await api.rodarCasos(versao); const f = r.filter(x => !x.passou).length; if (f) throw new Error(`${f} de ${r.length} casos falharam nesta versão (seguram a aprovação).`); }, 'Todos os casos passaram.');
		setRodando(false); void recarregar();
	}
	async function guardar() {
		if (!api || !sim) return;
		if (await executar(() => api.salvarCaso({ fluxo, nome: nome.trim(), falas, caminho: sim.caminho, resultado: sim.resultado, falhar }), 'Caso guardado. Ele roda a cada versão nova do fluxo.')) { setNome(''); void recarregar(); }
	}
	return (
		<div className="mt-4">
			<Cartao>
				<Detalhes titulo="Casos de teste guardados" qtd={`${casos.length} · caso que falha segura a aprovação`}>
					<Linhas itens={casos.map(c => {
						const r = dados?.res.find(x => x.caso_id === c.id);
						return { e: <><b className="font-semibold">#{c.id}</b> · {c.nome}</>, s: c.caminho_esperado.length ? c.caminho_esperado.join(' → ') : `só o resultado: ${c.resultado_esperado ?? '—'}`, d: r ? <Pilula tom={r.passou ? 'ok' : 'erro'}>{r.passou ? 'passou' : 'falhou'}</Pilula> : <Pilula>não rodou</Pilula> };
					})} />
					<div className="mt-3 flex flex-wrap items-end gap-2">
						<Botao secundario onClick={() => void rodarTodos()} disabled={rodando || !casos.length}>{rodando ? 'Rodando…' : 'Rodar todos nesta versão'}</Botao>
						{sim && falas.length > 0 && (
							<>
								<input aria-label="Nome do caso" placeholder="Nome do caso (ex.: CRM fora cai na carteira)" value={nome} maxLength={80} onChange={e => setNome(e.target.value)} className={`${campoCls} min-w-0 flex-1`} style={campoStyle} />
								<Botao secundario disabled={nome.trim().length < 2} onClick={() => void guardar()}>Guardar esta conversa como caso</Botao>
							</>
						)}
					</div>
				</Detalhes>
			</Cartao>
		</div>
	);
}
