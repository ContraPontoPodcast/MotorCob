// Speech Analytics › Curadoria. Onde a operação revisa e melhora o que a IA faz: fila (intenção com baixa confiança,
// resposta trocada pela trava, código com dúvida, nota contestada, transcrição com erro, tema sem nome), conjunto de
// referência (sem ID de cliente nem chamada, dura além da retenção) e backlog de melhorias. Exige curadoria_voz; cada
// ação fica na Auditoria. "Virar caso de teste" depende do Fluxo do agente, que ainda não está neste banco.
// Redesign v2: "Começar a revisar" abre o primeiro caso na gaveta (Confirmar e próximo); fila em tabela de 3 colunas;
// exemplo, caso de teste e descartar em "Mais ações"; backlog num botão; gráfico e passo a passo recolhidos.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { CURADORIA_TIPOS, MELHORIA_SIT, MELHORIA_TIPO, PERM_SA, dataBR, dataHoraBR, dc, nf, textoTemDadoPessoal } from '@/lib/speech';
import { Botao, Cartao, Detalhes, Estado, Gaveta, Kpis, Pilula, SeloRegras, Segmentos, Tabela, campoCls, campoStyle } from '@/components/ds';
import { Bloqueio, Modal, Trecho, type Filtros } from './comum';
import type { DefinirAcoes } from './speech-analytics';
import { COR_HUMANO, COR_IA, Legenda, LinhaSemanas } from './graficos';

type Item = { id: number; tipo: string; trecho_redigido: string | null; decisao_ia: Record<string, unknown>; opcoes: string[]; confianca: number | null; situacao: string; valor_certo: string | null; criado_em: string; em: string | null };
type Melhoria = { id: number; tipo: string; titulo: string; responsavel: string | null; situacao: string; impacto: { texto?: string } | null; criada_em: string };
type Medicao = { mes: string; tipo: string; acertos: number; total: number };
const ACOES: Record<string, string> = { confirmado: 'Confirmado', corrigido: 'Corrigido', exemplo: 'Virou exemplo', caso_teste: 'Virou caso de teste', descartado: 'Descartado' };
const TIPOS_MED: { id: string; nome: string; cor: string }[] = [{ id: 'intencao', nome: 'Intenção', cor: COR_IA }, { id: 'codigo', nome: 'Código (motivo e objeção)', cor: COR_HUMANO }, { id: 'nota', nome: 'Nota do checklist', cor: 'var(--estado-atencao)' }];

function decisaoTexto(i: Item): string {
	const d = i.decisao_ia;
	if (i.tipo === 'tema') return `Tema novo com ${nf(d.conversas)} conversas, ainda sem nome${typeof d.sugestao === 'string' && d.sugestao ? ` · sugestão da IA: "${d.sugestao}"` : ''}`;
	if (i.tipo === 'nota') return `Item ${String(d.item)}: ${String(d.valor) === 'nao' ? 'não' : String(d.valor)}${d.contestada ? ' · contestada' : ''}`;
	if (i.tipo === 'codigo') return `${String(d.campo ?? 'código')} = ${String(d.valor)} · dúvida com ${String(d.duvida_com ?? '—')}`;
	if (i.tipo === 'trava') return `Trava ${String(d.trava ?? '')} trocou a resposta`;
	if (i.tipo === 'transcricao') return `${dc(Number(d.baixa_pct ?? 0) * 100, 0)}% do trecho com baixa confiança`;
	return `Intenção ${String(d.valor)}${i.confianca != null ? ` · confiança ${dc(i.confianca, 2)}` : ''}`;
}

