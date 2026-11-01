// Speech Analytics › Qualidade e compliance. Checklist com dois níveis (padrão MotorCX + o do cliente), itens de lei
// com cadeado, cada publicação é uma versão e vale só daqui para a frente (a nota fica na versão em que foi dada).
// Ligações reprovadas: trecho só com ver_transcricoes; "Discordar da nota" manda o caso para a Curadoria.
// Redesign v2: o editor do checklist abre numa gaveta (ação principal); a tabela tem 4 colunas e o resto vai para a
// gaveta do item; as 3 primeiras reprovadas ficam à vista, e a regra de quem pode ouvir vira um selo.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Pencil, Play } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { APLICA, GRAVIDADE, ORIGEM_ITEM, PERM_SA, ajustarItem, dataBR, dataHoraBR, dc, idItem, nf, pc, textoTemDadoPessoal, type ItemChecklist } from '@/lib/speech';
import { Botao, BotaoLink, Cartao, Detalhes, Estado, Gaveta, Kpis, ListaRegras, ListaValores, Pilula, SeloRegras, Segmentos, Tabela, campoCls, campoStyle } from '@/components/ds';
import { BarraFiltros, Modal, Trecho, type Filtros } from './comum';
import type { DefinirAcoes } from './speech-analytics';
import { COR_HUMANO, COR_IA, Legenda, LinhaSemanas, semanaRotulo } from './graficos';

type Versao = { id: number; checklist_id: number; versao: number; situacao: 'rascunho' | 'em_uso' | 'arquivada'; itens: ItemChecklist[]; vigente_de: string | null; vigente_ate: string | null };
type Qual = {
	n: number | null; nota: number | null; conformidade: number | null; contestadas: number | null;
	origens: Record<string, { n: number | null; nota: number | null; conformidade: number | null; reprovadas: number | null }>;
	itens: Record<string, Record<string, { n: number | null; aprovado: number | null }>>;
	semanas: { s: string; origem: string; conformidade: number | null }[];
};
type Reprovada = { avaliacao_id: number; gravacao_id: number | null; id_cliente: string; origem: string; operador: string | null; item: string; avaliada_em: string; trecho: string | null; contestada: boolean; total: number };

const TOM_GRAV: Record<string, 'erro' | 'atencao' | 'neutro'> = { bloqueante: 'erro', importante: 'atencao', boa_pratica: 'neutro' };

