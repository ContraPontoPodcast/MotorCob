// Tela 5 · Agente virtual › Desempenho do fluxo. Só contagens e códigos: voz_fluxo_metricas_dia (funil por etapa),
// voz_fluxo_intencoes_dia e crm_chamadas (RLS da empresa). Nada por cliente. Comparação de versões = períodos diferentes,
// não é teste A/B (o aviso fica junto da comparação).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Download } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { Aviso, Botao, Cartao, Kpi, Tabela, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import {
	csv, funil, kpisDoFluxo, nTxt, pctTxt, ppTxt, somarMetricas, tituloBloco, type DegrauFunil,
} from '@/lib/fluxo';
import type { ChamadaCrmRow, VersaoRow } from './api';
import { BarraH, Gaveta, Linhas, Seg } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { diasAtras, useCarregar, useNomeCarteira } from './comum';

type Aba = 'intencoes' | 'livre' | 'conectores' | 'versoes';

export function DesempenhoFluxo() {
	const { api, empresa, rota } = useFluxo();
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const nome = useNomeCarteira();
	const [busca, setBusca] = useSearchParams();
	const [dias, setDias] = useState(30);
	const [aba, setAba] = useState<Aba>('intencoes');
	const [degrau, setDegrau] = useState<DegrauFunil | null>(null);

	const base = useCarregar(async () => (api && empresa ? api.fluxos(empresa.id) : null), [api, empresa?.id]);
	const fluxos = useMemo(() => (base.dados?.fluxos ?? []).filter(f => base.dados!.versoes.some(v => v.fluxo_id === f.id && v.situacao !== 'rascunho')), [base.dados]);
	const fluxoId = Number(busca.get('fluxo')) || fluxos[0]?.id || 0;
	const fluxo = fluxos.find(f => f.id === fluxoId) ?? null;
	const vs = (base.dados?.versoes ?? []).filter(v => v.fluxo_id === fluxoId);
	const atual: VersaoRow | null = vs.find(v => v.situacao === 'em_uso') ?? vs.filter(v => v.situacao !== 'rascunho').sort((a, b) => b.versao - a.versao)[0] ?? null;
	const anterior: VersaoRow | null = vs.filter(v => v.situacao === 'arquivado' && atual && v.versao < atual.versao).sort((a, b) => b.versao - a.versao)[0] ?? null;

	const dados = useCarregar(async () => {
		if (!api || !empresa || !atual) return null;
		const ids = [atual.id, ...(anterior ? [anterior.id] : [])];
		const [met, ints, chams] = await Promise.all([
			api.metricas(ids, diasAtras(Math.max(dias, 120))), api.intencoesDia([atual.id], diasAtras(dias)),
			api.chamadasCrm(empresa.id, { versao: atual.id, desde: `${diasAtras(dias)}T00:00:00Z`, limite: 5000 }).catch(() => [] as ChamadaCrmRow[]),
		]);
		return { met, ints, chams };
	}, [api, empresa?.id, atual?.id, anterior?.id, dias]);

	const calc = useMemo(() => {
		if (!dados.dados || !atual) return null;
		const desde = diasAtras(dias);
		const mAtual = somarMetricas(dados.dados.met.filter(x => x.fluxo_versao_id === atual.id && x.dia >= desde));
		const mAnt = anterior ? somarMetricas(dados.dados.met.filter(x => x.fluxo_versao_id === anterior.id)) : null;
		const k = kpisDoFluxo(atual.definicao, mAtual);
		const kAnt = anterior && mAnt ? kpisDoFluxo(anterior.definicao, mAnt) : null;
		return { mAtual, k, kAnt, degraus: funil(atual.definicao, mAtual) };
	}, [dados.dados, atual, anterior, dias]);

	const heading = <CabecalhoAgente titulo="Desempenho do fluxo" atual="desempenho"
		desc={atual && fluxo && calc ? `${fluxo.nome} · ${nome(fluxo.credor_id)} · v${atual.versao} · ${nTxt(calc.k.atendidas)} ligações atendidas por pessoa em ${dias} dias` : 'Onde as pessoas saem do fluxo, em contagens.'}
		acoes={calc && calc.k.atendidas > 0 ? <button type="button" onClick={() => exportar(calc.degraus, atual!.versao)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Download size={15} aria-hidden /> Exportar</button> : undefined} />;
	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!perm.ver) return <>{heading}<Vazio titulo="Seu perfil não vê os fluxos do agente.">Precisa da permissão Editar canais ou Aprovar roteiro de voz.</Vazio></>;
	if (base.carregando && !base.dados) return <>{heading}<Loading /></>;
	if (!fluxos.length) return <>{heading}<Vazio titulo="Nenhum fluxo aprovado ainda." acao={<Botao secundario onClick={() => navigate(rota('lista'))}>Ver os fluxos</Botao>}>Os números aparecem depois que uma versão entra em uso e recebe ligações.</Vazio></>;

	const filtros = (
		<div className="mb-4 flex flex-wrap gap-2">
			<select aria-label="Fluxo" value={fluxoId} onChange={e => setBusca(b => { b.set('fluxo', e.target.value); return b; })} className={`${campoCls} w-full max-w-[420px]`} style={campoStyle}>
				{fluxos.map(f => <option key={f.id} value={f.id}>{f.nome} · {nome(f.credor_id)}</option>)}
			</select>
			<select aria-label="Período" value={dias} onChange={e => setDias(Number(e.target.value))} className={campoCls} style={campoStyle}>
				<option value={30}>Últimos 30 dias</option><option value={7}>Últimos 7 dias</option><option value={90}>Últimos 90 dias</option>
			</select>
		</div>
	);
	if (dados.carregando && !dados.dados) return <>{heading}{filtros}<Loading /></>;
	if (dados.erro) return <>{heading}{filtros}<Notice>{dados.erro}</Notice></>;
	if (!calc || calc.k.atendidas === 0) return <>{heading}{filtros}<Vazio titulo="Este fluxo ainda não tem ligações no período.">Os números aparecem depois das primeiras ligações atendidas por pessoa (o resumo do dia é feito à noite).</Vazio></>;

	const { k, kAnt, degraus, mAtual } = calc;
	const chams = dados.dados?.chams ?? [];
	const falhasCon = chams.length ? chams.filter(c => c.classe !== 'ok').length / chams.length : null;
	const max = degraus[0]?.chegaram || k.atendidas;
	const def = atual!.definicao;
	const gens = def.blocos.filter(b => b.tipo === 'generativa');
	const intBlocos = def.blocos.filter(b => b.tipo === 'intencao');
	const ints = (dados.dados?.ints ?? []).reduce((m, x) => m.set(x.intencao, (m.get(x.intencao) ?? 0) + x.n), new Map<string, number>());
	const totInt = [...ints.values()].reduce((a, b) => a + b, 0);
	const porCon = [...chams.reduce((m, c) => { const id = c.conector_id ?? 0; const a = m.get(id) ?? { n: 0, erro: 0, tempo: 0, alt: 0 }; a.n++; if (c.classe !== 'ok') a.erro++; if (c.classe === 'tempo') a.tempo++; if (c.usou_alternativa) a.alt++; m.set(id, a); return m; }, new Map<number, { n: number; erro: number; tempo: number; alt: number }>()).entries()];

	return (
		<>
			{heading}
			{filtros}
			<div className="space-y-4">
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<Kpi rotulo="Identidade confirmada" valor={pctTxt(k.taxaIdentidade)} detalhe={kAnt ? `${ppTxt(k.taxaIdentidade, kAnt.taxaIdentidade)} sobre a v${anterior!.versao}` : `${nTxt(k.identidade)} pessoas`} />
					<Kpi rotulo="Acordos" valor={nTxt(k.acordos)} detalhe={`${pctTxt(k.taxaAcordo)} da identidade confirmada`} />
					<Kpi rotulo="Transferidas" valor={pctTxt(k.taxaTransferidas)} detalhe={kAnt ? `${ppTxt(k.taxaTransferidas, kAnt.taxaTransferidas)} sobre a v${anterior!.versao}` : `${nTxt(k.transferidas)} ligações`} />
					<Kpi rotulo="Falhas de conector" valor={pctTxt(falhasCon)} detalhe="das chamadas a conectores" />
				</div>
				<Cartao titulo="Onde as pessoas saem" linha="Quantos chegaram em cada etapa do caminho principal. Toque para ver por onde saíram e abrir a etapa no editor.">
					{degraus.map(d => <BarraH key={d.bloco.id} rotulo={`${d.bloco.id} · ${tituloBloco(d.bloco)}`} valor={d.chegaram} max={max} texto={`${nTxt(d.chegaram)} · ${pctTxt(d.pctAtendidas)}`} onClick={() => setDegrau(d)} />)}
				</Cartao>
				<Cartao titulo="Mais detalhes">
					<div className="mb-3"><Seg rotulo="Detalhe" valor={aba} onChange={setAba} itens={[{ v: 'intencoes', n: 'Intenções' }, { v: 'livre', n: 'Conversa livre' }, { v: 'conectores', n: 'Conectores' }, { v: 'versoes', n: anterior ? `v${anterior.versao} × v${atual!.versao}` : 'Versões' }]} /></div>
					{aba === 'intencoes' ? (
						intBlocos.length && totInt ? <>
							{[...ints.entries()].sort((a, b) => b[1] - a[1]).map(([i, n]) => <BarraH key={i} rotulo={i} valor={n} max={Math.max(...ints.values())} texto={`${pctTxt(n / totInt)} · ${nTxt(n)}`} />)}
							<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Etapas: {intBlocos.map(b => `${b.id} · ${tituloBloco(b)}`).join(', ')}. "nao_entendido" alto pede mais frases de exemplo nas intenções.</p>
						</> : <p className="text-[13px] text-[var(--base-texto-2)]">{intBlocos.length ? 'Sem intenções contadas no período.' : 'Este fluxo não tem etapa "Entende e escolhe" de intenção.'}</p>
					) : aba === 'livre' ? (
						gens.length ? <Tabela cabecalho={['Etapa · motivo', 'Foi para', 'Conversas', 'Turnos médios']} numericas={[2, 3]}
							linhas={gens.flatMap(g => Object.entries(mAtual.get(g.id)?.saidas ?? {}).sort((a, b) => b[1] - a[1]).map(([q, n]) => {
								const s = g.saidas.find(x => x.quando === q);
								const tot = mAtual.get(g.id)?.chegaram || 0;
								return [`${g.id} · ${s?.rotulo ?? q.replace(/_/g, ' ')}`, s?.para ?? '—', `${nTxt(n)} · ${pctTxt(tot ? n / tot : null)}`, mAtual.get(g.id)?.turnos_medio != null ? String(mAtual.get(g.id)!.turnos_medio).replace('.', ',') : '—'];
							}))} vazio={<p className="text-[13px] text-[var(--base-texto-2)]">Sem devoluções da conversa livre no período.</p>} />
							: <p className="text-[13px] text-[var(--base-texto-2)]">Este fluxo não tem Conversa livre (IA).</p>
					) : aba === 'conectores' ? (
						porCon.length ? <Tabela cabecalho={['Conector', 'Chamadas', 'Erro', 'O que o fluxo fez']} numericas={[1, 2]}
							linhas={porCon.map(([id, a]) => [`C${id}`, nTxt(a.n), `${pctTxt(a.erro / a.n)} · ${nTxt(a.tempo)} esgotados`, a.alt ? `${nTxt(a.alt)} usaram as ofertas da carteira` : `${nTxt(a.erro)} seguiram pelo ramo de falha`])} />
							: <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma chamada a conector no período.</p>
					) : anterior && kAnt ? (<>
						<Aviso tom="info" titulo="Períodos diferentes, não é teste A/B:">carteira e mês mudam junto. Compare com cuidado.</Aviso>
						<div className="mt-3"><Tabela cabecalho={['Indicador', `v${anterior.versao}`, `v${atual!.versao}`]} numericas={[1, 2]} linhas={[
							['Identidade confirmada ÷ atendidas', pctTxt(kAnt.taxaIdentidade), pctTxt(k.taxaIdentidade)],
							['Acordos ÷ identidade confirmada', pctTxt(kAnt.taxaAcordo), pctTxt(k.taxaAcordo)],
							['Transferidas ÷ atendidas', pctTxt(kAnt.taxaTransferidas), pctTxt(k.taxaTransferidas)],
							['Atendidas por pessoa', nTxt(kAnt.atendidas), nTxt(k.atendidas)],
						]} /></div>
					</>) : <p className="text-[13px] text-[var(--base-texto-2)]">Sem versão anterior com ligações para comparar.</p>}
				</Cartao>
			</div>
			<Gaveta aberta={!!degrau} onFechar={() => setDegrau(null)} titulo={degrau ? `${degrau.bloco.id} · ${tituloBloco(degrau.bloco)}` : ''} sub={degrau ? `${nTxt(degrau.chegaram)} chegaram · ${pctTxt(degrau.pctAtendidas)} das atendidas` : ''}
				pe={degrau && atual ? <Botao onClick={() => navigate(rota('editor', atual.id))}>Abrir a etapa no editor</Botao> : undefined}>
				{degrau && <><b className="text-[12.5px] font-semibold">Saíram aqui: {nTxt(degrau.sairamAqui)}</b>
					<Linhas itens={degrau.saidas.map(s => ({ e: `${s.rotulo}${s.para ? ` → ${s.para}` : ''}`, d: nTxt(s.n) }))} /></>}
			</Gaveta>
		</>
	);
}

function exportar(degraus: DegrauFunil[], versao: number) {
	const linhas: (string | number | null)[][] = [['versao', 'etapa', 'chegaram', 'saida', 'para', 'quantidade']];
	for (const d of degraus) {
		if (!d.saidas.length) linhas.push([versao, d.bloco.id, d.chegaram, null, null, null]);
		for (const s of d.saidas) linhas.push([versao, d.bloco.id, d.chegaram, s.rotulo, s.para, s.n]);
	}
	const url = URL.createObjectURL(new Blob([`﻿${csv(linhas)}`], { type: 'text/csv;charset=utf-8' }));
	const a = document.createElement('a');
	a.href = url; a.download = `fluxo_v${versao}_funil.csv`; a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
