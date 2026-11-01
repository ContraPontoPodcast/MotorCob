// Speech Analytics › Retroalimentação. Duas partes:
// * Para a estratégia: recomendações com evidência (n, %, comparação). "Aplicar" só cria um rascunho no lugar certo
//   (estratégia nova sem vínculo, frase desligada) por aplicar_recomendacao; quem decide e publica são vocês. Dispensada
//   some por 90 dias. Histórico do aplicado: 28 dias antes × 28 depois (não é teste A/B).
// * Para o credor: relatório mensal só com agregados. Rascunho → revisão → envio (link de leitura de 30 dias, sem login,
//   cada acesso registrado; o banco guarda só o hash do token) → resposta do credor.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Check, Copy, Download, Eye, Landmark, Link2, RefreshCw } from 'lucide-react';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError } from '@/lib/supabase';
import { DESTINOS, ETAPAS_REL, PERM_SA, dataBR, dataHoraBR, dc, etapaRel, linkRelatorio, mesExtenso, nf, sinal, textoTemDadoPessoal } from '@/lib/speech';
import { Aviso, Botao, Cartao, Kpi, Passos, Pilula, campoCls, campoStyle } from '@/components/voz/ui';
import { Bloqueio, Modal, Segmentos, textareaCls, type Filtros } from './comum';
import { COR_IA, COR_NEUTRA } from './graficos';
import { RelatorioView, type ConteudoRel } from './relatorio-view';

type Rec = { id: number; credor_id: number | null; destino: string; regra: string; titulo: string; texto: string; situacao: 'nova' | 'rascunho' | 'dispensada' | 'aplicada';
	evidencia: { n_a: number; n_b: number; pct_a: number; pct_b: number; rotulo_a?: string; rotulo_b?: string; unidade?: string };
	rascunho_tipo: string | null; rascunho_id: number | null; criada_em: string; decidida_em: string | null; aplicada_em: string | null; volta_em: string | null;
	recomendacao_impacto?: { metrica: string; antes: number | null; depois: number | null; n_antes: number | null; n_depois: number | null }[] };
type Rel = { id: number; credor_id: number; competencia: string; situacao: string; conteudo: ConteudoRel; comentario: string | null; enviado_em: string | null; expira_em: string | null; pdf_caminho: string | null };

export function Retro({ f }: { f: Filtros }) {
	const [params, setParams] = useSearchParams();
	const parte = params.get('para') === 'credor' ? 'credor' : 'estrategia';
	return (
		<>
			<div className="mb-4"><Segmentos rotulo="Retroalimentação" itens={[{ v: 'estrategia', n: <span className="inline-flex items-center gap-1"><RefreshCw size={13} />Para a estratégia</span> }, { v: 'credor', n: <span className="inline-flex items-center gap-1"><Landmark size={13} />Para o credor</span> }]} valor={parte} onTrocar={v => setParams(v === 'credor' ? { para: 'credor' } : {})} /></div>
			{parte === 'credor' ? <ParaCredor f={f} /> : <ParaEstrategia f={f} />}
		</>
	);
}

