// Speech Analytics › Qualidade e compliance. Checklist com dois níveis (padrão MotorCX + o do cliente), itens de lei
// com cadeado, cada publicação é uma versão e vale só daqui para a frente (a nota fica na versão em que foi dada).
// Ligações reprovadas: trecho só com ver_transcricoes; "Discordar da nota" manda o caso para a Curadoria.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Lock, Play } from 'lucide-react';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { APLICA, GRAVIDADE, ORIGEM_ITEM, PERM_SA, ajustarItem, dataBR, dataHoraBR, dc, idItem, nf, pc, textoTemDadoPessoal, type ItemChecklist } from '@/lib/speech';
import { Botao, Cartao, Kpi, Pilula, SubAbas, campoCls, campoStyle } from '@/components/voz/ui';
import { BarraFiltros, Modal, Trecho, type Filtros } from './comum';
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

function Medidor({ v, cor }: { v: number | null | undefined; cor: string }) {
	if (v == null) return <span className="text-[12px] text-[var(--base-texto-3)]">menos de 30</span>;
	return <span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--base-fill)]"><i className="block h-full rounded-full" style={{ width: `${v}%`, backgroundColor: cor }} /></span><b className="tnum text-[12.5px]">{dc(v)}%</b></span>;
}

export function Qualidade({ f, setDias }: { f: Filtros; setDias: (d: number) => void }) {
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
	if (erro) return <>{filtros}<Notice>{erro}</Notice></>;
	if (loading || !q) return <>{filtros}<Loading /></>;

	const itensVisao = (emUso?.itens ?? []).filter(i => i.on);
	const textoItem = (id: string) => (emUso?.itens ?? padrao?.itens ?? []).find(i => i.id === id)?.texto ?? id;
	const editaveis = aba === 'padrao' ? padrao?.itens ?? [] : rasc ?? [];
	const mudou = JSON.stringify(rasc) !== JSON.stringify((versoes.find(v => v.situacao === 'rascunho') ?? emUso)?.itens ?? null);
	const atualizar = (k: number, m: Partial<Pick<ItemChecklist, 'gravidade' | 'peso' | 'on'>>) => setRasc(xs => (xs ?? []).map((it, i) => (i === k ? ajustarItem(it, m) : it)));

	return (
		<>
			{filtros}
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<Kpi rotulo="Nota média" valor={dc(q.nota)} detalhe={`IA ${dc(q.origens?.ia?.nota)} · humano ${dc(q.origens?.discador?.nota)}`} />
					<Kpi rotulo="Em conformidade" valor={pc(q.conformidade)} detalhe="meta de vocês: 95%" />
					<Kpi rotulo="Reprovadas em item bloqueante" valor={nf((q.origens?.ia?.reprovadas ?? 0) + (q.origens?.discador?.reprovadas ?? 0))} detalhe={`${nf(q.origens?.ia?.reprovadas ?? 0)} da IA · ${nf(q.origens?.discador?.reprovadas ?? 0)} do humano`} />
					<Kpi rotulo="Notas contestadas" valor={pc(q.contestadas)} detalhe="vão para a Curadoria" />
				</div>
				<div className="grid gap-4 lg:grid-cols-2">
					<Cartao semPadding titulo="Nota por item" linha={`% de ligações aprovadas no item · versão em uso: ${emUso ? (emUso === padrao ? `Padrão MotorCX v${emUso.versao}` : `v${emUso.versao}`) : '—'}`}>
						<div className="divide-y px-4 pb-3 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
							{itensVisao.map(i => { const r = q.itens?.[i.id] ?? {}; return (
								<div key={i.id} className="grid grid-cols-1 gap-1 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4" style={{ borderColor: 'var(--base-borda)' }}>
									<span className="min-w-0"><b className="font-semibold text-[var(--base-texto)]">{i.texto}</b> <Pilula tom={TOM_GRAV[i.gravidade]}>{GRAVIDADE[i.gravidade]}</Pilula><small className="block text-[11.5px] text-[var(--base-texto-3)]">{ORIGEM_ITEM[i.origem]} · peso {i.peso}{i.trava ? ' · trava legal' : ''}</small></span>
									<span className="flex items-center gap-1.5"><small className="w-10 text-[11px] text-[var(--base-texto-3)]">IA</small>{i.aplica === 'humano' ? <span className="text-[12px] text-[var(--base-texto-3)]">não se aplica</span> : <Medidor v={r.ia?.aprovado} cor={COR_IA} />}</span>
									<span className="flex items-center gap-1.5"><small className="w-10 text-[11px] text-[var(--base-texto-3)]">Humano</small>{i.aplica === 'ia' ? <span className="text-[12px] text-[var(--base-texto-3)]">não se aplica</span> : <Medidor v={r.discador?.aprovado} cor={COR_HUMANO} />}</span>
								</div>); })}
						</div>
					</Cartao>
					<Cartao titulo="Evolução da conformidade" linha="% sem item bloqueante reprovado · linha tracejada: meta de 95%">
						<Legenda itens={[{ nome: 'Agente de IA', cor: COR_IA, linha: true }, { nome: 'Humano (discador)', cor: COR_HUMANO, linha: true }]} />
						{semanas.length === 0 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Ainda sem semana completa.</p> : <LinhaSemanas x={semanas.map(semanaRotulo)} series={[{ nome: 'Agente de IA', cor: COR_IA, valores: serie('ia') }, { nome: 'Humano', cor: COR_HUMANO, valores: serie('discador') }]} min={50} max={100} ticks={[50, 60, 70, 80, 90, 100]} fmt={v => `${dc(v, 0)}%`} meta={95} rotulo="Conformidade por semana" />}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Antes × depois de um treino ou de uma versão nova do checklist não tem grupo de controle.</p>
					</Cartao>
				</div>

				<Cartao semPadding titulo="Ligações reprovadas" linha="Trecho mascarado. Ouvir exige ouvir_gravacoes e o acesso fica registrado." direita={rep[0] ? <Pilula>{nf(rep[0].total)} no período</Pilula> : undefined}>
					{!leTrecho ? <p className="flex items-center gap-2 px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5"><Lock size={14} />A lista mostra trechos de conversa e exige a permissão ver_transcricoes.</p> : rep.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nenhuma ligação reprovada em item bloqueante no período.</p> : (
						<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
							{rep.map(r => (
								<div key={r.avaliacao_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{r.id_cliente}</b><span>{dataHoraBR(r.avaliada_em)}</span><Pilula>{r.origem === 'ia' ? 'Agente de IA' : r.operador ?? 'Discador'}</Pilula><Pilula tom="erro">{textoItem(r.item)}</Pilula></div>
										{r.trecho && <Trecho>{r.trecho}</Trecho>}
										{r.contestada && <p className="mt-1.5 text-[12px] text-[var(--estado-pronto-texto)]">Discordância registrada. O caso está na fila de Curadoria.</p>}
									</div>
									<div className="flex shrink-0 flex-wrap gap-2">
										<Link to={`/gravacoes?cliente=${encodeURIComponent(r.id_cliente)}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}><Play size={14} />Ouvir</Link>
										{!r.contestada && <Botao secundario onClick={() => void discordar(r)}>Discordar da nota</Botao>}
									</div>
								</div>
							))}
						</div>
					)}
				</Cartao>

				<Cartao semPadding titulo="Editor do checklist" linha="O padrão do MotorCX é a base; vocês ajustam, desligam o que não é trava legal e criam itens próprios. Cada publicação é uma versão.">
					<div className="flex flex-wrap gap-2 px-4 sm:px-5">
						{padrao && <span className="rounded-lg bg-[var(--base-fill)] px-2.5 py-1.5 text-[12px]"><b className="block">Padrão MotorCX v{padrao.versao}</b>desde {dataBR(padrao.vigente_de)}</span>}
						{versoes.map(v => <span key={v.id} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ backgroundColor: v.situacao === 'em_uso' ? 'var(--estado-pronto-fundo)' : 'var(--base-fill)' }}><b className="block">v{v.versao}</b>{v.situacao === 'rascunho' ? 'rascunho' : v.situacao === 'em_uso' ? `em uso desde ${dataBR(v.vigente_de)}` : `até ${dataBR(v.vigente_ate)} · arquivada`}</span>)}
					</div>
					<div className="mt-3 px-4 sm:px-5"><SubAbas itens={[{ id: 'padrao', nome: padrao ? `Padrão MotorCX v${padrao.versao}` : 'Padrão MotorCX' }, { id: 'cliente', nome: `Da empresa · v${proxima} ${temRascunho ? 'rascunho' : '(novo rascunho)'}` }]} atual={aba} onTrocar={id => setAba(id as 'padrao' | 'cliente')} /></div>
					<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
						{editaveis.map((i, k) => {
							const fixo = aba === 'padrao' || i.trava || !podeEditar;
							return (
								<div key={i.id} className={`grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-2.5 text-[13px] sm:grid-cols-[24px_minmax(0,1fr)_150px_70px] sm:items-center sm:px-5 ${i.on ? '' : 'opacity-55'}`} style={{ borderColor: 'var(--base-borda)' }}>
									<span>{i.trava ? <Lock size={15} className="text-[var(--base-texto-3)]" aria-label="Item de lei: não pode ser desligado" /> : aba === 'cliente' ? <input type="checkbox" aria-label={`Usar o item ${i.texto}`} checked={i.on} disabled={!podeEditar} onChange={e => atualizar(k, { on: e.target.checked })} className="h-4 w-4 accent-[var(--area)]" /> : null}</span>
									<span className="min-w-0"><b className="font-semibold text-[var(--base-texto)]">{i.texto}</b><small className="block text-[11.5px] text-[var(--base-texto-3)]">{ORIGEM_ITEM[i.origem]} · {APLICA[i.aplica]}{i.trava ? ' · trava legal' : ''}</small></span>
									<span className="col-start-2 sm:col-start-auto">{fixo ? <Pilula tom={TOM_GRAV[i.gravidade]}>{GRAVIDADE[i.gravidade]}</Pilula> : <select aria-label="Gravidade" value={i.gravidade} onChange={e => atualizar(k, { gravidade: e.target.value as ItemChecklist['gravidade'] })} className={`${campoCls} w-full`} style={campoStyle}>{Object.entries(GRAVIDADE).map(([g, n]) => <option key={g} value={g}>{n}</option>)}</select>}</span>
									<span className="col-start-2 sm:col-start-auto">{fixo ? <small className="text-[var(--base-texto-2)]">peso {i.peso}</small> : <select aria-label="Peso" value={i.peso} onChange={e => atualizar(k, { peso: Number(e.target.value) as 1 | 2 | 3 })} className={`${campoCls} w-full`} style={campoStyle}>{[1, 2, 3].map(x => <option key={x} value={x}>peso {x}</option>)}</select>}</span>
								</div>
							);
						})}
					</div>
					<div className="flex flex-col gap-2 border-t px-4 py-3 text-[12px] text-[var(--base-texto-2)] sm:flex-row sm:items-center sm:justify-between sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
						<span>{aba === 'padrao' ? 'Itens com cadeado vêm da lei (CDC art. 42, LGPD) e valem para todo cliente.' : 'A nota é dada por IA com saída fechada (sim, não, não se aplica) e a evidência é a posição na ligação. Mudar o checklist não reavalia o passado.'}</span>
						{aba === 'cliente' && podeEditar && <span className="flex flex-wrap gap-2">
							<Botao secundario onClick={() => setModal('novo')}>Adicionar item</Botao>
							<Botao secundario disabled={!mudou || ocupado} onClick={() => rasc && void salvarRascunho(rasc)}>Salvar rascunho</Botao>
							<Botao disabled={!temRascunho || mudou || ocupado} onClick={() => setModal('publicar')} title={mudou ? 'Salve o rascunho antes de publicar' : undefined}>Publicar v{proxima}</Botao>
						</span>}
						{aba === 'cliente' && !podeEditar && <span className="flex items-center gap-1"><Lock size={13} />Editar exige a permissão editar_checklist.</span>}
					</div>
				</Cartao>
			</div>
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
