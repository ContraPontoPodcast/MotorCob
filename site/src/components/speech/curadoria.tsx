// Speech Analytics › Curadoria. Onde a operação revisa e melhora o que a IA faz: fila (intenção com baixa confiança,
// resposta trocada pela trava, código com dúvida, nota contestada, transcrição com erro, tema sem nome), conjunto de
// referência (sem ID de cliente nem chamada, dura além da retenção) e backlog de melhorias. Exige curadoria_voz; cada
// ação fica na Auditoria. "Virar caso de teste" depende do Fluxo do agente, que ainda não está neste banco.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { CURADORIA_TIPOS, MELHORIA_SIT, MELHORIA_TIPO, PERM_SA, dataBR, dataHoraBR, dc, nf, textoTemDadoPessoal } from '@/lib/speech';
import { Botao, Cartao, Kpi, Pilula, campoCls, campoStyle } from '@/components/voz/ui';
import { Bloqueio, Modal, Segmentos, Trecho, type Filtros } from './comum';
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

export function Curadoria({ f }: { f: Filtros }) {
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

	async function curar(id: number, acao: string, valor?: string) {
		if (!supabase) return;
		const { error } = await supabase.rpc('curar_item_voz', { item: id, acao, valor: valor ?? null });
		if (error) { toast.error(friendlyError(error)); return; }
		setCorr(null); setRecarga(x => x + 1);
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
	if (!pode) return <Bloqueio titulo="Seu perfil não faz curadoria.">A fila mostra trechos mascarados e muda o que a IA aprende, por isso exige a permissão curadoria_voz. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio>;
	if (erro) return <Notice>{erro}</Notice>;
	if (loading) return <Loading />;

	const abertos = itens.filter(i => i.situacao === 'aberto');
	const recentes = itens.filter(i => i.situacao !== 'aberto' && i.em && Date.now() - new Date(i.em).getTime() < 86400000);
	const fila = [...abertos, ...recentes].filter(i => !tipo || i.tipo === tipo).slice(0, 40);
	const acerto = (t: string, mes: string) => { const xs = med.filter(m => m.tipo === t && m.mes === mes); const tot = xs.reduce((s, x) => s + x.total, 0); return tot >= 30 ? (100 * xs.reduce((s, x) => s + x.acertos, 0)) / tot : null; };
	const ultimo = meses.at(-1);
	const acertoUlt = ultimo ? (() => { const xs = med.filter(m => m.mes === ultimo); const tot = xs.reduce((s, x) => s + x.total, 0); return tot >= 30 ? (100 * xs.reduce((s, x) => s + x.acertos, 0)) / tot : null; })() : null;
	const melV = mel.filter(m => !melSt || m.situacao === melSt);
	const porTipo = (t: string) => gold.filter(g => g.tipo === t).length;

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Kpi rotulo="Na fila" valor={nf(abertos.length)} detalhe="mais antigos primeiro" />
				<Kpi rotulo="Conjunto de referência" valor={nf(gold.length)} detalhe={`${nf(porTipo('intencao'))} intenções · ${nf(porTipo('codigo'))} códigos · ${nf(porTipo('nota'))} notas`} />
				<Kpi rotulo={`Acerto da IA${ultimo ? ` em ${dataBR(ultimo).slice(3)}` : ''}`} valor={acertoUlt == null ? '—' : `${dc(acertoUlt)}%`} detalhe="medido sobre as correções humanas" />
				<Kpi rotulo="Melhorias aplicadas" valor={nf(mel.filter(m => m.situacao === 'aplicada').length)} detalhe={`${nf(mel.filter(m => m.situacao === 'em_teste').length)} em teste`} />
			</div>
			<Cartao semPadding titulo="Fila de curadoria" linha="Cada ação fica registrada com nome e hora.">
				<div className="flex flex-wrap gap-1.5 px-4 pb-3 sm:px-5">
					{[['', 'Todos'], ...Object.entries(CURADORIA_TIPOS)].map(([k, n]) => <button key={k} type="button" aria-pressed={tipo === k} onClick={() => setTipo(k)} className="rounded-full border px-3 py-1 text-[12.5px]" style={{ borderColor: tipo === k ? 'var(--destaque)' : 'var(--base-borda)', backgroundColor: tipo === k ? 'var(--base-fill)' : undefined }}>{n}</button>)}
				</div>
				{fila.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nada deste tipo na fila.</p> : (
					<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
						{fila.map(i => (
							<div key={i.id} className="px-4 py-3 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
								<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[13px] text-[var(--base-texto)]">CU-{i.id}</b><Pilula>{CURADORIA_TIPOS[i.tipo]}</Pilula><span>{dataHoraBR(i.criado_em)}</span></div>
								{i.trecho_redigido && <Trecho>{i.trecho_redigido}</Trecho>}
								<p className="mt-1.5 text-[12.5px] text-[var(--base-texto-2)]">A IA decidiu: <b className="text-[var(--base-texto)]">{decisaoTexto(i)}</b></p>
								{i.situacao !== 'aberto' ? (
									<p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--estado-pronto-texto)]"><Check size={14} /><b>{ACOES[i.situacao]}{i.valor_certo && i.situacao === 'corrigido' ? ` para ${i.valor_certo}` : ''}</b> em {dataHoraBR(i.em)}{['confirmado', 'corrigido'].includes(i.situacao) ? ' · entrou no conjunto de referência' : ''}<button type="button" className="font-semibold underline" onClick={() => void curar(i.id, 'desfazer')}>Desfazer</button></p>
								) : corr?.id === i.id ? (
									<div className="mt-2 flex flex-wrap gap-2">
										{i.tipo === 'tema' ? <input aria-label="Nome do tema" maxLength={80} value={corr.valor} onChange={e => setCorr({ id: i.id, valor: e.target.value })} placeholder="Ex.: Pix parcelado" className={campoCls} style={campoStyle} />
											: <select aria-label="Valor certo" value={corr.valor} onChange={e => setCorr({ id: i.id, valor: e.target.value })} className={campoCls} style={campoStyle}>{i.opcoes.map(o => <option key={o} value={o}>{o}</option>)}</select>}
										<Botao disabled={corr.valor.trim().length < (i.tipo === 'tema' ? 3 : 1) || textoTemDadoPessoal(corr.valor)} onClick={() => void curar(i.id, 'corrigir', corr.valor)}>{i.tipo === 'tema' ? 'Dar nome ao tema' : 'Salvar correção'}</Botao>
										<Botao secundario onClick={() => setCorr(null)}>Cancelar</Botao>
									</div>
								) : (
									<div className="mt-2 flex flex-wrap gap-2">
										{i.tipo !== 'tema' && <Botao onClick={() => void curar(i.id, 'confirmar')}>Confirmar</Botao>}
										<Botao secundario onClick={() => setCorr({ id: i.id, valor: i.tipo === 'tema' ? (typeof i.decisao_ia.sugestao === 'string' ? i.decisao_ia.sugestao : '') : i.opcoes[0] ?? '' })}>{i.tipo === 'tema' ? 'Dar nome' : 'Corrigir'}</Botao>
										{['intencao', 'trava', 'codigo', 'tema'].includes(i.tipo) && <Botao secundario onClick={() => void curar(i.id, 'exemplo')}>Virar exemplo</Botao>}
										{i.tipo !== 'transcricao' && <Botao secundario disabled title="Depende do Fluxo do agente (casos de teste), que ainda não está neste banco.">Virar caso de teste</Botao>}
										<Botao secundario onClick={() => void curar(i.id, 'descartar')}>Descartar</Botao>
									</div>
								)}
							</div>
						))}
					</div>
				)}
				<p className="border-t px-4 py-3 text-[12px] text-[var(--base-texto-3)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>"Virar caso de teste" fica desligado até o Fluxo do agente (com os casos de teste) entrar no banco. "Virar exemplo" guarda no conjunto de referência e abre uma melhoria no backlog.</p>
			</Cartao>
			<div className="grid gap-4 lg:grid-cols-2">
				<Cartao titulo="Conjunto de referência: acerto por tipo" linha="Mês a mês, medido sobre as correções humanas">
					<Legenda itens={TIPOS_MED.map(t => ({ nome: t.nome, cor: t.cor, linha: true }))} />
					{meses.length < 2 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">A medição começa quando o conjunto tiver confirmações e correções suficientes (job mensal).</p> : <LinhaSemanas x={meses.map(m => dataBR(m).slice(3))} series={TIPOS_MED.map(t => ({ nome: t.nome, cor: t.cor, valores: meses.map(m => acerto(t.id, m)) }))} min={50} max={100} ticks={[50, 60, 70, 80, 90, 100]} fmt={v => `${dc(v, 0)}%`} rotulo="Acerto da IA por mês" />}
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">O conjunto guarda o trecho mascarado e a resposta certa, sem ID do cliente e sem ligação com a gravação. Toda versão nova do fluxo, do extrator e do avaliador roda contra ele antes de entrar em uso.</p>
				</Cartao>
				<Cartao titulo="Como a curadoria volta para a IA">
					<ol className="space-y-2 text-[13px]">
						{[['Confirmar ou corrigir', 'vai para o conjunto de referência e mede o acerto'], ['Virar exemplo', 'exemplo da intenção ou resposta na base do fluxo, pelo backlog'], ['Virar caso de teste', 'entra nos casos de teste do Fluxo do agente (quando ele estiver no banco)'], ['Melhoria no backlog', 'com responsável e impacto medido depois']].map(([t, s], k) => (
							<li key={t} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ backgroundColor: 'var(--estado-pronto-fundo)', color: 'var(--estado-pronto-texto)' }}>{k + 1}</span><span><b>{t}</b><small className="block text-[var(--base-texto-2)]">{s}</small></span></li>
						))}
					</ol>
				</Cartao>
			</div>
			<Cartao semPadding titulo="Backlog de melhorias" linha="Fluxo, base de respostas e checklist" direita={<Botao onClick={() => setModalMel(true)}>Nova melhoria</Botao>}>
				<div className="px-4 pb-3 sm:px-5"><Segmentos rotulo="Situação" itens={[{ v: '', n: 'Todas' }, ...Object.entries(MELHORIA_SIT).map(([v, n]) => ({ v, n }))]} valor={melSt} onTrocar={setMelSt} /></div>
				{melV.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nenhuma.</p> : (
					<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
						{melV.map(m => (
							<div key={m.id} className="grid grid-cols-1 gap-1 px-4 py-2.5 text-[13px] sm:grid-cols-[60px_minmax(0,1.6fr)_minmax(0,1fr)_150px_minmax(0,1fr)] sm:items-center sm:gap-3 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
								<span className="font-mono text-[12px] text-[var(--base-texto-3)]">ML-{m.id}</span>
								<span className="min-w-0"><b className="font-semibold">{m.titulo}</b><small className="block text-[var(--base-texto-3)]">{MELHORIA_TIPO[m.tipo]}</small></span>
								<span className="truncate text-[var(--base-texto-2)]">{m.responsavel ?? '—'}</span>
								<select aria-label="Situação" value={m.situacao} onChange={e => void mudarMelhoria(m, e.target.value)} className={campoCls} style={campoStyle}>{Object.entries(MELHORIA_SIT).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
								<span className="text-[var(--base-texto-2)]">{m.impacto?.texto ?? '—'}</span>
							</div>
						))}
					</div>
				)}
			</Cartao>
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
