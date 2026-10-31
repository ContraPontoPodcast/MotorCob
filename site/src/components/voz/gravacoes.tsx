// Tela 5 · Cobrança › Resultados › Gravações. Só para quem tem ouvir_gravacoes (a RLS de voz_gravacoes
// exige o mesmo); a transcrição exige ver_transcricoes. A gravação nunca fica aberta na tela: ouvir pede um
// link de 5 minutos à Edge Function `gravacoes`, que confere a permissão e grava em `acessos`.
// Só o ID do cliente aparece — nunca nome, CPF ou telefone.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Lock, Play, Search } from 'lucide-react';
import { Loading, Notice, PageHeading, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { FUNCAO_GRAVACOES, PERM_VOZ, dataCurta, dataHoraCurta, diasAte, duracao, resultadoVoz } from '@/lib/voz';
import { Aviso, Botao, Cartao, CartaoLinha, Pilula, Tabela, Trilho, Vazio, campoCls, campoStyle } from './ui';

type Gravacao = {
	id: number; credor_id: number | null; chamada_id: number | null; id_cliente: string; id_acao: string | null;
	origem: 'ia' | 'discador'; duracao_s: number | null; gravada_em: string; expira_em: string;
	guarda: boolean; guarda_motivo: string | null; guarda_em: string | null;
	voz_chamadas?: { resultado: string | null } | null;
};
type Segmento = { quem: string; em_s?: number; texto: string };
type Acesso = { usuario: string; acao: string; em: string };

const ORIGEM: Record<string, string> = { ia: 'Agente virtual', discador: 'Discador do cliente' };
const LINK_S = 300;

function mmss(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

/** Chama a Edge Function `gravacoes` (caminho previsto no plano). Ela ainda pode não estar no ar. */
async function pedirGravacao(gravacao: number, tipo: 'audio' | 'transcricao'): Promise<{ ok: true; dados: Row } | { ok: false; motivo: 'sem_funcao' | 'sem_permissao' | 'erro'; msg: string }> {
	if (!supabase) return { ok: false, motivo: 'erro', msg: 'Configuração ausente.' };
	const { data, error } = await supabase.functions.invoke(FUNCAO_GRAVACOES, { body: { gravacao, tipo } });
	if (!error) return { ok: true, dados: (data ?? {}) as Row };
	const status = Number((error as { context?: { status?: number } }).context?.status ?? 0);
	if (status === 403 || status === 401) return { ok: false, motivo: 'sem_permissao', msg: 'Seu perfil não tem permissão para isso.' };
	if (status === 404 || /FunctionsFetchError|FunctionsRelayError|Failed to send|not found/i.test(`${error.name} ${error.message}`)) {
		return { ok: false, motivo: 'sem_funcao', msg: 'O serviço de escuta ainda não está no ar.' };
	}
	return { ok: false, motivo: 'erro', msg: friendlyError(error) };
}

export function Gravacoes() {
	const { empresa, credor, credores, perfil } = useMotorAuth();
	const podeLer = usePermissao(PERM_VOZ.verTranscricoes);
	const ehAdmin = perfil?.papel === 'admin';
	const [params] = useSearchParams();
	const [busca, setBusca] = useState(params.get('cliente') ?? '');
	const [buscaAplicada, setBuscaAplicada] = useState(params.get('cliente') ?? '');
	const [origem, setOrigem] = useState('');
	const [resultado, setResultado] = useState('');
	const [lista, setLista] = useState<Gravacao[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [selId, setSelId] = useState<number | null>(null);
	const detalheRef = useRef<HTMLDivElement>(null);

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true); setError('');
		let q = supabase.from('voz_gravacoes')
			.select('id,credor_id,chamada_id,id_cliente,id_acao,origem,duracao_s,gravada_em,expira_em,guarda,guarda_motivo,guarda_em,voz_chamadas(resultado)')
			.eq('empresa_id', empresa.id).order('gravada_em', { ascending: false }).limit(200);
		if (credor) q = q.eq('credor_id', credor.id);
		if (origem) q = q.eq('origem', origem);
		const b = buscaAplicada.trim();
		if (b) q = q.or(`id_cliente.eq.${b.replace(/[,()]/g, '')},id_acao.eq.${b.replace(/[,()]/g, '')}`);
		const { data, error } = await q;
		if (error) { setError(friendlyError(error)); setLoading(false); return; }
		// Embutido de N:1 vem como objeto; aceita lista também, por segurança.
		const l = ((data ?? []) as unknown as (Gravacao & { voz_chamadas: unknown })[]).map(g => ({ ...g, voz_chamadas: (Array.isArray(g.voz_chamadas) ? g.voz_chamadas[0] : g.voz_chamadas) as Gravacao['voz_chamadas'] }));
		setLista(l);
		setSelId(prev => (prev != null && l.some(g => g.id === prev) ? prev : l[0]?.id ?? null));
		setLoading(false);
	}

	useEffect(() => { void reload(); }, [empresa?.id, credor?.id, origem, buscaAplicada]);

	const resultados = useMemo(() => [...new Set(lista.map(g => g.voz_chamadas?.resultado).filter((x): x is string => !!x))], [lista]);
	const visiveis = resultado ? lista.filter(g => g.voz_chamadas?.resultado === resultado) : lista;
	const sel = visiveis.find(g => g.id === selId) ?? visiveis[0] ?? null;

	function escolher(id: number) {
		setSelId(id);
		if (window.matchMedia('(max-width: 1023px)').matches) window.setTimeout(() => detalheRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
	}

	const nomeCarteira = (id: number | null) => (id == null ? '' : credores.find(c => String(c.id) === String(id))?.nome ?? '');

	const seletorCarteira = credor ? `Carteira ${credor.nome}` : 'Todas as carteiras';

	return (
		<>
			<PageHeading title="Gravações" description="Agente virtual e discador · só o ID do cliente, nunca nome ou CPF" />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : (
				<>
					<form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); setBuscaAplicada(busca); }}>
						<label className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[340px]">
							<Search size={15} className="pointer-events-none absolute left-3 text-[var(--base-texto-3)]" />
							<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="ID do cliente ou da ação" aria-label="Buscar pelo ID do cliente ou da ação" className={`${campoCls} w-full pl-9`} style={campoStyle} />
						</label>
						<select aria-label="Gravador" value={origem} onChange={e => setOrigem(e.target.value)} className={campoCls} style={campoStyle}>
							<option value="">Todos os gravadores</option>
							<option value="ia">Agente virtual</option>
							<option value="discador">Discador do cliente</option>
						</select>
						<select aria-label="Resultado" value={resultado} onChange={e => setResultado(e.target.value)} className={campoCls} style={campoStyle}>
							<option value="">Todos os resultados</option>
							{resultados.map(r => <option key={r} value={r}>{resultadoVoz(r).label}</option>)}
						</select>
						<Botao secundario type="submit">Buscar</Botao>
						<span className="text-[12px] text-[var(--base-texto-3)]">{seletorCarteira}</span>
					</form>

					{error ? <Notice>{error}</Notice> : loading ? <Loading /> : visiveis.length === 0 ? (
						<Vazio titulo={buscaAplicada || origem || resultado ? 'Nenhuma gravação com esses filtros.' : 'Ainda não há gravações.'}>
							{buscaAplicada || origem || resultado ? 'Confira o ID do cliente ou tire um filtro.' : 'As ligações do agente virtual aparecem aqui quando a empresa grava. As do discador de vocês entram por Cargas › Gravações do discador.'}
						</Vazio>
					) : (
						<div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
							<Cartao semPadding className="self-start">
								<Tabela
									cabecalho={['ID do cliente', 'Quando', 'Gravador', 'Resultado', 'Duração', 'Apaga em']}
									numericas={[4, 5]}
									selecionada={visiveis.findIndex(g => g.id === sel?.id)}
									onLinha={i => escolher(visiveis[i].id)}
									linhas={visiveis.map(g => {
										const r = resultadoVoz(g.voz_chamadas?.resultado);
										const d = diasAte(g.expira_em);
										return [
											<span key="i" className="font-mono">{g.id_cliente}</span>, dataHoraCurta(g.gravada_em), ORIGEM[g.origem],
											g.voz_chamadas?.resultado ? <Pilula key="r" tom={r.tom}>{r.label}</Pilula> : '—', duracao(g.duracao_s),
											g.guarda ? <Pilula key="g" tom="info">em guarda</Pilula> : d <= 7 ? <Pilula key="d" tom="atencao">{d} dias</Pilula> : `${d} dias`,
										];
									})}
									cartoes={visiveis.map(g => (
										<CartaoLinha key={g.id} ativo={g.id === sel?.id} onClick={() => escolher(g.id)}>
											<div className="flex items-center justify-between gap-2"><b className="font-mono">{g.id_cliente}</b>{g.voz_chamadas?.resultado && <Pilula tom={resultadoVoz(g.voz_chamadas.resultado).tom}>{resultadoVoz(g.voz_chamadas.resultado).label}</Pilula>}</div>
											<small className="mt-1 block text-[var(--base-texto-2)]">{dataHoraCurta(g.gravada_em)} · {ORIGEM[g.origem]} · {duracao(g.duracao_s)}</small>
											<small className="block text-[var(--base-texto-3)]">{g.guarda ? 'em guarda para disputa' : `apaga em ${diasAte(g.expira_em)} dias`}</small>
										</CartaoLinha>
									))}
								/>
								<p className="border-t px-4 py-2.5 text-[12px] text-[var(--base-texto-3)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>{visiveis.length} {visiveis.length === 1 ? 'gravação' : 'gravações'}{lista.length >= 200 ? ' (as 200 mais recentes; use a busca)' : ''}</p>
							</Cartao>
							<div ref={detalheRef} className="min-w-0 scroll-mt-4">
								{sel && <Detalhe key={sel.id} g={sel} carteira={nomeCarteira(sel.credor_id)} podeLer={podeLer} ehAdmin={ehAdmin} onMudou={() => void reload()} />}
							</div>
						</div>
					)}
				</>
			)}
		</>
	);
}

