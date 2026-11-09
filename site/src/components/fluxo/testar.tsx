// Tela 4 · Agente virtual › Testar conversa. Por texto, sem ligar para ninguém: a Edge Function simular_fluxo_voz roda
// o MESMO executor da ligação na VM, com o cliente de teste (CLI-00001), dados fictícios e os conectores trocados pelo
// exemplo de resposta (ou com a resposta escolhida em "Opções": sucesso, tempo esgotado ou 401; SQL 66). O simulador
// não guarda estado: cada fala reenvia a conversa toda. "Ouvir" toca a fala com a voz da empresa (TTS da Montagem na VM,
// pela mesma Edge Function; o áudio não fica guardado e o uso entra no item de IA da margem).
// A conversa é a mesma do painel "Testar conversa" ao lado do Roteiro (conversa-teste.tsx; PR6 do redesenho).
// Casos de teste guardados (voz_fluxo_casos_teste) rodam por "rodar_casos"; caso que falha segura a aprovação.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { RotateCcw, Settings2 } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { Botao, Cartao, Pilula, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import { SITUACOES, nomesEtapas, rotuloTrava, travasDoTeste } from '@/lib/fluxo';
import type { CasoRow, CenarioConector, Simulacao } from './api';
import { Campo, Detalhes, Gaveta, Kv, Linhas } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { executar, mensagem, useCarregar, useNomeCarteira } from './comum';
import { Conversa, useConversaTeste } from './conversa-teste';

