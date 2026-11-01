// Tela 6 · Agente virtual › Fluxos › Rascunho gerado ("Descrever e o MotorCX monta"). Lê voz_fluxo_pedidos (RLS).
// A geração (voz/gerar_fluxo.py, na VM) só cria rascunho que passa no validador; o resultado traz "o que entendi"
// (frase → etapa), suposições, perguntas, mudanças e erros. Responder as perguntas pede nova geração
// (responder_pedido_fluxo_voz). Pedido à equipe vira chamado no Suporte (prazo de 2 dias úteis). "Descartar"
// (cancelar_pedido_fluxo_voz, SQL 66): o rascunho gerado sai e o pedido fica guardado como cancelado.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { Aviso, Botao, Cartao, Pilula, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import { TRAVAS, dataCurta, explicar, impedem } from '@/lib/fluxo';
import { Campo, Detalhes, Linhas, Regras } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { executar, useCarregar, useNomeCarteira } from './comum';
import { situacaoPedido } from './lista';

const textos = (x: unknown): string[] => (Array.isArray(x) ? x.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).filter(Boolean) : []);

export function PedidoGerado({ pedidoId }: { pedidoId: number }) {
	const { api, empresa, rota } = useFluxo();
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const nome = useNomeCarteira();
	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api) return null;
		const p = await api.pedido(pedidoId);
		const bloqueios = p?.versao_gerada_id ? await api.bloqueios(p.versao_gerada_id).catch(() => [] as string[]) : [];
		return { p, bloqueios };
	}, [api, pedidoId]);
	const p = dados?.p ?? null;
	const [resp, setResp] = useState<Record<string, string>>({});
	const [descartar, setDescartar] = useState(false);
	const [ocupado, setOcupado] = useState(false);
	useEffect(() => { setResp(p?.respostas ?? {}); }, [p?.id, p?.respostas]);
	// enquanto gera, confere de novo a cada 4 s
	useEffect(() => {
		if (!p || (p.situacao !== 'pendente' && p.situacao !== 'gerando')) return;
		const t = window.setTimeout(() => void recarregar(), 4000);
		return () => window.clearTimeout(t);
	}, [p, recarregar]);

	const cab = (titulo: string, desc?: string, acoes?: React.ReactNode) => <CabecalhoAgente titulo={titulo} desc={desc} acoes={acoes} />;
	if (!empresa) return <>{cab('Rascunho gerado')}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (carregando && !dados) return <>{cab('Rascunho gerado')}<Loading /></>;
	if (erro) return <>{cab('Rascunho gerado')}<Notice>{erro}</Notice></>;
	if (!p) return <>{cab('Pedido não encontrado')}<Vazio titulo="Pedido não encontrado." acao={<Botao secundario onClick={() => navigate(rota('lista'))}>Voltar aos fluxos</Botao>} /></>;

	const r = p.resultado ?? {};
	const perguntas = textos(r.perguntas);
	const entendi = (Array.isArray(r.entendi) ? r.entendi : []) as { frase?: string; bloco?: string }[];
	const pend = impedem(dados?.bloqueios ?? []);
	const codigo = `PED-${String(p.id).padStart(4, '0')}`;
	const quem = p.tipo === 'ia' ? 'Gerado pela IA do MotorCX' : 'Montado pela equipe MotorCX';
	const titulo = p.situacao === 'gerado' ? `Rascunho gerado · ${nome(p.credor_id)}` : p.situacao === 'na_equipe' ? `Pedido com a equipe · ${nome(p.credor_id)}` : p.situacao === 'com_erros' ? `A geração não passou · ${nome(p.credor_id)}` : `Gerando o rascunho · ${nome(p.credor_id)}`;
	const respondidas = perguntas.filter(q => (resp[q] ?? '').trim()).length;
	const podeDescartar = perm.editar && ['pendente', 'gerado', 'com_erros', 'na_equipe'].includes(p.situacao);
	async function confirmarDescarte() {
		if (!api) return;
		setOcupado(true);
		const ok = await executar(() => api.cancelarPedido(p!.id), p!.versao_gerada_id ? 'Rascunho descartado. O pedido fica guardado.' : 'Pedido cancelado. Ele fica guardado.');
		setOcupado(false); setDescartar(false);
		if (ok) navigate(rota('lista'));
	}
	async function gerarDeNovo() {
		if (!api) return;
		if (await executar(() => api.responderPedido(p!.id, Object.fromEntries(Object.entries(resp).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim().slice(0, 500)]))), 'Respostas enviadas. Gerando de novo…')) void recarregar();
	}

	return (
		<>
			{cab(titulo, `${quem} · pedido ${codigo}${p.gerado_em ? ` em ${dataCurta(p.gerado_em)}` : ''} · continua rascunho e passa pela mesma aprovação`,
				<>
					{podeDescartar && <button type="button" onClick={() => setDescartar(true)} className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Descartar</button>}
					{p.versao_gerada_id && <Botao onClick={() => navigate(rota('editor', p.versao_gerada_id))}>Abrir no editor</Botao>}
				</>)}
			<ConfirmaAcao aberto={descartar} titulo={p.versao_gerada_id ? 'Descartar o rascunho gerado?' : 'Cancelar este pedido?'}
				texto={p.versao_gerada_id ? 'O rascunho gerado é apagado (se ainda não foi aprovado). O pedido, o texto e as respostas ficam guardados.' : p.tipo === 'equipe' ? 'A equipe MotorCX recebe o aviso no chamado e não monta o rascunho. O pedido fica guardado.' : 'O pedido sai da fila e fica guardado como cancelado.'}
				botao="Descartar" onConfirm={() => void confirmarDescarte()} onClose={() => setDescartar(false)} loading={ocupado} />
			<div className="space-y-4">
				{(p.situacao === 'pendente' || p.situacao === 'gerando') && <Aviso tom="info" titulo="Gerando o rascunho…">Leva alguns segundos. Esta tela atualiza sozinha.</Aviso>}
				{p.situacao === 'cancelado' && <Aviso tom="neutro" titulo="Pedido cancelado.">{p.cancelado_em ? `Em ${dataCurta(p.cancelado_em)}. ` : ''}O texto fica guardado; para pedir de novo, use "Novo fluxo".</Aviso>}
				{p.situacao === 'na_equipe' && <Aviso tom="info" titulo={`Pedido aberto no Suporte (chamado ${p.chamado_id ?? '—'}).`}>A equipe MotorCX monta o rascunho até {dataCurta(p.prazo_em)}. Ele aparece em Fluxos quando ficar pronto.</Aviso>}
				{p.situacao === 'com_erros' && <Aviso tom="erro" titulo="O rascunho não passou no validador e não foi criado.">{textos(r.erros).map(e => explicar(e).texto).join(' ')} Responda as perguntas ou ajuste o texto e peça de novo.</Aviso>}
				{p.situacao === 'gerado' && (perguntas.length > 0 || pend.length > 0) && (
					<Aviso tom="atencao" titulo={`Faltam ${perguntas.length - respondidas} ${perguntas.length - respondidas === 1 ? 'resposta sua' : 'respostas suas'} e ${pend.length} ${pend.length === 1 ? 'ajuste' : 'ajustes'} no editor.`}>
						{(r.tentativas ?? 0) > 1 ? `A 1ª tentativa não passou no validador e a IA corrigiu sozinha (passou na ${r.tentativas}ª). ` : ''}Conectores e alçada da carteira só vocês resolvem.
					</Aviso>
				)}
				{p.situacao !== 'na_equipe' && (
					<div className="grid items-start gap-4 lg:grid-cols-2">
						<Cartao titulo="Responda para gerar de novo" linha={perguntas.length ? 'O que faltou no texto' : 'A geração não deixou perguntas.'}>
							{perguntas.length > 0 && (
								<div className="space-y-3">
									{perguntas.map(q => (
										<Campo key={q} rotulo={q}>
											<input value={resp[q] ?? ''} maxLength={500} disabled={!perm.editar || p.tipo !== 'ia'} onChange={e => setResp(x => ({ ...x, [q]: e.target.value }))} className={`${campoCls} w-full`} style={campoStyle} />
										</Campo>
									))}
									{perm.editar && p.tipo === 'ia' && (p.situacao === 'gerado' || p.situacao === 'com_erros') && <Botao secundario disabled={!respondidas} onClick={() => void gerarDeNovo()}><Sparkles size={14} aria-hidden /> Gerar de novo</Botao>}
								</div>
							)}
						</Cartao>
						<Cartao titulo="O que eu entendi" linha="Cada frase do seu texto e a etapa que ela virou">
							{entendi.length ? <Linhas itens={entendi.map((e, i) => ({ e: `${i + 1}. ${e.frase ?? ''}`, d: e.bloco ? e.bloco : <Pilula tom="erro">não feito</Pilula> }))} />
								: <p className="text-[13px] text-[var(--base-texto-2)]">{p.situacao === 'gerado' ? 'Sem detalhamento.' : '—'}</p>}
						</Cartao>
					</div>
				)}
				<Cartao>
					<Detalhes titulo="O texto que vocês escreveram" qtd={p.anexos.length ? `${p.anexos.length} ${p.anexos.length === 1 ? 'anexo' : 'anexos'}` : undefined}>
						<p className="whitespace-pre-wrap rounded-xl bg-[var(--base-fill)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--base-texto)]">{p.texto}</p>
						{p.anexos.length > 0 && <p className="mt-2 text-[12px] text-[var(--base-texto-3)]">{p.anexos.map(a => a.split('/').pop()).join(' · ')}</p>}
					</Detalhes>
					{textos(r.suposicoes).length > 0 && <Detalhes titulo="O que a IA supôs" qtd={`${textos(r.suposicoes).length}`}><Linhas itens={textos(r.suposicoes).map(s => ({ e: s }))} /></Detalhes>}
					{textos(r.mudancas).length > 0 && <Detalhes titulo="O que mudou em relação à versão de origem" qtd={`${textos(r.mudancas).length}`}><Linhas itens={textos(r.mudancas).map(s => ({ e: s }))} /></Detalhes>}
					{pend.length > 0 && <Detalhes titulo="Ajustes no editor" qtd={`${pend.length}`}><Linhas itens={pend.map(x => ({ e: x.bloco ? `${x.bloco}` : 'Fluxo', s: x.texto }))} /></Detalhes>}
					<Detalhes titulo="Travas aplicadas sem vocês pedirem"><Regras itens={TRAVAS.filter((_, i) => [0, 2, 3, 5, 6].includes(i))} /></Detalhes>
				</Cartao>
				<p className="text-[12px] text-[var(--base-texto-3)]">Situação: {situacaoPedido(p)}. {p.tipo === 'ia' && p.geracoes ? `${p.geracoes} ${p.geracoes === 1 ? 'geração' : 'gerações'} no item de IA da fatura.` : ''}</p>
			</div>
		</>
	);
}