export function Qualidade({ f, setDias, setAcoes }: { f: Filtros; setDias: (d: number) => void; setAcoes: DefinirAcoes }) {
	const podeEditar = usePermissao(PERM_SA.editarChecklist);
	const leTrecho = usePermissao(PERM_SA.verTranscricoes);
	const [q, setQ] = useState<Qual | null>(null);
	const [padrao, setPadrao] = useState<Versao | null>(null);
	const [versoes, setVersoes] = useState<Versao[]>([]);
	const [rep, setRep] = useState<Reprovada[]>([]);
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [aba, setAba] = useState<'padrao' | 'cliente'>('cliente');
	const [rasc, setRasc] = useState<ItemChecklist[] | null>(null);
	const [modal, setModal] = useState<'novo' | 'publicar' | null>(null);
	const [novo, setNovo] = useState({ texto: '', gravidade: 'importante' as ItemChecklist['gravidade'], aplica: 'ambos' as ItemChecklist['aplica'] });
	const [ocupado, setOcupado] = useState(false);
	const [recarga, setRecarga] = useState(0);
	const [editor, setEditor] = useState(false);
	const [itemSel, setItemSel] = useState<ItemChecklist | null>(null);

	useEffect(() => {
		setAcoes(<Botao tipo={podeEditar ? 'primario' : 'secundario'} onClick={() => setEditor(true)}>{podeEditar ? <><Pencil size={14} aria-hidden="true" />Editar checklist</> : 'Ver checklist'}</Botao>);
		return () => setAcoes(null);
	}, [podeEditar, setAcoes]);

	useEffect(() => {
		if (!supabase) return;
		const sb = supabase;
		let ativo = true;
		setLoading(true); setErro('');
		(async () => {
			const [r, cks, rp] = await Promise.all([
				sb.rpc('qualidade_voz', { empresa: f.empresaId, credor: f.credorId, de: f.de, ate: f.ate }),
				sb.from('checklists_qualidade').select('id, empresa_id, checklist_versoes(id, checklist_id, versao, situacao, itens, vigente_de, vigente_ate)'),
				leTrecho ? sb.rpc('reprovadas_voz', { empresa: f.empresaId, credor: f.credorId, de: f.de, ate: f.ate, limite: 5 }) : Promise.resolve({ data: [], error: null }),
			]);
			if (!ativo) return;
			if (r.error) { setErro(friendlyError(r.error)); setLoading(false); return; }
			setQ(r.data as Qual);
			const lista = (cks.data ?? []) as (Row & { checklist_versoes: Versao[] })[];
			const pad = lista.find(c => c.empresa_id == null)?.checklist_versoes.find(v => v.situacao === 'em_uso') ?? null;
			const cli = (lista.find(c => Number(c.empresa_id) === f.empresaId)?.checklist_versoes ?? []).sort((a, b) => a.versao - b.versao);
			setPadrao(pad); setVersoes(cli);
			const r0 = cli.find(v => v.situacao === 'rascunho');
			const uso = cli.find(v => v.situacao === 'em_uso');
			setRasc(r0 ? r0.itens : (uso ?? pad)?.itens ?? null);
			setRep((rp.data ?? []) as Reprovada[]);
			setLoading(false);
		})();
		return () => { ativo = false; };
	}, [f.empresaId, f.credorId, f.de, f.ate, leTrecho, recarga]);

	const emUso = versoes.find(v => v.situacao === 'em_uso') ?? padrao;
	const temRascunho = versoes.some(v => v.situacao === 'rascunho');
	const proxima = (versoes.at(-1)?.versao ?? 0) + (temRascunho ? 0 : 1);
	const semanas = useMemo(() => [...new Set((q?.semanas ?? []).map(s => s.s))].sort(), [q]);
	const serie = (o: string) => semanas.map(s => (q?.semanas ?? []).find(x => x.s === s && x.origem === o)?.conformidade ?? null);

	async function salvarRascunho(itens: ItemChecklist[]) {
		if (!supabase) return;
		setOcupado(true);
		const { error } = await supabase.rpc('salvar_rascunho_checklist', { empresa: f.empresaId, itens });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return false; }
		toast.success('Rascunho do checklist salvo.');
		setRecarga(x => x + 1);
		return true;
	}
	async function publicar() {
		const r = versoes.find(v => v.situacao === 'rascunho');
		if (!supabase || !r) return;
		setOcupado(true);
		const { data, error } = await supabase.rpc('publicar_checklist', { versao_id: r.id });
		setOcupado(false); setModal(null);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(`Versão ${r.versao} publicada. Vale para as ligações a partir de ${dataBR(String(data))}.`);
		setRecarga(x => x + 1);
	}
	async function discordar(r: Reprovada) {
		if (!supabase) return;
		const { error } = await supabase.rpc('contestar_nota_voz', { avaliacao: r.avaliacao_id });
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success('Discordância registrada. O caso foi para a fila de Curadoria.');
		setRep(xs => xs.map(x => (x.avaliacao_id === r.avaliacao_id ? { ...x, contestada: true } : x)));
	}

	const filtros = <BarraFiltros dias={f.dias} setDias={setDias} origem="" setOrigem={() => {}} credorNome={f.credorNome} semOrigem />;
	if (erro) return <>{filtros}<Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado></>;
	if (loading || !q) return <>{filtros}<Estado tipo="carregando" /></>;

	const itensVisao = (emUso?.itens ?? []).filter(i => i.on);
	const textoItem = (id: string) => (emUso?.itens ?? padrao?.itens ?? []).find(i => i.id === id)?.texto ?? id;
	const editaveis = aba === 'padrao' ? padrao?.itens ?? [] : rasc ?? [];
	const mudou = JSON.stringify(rasc) !== JSON.stringify((versoes.find(v => v.situacao === 'rascunho') ?? emUso)?.itens ?? null);
	const atualizar = (k: number, m: Partial<Pick<ItemChecklist, 'gravidade' | 'peso' | 'on'>>) => setRasc(xs => (xs ?? []).map((it, i) => (i === k ? ajustarItem(it, m) : it)));
	const versaoUso = emUso ? (emUso === padrao ? `Padrão MotorCX v${emUso.versao}` : `v${emUso.versao}`) : '—';
	const medida = (it: ItemChecklist, o: 'ia' | 'discador') => {
		if ((o === 'ia' && it.aplica === 'humano') || (o === 'discador' && it.aplica === 'ia')) return <span className="text-[12px] text-[var(--base-texto-3)]">não se aplica</span>;
		const v = q.itens?.[it.id]?.[o]?.aprovado;
		if (v == null) return <span className="text-[12px] text-[var(--base-texto-3)]">menos de 30</span>;
		return <b className="tnum" style={{ color: o === 'discador' && v < 75 ? 'var(--estado-erro-texto)' : undefined }}>{dc(v)}%</b>;
	};
	const sel = itemSel ? q.itens?.[itemSel.id] ?? {} : {};
	const visiveis = rep.slice(0, 3);
	const linhaRep = (r: Reprovada) => (
		<div key={r.avaliacao_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{r.id_cliente}</b><span>{dataHoraBR(r.avaliada_em)}</span><span>{r.origem === 'ia' ? 'Agente de IA' : r.operador ?? 'Discador'}</span><Pilula tom="erro">{textoItem(r.item)}</Pilula></div>
				{r.trecho && <Trecho>{r.trecho}</Trecho>}
				{r.contestada && <p className="mt-1.5 text-[12px] text-[var(--estado-pronto-texto)]">Discordância registrada. O caso está na fila de Curadoria.</p>}
			</div>
			<div className="flex shrink-0 flex-wrap gap-2">
				<BotaoLink pequeno to={`/gravacoes?cliente=${encodeURIComponent(r.id_cliente)}`}><Play size={13} aria-hidden="true" />Ouvir</BotaoLink>
				{!r.contestada && <Botao tipo="fantasma" pequeno onClick={() => void discordar(r)}>Discordar da nota</Botao>}
			</div>
		</div>
	);

	return (
		<>
			{filtros}
			<div className="space-y-4">
				<Kpis itens={[
					{ rotulo: 'Nota média', valor: dc(q.nota), detalhe: `IA ${dc(q.origens?.ia?.nota)} · humano ${dc(q.origens?.discador?.nota)}` },
					{ rotulo: 'Em conformidade', valor: pc(q.conformidade), detalhe: 'meta de vocês: 95%', tom: q.conformidade != null && q.conformidade < 95 ? 'atencao' : undefined },
					{ rotulo: 'Reprovadas em item bloqueante', valor: nf((q.origens?.ia?.reprovadas ?? 0) + (q.origens?.discador?.reprovadas ?? 0)), detalhe: `${nf(q.origens?.ia?.reprovadas ?? 0)} da IA · ${nf(q.origens?.discador?.reprovadas ?? 0)} do humano` },
					{ rotulo: 'Notas contestadas', valor: pc(q.contestadas), detalhe: 'vão para a Curadoria' },
				]} />
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
					<Cartao semPadding titulo="Nota por item" linha={`% de ligações aprovadas no item · versão em uso: ${versaoUso}`}>
						<Tabela rotulo="Nota por item" linhas={itensVisao} chave={i => i.id} onAbrir={setItemSel} selecionada={itemSel?.id}
							colunas={[
								{ id: 'item', titulo: 'Item', celula: i => <span className="inline-flex items-center gap-1.5">{i.trava && <Lock size={13} className="shrink-0 text-[var(--base-texto-3)]" aria-label="Item de lei" />}{i.texto}</span> },
								{ id: 'grav', titulo: 'Gravidade', celula: i => <Pilula tom={TOM_GRAV[i.gravidade]}>{GRAVIDADE[i.gravidade]}</Pilula> },
								{ id: 'ia', titulo: 'IA', num: true, celula: i => medida(i, 'ia') },
								{ id: 'hu', titulo: 'Humano', num: true, celula: i => medida(i, 'discador') },
							]}
							celular={i => ({ titulo: i.texto, valor: medida(i, 'discador'), resumo: <><Pilula tom={TOM_GRAV[i.gravidade]}>{GRAVIDADE[i.gravidade]}</Pilula><span>IA {medida(i, 'ia')}</span></> })}
							vazio="Nenhum item ligado na versão em uso." />
					</Cartao>
					<Cartao titulo="Evolução da conformidade" linha="% sem item bloqueante reprovado · tracejado: meta de 95%">
						<Legenda itens={[{ nome: 'Agente de IA', cor: COR_IA, linha: true }, { nome: 'Humano (discador)', cor: COR_HUMANO, linha: true }]} />
						{semanas.length === 0 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Ainda sem semana completa.</p> : <LinhaSemanas x={semanas.map(semanaRotulo)} series={[{ nome: 'Agente de IA', cor: COR_IA, valores: serie('ia') }, { nome: 'Humano', cor: COR_HUMANO, valores: serie('discador') }]} min={50} max={100} ticks={[50, 60, 70, 80, 90, 100]} fmt={v => `${dc(v, 0)}%`} meta={95} rotulo="Conformidade por semana" />}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Antes × depois de um treino ou de uma versão nova do checklist não tem grupo de controle.</p>
					</Cartao>
				</div>

				<Cartao semPadding titulo="Ligações reprovadas" linha="Trecho mascarado. Cada escuta fica registrada." direita={<>{rep[0] && <Pilula>{nf(rep[0].total)} no período</Pilula>}<SeloRegras rotulo="Quem pode ouvir" regras={[
					{ titulo: 'Ver o trecho exige a permissão Ver transcrições', texto: 'Sem ela, a lista não aparece.' },
					{ titulo: 'Ouvir exige a permissão Ouvir gravações', texto: 'O acesso fica registrado com nome e hora.' },
					{ titulo: '"Discordar da nota" manda o caso para a Curadoria', texto: 'A nota não muda sozinha.' },
				]} /></>}>
					{!leTrecho ? <div className="px-4 pb-4 sm:px-5"><Estado tipo="semPermissao" compacto titulo="Seu perfil não vê trechos de conversa.">Quem dá acesso é o Admin da empresa, em Pessoas e perfis.</Estado></div>
						: rep.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nenhuma ligação reprovada em item bloqueante no período.</p> : (
						<div className="divide-y [&>*]:border-[var(--base-borda)]">
							{visiveis.map(linhaRep)}
							{rep.length > 3 && <div className="px-4 py-2 sm:px-5"><Detalhes resumo="Mais reprovadas" qtd={rep.length - 3}><div className="divide-y [&>*]:border-[var(--base-borda)]">{rep.slice(3).map(linhaRep)}</div></Detalhes></div>}
						</div>
					)}
				</Cartao>
			</div>

			<Gaveta aberta={!!itemSel} onFechar={() => setItemSel(null)} titulo={itemSel?.texto ?? ''} subtitulo={itemSel ? `${GRAVIDADE[itemSel.gravidade]} · ${APLICA[itemSel.aplica]}` : undefined}>
				{itemSel && <ListaValores itens={[
					['Origem', ORIGEM_ITEM[itemSel.origem]],
					['Peso', itemSel.peso],
					['Trava legal', itemSel.trava ? 'sim (não pode ser desligado)' : 'não'],
					['IA aprovada', sel.ia?.aprovado == null ? 'menos de 30' : `${dc(sel.ia.aprovado)}%`],
					['IA avaliadas', sel.ia?.n == null ? '—' : nf(sel.ia.n)],
					['Humano aprovado', sel.discador?.aprovado == null ? 'menos de 30' : `${dc(sel.discador.aprovado)}%`],
					['Humano avaliadas', sel.discador?.n == null ? '—' : nf(sel.discador.n)],
				]} />}
			</Gaveta>

			<Gaveta aberta={editor} onFechar={() => setEditor(false)} largura={640} titulo="Checklist de qualidade"
				subtitulo="O padrão do MotorCX é a base; vocês ajustam, desligam o que não é trava legal e criam itens próprios. Cada publicação é uma versão."
				rodape={aba === 'cliente' && podeEditar ? <>
					<Botao tipo="secundario" onClick={() => setModal('novo')}>Adicionar item</Botao>
					<Botao tipo="secundario" disabled={!mudou || ocupado} onClick={() => rasc && void salvarRascunho(rasc)}>Salvar rascunho</Botao>
					<Botao disabled={!temRascunho || mudou || ocupado} onClick={() => setModal('publicar')} title={mudou ? 'Salve o rascunho antes de publicar' : undefined}>Publicar v{proxima}</Botao>
				</> : undefined}>
				<div className="flex flex-wrap gap-2">
					{padrao && <span className="rounded-lg bg-[var(--base-fill)] px-2.5 py-1.5 text-[12px]"><b className="block">Padrão MotorCX v{padrao.versao}</b>desde {dataBR(padrao.vigente_de)}</span>}
					{versoes.map(v => <span key={v.id} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ backgroundColor: v.situacao === 'em_uso' ? 'var(--estado-pronto-fundo)' : 'var(--base-fill)' }}><b className="block">v{v.versao}</b>{v.situacao === 'rascunho' ? 'rascunho' : v.situacao === 'em_uso' ? `em uso desde ${dataBR(v.vigente_de)}` : `até ${dataBR(v.vigente_ate)} · arquivada`}</span>)}
				</div>
				<Segmentos rotulo="Checklist" itens={[{ v: 'padrao', n: padrao ? `Padrão MotorCX v${padrao.versao}` : 'Padrão MotorCX' }, { v: 'cliente', n: `Da empresa · v${proxima} ${temRascunho ? 'rascunho' : '(novo)'}` }]} valor={aba} onTrocar={setAba} />
				<div className="divide-y [&>*]:border-[var(--base-borda)]">
					{editaveis.map((i, k) => {
						const fixo = aba === 'padrao' || i.trava || !podeEditar;
						return (
							<div key={i.id} className={`grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-2 py-2.5 text-[13px] sm:grid-cols-[24px_minmax(0,1fr)_140px_80px] sm:items-center ${i.on ? '' : 'opacity-55'}`}>
								<span>{i.trava ? <Lock size={15} className="text-[var(--base-texto-3)]" aria-label="Item de lei: não pode ser desligado" /> : aba === 'cliente' ? <input type="checkbox" aria-label={`Usar o item ${i.texto}`} checked={i.on} disabled={!podeEditar} onChange={e => atualizar(k, { on: e.target.checked })} className="h-4 w-4 accent-[var(--destaque)]" /> : null}</span>
								<span className="min-w-0"><b className="font-semibold text-[var(--base-texto)]">{i.texto}</b><small className="block text-[11.5px] text-[var(--base-texto-3)]">{ORIGEM_ITEM[i.origem]} · {APLICA[i.aplica]}</small></span>
								<span className="col-start-2 sm:col-start-auto">{fixo ? <Pilula tom={TOM_GRAV[i.gravidade]}>{GRAVIDADE[i.gravidade]}</Pilula> : <select aria-label="Gravidade" value={i.gravidade} onChange={e => atualizar(k, { gravidade: e.target.value as ItemChecklist['gravidade'] })} className={`${campoCls} w-full`} style={campoStyle}>{Object.entries(GRAVIDADE).map(([g, n]) => <option key={g} value={g}>{n}</option>)}</select>}</span>
								<span className="col-start-2 sm:col-start-auto">{fixo ? <small className="text-[var(--base-texto-2)]">peso {i.peso}</small> : <select aria-label="Peso" value={i.peso} onChange={e => atualizar(k, { peso: Number(e.target.value) as 1 | 2 | 3 })} className={`${campoCls} w-full`} style={campoStyle}>{[1, 2, 3].map(x => <option key={x} value={x}>peso {x}</option>)}</select>}</span>
							</div>
						);
					})}
				</div>
				{aba === 'cliente' && !podeEditar && <Estado tipo="semPermissao" compacto titulo="Seu perfil só vê o checklist.">Editar exige a permissão Editar checklist, dada pelo Admin da empresa.</Estado>}
				<Detalhes resumo="Como a nota é dada">
					<ListaRegras regras={[
						{ titulo: 'IA com saída fechada', texto: 'Sim, não ou não se aplica; a evidência é a posição na ligação.' },
						{ titulo: 'Itens com cadeado vêm da lei', texto: 'CDC art. 42 e LGPD: valem para todo cliente e não podem ser desligados.' },
						{ titulo: 'Mudar o checklist não reavalia o passado', texto: 'A nota fica na versão em que foi dada; a nova vale da publicação em diante.' },
					]} />
				</Detalhes>
			</Gaveta>
			{modal === 'novo' && (
				<Modal titulo="Novo item do checklist" texto="Escreva como pergunta de sim ou não. O item vale para as próximas ligações depois que a versão for publicada." confirmar="Adicionar" onFechar={() => setModal(null)}
					desabilitado={novo.texto.trim().length < 5 || textoTemDadoPessoal(novo.texto)}
					onConfirmar={() => { const it: ItemChecklist = { id: idItem(novo.texto, (rasc ?? []).map(x => x.id)), texto: novo.texto.trim().slice(0, 140), gravidade: novo.gravidade, aplica: novo.aplica, peso: 2, origem: 'cliente', trava: false, on: true }; setRasc(xs => [...(xs ?? []), it]); setNovo({ texto: '', gravidade: 'importante', aplica: 'ambos' }); setModal(null); }}>
					<input aria-label="Texto do item" maxLength={140} value={novo.texto} onChange={e => setNovo({ ...novo, texto: e.target.value })} placeholder="Ex.: Ofereceu o boleto por WhatsApp?" className={`${campoCls} w-full`} style={campoStyle} />
					<select aria-label="Gravidade" value={novo.gravidade} onChange={e => setNovo({ ...novo, gravidade: e.target.value as ItemChecklist['gravidade'] })} className={`${campoCls} w-full`} style={campoStyle}>{Object.entries(GRAVIDADE).map(([g, n]) => <option key={g} value={g}>{n}</option>)}</select>
					<select aria-label="Vale para" value={novo.aplica} onChange={e => setNovo({ ...novo, aplica: e.target.value as ItemChecklist['aplica'] })} className={`${campoCls} w-full`} style={campoStyle}><option value="ambos">IA e humano</option><option value="humano">Só humano</option><option value="ia">Só IA</option></select>
				</Modal>
			)}
			{modal === 'publicar' && <Modal titulo={`Publicar a versão ${proxima}?`} texto="Vale para as ligações a partir de amanhã. As notas já dadas continuam na versão anterior." confirmar="Publicar" ocupado={ocupado} onFechar={() => setModal(null)} onConfirmar={() => void publicar()} />}
		</>
	);
}
