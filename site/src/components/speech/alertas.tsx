// Speech Analytics › Alertas. Procon, advogado ou processo, ameaça, linguagem abusiva e vulnerabilidade.
// Alerta só avisa: nada pausa, muda régua ou bloqueia cliente. Vulnerabilidade mostra só o sinal (nunca o trecho; saúde
// sem detalhe nenhum). Exige ver_alertas; o trecho dos outros tipos exige também ver_transcricoes.
// Redesign v2: tipos num seletor com a contagem (sem KPI falso), cada alerta com Revisar e Ouvir; Revisar abre a gaveta
// (desfecho, observação, quem falou, Extrato). Ação principal: Revisar o próximo. Regras no selo "Como funcionam".
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Heart, Play } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { ALERTA_TIPOS, DESFECHOS, PERM_SA, SINAIS, dataHoraBR, desfechosDe, nf, textoTemDadoPessoal } from '@/lib/speech';
import { Botao, BotaoLink, Cartao, Estado, Gaveta, ListaValores, Pilula, Rotulo, SeloRegras, Segmentos, campoCls, campoStyle, textareaCls } from '@/components/ds';
import { BarraFiltros, Bloqueio, SeloPrivacidade, Trecho, type Filtros } from './comum';
import type { DefinirAcoes } from './speech-analytics';

type Alerta = { id: number; tipo: string; sinal: string | null; falante: string | null; origem: string; operador: string | null; id_cliente: string | null; gravacao_id: number | null; credor_id: number | null; criado_em: string; trecho: string | null; situacao: 'novo' | 'revisado'; revisado_por: string | null; revisado_em: string | null; desfecho: string | null; observacao: string | null };
type Contagem = { tipo: string; total: number; abertos: number };
const FALANTE: Record<string, string> = { cliente: 'cliente', agente: 'agente de IA', operador: 'operador' };