function Detalhe({ g, carteira, podeLer, ehAdmin, onMudou }: { g: Gravacao; carteira: string; podeLer: boolean; ehAdmin: boolean; onMudou: () => void }) {
	const [confirmaOuvir, setConfirmaOuvir] = useState(false);
	const [url, setUrl] = useState<string | null>(null);
	const [restante, setRestante] = useState(0);
	const [expirou, setExpirou] = useState(false);
	const [pendencia, setPendencia] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [segmentos, setSegmentos] = useState<Segmento[] | null>(null);
	const [lendo, setLendo] = useState(false);
	const [guardaAberta, setGuardaAberta] = useState(false);
	const [soltarAberto, setSoltarAberto] = useState(false);
	const [motivo, setMotivo] = useState('');
	const [acessos, setAcessos] = useState<{ nome: string; acao: string; em: string }[] | null>(null);
	const [acessosBloq, setAcessosBloq] = useState(false);

	// Contagem regressiva do link de 5 minutos.
	useEffect(() => {
		if (!url) return;
		const t = window.setInterval(() => {
			setRestante(r => {
				if (r <= 1) { window.clearInterval(t); setUrl(null); setExpirou(true); return 0; }
				return r - 1;
			});
		}, 1000);
		return () => window.clearInterval(t);
	}, [url]);

	async function carregarAcessos() {
		if (!supabase) return;
		const { data, error } = await supabase.from('acessos').select('usuario,acao,em')
			.in('alvo', [String(g.id), `gravacao:${g.id}`]).in('acao', ['ouvir_gravacao', 'ler_transcricao'])
			.order('em', { ascending: false }).limit(20);
		if (error) { setAcessosBloq(true); setAcessos([]); return; }
		const rows = (data ?? []) as Acesso[];
		const ids = [...new Set(rows.map(r => r.usuario))];
		let nomes: Record<string, string> = {};
		if (ids.length) {
			const { data: ps } = await supabase.from('perfis').select('id,nome').in('id', ids);
			nomes = Object.fromEntries(((ps ?? []) as Row[]).map(p => [String(p.id), abreviar(String(p.nome ?? ''))]));
		}
		setAcessos(rows.map(r => ({ nome: nomes[r.usuario] ?? 'Alguém da empresa', acao: r.acao, em: r.em })));
	}
	useEffect(() => { void carregarAcessos(); }, [g.id]);

	async function ouvir() {
		setOcupado(true);
		const r = await pedirGravacao(g.id, 'audio');
		setOcupado(false); setConfirmaOuvir(false);
		if (!r.ok) { if (r.motivo === 'sem_funcao') setPendencia(r.msg); else toast.error(r.msg); return; }
		const u = String(r.dados.url ?? '');
		if (!/^https:\/\//.test(u)) { toast.error('O link da gravação veio inválido.'); return; }
		const exp = r.dados.expira_em ? Math.round((new Date(String(r.dados.expira_em)).getTime() - Date.now()) / 1000) : LINK_S;
		setRestante(Math.max(1, Math.min(LINK_S, exp))); setExpirou(false); setUrl(u);
		void carregarAcessos();
	}

	async function ler() {
		setLendo(true);
		const r = await pedirGravacao(g.id, 'transcricao');
		setLendo(false);
		if (!r.ok) { if (r.motivo === 'sem_funcao') setPendencia(r.msg); else toast.error(r.msg); return; }
		let segs = r.dados.segmentos as Segmento[] | undefined;
		if (!segs && typeof r.dados.url === 'string' && /^https:\/\//.test(r.dados.url)) {
			try { const resp = await fetch(r.dados.url); const j = await resp.json(); segs = (j?.segmentos ?? j) as Segmento[]; } catch { segs = undefined; }
		}
		if (!Array.isArray(segs)) { toast.error('A transcrição ainda não está pronta.'); return; }
		setSegmentos(segs);
		void carregarAcessos();
	}

	async function guardar() {
		if (!supabase || motivo.trim().length < 5) return;
		setOcupado(true);
		const { error } = await supabase.rpc('guardar_gravacao', { gravacao: g.id, motivo: motivo.trim() });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		setGuardaAberta(false); setMotivo('');
		toast.success('Gravação guardada além do prazo.');
		onMudou();
	}
	async function soltar() {
		if (!supabase) return;
		setOcupado(true);
		const { error } = await supabase.rpc('soltar_gravacao', { gravacao: g.id });
		setOcupado(false); setSoltarAberto(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success('Guarda retirada. A gravação volta a seguir a retenção.');
		onMudou();
	}

	const total = Math.max(1, (new Date(g.expira_em).getTime() - new Date(g.gravada_em).getTime()) / 86_400_000);
	const faltam = diasAte(g.expira_em);
	const r = resultadoVoz(g.voz_chamadas?.resultado);

	return (
		<div className="space-y-4">
			<Cartao titulo={<span className="font-mono">{g.id_cliente} · {dataHoraCurta(g.gravada_em)}</span>} linha={[carteira, g.id_acao ? `ação ${g.id_acao}` : '', duracao(g.duracao_s)].filter(Boolean).join(' · ')} direita={<><Pilula>{ORIGEM[g.origem]}</Pilula>{g.voz_chamadas?.resultado && <Pilula tom={r.tom}>{r.label}</Pilula>}</>}>
				{pendencia && <div className="mb-3"><Aviso tom="atencao" titulo={pendencia}>A Edge Function <span className="font-mono">gravacoes</span> (link de 5 minutos e registro em acessos) ainda não foi publicada. O botão já chama o caminho previsto.</Aviso></div>}
				{url ? (
					<div className="space-y-2">
						<audio controls autoPlay src={url} controlsList="nodownload noplaybackrate" className="w-full" onContextMenu={e => e.preventDefault()} />
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Pilula tom={restante < 60 ? 'atencao' : 'neutro'}>Link vale por mais {mmss(restante)}</Pilula>
							<span className="text-[12px] text-[var(--base-texto-3)]">O acesso ficou registrado. O link é de uso pessoal.</span>
						</div>
					</div>
				) : (
					<div className="space-y-3">
						<p className="text-[13px] text-[var(--base-texto-2)]">{expirou ? 'O link expirou. Para ouvir de novo, peça outro; o novo acesso também fica registrado.' : 'A gravação não fica aberta na tela. Ao pedir para ouvir, você recebe um link que vale 5 minutos.'}</p>
						<Botao onClick={() => setConfirmaOuvir(true)} disabled={ocupado}><Play size={14} /> {expirou ? 'Pedir outro link' : 'Ouvir'}</Botao>
					</div>
				)}
			</Cartao>

			<Cartao titulo={<span className="flex items-center gap-2">Transcrição {podeLer && <Pilula>redigida</Pilula>}</span>} linha={podeLer ? 'CPF, cartão, telefone, e-mail, nomes e saúde saem antes de gravar.' : undefined}>
				{!podeLer ? (
					<p className="flex items-center gap-1.5 text-[13px] text-[var(--base-texto-2)]"><Lock size={14} /> Seu perfil pode ouvir, mas não ler transcrições (permissão Ler transcrições).</p>
				) : segmentos ? (
					<>
						<div className="max-h-[420px] space-y-2 overflow-y-auto select-none" onCopy={e => e.preventDefault()} onContextMenu={e => e.preventDefault()}>
							{segmentos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Transcrição vazia.</p> : segmentos.map((s, i) => {
								const pessoa = /pessoa|cliente|user/i.test(s.quem);
								return (
									<div key={i} className={`max-w-[90%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${pessoa ? 'ml-auto' : ''}`} style={{ backgroundColor: pessoa ? 'var(--destaque-suave)' : 'var(--base-fill)', color: 'var(--base-texto)' }}>
										<small className="block text-[11px] font-semibold text-[var(--base-texto-3)]">{pessoa ? 'Pessoa' : /operador/i.test(s.quem) ? 'Operador' : 'Agente'}{s.em_s != null ? ` · ${mmss(Math.round(s.em_s))}` : ''}</small>
										<Redigido texto={s.texto} />
									</div>
								);
							})}
						</div>
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Ler a transcrição também fica registrado. Não há botão para copiar nem baixar o texto.</p>
					</>
				) : (
					<div className="space-y-2">
						<p className="text-[13px] text-[var(--base-texto-2)]">A transcrição abre só quando você pede, e a leitura fica registrada.</p>
						<Botao secundario onClick={() => void ler()} disabled={lendo}>{lendo ? 'Abrindo...' : 'Ler a transcrição'}</Botao>
					</div>
				)}
			</Cartao>

			<Cartao titulo="Retenção">
				{g.guarda ? (
					<Aviso tom="info" titulo={`Guardada além do prazo desde ${dataCurta(g.guarda_em)}.`}>Motivo: {g.guarda_motivo}. Não apaga no fim do prazo até o Admin tirar a guarda.</Aviso>
				) : (
					<>
						<p className="text-[14px] text-[var(--base-texto)]"><b>Apaga em {faltam} {faltam === 1 ? 'dia' : 'dias'}</b> <span className="text-[12.5px] text-[var(--base-texto-3)]">({dataCurta(g.expira_em)}/{new Date(g.expira_em).getFullYear()})</span></p>
						<Trilho valor={100 * (1 - faltam / total)} cor={faltam <= 7 ? 'var(--estado-atencao)' : 'var(--area)'} />
					</>
				)}
				<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Áudio e transcrição apagam juntos, sozinhos, no fim do prazo. Ficam só os códigos de resultado e os números agregados. O prazo é da empresa, em <Link to="/empresa/privacidade" className="underline">Empresa › Privacidade e gravações</Link>.</p>
				{ehAdmin ? (
					<div className="mt-3">{g.guarda
						? <Botao secundario onClick={() => setSoltarAberto(true)} disabled={ocupado}>Tirar a guarda</Botao>
						: <Botao secundario onClick={() => setGuardaAberta(true)} disabled={ocupado}>Guardar além do prazo (disputa)</Botao>}</div>
				) : !g.guarda && <p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Em disputa, reclamação ou pedido judicial, o Admin da empresa guarda a gravação além do prazo.</p>}
			</Cartao>

			<Cartao titulo="Quem acessou">
				{acessos == null ? <p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p>
					: acessosBloq ? <p className="text-[13px] text-[var(--base-texto-2)]">Só os perfis Admin e Gestão veem quem acessou. Todo acesso entra também na Auditoria.</p>
					: acessos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Ninguém ouviu nem leu esta gravação ainda.</p>
					: (
						<ul className="divide-y text-[13px]" style={{ borderColor: 'var(--base-borda)' }}>
							{acessos.map((a, i) => (
								<li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5" style={{ borderColor: 'var(--base-borda)' }}>
									<span className="text-[var(--base-texto)]">{a.nome}</span>
									<span className="text-[var(--base-texto-2)]">{a.acao === 'ler_transcricao' ? 'leu a transcrição' : 'ouviu'}</span>
									<span className="tnum text-[var(--base-texto-3)]">{dataHoraCurta(a.em)}</span>
								</li>
							))}
						</ul>
					)}
			</Cartao>

			<ConfirmaAcao aberto={confirmaOuvir} titulo="Ouvir esta gravação?" texto={'O seu acesso fica registrado (nome, gravação e hora) e aparece em "Quem acessou" e na Auditoria. O link vale 5 minutos.'} botao="Ouvir" onConfirm={() => void ouvir()} onClose={() => setConfirmaOuvir(false)} loading={ocupado} />
			<ConfirmaAcao aberto={guardaAberta} titulo="Guardar além do prazo"
				texto={<>
					<p>Use só em disputa, reclamação ou pedido judicial. A gravação não apaga no fim do prazo até o Admin tirar a guarda.</p>
					<label htmlFor="motivo-guarda" className="mt-3 block text-[12px] font-semibold text-[var(--base-texto-2)]">Motivo e protocolo</label>
					<input id="motivo-guarda" value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: contestação no Procon, protocolo 2026-1187" className={`${campoCls} mt-1 w-full`} style={campoStyle} />
					{motivo.trim().length > 0 && motivo.trim().length < 5 && <small className="text-[var(--estado-erro-texto)]">Escreva pelo menos 5 caracteres.</small>}
				</>}
				botao="Guardar" onConfirm={() => void guardar()} onClose={() => setGuardaAberta(false)} loading={ocupado} />
			<ConfirmaAcao aberto={soltarAberto} titulo="Tirar a guarda?" texto="A gravação volta a seguir a retenção da empresa e pode apagar logo, se o prazo já passou." botao="Tirar a guarda" onConfirm={() => void soltar()} onClose={() => setSoltarAberto(false)} loading={ocupado} />
		</div>
	);
}

/** Destaca os trechos redigidos ([NOME], [CPF], [SAÚDE]...). */
function Redigido({ texto }: { texto: string }) {
	const partes = String(texto ?? '').split(/(\[[A-ZÀ-Ú_ ]{2,20}\])/g);
	return <>{partes.map((p, i) => /^\[[A-ZÀ-Ú_ ]{2,20}\]$/.test(p)
		? <span key={i} className="rounded px-1 font-mono text-[11.5px]" style={{ backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' }}>{p}</span>
		: <span key={i}>{p}</span>)}</>;
}

/** "Marina Lopes" → "Marina L." (nome de quem trabalha na empresa, sem sobrenome inteiro). */
function abreviar(nome: string): string {
	const p = nome.trim().split(/\s+/);
	if (p.length < 2) return p[0] || 'Alguém da empresa';
	return `${p[0]} ${p[p.length - 1][0]}.`;
}