export function Curadoria({ f, setAcoes }: { f: Filtros; setAcoes: DefinirAcoes }) {
	const pode = usePermissao(PERM_SA.curadoria);
	const [itens, setItens] = useState<Item[]>([]);
	const [mel, setMel] = useState<Melhoria[]>([]);
	const [med, setMed] = useState<Medicao[]>([]);
	const [gold, setGold] = useState<{ tipo: string }[]>([]);
	const [tipo, setTipo] = useState('');
	const [melSt, setMelSt] = useState('');
	const [corr, setCorr] = useState<{ id: number; valor: string } | null>(null);
	const [modalMel, setModalMel] = useState(false);
	const [nova, setNova] = useState({ titulo: '', tipo: 'fluxo', responsavel: '' });
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [recarga, setRecarga] = useState(0);
	const [abertoId, setAbertoId] = useState<number | null>(null);
	const [backlog, setBacklog] = useState(false);

	useEffect(() => {
		if (!supabase || !pode) { setLoading(false); return; }
		const sb = supabase;
		let ativo = true;
		setLoading(true);
		(async () => {
			const [a, b, c, d] = await Promise.all([
				sb.from('voz_curadoria_itens').select('id, tipo, trecho_redigido, decisao_ia, opcoes, confianca, situacao, valor_certo, criado_em, em').eq('empresa_id', f.empresaId).order('criado_em', { ascending: true }).limit(300),
				sb.from('voz_melhorias').select('id, tipo, titulo, responsavel, situacao, impacto, criada_em').eq('empresa_id', f.empresaId).order('criada_em', { ascending: false }).limit(100),
				sb.from('voz_golden_medicoes').select('mes, tipo, acertos, total').order('mes').limit(500),
				sb.from('voz_golden_set').select('tipo').eq('empresa_id', f.empresaId).limit(10000),
			]);
			if (!ativo) return;
			if (a.error) { setErro(friendlyError(a.error)); setLoading(false); return; }
			setItens((a.data ?? []) as Item[]); setMel((b.data ?? []) as Melhoria[]); setMed((c.data ?? []) as Medicao[]); setGold((d.data ?? []) as { tipo: string }[]);
			setLoading(false);
		})();
		return () => { ativo = false; };
	}, [pode, f.empresaId, recarga]);

	async function curar(id: number, acao: string, valor?: string, proximo?: boolean) {
		if (!supabase) return;
		const { error } = await supabase.rpc('curar_item_voz', { item: id, acao, valor: valor ?? null });
		if (error) { toast.error(friendlyError(error)); return; }
		setCorr(null); setRecarga(x => x + 1);
		if (proximo) {
			const resto = itens.filter(i => i.situacao === 'aberto' && i.id !== id && (!tipo || i.tipo === tipo));
			setAbertoId(resto[0]?.id ?? null);
			if (!resto.length) toast.success('Fila revisada. Nada mais deste tipo.');
		}
	}
	async function criarMelhoria() {
		if (!supabase) return;
		const { error } = await supabase.rpc('salvar_melhoria_voz', { empresa: f.empresaId, id: null, tipo: nova.tipo, titulo: nova.titulo.trim(), responsavel: nova.responsavel.trim() || null, situacao: 'aberta' });
		if (error) { toast.error(friendlyError(error)); return; }
		setModalMel(false); setNova({ titulo: '', tipo: 'fluxo', responsavel: '' }); setRecarga(x => x + 1);
	}
	async function mudarMelhoria(m: Melhoria, situacao: string) {
		if (!supabase) return;
		const { error } = await supabase.rpc('salvar_melhoria_voz', { empresa: f.empresaId, id: m.id, tipo: m.tipo, titulo: m.titulo, responsavel: m.responsavel, situacao });
		if (error) toast.error(friendlyError(error)); else setRecarga(x => x + 1);
	}

	const meses = useMemo(() => [...new Set(med.map(m => m.mes))].sort().slice(-6), [med]);
	const primeiro = itens.find(i => i.situacao === 'aberto' && (!tipo || i.tipo === tipo)) ?? null;
	useEffect(() => {
		setAcoes(pode ? <>
			<Botao tipo="secundario" onClick={() => setBacklog(true)}>Backlog de melhorias</Botao>
			<Botao disabled={!primeiro} onClick={() => primeiro && setAbertoId(primeiro.id)}>Começar a revisar</Botao>
		</> : null);
		return () => setAcoes(null);
	}, [pode, primeiro, setAcoes]);

	if (!pode) return <Bloqueio titulo="Seu perfil não faz curadoria.">A fila mostra trechos mascarados e muda o que a IA aprende, por isso exige a permissão Curadoria. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio>;
	if (erro) return <Estado tipo="erro" titulo="Não deu para carregar a fila.">{erro}</Estado>;
	if (loading) return <Estado tipo="carregando" />;

	const abertos = itens.filter(i => i.situacao === 'aberto');
	const recentes = itens.filter(i => i.situacao !== 'aberto' && i.em && Date.now() - new Date(i.em).getTime() < 86400000);
	const fila = [...abertos, ...recentes].filter(i => !tipo || i.tipo === tipo).slice(0, 40);
	const acerto = (t: string, mes: string) => { const xs = med.filter(m => m.tipo === t && m.mes === mes); const tot = xs.reduce((s, x) => s + x.total, 0); return tot >= 30 ? (100 * xs.reduce((s, x) => s + x.acertos, 0)) / tot : null; };
	const ultimo = meses.at(-1);
	const acertoUlt = ultimo ? (() => { const xs = med.filter(m => m.mes === ultimo); const tot = xs.reduce((s, x) => s + x.total, 0); return tot >= 30 ? (100 * xs.reduce((s, x) => s + x.acertos, 0)) / tot : null; })() : null;
	const melV = mel.filter(m => !melSt || m.situacao === melSt);
	const porTipo = (t: string) => gold.filter(g => g.tipo === t).length;
	const item = itens.find(i => i.id === abertoId) ?? null;
	const contTipo = (k: string) => abertos.filter(i => !k || i.tipo === k).length;

	return (
		<div className="space-y-4">
			<Kpis itens={[
				{ rotulo: 'Na fila', valor: nf(abertos.length), detalhe: 'mais antigos primeiro' },
				{ rotulo: 'Conjunto de referência', valor: nf(gold.length), detalhe: `${nf(porTipo('intencao'))} intenções · ${nf(porTipo('codigo'))} códigos · ${nf(porTipo('nota'))} notas` },
				{ rotulo: `Acerto da IA${ultimo ? ` em ${dataBR(ultimo).slice(3)}` : ''}`, valor: acertoUlt == null ? '—' : `${dc(acertoUlt)}%`, detalhe: 'medido sobre as correções humanas' },
				{ rotulo: 'Melhorias aplicadas', valor: nf(mel.filter(m => m.situacao === 'aplicada').length), detalhe: `${nf(mel.filter(m => m.situacao === 'em_teste').length)} em teste` },
			]} />
			<Cartao semPadding titulo="Fila de curadoria" linha="Clique num caso para revisar. Cada ação fica registrada com nome e hora." direita={<>
				<select aria-label="Tipo de caso" value={tipo} onChange={e => setTipo(e.target.value)} className={campoCls} style={campoStyle}>
					<option value="">Todos · {nf(contTipo(''))}</option>
					{Object.entries(CURADORIA_TIPOS).map(([k, n]) => <option key={k} value={k}>{n} · {nf(contTipo(k))}</option>)}
				</select>
				<SeloRegras rotulo="Regras" regras={[
					{ titulo: 'Exige a permissão Curadoria', texto: 'A fila mostra trechos mascarados e muda o que a IA aprende.' },
					{ titulo: 'Cada ação fica registrada', texto: 'Nome e hora, e aparece na Auditoria.' },
					{ titulo: 'Conjunto de referência sem ID', texto: 'Guarda o trecho mascarado e a resposta certa, sem ID do cliente e sem ligação com a gravação; dura além da retenção.' },
					{ titulo: '"Virar caso de teste" depende do Fluxo do agente', texto: 'Fica desligado até os casos de teste entrarem no banco.' },
				]} />
			</>}>
				<Tabela rotulo="Fila de curadoria" linhas={fila} chave={i => i.id} onAbrir={i => { setCorr(null); setAbertoId(i.id); }} selecionada={abertoId}
					vazio="Nada deste tipo na fila."
					colunas={[
						{ id: 'caso', titulo: 'Caso', celula: i => <span className="whitespace-nowrap"><b>CU-{i.id}</b><small className="block text-[11.5px] text-[var(--base-texto-3)]">{CURADORIA_TIPOS[i.tipo]}</small></span> },
						{ id: 'trecho', titulo: 'Trecho', celula: i => <span className="line-clamp-2 text-[var(--base-texto-2)]">{i.trecho_redigido ?? '—'}</span> },
						{ id: 'ia', titulo: 'A IA decidiu', celula: i => i.situacao !== 'aberto' ? <Pilula tom="ok"><Check size={12} aria-hidden="true" />{ACOES[i.situacao]}</Pilula> : <span>{decisaoTexto(i)}</span> },
					]}
					celular={i => ({ titulo: <>CU-{i.id} · {CURADORIA_TIPOS[i.tipo]}</>, valor: i.situacao !== 'aberto' ? <Pilula tom="ok">{ACOES[i.situacao]}</Pilula> : undefined, resumo: decisaoTexto(i) })} />
			</Cartao>
			<Detalhes solto resumo="Acerto por tipo e como a curadoria volta para a IA">
				<div className="grid gap-4 pt-1 lg:grid-cols-2">
					<div>
						<h3 className="mb-1 text-[13px] font-semibold">Conjunto de referência: acerto por tipo</h3>
						<Legenda itens={TIPOS_MED.map(t => ({ nome: t.nome, cor: t.cor, linha: true }))} />
						{meses.length < 2 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">A medição começa quando o conjunto tiver confirmações e correções suficientes (job mensal).</p> : <LinhaSemanas x={meses.map(m => dataBR(m).slice(3))} series={TIPOS_MED.map(t => ({ nome: t.nome, cor: t.cor, valores: meses.map(m => acerto(t.id, m)) }))} min={50} max={100} ticks={[50, 60, 70, 80, 90, 100]} fmt={v => `${dc(v, 0)}%`} rotulo="Acerto da IA por mês" />}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Toda versão nova do fluxo, do extrator e do avaliador roda contra o conjunto antes de entrar em uso.</p>
					</div>
					<ol className="space-y-2 text-[13px]">
						{[['Confirmar ou corrigir', 'vai para o conjunto de referência e mede o acerto'], ['Virar exemplo', 'exemplo da intenção ou resposta na base do fluxo, pelo backlog'], ['Virar caso de teste', 'entra nos casos de teste do Fluxo do agente (quando ele estiver no banco)'], ['Melhoria no backlog', 'com responsável e impacto medido depois']].map(([t, sx], k) => (
							<li key={t} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--estado-pronto-fundo)] text-[11px] font-bold text-[var(--estado-pronto-texto)]">{k + 1}</span><span><b>{t}</b><small className="block text-[var(--base-texto-2)]">{sx}</small></span></li>
						))}
					</ol>
				</div>
			</Detalhes>

			<Gaveta aberta={!!item} onFechar={() => { setAbertoId(null); setCorr(null); }} titulo={item ? `CU-${item.id} · ${CURADORIA_TIPOS[item.tipo]}` : ''} subtitulo={item ? `Na fila desde ${dataHoraBR(item.criado_em)}` : undefined}
				rodape={item && item.situacao === 'aberto' && corr?.id !== item.id ? <>
					<Botao tipo="secundario" onClick={() => setCorr({ id: item.id, valor: item.tipo === 'tema' ? (typeof item.decisao_ia.sugestao === 'string' ? item.decisao_ia.sugestao : '') : item.opcoes[0] ?? '' })}>{item.tipo === 'tema' ? 'Dar nome' : 'Corrigir'}</Botao>
					{item.tipo !== 'tema' && <Botao onClick={() => void curar(item.id, 'confirmar', undefined, true)}>Confirmar e próximo</Botao>}
				</> : undefined}>
				{item && <>
					{item.trecho_redigido && <Trecho>{item.trecho_redigido}</Trecho>}
					<p className="text-[13px] text-[var(--base-texto-2)]">A IA decidiu: <b className="text-[var(--base-texto)]">{decisaoTexto(item)}</b></p>
					{item.situacao !== 'aberto' ? (
						<p className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--estado-pronto-texto)]"><Check size={14} aria-hidden="true" /><b>{ACOES[item.situacao]}{item.valor_certo && item.situacao === 'corrigido' ? ` para ${item.valor_certo}` : ''}</b> em {dataHoraBR(item.em)}{['confirmado', 'corrigido'].includes(item.situacao) ? ' · entrou no conjunto de referência' : ''}<Botao pequeno tipo="fantasma" onClick={() => void curar(item.id, 'desfazer')}>Desfazer</Botao></p>
					) : corr?.id === item.id ? (
						<div className="flex flex-wrap gap-2">
							{item.tipo === 'tema' ? <input aria-label="Nome do tema" maxLength={80} value={corr.valor} onChange={e => setCorr({ id: item.id, valor: e.target.value })} placeholder="Ex.: Pix parcelado" className={`${campoCls} flex-1`} style={campoStyle} />
								: <select aria-label="Valor certo" value={corr.valor} onChange={e => setCorr({ id: item.id, valor: e.target.value })} className={`${campoCls} flex-1`} style={campoStyle}>{item.opcoes.map(o => <option key={o} value={o}>{o}</option>)}</select>}
							<Botao disabled={corr.valor.trim().length < (item.tipo === 'tema' ? 3 : 1) || textoTemDadoPessoal(corr.valor)} onClick={() => void curar(item.id, 'corrigir', corr.valor, true)}>{item.tipo === 'tema' ? 'Dar nome e próximo' : 'Salvar e próximo'}</Botao>
							<Botao tipo="secundario" onClick={() => setCorr(null)}>Cancelar</Botao>
						</div>
					) : (
						<Detalhes resumo="Mais ações">
							<div className="flex flex-wrap gap-2">
								{['intencao', 'trava', 'codigo', 'tema'].includes(item.tipo) && <Botao pequeno tipo="secundario" onClick={() => void curar(item.id, 'exemplo', undefined, true)}>Virar exemplo</Botao>}
								{item.tipo !== 'transcricao' && <Botao pequeno tipo="secundario" disabled title="Depende do Fluxo do agente (casos de teste), que ainda não está neste banco.">Virar caso de teste</Botao>}
								<Botao pequeno tipo="perigo" onClick={() => void curar(item.id, 'descartar', undefined, true)}>Descartar</Botao>
							</div>
							<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">"Virar exemplo" guarda no conjunto de referência e abre uma melhoria no backlog.</p>
						</Detalhes>
					)}
				</>}
			</Gaveta>

			<Gaveta aberta={backlog} onFechar={() => setBacklog(false)} largura={600} titulo="Backlog de melhorias" subtitulo="Fluxo, base de respostas e checklist" rodape={<Botao onClick={() => setModalMel(true)}>Nova melhoria</Botao>}>
				<Segmentos rotulo="Situação" itens={[{ v: '', n: 'Todas' }, ...Object.entries(MELHORIA_SIT).map(([v, n]) => ({ v, n }))]} valor={melSt} onTrocar={setMelSt} />
				{melV.length === 0 ? <Estado tipo="vazio" compacto titulo="Nenhuma melhoria." /> : melV.map(m => (
					<div key={m.id} className="flex flex-col gap-1.5 border-b pb-3 text-[13px] last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
						<div className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="font-semibold">{m.titulo}</b><small className="block text-[var(--base-texto-3)]">ML-{m.id} · {MELHORIA_TIPO[m.tipo]} · {m.responsavel ?? 'sem responsável'}</small></span>
							<select aria-label="Situação" value={m.situacao} onChange={e => void mudarMelhoria(m, e.target.value)} className={campoCls} style={campoStyle}>{Object.entries(MELHORIA_SIT).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
						{m.impacto?.texto && <small className="text-[var(--base-texto-2)]">Impacto: {m.impacto.texto}</small>}
					</div>
				))}
			</Gaveta>
			{modalMel && (
				<Modal titulo="Nova melhoria" texto="Sem dado de cliente na descrição." confirmar="Criar" desabilitado={nova.titulo.trim().length < 5 || textoTemDadoPessoal(nova.titulo + ' ' + nova.responsavel)} onFechar={() => setModalMel(false)} onConfirmar={() => void criarMelhoria()}>
					<input aria-label="Melhoria" maxLength={140} value={nova.titulo} onChange={e => setNova({ ...nova, titulo: e.target.value })} placeholder="Ex.: Resposta para quem pergunta sobre o Serasa" className={`${campoCls} w-full`} style={campoStyle} />
					<select aria-label="Tipo" value={nova.tipo} onChange={e => setNova({ ...nova, tipo: e.target.value })} className={`${campoCls} w-full`} style={campoStyle}>{Object.entries(MELHORIA_TIPO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
					<input aria-label="Responsável" maxLength={60} value={nova.responsavel} onChange={e => setNova({ ...nova, responsavel: e.target.value })} placeholder="Responsável (ex.: Marina L.)" className={`${campoCls} w-full`} style={campoStyle} />
				</Modal>
			)}
		</div>
	);
}