export function Alertas({ f, setDias, setAcoes }: { f: Filtros; setDias: (d: number) => void; setAcoes: DefinirAcoes }) {
	const pode = usePermissao(PERM_SA.verAlertas);
	const [tipo, setTipo] = useState('');
	const [sit, setSit] = useState<'novo' | 'revisado' | ''>('novo');
	const [lista, setLista] = useState<Alerta[]>([]);
	const [cont, setCont] = useState<Contagem[]>([]);
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [rev, setRev] = useState<Alerta | null>(null);
	const [desf, setDesf] = useState('tratado');
	const [obs, setObs] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [recarga, setRecarga] = useState(0);

	useEffect(() => {
		if (!supabase || !pode) { setLoading(false); return; }
		const sb = supabase;
		let ativo = true;
		setLoading(true); setErro('');
		(async () => {
			const [l, c] = await Promise.all([
				sb.rpc('alertas_voz', { empresa: f.empresaId, filtro_tipo: tipo || null, filtro_situacao: sit || null, de: f.de, ate: f.ate, limite: 100 }),
				sb.rpc('contagem_alertas_voz', { empresa: f.empresaId, de: f.de, ate: f.ate }),
			]);
			if (!ativo) return;
			if (l.error) { setErro(friendlyError(l.error)); setLoading(false); return; }
			setLista(((l.data ?? []) as Alerta[]).filter(a => f.credorId == null || a.credor_id === f.credorId));
			setCont((c.data ?? []) as Contagem[]);
			setLoading(false);
		})();
		return () => { ativo = false; };
	}, [pode, f.empresaId, f.credorId, f.de, f.ate, tipo, sit, recarga]);

	async function revisar() {
		if (!supabase || !rev) return;
		setOcupado(true);
		const { error } = await supabase.rpc('revisar_alerta_voz', { alerta: rev.id, desfecho: desf, observacao: obs.trim() || null });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success('Alerta marcado como revisado.');
		setRev(null); setObs(''); setRecarga(x => x + 1);
	}

	const proximo = lista.find(a => a.situacao === 'novo') ?? null;
	const abrir = (a: Alerta) => { setRev(a); setDesf('tratado'); setObs(''); };
	useEffect(() => {
		setAcoes(pode && proximo ? <Botao onClick={() => abrir(proximo)}>Revisar o próximo</Botao> : null);
		return () => setAcoes(null);
	}, [pode, proximo, setAcoes]);

	const total = cont.reduce((t, c) => t + Number(c.total), 0);
	const abertos = cont.reduce((t, c) => t + Number(c.abertos), 0);
	const selo = <SeloRegras rotulo="Como funcionam" regras={[
		{ titulo: 'Alerta só avisa', texto: 'Nenhum alerta pausa, muda régua ou bloqueia cliente sozinho. Quem revisa decide o que fazer.' },
		{ titulo: 'Quem revisou fica registrado', texto: 'Nome, hora, desfecho e observação.' },
		{ titulo: 'Vulnerabilidade só sinaliza', texto: 'O trecho nunca aparece; de saúde, nenhum detalhe é guardado.' },
		{ titulo: 'O trecho some com a gravação', texto: 'Depois de 90 dias (ou da retenção da empresa) o alerta fica só como contagem.' },
		{ titulo: 'Quem vê', texto: 'A fila exige a permissão Ver alertas; o trecho exige também Ver transcrições.' },
	]} />;
	const seletorTipo = (
		<select aria-label="Tipo de alerta" value={tipo} onChange={e => setTipo(e.target.value)} className={campoCls} style={campoStyle}>
			<option value="">Todos · {nf(total)}</option>
			{Object.entries(ALERTA_TIPOS).map(([k, n]) => { const c = cont.find(x => x.tipo === k); return <option key={k} value={k}>{n} · {nf(Number(c?.total ?? 0))}</option>; })}
		</select>
	);
	const filtros = <BarraFiltros dias={f.dias} setDias={setDias} origem="" setOrigem={() => {}} credorNome={f.credorNome} semOrigem direita={<>{selo}<SeloPrivacidade /></>} />;
	if (!pode) return <Bloqueio titulo="Seu perfil não vê os alertas das ligações.">A fila mostra situações sensíveis (Procon, jurídico, ameaça, vulnerabilidade). Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio>;

	return (
		<>
			{filtros}
			<Cartao semPadding titulo="Fila" linha={`${nf(abertos)} abertos no período · mostrando ${lista.length}`} direita={<>{seletorTipo}<Segmentos rotulo="Situação" itens={[{ v: 'novo', n: 'Abertos' }, { v: 'revisado', n: 'Revisados' }, { v: '', n: 'Todos' }]} valor={sit} onTrocar={setSit} /></>}>
				{erro ? <div className="px-4 pb-4"><Estado tipo="erro" compacto titulo="Não deu para carregar a fila.">{erro}</Estado></div> : loading ? <div className="px-4 pb-4"><Estado tipo="carregando" compacto titulo="Carregando a fila…" /></div> : lista.length === 0 ? <div className="px-4 pb-4"><Estado tipo="vazio" compacto titulo="Nada nesta fila." /></div> : (
					<div className="divide-y [&>*]:border-[var(--base-borda)]">
						{lista.map(a => (
							<div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]">
										<Pilula tom={a.tipo === 'vulnerabilidade' ? 'neutro' : 'erro'}>{ALERTA_TIPOS[a.tipo] ?? a.tipo}</Pilula>
										<b className="text-[var(--base-texto)]">AL-{a.id}</b>
										{a.id_cliente && <span>{a.id_cliente}</span>}
										<span>{dataHoraBR(a.criado_em)}</span>
										{a.situacao === 'revisado' && <Pilula tom="ok">Revisado</Pilula>}
									</div>
									{a.tipo === 'vulnerabilidade' ? (
										<p className="mt-1.5 flex items-start gap-2 rounded-lg bg-[var(--base-fill)] px-3 py-2 text-[13px] text-[var(--base-texto-2)]"><Heart size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span><b className="text-[var(--base-texto)]">Sinal: {SINAIS[a.sinal ?? ''] ?? a.sinal}.</b> O trecho não aparece aqui.</span></p>
									) : a.trecho ? <Trecho>{a.trecho}</Trecho> : <p className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">{a.id_cliente ? 'O trecho exige a permissão Ver transcrições.' : 'Trecho apagado com a gravação: o alerta fica só como contagem.'}</p>}
								</div>
								<div className="flex shrink-0 flex-wrap gap-2">
									<Botao pequeno tipo={a.situacao === 'novo' ? 'secundario' : 'fantasma'} onClick={() => abrir(a)}>{a.situacao === 'novo' ? 'Revisar' : 'Ver'}</Botao>
									{a.id_cliente && <BotaoLink pequeno tipo="fantasma" to={`/gravacoes?cliente=${encodeURIComponent(a.id_cliente)}`}><Play size={13} aria-hidden="true" />Ouvir</BotaoLink>}
								</div>
							</div>
						))}
					</div>
				)}
			</Cartao>
			<Gaveta aberta={!!rev} onFechar={() => setRev(null)} titulo={rev ? `AL-${rev.id} · ${ALERTA_TIPOS[rev.tipo] ?? rev.tipo}` : ''}
				subtitulo="Fica registrado quem revisou e quando. Nada é pausado nem bloqueado automaticamente."
				rodape={rev?.situacao === 'novo' ? <><Botao tipo="secundario" onClick={() => setRev(null)}>Cancelar</Botao><Botao disabled={ocupado || textoTemDadoPessoal(obs)} onClick={() => void revisar()}>{ocupado ? 'Aguarde…' : 'Marcar como revisado'}</Botao></> : undefined}>
				{rev && <>
					<ListaValores itens={[
						['Quando', dataHoraBR(rev.criado_em)],
						['Origem', rev.origem === 'ia' ? 'Agente de IA' : 'Discador'],
						...(rev.falante ? [['Quem falou', `${FALANTE[rev.falante] ?? rev.falante}${rev.operador ? ` (${rev.operador})` : ''}`] as [string, string]] : []),
						...(rev.id_cliente ? [['Cliente', rev.id_cliente] as [string, string]] : []),
					]} />
					{rev.tipo === 'vulnerabilidade' ? <p className="rounded-lg bg-[var(--base-fill)] px-3 py-2 text-[13px] text-[var(--base-texto-2)]">Sinal: {SINAIS[rev.sinal ?? ''] ?? rev.sinal}. O trecho não aparece{rev.sinal === 'saude' ? ' e nenhum detalhe de saúde é guardado' : ''}. Se precisar, ouça a gravação (o acesso fica registrado). Para mudar algo para este cliente, use o Extrato.</p> : rev.trecho && <Trecho>{rev.trecho}</Trecho>}
					{rev.situacao === 'revisado' ? <p className="text-[13px] text-[var(--estado-pronto-texto)]">Revisado por <b>{rev.revisado_por}</b> em {dataHoraBR(rev.revisado_em)} · {DESFECHOS[rev.desfecho ?? ''] ?? rev.desfecho}{rev.observacao ? ` · "${rev.observacao}"` : ''}</p> : <>
						<Rotulo texto="Desfecho"><select value={desf} onChange={e => setDesf(e.target.value)} className={`${campoCls} w-full`} style={campoStyle}>{desfechosDe(rev.tipo).map(d => <option key={d} value={d}>{DESFECHOS[d]}</option>)}</select></Rotulo>
						<Rotulo texto="Observação (opcional)" dica="Até 200 caracteres. Sem nome, CPF, telefone nem detalhe de saúde.">
							<textarea maxLength={200} rows={3} value={obs} onChange={e => setObs(e.target.value)} className={textareaCls} style={campoStyle} />
						</Rotulo>
						{textoTemDadoPessoal(obs) && <p className="text-[12px] text-[var(--estado-erro-texto)]">Tire o CPF, telefone ou e-mail da observação.</p>}
					</>}
					{rev.id_cliente && <div className="flex flex-wrap gap-2">
						<BotaoLink pequeno to={`/gravacoes?cliente=${encodeURIComponent(rev.id_cliente)}`}><Play size={13} aria-hidden="true" />Ouvir</BotaoLink>
						<BotaoLink pequeno tipo="fantasma" to={`/cliente?id=${encodeURIComponent(rev.id_cliente)}`}>Abrir o Extrato do cliente</BotaoLink>
					</div>}
				</>}
			</Gaveta>
		</>
	);
}