const NOMES_CENARIO: Record<CenarioConector, string> = { sucesso: 'sucesso', tempo: 'tempo esgotado', '401': '401' };

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
	const [painel, setPainel] = useState<'caminho' | 'intencao' | 'travas' | 'con'>('caminho');
	const [cenarios, setCenarios] = useState<Record<string, CenarioConector>>({});
	const falhar = useMemo(() => Object.entries(cenarios).filter(([, c]) => c === 'tempo').map(([id]) => Number(id)), [cenarios]);
	const [tocando, setTocando] = useState<string | null>(null);
	const [erroOuvir, setErroOuvir] = useState('');
	const [opcoes, setOpcoes] = useState(false);
	const [soa, setSoa] = useState(false);
	const { dados: conectores } = useCarregar(async () => (api && empresa ? api.conectores(empresa.id) : []), [api, empresa?.id]);
	// nomes das etapas desta versão (a conversa mostra o nome, nunca o código)
	const { dados: def } = useCarregar(async () => (api && versao ? (await api.versao(versao))?.definicao ?? null : null), [api, versao]);
	const nomes = useMemo(() => (def ? nomesEtapas(def) : new Map<string, string>()), [def]);
	const estado = useConversaTeste(api, versao, cenarios, perm.editar);
	const { sim, falas, ocupado } = estado;
	/** "Ouvir a voz": prévia em áudio desta fala (nada fica guardado). */
	async function ouvir(texto: string, chave: string) {
		if (!api || !versao || tocando) return;
		setTocando(chave); setErroOuvir('');
		try {
			const r = await api.ouvir(versao, texto);
			if (!r.audio) throw new Error('Prévia sem áudio (modo de demonstração).');
			const a = new Audio(`data:${r.mime};base64,${r.audio}`);
			a.onended = () => setTocando(null);
			await a.play();
		} catch (e) { setErroOuvir(mensagem(e)); setTocando(null); }
	}

	const travas = useMemo(() => travasDoTeste(sim?.turnos ?? []), [sim]);
	const chamadas = useMemo(() => (sim?.turnos ?? []).flatMap(t => t.conectores), [sim]);
	const ultimaIntencao = [...(sim?.turnos ?? [])].reverse().find(t => t.intencao)?.intencao ?? null;

	const heading = <CabecalhoAgente titulo="Testar conversa" desc="Por texto, sem ligar para ninguém. Cliente de teste CLI-00001 e conectores com resposta simulada. No editor, o teste também abre ao lado do Roteiro." atual="testar"
		acoes={<><label className="inline-flex h-9 items-center gap-1.5 px-2 text-[13px] text-[var(--base-texto-2)]"><input type="checkbox" className="accent-[var(--destaque)]" checked={soa} onChange={e => setSoa(e.target.checked)} /> Como soa</label><button type="button" onClick={() => setOpcoes(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Settings2 size={15} aria-hidden /> Opções</button><Botao secundario onClick={() => void estado.rodar([])} disabled={!versao || ocupado}><RotateCcw size={14} aria-hidden /> Recomeçar</Botao></>} />;
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
				{atual && <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => navigate(rota('editor', atual.id, { testar: 1 }))}>Abrir no editor, com o teste ao lado</button>}
			</div>
			{erroOuvir && <div className="mb-4"><Notice>{erroOuvir}</Notice></div>}
			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
				<Cartao titulo="Conversa" linha={Object.keys(cenarios).length ? `Resposta simulada: ${Object.entries(cenarios).map(([id, c]) => `C${id} ${NOMES_CENARIO[c]}`).join(', ')}.` : undefined}>
					<Conversa estado={estado} nomes={nomes} soa={soa} onOuvir={(t, k) => void ouvir(t, k)} tocando={tocando} />
				</Cartao>
				<Cartao titulo="O que aconteceu">
					<select aria-label="Painel" value={painel} onChange={e => setPainel(e.target.value as typeof painel)} className={`${campoCls} mb-3 w-full`} style={campoStyle}>
						<option value="caminho">Caminho no fluxo</option><option value="intencao">Intenção reconhecida</option><option value="travas">Travas que agiram</option><option value="con">Chamadas a conectores</option>
					</select>
					{painel === 'intencao' ? (ultimaIntencao ? <Kv itens={[['Intenção', ultimaIntencao.intencao], ['Confiança', ultimaIntencao.confianca], ['Dados entendidos', (ultimaIntencao.entidades ?? []).join(', ') || '—']]} /> : <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhuma intenção até aqui.</p>)
						: painel === 'travas' ? (travas.length ? <Linhas itens={travas.map(t => ({ e: rotuloTrava(t), s: `${t.pessoa ? `Quando o cliente disse “${t.pessoa}”` : 'Na abertura'}${t.etapa ? `, em ${nomes.get(t.etapa) ?? t.etapa}` : ''}.` }))} /> : <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhuma até aqui. Experimente "não me ligue mais" ou pedir 24 parcelas.</p>)
						: painel === 'con' ? (<>{chamadas.length ? <Linhas itens={chamadas.map(c => ({ e: `C${c.conector}${c.nome ? ` · ${c.nome}` : ''}`, d: `${c.status ?? c.classe}${c.ms != null ? ` · ${c.ms} ms` : ''}`, s: c.codigo ?? undefined }))} /> : <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhum conector chamado até aqui.</p>}<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Resposta de exemplo; nada vai ao CRM.</p></>)
						: (<>
							<Linhas itens={(sim?.caminho ?? []).map((b, i, arr) => ({ e: <b className="font-semibold">{nomes.get(b) ?? b}</b>, d: i === arr.length - 1 && !sim?.encerrada ? <Pilula tom="info">agora</Pilula> : <Pilula tom="ok">passou</Pilula> }))} />
							{sim?.resultado && <p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">Resultado: <b>{sim.resultado}</b></p>}
						</>)}
				</Cartao>
			</div>
			{atual && <Casos versao={atual.id} fluxo={atual.fluxo} sim={sim} falas={falas} falhar={falhar} />}
			<Gaveta aberta={opcoes} onFechar={() => setOpcoes(false)} titulo="Opções do teste">
				<Campo rotulo="Cliente de teste"><input value="CLI-00001" readOnly className={`${campoCls} w-full`} style={campoStyle} /></Campo>
				<div>
					<b className="text-[12.5px] font-semibold">Resposta dos conectores</b>
					<p className="mb-1.5 text-[12px] text-[var(--base-texto-2)]">Escolha como cada conector simulado responde: com o exemplo do último teste, tempo esgotado ou 401 (credencial recusada). O fluxo segue pelo ramo de falha ou pela alternativa da carteira. Nada vai ao CRM.</p>
					{(conectores ?? []).length ? (conectores ?? []).map(c => (
						<label key={c.id} className="flex items-center justify-between gap-2 py-1 text-[13px]">
							<span className="min-w-0 truncate">C{c.id} · {c.nome}</span>
							<select aria-label={`Resposta de C${c.id}`} value={cenarios[String(c.id)] ?? ''} onChange={e => setCenarios(x => { const n = { ...x }; if (e.target.value) n[String(c.id)] = e.target.value as CenarioConector; else delete n[String(c.id)]; return n; })} className={campoCls} style={campoStyle}>
								<option value="">Normal (exemplo)</option><option value="sucesso">Sucesso</option><option value="tempo">Tempo esgotado</option><option value="401">401 · credencial recusada</option>
							</select>
						</label>
					)) : <p className="text-[12.5px] text-[var(--base-texto-3)]">Nenhum conector cadastrado.</p>}
				</div>
				<Detalhes titulo="Ouvir a voz">
					<p className="text-[12.5px] text-[var(--base-texto-2)]">O alto-falante ao lado de cada fala do agente toca a fala com a voz configurada da empresa, com os dados fictícios do cliente de teste. O áudio é gerado na hora e não fica guardado; o uso entra no custo de IA do MotorCX (não é cobrado à parte).</p>
				</Detalhes>
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
