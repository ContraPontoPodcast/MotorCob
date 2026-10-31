import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Check, Code, Copy, Plus, ShieldAlert, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { useConsolePerms } from '@/components/workspace/console/console-perms';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { supabase, dateBR, dateTimeBR, friendlyError, type Row } from '@/lib/supabase';
import { PERM } from '@/lib/permissoes';
import { cardShadow } from './empresa-shell';

// Empresa › Integrações › API (prompt 63, protótipo tokens-api-prototipo.html aprovado em 15/10/2026).
// O token inteiro só existe na tela que o criou (ou trocou); o banco guarda o hash.

/** Endereço da API. Enquanto api.motorcob.online não estiver no ar, o da função no Supabase. */
export const API_BASE = 'https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api';

export const ESCOPO_NOME: Record<string, string> = {
	'cargas:enviar': 'Enviar cargas',
	'cargas:status': 'Acompanhar cargas',
	'lista:ler': 'Ler a Lista do dia',
	'jornada:enviar': 'Enviar cargas da Jornada',
};
const GRUPO_COBRANCA = ['cargas:enviar', 'cargas:status', 'lista:ler'];
const GRUPO_JORNADA = ['jornada:enviar'];
const VALIDADES = [30, 90, 180, 365];
const CONVIVENCIAS = [1, 7, 14];

export type TokenApi = {
	id: number | string;
	nome: string;
	prefixo: string;
	escopos: string[];
	credor_ids: (number | string)[] | null;
	ips: string[] | null;
	criado_por: string | null;
	criado_em: string;
	expira_em: string;
	ultimo_uso: string | null;
	revogado_em: string | null;
	revogado_motivo: string | null;
	substitui_id: number | string | null;
	substituido_por: number | string | null;
};

type Uso = { chamadas: number; erros: number; ultimo_ip: string | null; ultima_chamada: string | null };

export function diasAte(v: string): number {
	return Math.ceil((new Date(v).getTime() - Date.now()) / 86400000);
}

export function situacaoToken(t: TokenApi): { id: 'ativo' | 'saindo' | 'vencido' | 'revogado'; label: string; cor: string; bg: string } {
	if (t.revogado_em) return { id: 'revogado', label: 'Revogado', cor: '#FF3B30', bg: '#FFE8E6' };
	if (new Date(t.expira_em).getTime() <= Date.now()) return { id: 'vencido', label: 'Vencido', cor: '#8E8E93', bg: '#F5F5F7' };
	if (t.substituido_por) return { id: 'saindo', label: 'Saindo', cor: '#9a631b', bg: '#FFF3E8' };
	return { id: 'ativo', label: 'Ativo', cor: '#248A3D', bg: '#E8F8EC' };
}

function CopiarBotao({ valor, rotulo = 'Copiar' }: { valor: string; rotulo?: string }) {
	const [ok, setOk] = useState(false);
	async function copiar() {
		try { await navigator.clipboard.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1800); } catch { /* ignora */ }
	}
	return (
		<button type="button" onClick={copiar} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] bg-white px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
			{ok ? <Check size={13} className="text-[#248A3D]" /> : <Copy size={13} />} {ok ? 'Copiado' : rotulo}
		</button>
	);
}

function Modal({ titulo, onClose, children, largo }: { titulo: string; onClose: () => void; children: ReactNode; largo?: boolean }) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);
	return (
		<div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label={titulo} className={`my-auto w-full ${largo ? 'max-w-[560px]' : 'max-w-[440px]'} rounded-2xl bg-white p-6`} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between gap-3">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{titulo}</h2>
					<button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-[#8E8E93] hover:bg-[#F5F5F7]"><X size={18} /></button>
				</div>
				{children}
			</div>
		</div>
	);
}