function ParaEstrategia({ f }: { f: Filtros }) {
	const podeOrq = usePermissao(PERM_SA.editarOrquestracao);
	const podeFrases = usePermissao(PERM_SA.editarCanais);
	const [recs, setRecs] = useState<Rec[]>([]);
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [aplicar, setAplicar] = useState<Rec | null>(null);
	const [ocupado, setOcupado] = useState(false);
	const [recarga, setRecarga] = useState(0);

	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		setLoading(true);
		let qy = supabase.from('recomendacoes').select('id, credor_id, destino, regra, titulo, texto, situacao, evidencia, rascunho_tipo, rascunho_id, criada_em, decidida_em, aplicada_em, volta_em, recomendacao_impacto(metrica, antes, depois, n_antes, n_depois)').eq('empresa_id', f.empresaId).order('criada_em', { ascending: false }).limit(200);
		if (f.credorId) qy = qy.or(`credor_id.eq.${f.credorId},credor_id.is.null`);
		void qy.then(({ data, error }) => {
			if (!ativo) return;
			if (error) setErro(friendlyError(error)); else setRecs((data ?? []) as Rec[]);
			setLoading(false);
		});
		return () => { ativo = false; };
	}, [f.empresaId, f.credorId, recarga]);

	async function rpc(nome: string, args: Record<string, unknown>, ok: string) {
		if (!supabase) return;
		setOcupado(true);
		const { error } = await supabase.rpc(nome, args);
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(ok); setAplicar(null); setRecarga(x => x + 1);
	}

	if (erro) return <Notice>{erro}</Notice>;
	if (loading) return <Loading />;
	const visiveis = recs.filter(r => r.situacao === 'nova' || r.situacao === 'rascunho' || (r.situacao === 'dispensada' && r.decidida_em && Date.now() - new Date(r.decidida_em).getTime() < 7 * 86400000));
	const aplicadas = recs.filter(r => r.situacao === 'aplicada');
	const noventa = Date.now() - 90 * 86400000;
	const medidas = aplicadas.filter(r => (r.recomendacao_impacto ?? []).length > 0);

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Kpi rotulo="Recomendações abertas" valor={nf(recs.filter(r => r.situacao === 'nova').length)} detalhe="com n ≥ 200 e diferença ≥ 5 p.p." />
				<Kpi rotulo="Aplicadas em 90 dias" valor={nf(aplicadas.filter(r => r.aplicada_em && new Date(r.aplicada_em).getTime() > noventa).length)} detalhe="viraram rascunho e vocês ligaram" />
				<Kpi rotulo="Com impacto medido" valor={nf(medidas.length)} detalhe={`${nf(medidas.filter(r => { const i = r.recomendacao_impacto![0]; return (i.depois ?? 0) > (i.antes ?? 0); }).length)} melhoraram`} />
				<Kpi rotulo="Dispensadas" valor={nf(recs.filter(r => r.situacao === 'dispensada').length)} detalhe="não voltam por 90 dias" />
			</div>
			<Aviso tom="info" titulo={'"Aplicar" só cria um rascunho no lugar certo.'}>Quem decide e publica são vocês, na própria tela da estratégia ou das frases. A ferramenta nunca muda a estratégia sozinha.</Aviso>
			{visiveis.length === 0 ? <p className="rounded-xl bg-[var(--base-fill)] px-4 py-3 text-[13px] text-[var(--base-texto-2)]">Sem recomendações por enquanto. Elas aparecem quando um grupo passa de 200 ligações e a diferença é de 5 p.p. ou mais.</p> : (
				<div className="grid gap-3 lg:grid-cols-2">
					{visiveis.map(r => { const d = DESTINOS[r.destino]; const ev = r.evidencia; const mx = Math.max(ev.pct_a, ev.pct_b) * 1.15 || 1; const podeAplicar = d?.rascunho && (r.destino === 'frases' ? podeFrases : podeOrq); return (
						<section key={r.id} className="rounded-2xl bg-[var(--base-cartao)] p-4" style={{ boxShadow: '0 0 0 1px var(--base-borda)', opacity: r.situacao === 'dispensada' ? 0.6 : 1 }}>
							<div className="flex flex-wrap gap-2"><Pilula tom="info">{d?.nome ?? r.destino}</Pilula>{r.situacao === 'rascunho' && <Pilula tom="ok"><Check size={12} />Rascunho criado</Pilula>}{r.situacao === 'dispensada' && <Pilula>Dispensada</Pilula>}</div>
							<h3 className="mt-2 text-[15px] font-semibold">{r.titulo}</h3>
							<p className="text-[12px] text-[var(--base-texto-3)]">Vai para: {d?.onde}</p>
							<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--base-texto-2)]"><span>n <b className="text-[var(--base-texto)]">{nf(ev.n_a)} + {nf(ev.n_b)}</b></span><span>% <b className="text-[var(--base-texto)]">{dc(ev.pct_a)}% × {dc(ev.pct_b)}%</b></span></div>
							<div className="mt-2 space-y-1">
								{[[ev.rotulo_a ?? 'A', ev.pct_a, COR_IA], [ev.rotulo_b ?? 'B', ev.pct_b, COR_NEUTRA]].map(([n, v, c]) => (
									<div key={String(n)} className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px]"><span className="truncate">{n}</span><span className="h-2 rounded-full bg-[var(--base-fill)]"><i className="block h-full rounded-full" style={{ width: `${(100 * Number(v)) / mx}%`, backgroundColor: String(c) }} /></span><b className="tnum">{dc(v)}%</b></div>
								))}
								<small className="text-[11.5px] text-[var(--base-texto-3)]">{ev.unidade}</small>
							</div>
							{r.texto && <p className="mt-2 text-[13px] leading-relaxed text-[var(--base-texto-2)]">{r.texto}</p>}
							{r.situacao === 'rascunho' && <p className="mt-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ backgroundColor: 'var(--estado-pronto-fundo)' }}>{r.rascunho_tipo === 'frase' ? 'Frase nova criada desligada em Frases.' : 'Estratégia nova criada em rascunho, sem ligação com segmento nem carteira.'} Nada muda até vocês ligarem lá. <Link className="font-semibold underline" to={r.rascunho_tipo === 'frase' ? '/canais?secao=frases' : `/estrategias/${r.rascunho_id}`}>Abrir rascunho</Link></p>}
							<div className="mt-3 flex flex-wrap gap-2">
								{r.situacao === 'nova' && (podeAplicar ? <Botao onClick={() => setAplicar(r)}>Aplicar</Botao> : !d?.rascunho ? <Link to={d?.to ?? '/'} className="inline-flex h-9 items-center rounded-lg border px-3 text-[13px] font-semibold" style={{ borderColor: 'var(--base-borda)' }}>{r.destino === 'propensao' ? 'Só observação' : `Abrir ${d?.nome}`}</Link> : null)}
								{r.situacao === 'nova' && podeOrq && <Botao secundario disabled={ocupado} onClick={() => void rpc('dispensar_recomendacao', { rec: r.id }, 'Dispensada. Não volta por 90 dias.')}>Dispensar</Botao>}
								{r.situacao === 'dispensada' && podeOrq && <Botao secundario disabled={ocupado} onClick={() => void rpc('dispensar_recomendacao', { rec: r.id, desfazer: true }, 'Recomendação de volta.')}>Desfazer</Botao>}
								<Link to="/speech-analytics/busca" className="inline-flex h-9 items-center rounded-lg border px-3 text-[13px] font-semibold" style={{ borderColor: 'var(--base-borda)' }}>Ver ligações</Link>
							</div>
						</section>); })}
				</div>
			)}
			<Cartao semPadding titulo="Histórico do que foi aplicado" linha="28 dias antes × 28 dias depois, no mesmo recorte">
				<div className="px-4 pb-3 sm:px-5"><Aviso titulo="Antes × depois não é teste A/B.">No mesmo período mudam a carga, a sazonalidade e a política do credor. Para ter certeza, use o Dividir % da estratégia.</Aviso></div>
				{aplicadas.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nada aplicado ainda.</p> : (
					<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
						{aplicadas.map(r => { const i = (r.recomendacao_impacto ?? [])[0]; const dia = r.aplicada_em ? Math.min(28, Math.floor((Date.now() - new Date(r.aplicada_em).getTime()) / 86400000) + 1) : 0; const dd = i && i.antes != null && i.depois != null ? i.depois - i.antes : null; return (
							<div key={r.id} className="grid grid-cols-1 gap-1 px-4 py-2.5 text-[13px] sm:grid-cols-[70px_minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
								<span className="text-[var(--base-texto-3)]">{dataBR(r.aplicada_em)}</span>
								<span className="min-w-0"><b className="font-semibold">{r.titulo}</b><small className="block text-[var(--base-texto-3)]">{DESTINOS[r.destino]?.nome}</small></span>
								<span>% acordo {i ? <small className="block text-[var(--base-texto-3)]">n {nf(i.n_antes)} → {nf(i.n_depois)} · {dc(i.antes)}% → {dc(i.depois)}%</small> : null}</span>
								<span>{dd == null ? <Pilula>dia {dia} de 28</Pilula> : <b style={{ color: dd >= 0 ? 'var(--estado-pronto-texto)' : 'var(--estado-erro-texto)' }}>{sinal(dd)} p.p.</b>}</span>
							</div>); })}
					</div>
				)}
			</Cartao>
			{aplicar && <Modal titulo="Criar rascunho?" texto={<>Vai criar um rascunho em <b>{DESTINOS[aplicar.destino]?.onde}</b>. Nada muda nas ligações até alguém com permissão ligar o rascunho lá.</>} confirmar="Criar rascunho" ocupado={ocupado} onFechar={() => setAplicar(null)} onConfirmar={() => void rpc('aplicar_recomendacao', { rec: aplicar.id }, 'Rascunho criado. Nada muda até vocês aprovarem.')} />}
		</div>
	);
}

function ParaCredor({ f }: { f: Filtros }) {
	const { empresa, credores } = useMotorAuth();
	const pode = usePermissao(PERM_SA.relatorioCredor);
	const [rels, setRels] = useState<Rel[]>([]);
	const [selId, setSelId] = useState<number | null>(null);
	const [respostas, setRespostas] = useState<Record<string, string>>({});
	const [acessos, setAcessos] = useState<{ acao: string; em: string }[]>([]);
	const [comentario, setComentario] = useState('');
	const [link, setLink] = useState('');
	const [credorVe, setCredorVe] = useState(false);
	const [modal, setModal] = useState(false);
	const [ocupado, setOcupado] = useState(false);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [recarga, setRecarga] = useState(0);

	useEffect(() => {
		if (!supabase || !pode) { setLoading(false); return; }
		let ativo = true;
		setLoading(true);
		let qy = supabase.from('relatorios_credor').select('id, credor_id, competencia, situacao, conteudo, comentario, enviado_em, expira_em, pdf_caminho').eq('empresa_id', f.empresaId).order('competencia', { ascending: false }).limit(48);
		if (f.credorId) qy = qy.eq('credor_id', f.credorId);
		void qy.then(({ data, error }) => {
			if (!ativo) return;
			if (error) { setErro(friendlyError(error)); setLoading(false); return; }
			const lista = (data ?? []) as Rel[];
			setRels(lista);
			setSelId(s => (s && lista.some(r => r.id === s) ? s : lista[0]?.id ?? null));
			setLoading(false);
		});
		return () => { ativo = false; };
	}, [pode, f.empresaId, f.credorId, recarga]);

	const rel = rels.find(r => r.id === selId) ?? null;
	useEffect(() => {
		setComentario(rel?.comentario ?? ''); setLink('');
		if (!supabase || !rel) return;
		void supabase.from('relatorio_credor_respostas').select('recomendacao, resposta').eq('relatorio_id', rel.id).then(({ data }) => setRespostas(Object.fromEntries(((data ?? []) as { recomendacao: string; resposta: string }[]).map(x => [x.recomendacao, x.resposta]))));
		void supabase.from('relatorio_credor_acessos').select('acao, em').eq('relatorio_id', rel.id).order('em', { ascending: false }).limit(20).then(({ data }) => setAcessos((data ?? []) as { acao: string; em: string }[]));
	}, [rel?.id]);

	async function mudar(acao: string, extra: Record<string, unknown> = {}, ok = '') {
		if (!supabase || !rel) return;
		setOcupado(true);
		const { data, error } = await supabase.rpc('mudar_relatorio_credor', { relatorio: rel.id, acao, ...extra });
		setOcupado(false); setModal(false);
		if (error) { toast.error(friendlyError(error)); return; }
		const token = (data as { token?: string } | null)?.token;
		if (token) {
			const l = linkRelatorio(window.location.origin, token);
			setLink(l);
			try { await navigator.clipboard.writeText(l); toast.success(`${ok} Link copiado: vale 30 dias e cada acesso fica registrado.`); } catch { toast.success(`${ok} Copie o link abaixo: ele só aparece agora.`); }
		} else if (ok) toast.success(ok);
		setRecarga(x => x + 1);
	}
	async function baixarPdf() {
		if (!supabase || !rel?.pdf_caminho) return;
		const { data, error } = await supabase.storage.from('saidas').createSignedUrl(rel.pdf_caminho, 120);
		if (error || !data?.signedUrl) { toast.error('Não foi possível baixar o PDF agora.'); return; }
		window.open(data.signedUrl, '_blank', 'noopener');
	}

	if (!pode) return <Bloqueio titulo="Seu perfil não envia o relatório ao credor.">O relatório ao credor exige a permissão enviar_relatorio_credor. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio>;
	if (erro) return <Notice>{erro}</Notice>;
	if (loading) return <Loading />;
	if (!rel) return <Bloqueio titulo="Ainda não há relatório ao credor.">O MotorCX gera o rascunho no dia 1 de cada mês, para cada carteira com 30 conversas analisadas ou mais no mês anterior.</Bloqueio>;
	const etapa = etapaRel(rel.situacao);
	const nomeCredor = credores.find(c => Number(c.id) === rel.credor_id)?.nome ?? 'credor';
	const vencido = rel.expira_em ? new Date(rel.expira_em).getTime() < Date.now() : false;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<select aria-label="Relatório" value={rel.id} onChange={e => setSelId(Number(e.target.value))} className={`${campoCls} max-w-full`} style={campoStyle}>{rels.map(r => <option key={r.id} value={r.id}>{mesExtenso(r.competencia)} · {credores.find(c => Number(c.id) === r.credor_id)?.nome ?? `carteira ${r.credor_id}`}</option>)}</select>
				{rel.situacao === 'rascunho' && <Botao disabled={ocupado} onClick={() => void mudar('revisar', {}, 'Relatório em revisão.')}>Mandar para revisão</Botao>}
				{rel.situacao === 'revisao' && <Botao disabled={ocupado} onClick={() => setModal(true)}>Aprovar e enviar ao credor</Botao>}
				{(rel.situacao === 'enviado' || rel.situacao === 'respondido') && <><Pilula tom={rel.situacao === 'respondido' ? 'ok' : 'info'}>{rel.situacao === 'respondido' ? 'Credor respondeu' : `Aguardando o credor · enviado em ${dataBR(rel.enviado_em)}`}</Pilula><Botao secundario disabled={ocupado} onClick={() => void mudar('novo_link', {}, 'Link novo gerado (o anterior deixou de valer).')}><Link2 size={14} />{vencido ? 'Gerar link novo (venceu)' : 'Gerar link novo'}</Botao></>}
				{rel.pdf_caminho && <Botao secundario onClick={() => void baixarPdf()}><Download size={14} />Baixar PDF</Botao>}
				<Botao secundario onClick={() => setCredorVe(v => !v)}><Eye size={14} />{credorVe ? 'Ver como assessoria' : 'Ver como o credor'}</Botao>
			</div>
			{link && <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[13px]" style={{ backgroundColor: 'var(--estado-pronto-fundo)' }}><span className="min-w-0 flex-1 break-all font-mono text-[12px]">{link}</span><Botao secundario onClick={() => void navigator.clipboard?.writeText(link)}><Copy size={14} />Copiar</Botao><small className="w-full text-[var(--base-texto-2)]">O link só aparece agora (o banco guarda só o hash). Vale até {rel.expira_em ? dataBR(rel.expira_em) : '30 dias'}.</small></div>}
			<Passos passos={ETAPAS_REL} atual={etapa} />
			{credorVe && <Aviso tom="info">É assim que o credor vê pelo link: só leitura, sem login no MotorCX, com o acesso registrado. Ele marca a resposta em cada recomendação.</Aviso>}
			<div className={`grid gap-4 ${credorVe ? '' : 'lg:grid-cols-[minmax(0,1fr)_320px]'}`}>
				<RelatorioView competencia={rel.competencia} credor={nomeCredor} assessoria={empresa?.nome ?? ''} conteudo={rel.conteudo} comentario={rel.comentario} respostas={respostas} />
				{!credorVe && <div className="space-y-4">
					<Cartao titulo="Comentário da assessoria" linha="Entra no relatório. Sem dado de cliente.">
						<textarea aria-label="Comentário" maxLength={400} rows={4} value={comentario} disabled={!(rel.situacao === 'rascunho' || rel.situacao === 'revisao')} onChange={e => setComentario(e.target.value)} placeholder="Ex.: Recomendamos começar pela parcela mínima, em um piloto de 30 dias." className={textareaCls} style={campoStyle} />
						{textoTemDadoPessoal(comentario) && <p className="text-[12px] text-[var(--estado-erro-texto)]">Tire o CPF, telefone ou e-mail do comentário.</p>}
						<div className="mt-2"><Botao secundario disabled={ocupado || textoTemDadoPessoal(comentario) || comentario === (rel.comentario ?? '') || !(rel.situacao === 'rascunho' || rel.situacao === 'revisao')} onClick={() => void mudar('comentar', { comentario }, 'Comentário salvo no relatório.')}>Salvar comentário</Botao></div>
					</Cartao>
					<Cartao titulo="Acessos do credor" linha="Cada leitura e resposta pelo link fica registrada.">
						{acessos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhum acesso ainda.</p> : acessos.map((a, i) => <p key={i} className="text-[12.5px] text-[var(--base-texto-2)]">{dataHoraBR(a.em)} · {a.acao === 'leitura' ? 'leu o relatório' : 'respondeu'}</p>)}
					</Cartao>
				</div>}
			</div>
			{modal && <Modal titulo="Enviar ao credor?" texto={`O ${nomeCredor} recebe um link de leitura (vale 30 dias, acessos registrados). O link aparece uma vez para vocês copiarem e mandarem.`} confirmar="Enviar" ocupado={ocupado} onFechar={() => setModal(false)} onConfirmar={() => void mudar('enviar', {}, 'Enviado ao credor.')} />}
		</div>
	);
}