/** Token recém-criado ou trocado: aparece uma vez, com a primeira chamada e o teste. */
function TokenNovo({ token, nome, carteira, onFechar }: { token: string; nome: string; carteira: string | null; onFechar: () => void }) {
	const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
	const [testando, setTestando] = useState(false);
	const curl = `curl "${API_BASE}/v1/lista-do-dia?credor=${carteira ?? 'codigo-da-carteira'}" \\\n  -H "Authorization: Bearer ${token}"`;

	async function testar() {
		setTestando(true); setTeste(null);
		try {
			const r = await fetch(`${API_BASE}/v1/teste`, { headers: { Authorization: `Bearer ${token}` } });
			const j = await r.json().catch(() => ({})) as Row;
			if (r.ok && j.ok) {
				const pode = (Array.isArray(j.pode) ? j.pode as string[] : []).map(e => ESCOPO_NOME[e] ?? e).join(', ');
				const cs = Array.isArray(j.carteiras) ? (j.carteiras as Row[]).map(c => String(c.nome ?? c.codigo)) : [];
				setTeste({ ok: true, texto: `Funcionou: ${j.empresa} · ${pode} · ${cs.length ? cs.join(', ') : 'nenhuma carteira ativa'}` });
			} else {
				setTeste({ ok: false, texto: String(j.erro ?? j.message ?? `A API respondeu ${r.status}.`) });
			}
		} catch {
			setTeste({ ok: false, texto: 'Não foi possível falar com a API agora. Tente de novo em alguns minutos.' });
		} finally { setTestando(false); }
	}

	return (
		<Modal titulo={`Token "${nome}"`} onClose={onFechar} largo>
			<div className="rounded-lg bg-[#1D1D1F] p-3">
				<code className="block break-all font-mono text-[13px] text-[#F5F5F7]">{token}</code>
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<CopiarBotao valor={token} />
				<p className="text-[12px] text-[#9a631b]">Por segurança, ele não aparece de novo.</p>
			</div>
			<p className="mt-5 text-[13px] font-semibold text-[#1D1D1F]">Primeira chamada</p>
			<pre className="mt-2 overflow-x-auto rounded-lg bg-[#F5F5F7] p-3 text-[12px] leading-relaxed text-[#1D1D1F]">{curl}</pre>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				<CopiarBotao valor={curl} rotulo="Copiar o comando" />
				<button type="button" onClick={() => void testar()} disabled={testando} className="inline-flex h-8 items-center rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">{testando ? 'Testando…' : 'Testar agora'}</button>
			</div>
			{teste && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${teste.ok ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#FFE8E6] text-[#FF3B30]'}`}>{teste.texto}</p>}
			<div className="mt-6 flex justify-end">
				<button type="button" onClick={onFechar} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Já copiei</button>
			</div>
		</Modal>
	);
}

/** Lista, criação, troca e revogação dos tokens da empresa (Empresa › Integrações). */
export function TokensApi({ apiAtivo }: { apiAtivo: boolean }) {
	const { empresa, perfil, permissoes, credores } = useMotorAuth();
	const { isMaster } = useConsolePerms();
	const areasLib = useAreasLiberadas();
	const [params, setParams] = useSearchParams();
	const isEquipe = !!perfil?.equipe;
	const podeGerenciar = !isEquipe && permissoes.includes(PERM.gerenciarApi);
	const podeVer = isEquipe || podeGerenciar;

	const [tokens, setTokens] = useState<TokenApi[]>([]);
	const [uso, setUso] = useState<Record<string, Uso>>({});
	const [nomes, setNomes] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState('');

	const [criarAberto, setCriarAberto] = useState(false);
	const [trocar, setTrocar] = useState<TokenApi | null>(null);
	const [revogar, setRevogar] = useState<TokenApi | null>(null);
	const [novo, setNovo] = useState<{ token: string; nome: string; carteira: string | null } | null>(null);

	async function reload() {
		if (!supabase || !empresa || !podeVer || !apiAtivo) { setLoading(false); return; }
		setLoading(true); setErro('');
		const [t, u] = await Promise.all([
			supabase.from('api_tokens').select('id,nome,prefixo,escopos,credor_ids,ips,criado_por,criado_em,expira_em,ultimo_uso,revogado_em,revogado_motivo,substitui_id,substituido_por').eq('empresa_id', empresa.id).order('criado_em', { ascending: false }),
			supabase.rpc('uso_tokens_api', { empresa: empresa.id, dias: 7 }),
		]);
		if (t.error) { setErro(friendlyError(t.error)); setLoading(false); return; }
		const lista = (t.data ?? []) as TokenApi[];
		setTokens(lista);
		const m: Record<string, Uso> = {};
		((u.data ?? []) as Row[]).forEach(r => { m[String(r.token_id)] = { chamadas: Number(r.chamadas ?? 0), erros: Number(r.erros ?? 0), ultimo_ip: r.ultimo_ip ?? null, ultima_chamada: r.ultima_chamada ?? null }; });
		setUso(m);
		const uids = [...new Set(lista.map(x => x.criado_por).filter(Boolean))] as string[];
		if (uids.length) {
			const { data: ps } = await supabase.from('perfis').select('id,nome').in('id', uids);
			const n: Record<string, string> = {};
			((ps ?? []) as Row[]).forEach(p => { n[String(p.id)] = String(p.nome ?? ''); });
			setNomes(n);
		}
		setLoading(false);
	}
	useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [empresa?.id, apiAtivo, podeVer]);

	// ?token=ID (Início › Para hoje › "Trocar"): abre a troca daquele token.
	const tokenLink = params.get('token');
	useEffect(() => {
		if (!tokenLink || loading || !podeGerenciar) return;
		const t = tokens.find(x => String(x.id) === tokenLink);
		if (t && situacaoToken(t).id === 'ativo') setTrocar(t);
		const n = new URLSearchParams(params); n.delete('token'); setParams(n, { replace: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tokenLink, loading, podeGerenciar]);

	const vencendo = useMemo(() => tokens
		.filter(t => situacaoToken(t).id === 'ativo' && diasAte(t.expira_em) <= 15)
		.sort((a, b) => new Date(a.expira_em).getTime() - new Date(b.expira_em).getTime())[0] ?? null, [tokens]);

	const credorNome = (id: number | string) => credores.find(c => String(c.id) === String(id))?.nome ?? 'carteira removida';
	const carteirasTexto = (t: TokenApi) => {
		const ids = (t.credor_ids ?? []).filter(Boolean);
		return ids.length ? ids.map(credorNome).join(', ') : 'Todas as carteiras';
	};

	if (!apiAtivo) {
		if (isEquipe) return null;
		return (
			<section className="mt-4 rounded-2xl bg-[#F5F5F7] p-6" style={{ boxShadow: cardShadow }}>
				<div className="flex items-start gap-4">
					<div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#1D1D1F]"><Code size={22} /></div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Tokens de API</h2>
						<p className="mt-1 text-[14px] text-[#6E6E73]">Os tokens chegam com o módulo API. Com eles, o sistema da sua empresa envia cargas e lê a Lista do dia sem passar pelo site.</p>
						<Link to="/suporte/novo?motivo=integracao&assunto=Interesse%20na%20API" className="mt-4 inline-flex h-9 items-center rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Quero ser avisado</Link>
					</div>
				</div>
			</section>
		);
	}

	if (!podeVer) {
		return (
			<section className="mt-4 rounded-2xl bg-[#F5F5F7] p-6" style={{ boxShadow: cardShadow }}>
				<div className="flex items-start gap-4">
					<div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#1D1D1F]"><ShieldAlert size={22} /></div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Tokens de API</h2>
						<p className="mt-1 text-[14px] text-[#6E6E73]">Quem cuida dos tokens é o Admin da sua empresa.</p>
					</div>
				</div>
			</section>
		);
	}

	async function pararAgora(t: TokenApi) {
		if (!supabase) return;
		setBusy(String(t.id)); setErro('');
		const { error } = await supabase.rpc('revogar_token_api', { token_id: t.id, motivo: null });
		setBusy('');
		if (error) setErro(error.message || friendlyError(error)); else void reload();
	}

	return (
		<section className="mt-4 rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Tokens de API</h2>
					<p className="mt-0.5 max-w-[560px] text-[13px] text-[#6E6E73]">O sistema da sua empresa usa o token para enviar cargas e ler a Lista do dia. Guarde-o num cofre de segredos.</p>
				</div>
				{podeGerenciar && (
					<button onClick={() => setCriarAberto(true)} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Criar token</button>
				)}
			</div>

			{vencendo && podeGerenciar && (
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FFF3E8] px-4 py-3 text-[14px] text-[#9a631b]">
					<span>{vencendo.nome} vence em {Math.max(diasAte(vencendo.expira_em), 0)} {diasAte(vencendo.expira_em) === 1 ? 'dia' : 'dias'}. Troque antes para o sistema não parar.</span>
					<button onClick={() => setTrocar(vencendo)} className="h-8 rounded-full bg-[#9a631b] px-4 text-[13px] font-semibold text-white hover:opacity-90">Trocar agora</button>
				</div>
			)}

			{erro && <p role="alert" className="mt-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</p>}

			{loading ? (
				<p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando tokens…</p>
			) : tokens.length === 0 ? (
				<div className="mt-5 rounded-xl bg-[#F5F5F7] px-6 py-10 text-center text-[14px] text-[#6E6E73]">
					{podeGerenciar ? 'Nenhum token criado. Crie o primeiro com "Criar token".' : 'A empresa ainda não criou nenhum token.'}
				</div>
			) : (
				<div className="mt-5 space-y-3 lg:space-y-0">
					<div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,.9fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,1.1fr)] gap-3 border-b border-[#F0F0F2] pb-2 text-[12px] font-medium text-[#8E8E93] lg:grid">
						<span>Nome</span><span>Token</span><span>Pode</span><span>Uso · 7 dias</span><span>Vence</span><span>Situação</span><span />
					</div>
					{tokens.map(t => {
						const sit = situacaoToken(t);
						const u = uso[String(t.id)];
						const dias = diasAte(t.expira_em);
						const pode = (t.escopos ?? []).map(e => ESCOPO_NOME[e] ?? e).join(', ');
						const ips = t.ips?.length ? ` · só de ${t.ips.length} ${t.ips.length === 1 ? 'faixa' : 'faixas'} de IP` : '';
						return (
							<div key={String(t.id)} className="grid gap-2 rounded-xl border border-[#F0F0F2] p-4 text-[13px] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.9fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,1.1fr)] lg:items-start lg:gap-3 lg:rounded-none lg:border-0 lg:border-b lg:px-0 lg:py-3">
								<div className="min-w-0">
									<p className="font-medium text-[#1D1D1F]">{t.nome}</p>
									{t.criado_por && nomes[t.criado_por] && <p className="text-[12px] text-[#8E8E93]">criado por {nomes[t.criado_por]}</p>}
								</div>
								<span className="truncate font-mono text-[12px] text-[#6E6E73]">{t.prefixo}…</span>
								<span className="text-[#1D1D1F]">{pode} <span className="text-[#6E6E73]">· {carteirasTexto(t)}{ips}</span></span>
								<span>{!u ? (t.ultimo_uso ? <span className="text-[#6E6E73]">sem chamadas</span> : <span className="text-[#8E8E93]">nunca usado</span>) : <span className="text-[#1D1D1F]">{u.chamadas.toLocaleString('pt-BR')} chamadas{u.erros > 0 && <> · <span className="text-[#FF3B30]">{u.erros.toLocaleString('pt-BR')} erros</span></>}</span>}</span>
								<span className={sit.id === 'ativo' && dias <= 15 ? 'font-medium text-[#FF9500]' : 'text-[#6E6E73]'}>{dateBR(t.expira_em)}</span>
								<span>
									<span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{sit.label}</span>
									{sit.id === 'saindo' && <span className="mt-1 block text-[11px] text-[#9a631b]">para em {Math.max(dias, 0)} {dias === 1 ? 'dia' : 'dias'}</span>}
									{sit.id === 'revogado' && t.revogado_motivo && <span className="mt-1 block text-[11px] text-[#8E8E93]">pela equipe MotorCX: {t.revogado_motivo}</span>}
								</span>
								<div className="flex flex-wrap gap-1.5 lg:justify-end">
									<Link to={`/empresa/integracoes/${t.id}`} className="inline-flex h-7 items-center rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Uso</Link>
									{podeGerenciar && sit.id === 'ativo' && <button onClick={() => setTrocar(t)} className="h-7 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Trocar</button>}
									{podeGerenciar && sit.id === 'saindo' && <button onClick={() => void pararAgora(t)} disabled={busy === String(t.id)} className="h-7 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#FF3B30] hover:bg-[#FFE8E6] disabled:opacity-50">Parar agora</button>}
									{(podeGerenciar || (isEquipe && isMaster)) && (sit.id === 'ativo' || sit.id === 'saindo') && (
										<button onClick={() => setRevogar(t)} className="h-7 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#FF3B30] hover:bg-[#FFE8E6]">{isEquipe ? 'Revogar (incidente de segurança)' : 'Revogar'}</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<p className="mt-4 text-[12px] text-[#8E8E93]">Como usar: <Link to="/docs/api" className="font-medium text-[#0A60D0] hover:underline">documentação da API</Link>. Guardamos método, rota, carteira, código e IP de cada chamada por 90 dias; nunca o arquivo.</p>

			{criarAberto && (
				<CriarToken
					temCobranca={areasLib.cobranca}
					temJornada={areasLib.jornada}
					onClose={() => setCriarAberto(false)}
					onCriado={(token, nome, carteira) => { setCriarAberto(false); setNovo({ token, nome, carteira }); void reload(); }}
				/>
			)}
			{trocar && (
				<TrocarToken token={trocar} onClose={() => setTrocar(null)} onTrocado={token => {
					const cart = (trocar.credor_ids ?? [])[0];
					const codigo = cart != null ? credores.find(c => String(c.id) === String(cart))?.codigo ?? null : null;
					setNovo({ token, nome: trocar.nome, carteira: codigo });
					setTrocar(null); void reload();
				}} />
			)}
			{revogar && <RevogarToken token={revogar} pelaEquipe={isEquipe} onClose={() => setRevogar(null)} onRevogado={() => { setRevogar(null); void reload(); }} />}
			{novo && <TokenNovo token={novo.token} nome={novo.nome} carteira={novo.carteira} onFechar={() => setNovo(null)} />}
		</section>
	);
}

function CriarToken({ temCobranca, temJornada, onClose, onCriado }: {
	temCobranca: boolean; temJornada: boolean;
	onClose: () => void; onCriado: (token: string, nome: string, carteira: string | null) => void;
}) {
	const { empresa, credores } = useMotorAuth();
	const [passo, setPasso] = useState<'form' | 'resumo'>('form');
	const [nome, setNome] = useState('');
	const [escopos, setEscopos] = useState<string[]>([]);
	const [carteiras, setCarteiras] = useState<string[]>([]);
	const [dias, setDias] = useState(90);
	const [ipsTexto, setIpsTexto] = useState('');
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState(false);

	const ativas = credores.filter(c => c.ativo);
	const ips = ipsTexto.split(/\n+/).map(x => x.trim()).filter(Boolean);
	const grupos: { titulo: string; texto: string; ids: string[] }[] = [];
	if (temCobranca) grupos.push({ titulo: 'Cobrança', texto: 'Cargas das carteiras de cobrança e a Lista do dia.', ids: GRUPO_COBRANCA });
	if (temJornada) grupos.push({ titulo: 'Jornada do Cliente', texto: 'Cargas da Jornada: clientes, contatos e leads.', ids: GRUPO_JORNADA });

	function alternar<T>(lista: T[], v: T): T[] { return lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v]; }

	function revisar() {
		setErro('');
		if (nome.trim().length < 2 || nome.trim().length > 60) { setErro('Nome: de 2 a 60 caracteres.'); return; }
		if (escopos.length === 0) { setErro('Escolha o que o token pode fazer.'); return; }
		if (ips.length > 20) { setErro('Até 20 faixas de IP.'); return; }
		const invalido = ips.find(ip => !/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(ip));
		if (invalido) { setErro(`Faixa de IP inválida: ${invalido}. Use, por exemplo, 200.155.10.0/24.`); return; }
		setPasso('resumo');
	}

	async function criar() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro('');
		const { data, error } = await supabase.rpc('criar_token_api', {
			empresa: empresa.id, nome: nome.trim(), escopos,
			credores: carteiras.length ? carteiras : null, dias, ips: ips.length ? ips : null,
		});
		setBusy(false);
		if (error || typeof data !== 'string') { setErro(error?.message || friendlyError(error)); setPasso('form'); return; }
		const primeira = carteiras.length ? credores.find(c => String(c.id) === carteiras[0])?.codigo ?? null : ativas[0]?.codigo ?? null;
		onCriado(data, nome.trim(), primeira);
	}

	if (grupos.length === 0) {
		return (
			<Modal titulo="Criar token" onClose={onClose}>
				<p className="text-[14px] text-[#6E6E73]">Os tokens enviam cargas e leem a Lista do dia da Cobrança ou da Jornada do Cliente. A sua empresa não tem essas áreas no plano.</p>
				<div className="mt-5 flex justify-end"><button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Fechar</button></div>
			</Modal>
		);
	}

	if (passo === 'resumo') {
		return (
			<Modal titulo="Confira antes de criar" onClose={onClose}>
				<dl className="space-y-2 text-[14px]">
					<div className="flex justify-between gap-4"><dt className="text-[#6E6E73]">Nome</dt><dd className="text-right font-medium text-[#1D1D1F]">{nome.trim()}</dd></div>
					<div className="flex justify-between gap-4"><dt className="text-[#6E6E73]">Pode</dt><dd className="text-right text-[#1D1D1F]">{escopos.map(e => ESCOPO_NOME[e]).join(', ')}</dd></div>
					<div className="flex justify-between gap-4"><dt className="text-[#6E6E73]">Carteiras</dt><dd className="text-right text-[#1D1D1F]">{carteiras.length ? carteiras.map(id => credores.find(c => String(c.id) === id)?.nome ?? id).join(', ') : 'Todas as carteiras'}</dd></div>
					<div className="flex justify-between gap-4"><dt className="text-[#6E6E73]">Vale por</dt><dd className="text-right text-[#1D1D1F]">{dias} dias</dd></div>
					<div className="flex justify-between gap-4"><dt className="text-[#6E6E73]">Endereços IP</dt><dd className="text-right text-[#1D1D1F]">{ips.length ? ips.join(', ') : 'Qualquer endereço'}</dd></div>
				</dl>
				{erro && <p role="alert" className="mt-3 text-[13px] text-[#FF3B30]">{erro}</p>}
				<div className="mt-6 flex justify-end gap-3">
					<button onClick={() => setPasso('form')} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button>
					<button onClick={() => void criar()} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white disabled:opacity-50">{busy ? 'Criando…' : 'Criar token'}</button>
				</div>
			</Modal>
		);
	}

	return (
		<Modal titulo="Criar token" onClose={onClose} largo>
			<div className="space-y-5">
				<label className="block">
					<span className="mb-1.5 block text-[12px] font-semibold text-[#6E6E73]">Nome *</span>
					<input value={nome} onChange={e => setNome(e.target.value)} maxLength={60} placeholder="Ex.: ERP Financeiro" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" />
				</label>
				<div>
					<span className="mb-1.5 block text-[12px] font-semibold text-[#6E6E73]">O que pode</span>
					<div className="space-y-3">
						{grupos.map(g => (
							<div key={g.titulo} className="rounded-xl bg-[#F5F5F7] p-3">
								<p className="text-[13px] font-semibold text-[#1D1D1F]">{g.titulo}</p>
								<p className="text-[12px] text-[#6E6E73]">{g.texto}</p>
								<div className="mt-2 space-y-1.5">
									{g.ids.map(id => (
										<label key={id} className="flex items-center gap-2.5 text-[14px] text-[#1D1D1F]">
											<input type="checkbox" checked={escopos.includes(id)} onChange={() => setEscopos(s => alternar(s, id))} className="h-4 w-4 accent-[#1D1D1F]" />
											{ESCOPO_NOME[id]}
										</label>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
				<div>
					<span className="mb-1.5 block text-[12px] font-semibold text-[#6E6E73]">Carteiras <span className="font-normal text-[#8E8E93]">(nenhuma marcada = todas)</span></span>
					<div className="max-h-[140px] space-y-1.5 overflow-y-auto rounded-lg bg-[#F5F5F7] p-2">
						{ativas.length === 0 ? <p className="px-1 py-2 text-[13px] text-[#8E8E93]">Nenhuma carteira ativa.</p> : ativas.map(c => (
							<label key={c.id} className="flex items-center gap-2.5 px-1 py-0.5 text-[14px] text-[#1D1D1F]">
								<input type="checkbox" checked={carteiras.includes(String(c.id))} onChange={() => setCarteiras(s => alternar(s, String(c.id)))} className="h-4 w-4 accent-[#1D1D1F]" />
								{c.nome}
							</label>
						))}
					</div>
				</div>
				<div>
					<span className="mb-1.5 block text-[12px] font-semibold text-[#6E6E73]">Validade</span>
					<div className="flex rounded-lg bg-[#F5F5F7] p-1">
						{VALIDADES.map(d => (
							<button key={d} type="button" onClick={() => setDias(d)} className={`flex-1 rounded-md py-2 text-[13px] font-medium ${dias === d ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{d} dias</button>
						))}
					</div>
				</div>
				<label className="block">
					<span className="mb-1.5 block text-[12px] font-semibold text-[#6E6E73]">Só destes endereços IP (opcional)</span>
					<textarea value={ipsTexto} onChange={e => setIpsTexto(e.target.value)} rows={3} placeholder={'Uma faixa por linha. Ex.: 200.155.10.0/24'} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 font-mono text-[13px] outline-none focus:border-[#1D1D1F]" />
				</label>
				{erro && <p role="alert" className="text-[13px] text-[#FF3B30]">{erro}</p>}
				<div className="flex justify-end gap-3">
					<button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
					<button onClick={revisar} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Revisar</button>
				</div>
			</div>
		</Modal>
	);
}

function TrocarToken({ token, onClose, onTrocado }: { token: TokenApi; onClose: () => void; onTrocado: (token: string) => void }) {
	const [convivencia, setConvivencia] = useState(7);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	async function confirmar() {
		if (!supabase) return;
		setBusy(true); setErro('');
		const { data, error } = await supabase.rpc('trocar_token_api', { token_id: token.id, convivencia });
		setBusy(false);
		if (error || typeof data !== 'string') { setErro(error?.message || friendlyError(error)); return; }
		onTrocado(data);
	}
	return (
		<Modal titulo={`Trocar "${token.nome}"`} onClose={onClose}>
			<p className="text-[14px] text-[#6E6E73]">Mesmo nome, permissões, carteiras e IPs. Depois de colar o novo, veja em Uso se o antigo parou de ser chamado e use Parar agora.</p>
			<p className="mt-4 text-[12px] font-semibold text-[#6E6E73]">O antigo continua valendo por</p>
			<div className="mt-1.5 flex rounded-lg bg-[#F5F5F7] p-1">
				{CONVIVENCIAS.map(d => (
					<button key={d} type="button" onClick={() => setConvivencia(d)} className={`flex-1 rounded-md py-2 text-[13px] font-medium ${convivencia === d ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{d} {d === 1 ? 'dia' : 'dias'}</button>
				))}
			</div>
			{erro && <p role="alert" className="mt-3 text-[13px] text-[#FF3B30]">{erro}</p>}
			<div className="mt-6 flex justify-end gap-3">
				<button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
				<button onClick={() => void confirmar()} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white disabled:opacity-50">{busy ? 'Trocando…' : 'Trocar token'}</button>
			</div>
		</Modal>
	);
}

function RevogarToken({ token, pelaEquipe, onClose, onRevogado }: { token: TokenApi; pelaEquipe: boolean; onClose: () => void; onRevogado: () => void }) {
	const [motivo, setMotivo] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	async function confirmar() {
		if (!supabase) return;
		if (pelaEquipe && motivo.trim().length < 5) { setErro('Informe o motivo (5 caracteres ou mais).'); return; }
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('revogar_token_api', { token_id: token.id, motivo: pelaEquipe ? motivo.trim() : null });
		setBusy(false);
		if (error) { setErro(error.message || friendlyError(error)); return; }
		onRevogado();
	}
	return (
		<Modal titulo={`Revogar "${token.nome}"?`} onClose={onClose}>
			<p className="text-[14px] text-[#6E6E73]">O sistema que usa este token para de funcionar na hora.</p>
			{pelaEquipe && (
				<>
					<label className="mt-4 block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Motivo *</span>
						<textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={200} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Incidente de segurança" />
					</label>
					<p className="mt-1 text-[12px] text-[#8E8E93]">A empresa recebe o aviso no sino e a revogação fica na Auditoria.</p>
				</>
			)}
			{erro && <p role="alert" className="mt-3 text-[13px] text-[#FF3B30]">{erro}</p>}
			<div className="mt-6 flex justify-end gap-3">
				<button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
				<button onClick={() => void confirmar()} disabled={busy} className="h-10 rounded-lg bg-[#FF3B30] px-6 text-[14px] font-semibold text-white disabled:opacity-50">{busy ? 'Revogando…' : 'Revogar'}</button>
			</div>
		</Modal>
	);
}

/** Empresa › Integrações › Uso do token (/empresa/integracoes/:id). */
export function UsoToken({ id }: { id: string }) {
	const { empresa, perfil, permissoes } = useMotorAuth();
	const podeVer = !!perfil?.equipe || permissoes.includes(PERM.gerenciarApi);
	const [token, setToken] = useState<TokenApi | null>(null);
	const [dias, setDias] = useState<Row[]>([]);
	const [erros, setErros] = useState<Row[]>([]);
	const [uso, setUso] = useState<Uso | null>(null);
	const [loading, setLoading] = useState(true);
	const [naoAchou, setNaoAchou] = useState(false);

	useEffect(() => {
		if (!supabase || !empresa || !podeVer) { setLoading(false); return; }
		let active = true;
		(async () => {
			setLoading(true);
			const [t, d, e, u] = await Promise.all([
				supabase.from('api_tokens').select('id,nome,prefixo,escopos,credor_ids,ips,criado_por,criado_em,expira_em,ultimo_uso,revogado_em,revogado_motivo,substitui_id,substituido_por').eq('empresa_id', empresa.id).eq('id', id).maybeSingle(),
				supabase.rpc('uso_token_api_dias', { token: id, dias: 7 }),
				supabase.from('api_registros').select('quando,metodo,rota,carteira,status,motivo').eq('token_id', id).gte('status', 400).order('quando', { ascending: false }).limit(20),
				supabase.rpc('uso_tokens_api', { empresa: empresa.id, dias: 7 }),
			]);
			if (!active) return;
			if (!t.data) { setNaoAchou(true); setLoading(false); return; }
			setToken(t.data as TokenApi);
			setDias((d.data ?? []) as Row[]);
			setErros((e.data ?? []) as Row[]);
			const linha = ((u.data ?? []) as Row[]).find(r => String(r.token_id) === String(id));
			setUso(linha ? { chamadas: Number(linha.chamadas ?? 0), erros: Number(linha.erros ?? 0), ultimo_ip: linha.ultimo_ip ?? null, ultima_chamada: linha.ultima_chamada ?? null } : { chamadas: 0, erros: 0, ultimo_ip: null, ultima_chamada: null });
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, id, podeVer]);

	const voltar = <Link to="/empresa/integracoes" className="mb-4 inline-flex text-[14px] font-medium text-[#0A60D0] hover:underline">‹ Integrações</Link>;
	if (!podeVer) return <div>{voltar}<p className="rounded-2xl bg-[#F5F5F7] p-6 text-[14px] text-[#6E6E73]">Quem cuida dos tokens é o Admin da sua empresa.</p></div>;
	if (loading) return <div>{voltar}<p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando…</p></div>;
	if (naoAchou || !token || !uso) return <div>{voltar}<p className="rounded-2xl bg-[#F5F5F7] p-6 text-[14px] text-[#6E6E73]">Este token não existe nesta empresa.</p></div>;

	const certo = uso.chamadas ? Math.round(100 * (uso.chamadas - uso.erros) / uso.chamadas) : null;
	const maxDia = Math.max(1, ...dias.map(d => Number(d.chamadas ?? 0)));
	const sit = situacaoToken(token);

	return (
		<div>
			{voltar}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<h2 className="text-[20px] font-semibold text-[#1D1D1F]">{token.nome}</h2>
				<span className="font-mono text-[12px] text-[#6E6E73]">{token.prefixo}…</span>
				<span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{sit.label}</span>
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{[
					['Chamadas · 7 dias', uso.chamadas.toLocaleString('pt-BR')],
					['Deram certo', certo == null ? '—' : `${certo}%`],
					['Erros', uso.erros.toLocaleString('pt-BR')],
					['Último uso', token.ultimo_uso ? `${dateTimeBR(token.ultimo_uso)}${uso.ultimo_ip ? ` · IP ${uso.ultimo_ip}` : ''}` : 'nunca usado'],
				].map(([r, v]) => (
					<div key={r} className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
						<p className="text-[12px] font-semibold text-[#8E8E93]">{r}</p>
						<p className="mt-1 text-[18px] font-semibold text-[#1D1D1F]">{v}</p>
					</div>
				))}
			</div>
			<section className="mt-4 rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
				<h3 className="text-[15px] font-semibold text-[#1D1D1F]">Chamadas por dia</h3>
				<div className="mt-4 flex h-[140px] items-end gap-2" role="img" aria-label="Chamadas por dia nos últimos 7 dias">
					{dias.map(d => {
						const n = Number(d.chamadas ?? 0); const e = Number(d.erros ?? 0);
						return (
							<div key={String(d.dia)} className="flex flex-1 flex-col items-center gap-1" title={`${dateBR(d.dia)}: ${n} chamadas, ${e} erros`}>
								<div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-md bg-[#F5F5F7]">
									<div className="w-full bg-[#FF3B30]" style={{ height: `${(100 * e) / maxDia}%` }} />
									<div className="w-full bg-[#1D1D1F]" style={{ height: `${(100 * (n - e)) / maxDia}%` }} />
								</div>
								<span className="text-[11px] text-[#8E8E93]">{dateBR(d.dia).slice(0, 5)}</span>
							</div>
						);
					})}
				</div>
			</section>
			<section className="mt-4 rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
				<h3 className="text-[15px] font-semibold text-[#1D1D1F]">Últimos erros</h3>
				{erros.length === 0 ? <p className="mt-3 text-[14px] text-[#6E6E73]">Nenhum erro nos últimos 90 dias.</p> : (
					<div className="mt-3 overflow-x-auto">
						<table className="w-full min-w-[640px] text-left text-[13px]">
							<thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="py-2 pr-3 font-medium">Quando</th><th className="py-2 pr-3 font-medium">Chamada</th><th className="py-2 pr-3 font-medium">Código</th><th className="py-2 font-medium">O que fazer</th></tr></thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{erros.map((r, i) => (
									<tr key={i}>
										<td className="py-2 pr-3 text-[#6E6E73]">{dateTimeBR(r.quando)}</td>
										<td className="py-2 pr-3 font-mono text-[12px] text-[#1D1D1F]">{r.metodo} {r.rota}{r.carteira ? ` · ${r.carteira}` : ''}</td>
										<td className="py-2 pr-3 font-semibold text-[#FF3B30]">{r.status}</td>
										<td className="py-2 text-[#1D1D1F]">{oQueFazer(Number(r.status), r.motivo ? String(r.motivo) : '')}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<p className="mt-4 text-[12px] text-[#8E8E93]">Guardamos método, rota, carteira, código e IP por 90 dias; nunca o arquivo.</p>
			</section>
		</div>
	);
}

function oQueFazer(status: number, motivo: string): string {
	switch (status) {
		case 400: return `Confira os parâmetros${motivo ? `: ${motivo}` : '.'}`;
		case 401: return 'Token vencido ou revogado: troque o token.';
		case 403: return motivo || 'Sem permissão para esta chamada.';
		case 404: return motivo || 'Endereço não encontrado.';
		case 409: return 'Mude a carteira para API em Como a carga chega.';
		case 413: return 'Arquivo acima de 20 MB: divida em partes.';
		case 429: return 'Mais de 60 chamadas no minuto: espere 60 s.';
		default: return status >= 500 ? 'Falha nossa; tente de novo.' : (motivo || '—');
	}
}
