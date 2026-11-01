// Tela 3 · Empresa › Integrações › Conectores do CRM (SQL 58). A empresa vê os conectores, a saúde (crm_conector_saude)
// e as últimas chamadas (crm_chamadas: só ID, conector, status, tempo e código). O cadastro técnico, a credencial e o
// teste são da equipe MotorCX com gerenciar_conectores_crm (decisão do dono): salvar_conector_crm, trocar_credencial_conector
// (só a REFERÊNCIA no Secret Manager; o valor nunca passa pelo site nem pelo banco), testar_conector_crm (a VM testa com
// o cliente de teste), mudar_situacao_conector_crm, liberar_host_crm / revogar_host_crm.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Loading, Notice, PageHeading } from '@/components/app-shell';
import { Aviso, Botao, Cartao, CartaoLinha, Pilula, Tabela, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import { IPS_SAIDA_MOTORCX } from '@/lib/voz';
import { dataCurta, nTxt, pctTxt, tituloBloco } from '@/lib/fluxo';
import type { ConectorRow, SaudeRow } from './api';
import { Campo, Detalhes, Gaveta, Kv, Linhas, Regras, Selo } from './ds';
import { useFluxo } from './contexto';
import { executar, useCarregar } from './comum';
import { nomeFinalidade } from './etapa';

const AUT: Record<string, string> = { oauth2_cc: 'OAuth2 (client credentials)', api_key_header: 'Chave de API no cabeçalho', bearer: 'Token Bearer', basic: 'Usuário e senha (Basic)', mtls: 'Certificado (mTLS)' };
const FALHA: Record<string, string> = { alternativa_carteira: 'Usar ofertas e alçada da carteira (alternativa)', ramo: 'Seguir pelo ramo "Falhou" da etapa', transferir: 'Transferir para humano' };
const sit = (c: ConectorRow): { t: string; tom: 'ok' | 'atencao' | 'neutro' | 'erro' } =>
	c.situacao === 'ativo' ? { t: `ativo${c.testado_em ? ` · testado em ${dataCurta(c.testado_em)}` : ''}`, tom: 'ok' }
		: c.situacao === 'pausado' ? { t: 'pausado', tom: 'atencao' }
		: { t: c.testado_em ? `rascunho · ${c.teste_ok ? 'teste ok' : 'teste falhou'}` : 'rascunho · nunca testado', tom: 'neutro' };
const ms = (v: number | null | undefined) => (v == null ? '—' : `${nTxt(v)} ms`);

export function ConectoresCrm() {
	const { api, empresa, equipe, permissoes } = useFluxo();
	const [gaveta, setGaveta] = useState<null | 'novo' | 'chamadas' | 'lgpd' | 'rede' | { con: number }>(null);
	const ver = equipe || ['editar_canais', 'aprovar_roteiro_voz', 'gerenciar_usuarios'].some(p => permissoes.includes(p));
	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api || !empresa) return null;
		const [conectores, saude, hosts, cuida, chamadas, fl] = await Promise.all([
			api.conectores(empresa.id), api.saude(empresa.id).catch(() => [] as SaudeRow[]), api.hosts(empresa.id).catch(() => []),
			api.cuidaConectores(empresa.id), api.chamadasCrm(empresa.id, { limite: 30 }).catch(() => []), api.fluxos(empresa.id).catch(() => ({ fluxos: [], versoes: [] })),
		]);
		return { conectores, saude, hosts, cuida, chamadas, fl };
	}, [api, empresa?.id]);

	/** Onde cada conector é usado (versões não arquivadas): "N7 · Negociador v5". */
	const usos = useMemo(() => {
		const m = new Map<number, string[]>();
		for (const v of dados?.fl.versoes ?? []) {
			if (v.situacao === 'arquivado') continue;
			const f = dados!.fl.fluxos.find(x => x.id === v.fluxo_id);
			for (const b of v.definicao?.blocos ?? []) {
				const p = b.params ?? {};
				const ids = [p.conector_id, ...(Array.isArray(p.conectores) ? p.conectores : [])].filter((x): x is number => typeof x === 'number');
				for (const id of ids) m.set(id, [...(m.get(id) ?? []), `${b.id} · ${tituloBloco(b)} (${f?.nome ?? 'fluxo'} v${v.versao})`]);
			}
		}
		return m;
	}, [dados]);

	const heading = <PageHeading title="Conectores do CRM" description="APIs que o agente chama durante a ligação. São da empresa toda; cada fluxo escolhe quais usa." semControles
		actions={dados ? <>{dados.cuida && <Botao onClick={() => setGaveta('novo')}><Plus size={15} aria-hidden /> Novo conector</Botao>}<Botao secundario onClick={() => setGaveta('chamadas')}>Últimas chamadas</Botao></> : undefined} />;
	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!ver) return <>{heading}<Vazio titulo="Seu perfil não vê os conectores.">Quem administra a empresa, edita canais ou aprova o roteiro de voz vê os conectores.</Vazio></>;
	if (carregando && !dados) return <>{heading}<Loading /></>;
	if (erro || !dados) return <>{heading}<Notice>{erro || 'Não foi possível carregar.'}</Notice></>;

	const semTeste = dados.conectores.filter(c => !c.testado_em && (usos.get(c.id)?.length ?? 0) > 0);
	const saude = (id: number) => dados.saude.find(s => s.conector_id === id);
	const sel = gaveta && typeof gaveta === 'object' ? dados.conectores.find(c => c.id === gaveta.con) ?? null : null;

	return (
		<>
			{heading}
			<div className="space-y-4">
				{semTeste.map(c => (
					<Aviso key={c.id} tom="atencao" titulo={`C${c.id} · ${c.nome} nunca foi testado`}>
						e já é usado em {usos.get(c.id)!.slice(0, 2).join(', ')}. {dados.cuida ? <button type="button" className="font-semibold underline" onClick={() => setGaveta({ con: c.id })}>Testar agora</button> : 'A equipe MotorCX testa pelo Suporte.'}
					</Aviso>
				))}
				<div className="flex flex-wrap gap-2">
					<Selo onClick={() => setGaveta('lgpd')}>O que vai, o que volta, o que fica</Selo>
					<Selo onClick={() => setGaveta('rede')}>Rede e IPs</Selo>
				</div>
				{dados.conectores.length === 0 ? (
					<Vazio titulo="Nenhum conector cadastrado." acao={dados.cuida ? <Botao onClick={() => setGaveta('novo')}>Novo conector</Botao> : undefined}>
						Sem conector, o fluxo usa as ofertas e a alçada da carteira cadastradas no MotorCX. {dados.cuida ? '' : 'O cadastro é feito pela equipe MotorCX: peça pelo Suporte.'}
					</Vazio>
				) : (
					<Cartao semPadding>
						<Tabela cabecalho={['Conector', 'Situação', 'Resposta (95%)', 'Erros', 'Chamadas · 24 h']} numericas={[2, 3, 4]}
							onLinha={i => setGaveta({ con: dados.conectores[i].id })}
							linhas={dados.conectores.map(c => {
								const s = sit(c), h = saude(c.id);
								return [
									<span key="n" className="block max-w-[340px]"><b className="font-semibold">C{c.id} · {c.nome}</b><small className="block truncate text-[12px] text-[var(--base-texto-2)]">{c.metodo} {c.url.replace(/^https:\/\/[^/]+/, '…')}</small></span>,
									<Pilula key="s" tom={s.tom}>{s.t}</Pilula>, ms(h?.p95_ms), h?.erro_pct != null ? `${String(h.erro_pct).replace('.', ',')}%` : '—', h?.volume_24h ? nTxt(h.volume_24h) : '—',
								];
							})}
							cartoes={dados.conectores.map(c => {
								const s = sit(c), h = saude(c.id);
								return (
									<CartaoLinha key={c.id} onClick={() => setGaveta({ con: c.id })}>
										<span className="flex justify-between gap-2"><b className="font-semibold">C{c.id} · {c.nome}</b><b className="tnum">{h?.erro_pct != null ? `${String(h.erro_pct).replace('.', ',')}%` : '—'}</b></span>
										<span className="mt-1 block"><Pilula tom={s.tom}>{s.t}</Pilula></span>
										<small className="mt-1 block text-[12px] text-[var(--base-texto-2)]">até {ms(h?.p95_ms)} · {nTxt(h?.volume_24h ?? 0)} chamadas</small>
									</CartaoLinha>
								);
							})} />
					</Cartao>
				)}
			</div>

			{(gaveta === 'novo' || sel) && <GavetaConector c={sel} cuida={dados.cuida} hosts={dados.hosts} saude={sel ? saude(sel.id) : undefined} usos={sel ? usos.get(sel.id) ?? [] : []} onFechar={() => setGaveta(null)} aoMudar={() => void recarregar()} />}
			<Gaveta aberta={gaveta === 'chamadas'} onFechar={() => setGaveta(null)} titulo="Últimas chamadas" sub="Sem dado pessoal: só ID, conector, status, tempo e código.">
				<Linhas itens={dados.chamadas.map(h => ({
					e: <><b className="font-semibold">{new Date(h.ocorrido_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</b> · C{h.conector_id ?? '—'} <Pilula tom={h.classe === 'ok' ? 'ok' : 'erro'}>{h.http_status ?? (h.classe === 'tempo' ? 'tempo esgotado' : h.classe)}</Pilula></>,
					s: `${h.id_chamada ?? 'teste'} · ${h.id_cliente ?? '—'} · ${ms(h.latencia_ms)} · tentativa ${h.tentativa}${h.usou_alternativa ? ' · usou alternativa da carteira' : ''}`,
					d: <span className="text-[12px] font-normal">{h.resultado_codigo ?? '—'}</span>,
				}))} />
				{!dados.chamadas.length && <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma chamada registrada (guardadas por 90 dias).</p>}
			</Gaveta>
			<Gaveta aberta={gaveta === 'lgpd'} onFechar={() => setGaveta(null)} titulo="O que vai, o que volta, o que fica" sub="Vale para todos os conectores">
				<b className="text-[12.5px] font-semibold">Vai para o CRM</b>
				<Regras itens={[['O ID do cliente no MotorCX (CLI-xxxxx) e a referência do contrato.'], ['O que a pessoa falou e o fluxo precisa conferir.', 'Ex.: dia e mês de nascimento.'], ['A oferta escolhida e a data combinada.']]} />
				<b className="text-[12.5px] font-semibold">Volta e só passa pela ligação</b>
				<Regras itens={[['Ofertas, valores, parcelas, número do acordo, link do boleto.', 'Fica na memória da ligação e some quando ela termina. Não vai para log, banco nem relatório.']]} />
				<b className="text-[12.5px] font-semibold">Fica gravado no MotorCX</b>
				<Regras itens={[['Qual conector, quando, status, tempo de resposta e tentativa.'], ['O resultado em código fechado.', 'ofertas_1_3, identidade_ok, acordo_registrado… Nenhum valor, nome, documento ou corpo de resposta.'], ['Registro guardado por 90 dias, como as chamadas de voz.']]} />
			</Gaveta>
			<GavetaRede aberta={gaveta === 'rede'} onFechar={() => setGaveta(null)} hosts={dados.hosts} cuida={dados.cuida} aoMudar={() => void recarregar()} />
		</>
	);
}

function GavetaRede({ aberta, onFechar, hosts, cuida, aoMudar }: { aberta: boolean; onFechar: () => void; hosts: string[]; cuida: boolean; aoMudar: () => void }) {
	const { api, empresa } = useFluxo();
	const [host, setHost] = useState('');
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo="Rede">
			<Kv itens={[['IPs de saída para liberar no firewall do CRM', IPS_SAIDA_MOTORCX.join(' e ')]]} />
			<b className="text-[12.5px] font-semibold">Hosts liberados pela equipe MotorCX</b>
			<Linhas itens={hosts.map(h => ({ e: h, d: cuida ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => void executar(() => api!.revogarHost(empresa!.id, h), 'Host revogado.').then(aoMudar)}>Revogar</button> : undefined }))} />
			{!hosts.length && <p className="text-[12.5px] text-[var(--base-texto-2)]">Nenhum host liberado. Só nome DNS público, nunca IP nem rede interna.</p>}
			{cuida && (
				<div className="flex gap-2">
					<input aria-label="Host" placeholder="api.crm.exemplo.com.br" value={host} onChange={e => setHost(e.target.value.trim().toLowerCase())} className={`${campoCls} min-w-0 flex-1`} style={campoStyle} />
					<Botao secundario disabled={!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)} onClick={() => void executar(() => api!.liberarHost(empresa!.id, host), 'Host liberado.').then(ok => { if (ok) { setHost(''); aoMudar(); } })}>Liberar</Botao>
				</div>
			)}
		</Gaveta>
	);
}

interface Rasc { nome: string; finalidade: string; metodo: string; url: string; autenticacao: string; em_falha: string; timeout_ms: string; tentativas: string; idempotencia: boolean; mapa_entrada: string; mapa_saida: string; cabecalhos_fixos: string }
const rascDe = (c: ConectorRow | null): Rasc => ({
	nome: c?.nome ?? '', finalidade: c?.finalidade ?? 'buscar_ofertas', metodo: c?.metodo ?? 'GET', url: c?.url ?? 'https://', autenticacao: c?.autenticacao ?? 'oauth2_cc',
	em_falha: c?.em_falha ?? 'ramo', timeout_ms: String(c?.timeout_ms ?? 2500), tentativas: String(c?.tentativas ?? 0), idempotencia: !!c?.idempotencia,
	mapa_entrada: JSON.stringify(c?.mapa_entrada ?? [{ origem: 'id_cliente', destino: 'id_cliente', onde: 'path' }], null, 1),
	mapa_saida: JSON.stringify(c?.mapa_saida ?? [], null, 1), cabecalhos_fixos: JSON.stringify(c?.cabecalhos_fixos ?? {}, null, 1),
});

function GavetaConector({ c, cuida, hosts, saude, usos, onFechar, aoMudar }: { c: ConectorRow | null; cuida: boolean; hosts: string[]; saude?: SaudeRow; usos: string[]; onFechar: () => void; aoMudar: () => void }) {
	const { api, empresa } = useFluxo();
	const [r, setR] = useState<Rasc>(rascDe(c));
	const [ref, setRef] = useState<string | null>(null);
	useEffect(() => { setR(rascDe(c)); setRef(null); }, [c?.id, c?.versao]);
	const dis = !cuida;
	const set = (k: keyof Rasc, v: string | boolean) => setR(x => ({ ...x, [k]: v }));
	const json = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
	const host = (r.url.match(/^https:\/\/([^/:?#]+)/) ?? [])[1] ?? '';
	const problemas = [
		r.nome.trim().length < 2 && 'Dê um nome.',
		!/^https:\/\//.test(r.url) && 'Só https.',
		host && !hosts.includes(host) && `O host ${host} não está liberado (Rede e IPs).`,
		(json(r.mapa_entrada) === undefined || json(r.mapa_saida) === undefined || json(r.cabecalhos_fixos) === undefined) && 'Mapas e cabeçalhos precisam ser JSON válido.',
		r.metodo !== 'GET' && Number(r.tentativas) > 0 && !r.idempotencia && 'POST/PUT só repete com chave de idempotência.',
		r.em_falha === 'alternativa_carteira' && r.finalidade !== 'buscar_ofertas' && 'A alternativa da carteira só vale para Buscar ofertas.',
	].filter(Boolean) as string[];
	async function salvar() {
		if (!api || !empresa) return;
		const ajustes = { nome: r.nome.trim(), finalidade: r.finalidade, metodo: r.metodo, url: r.url.trim(), autenticacao: r.autenticacao, em_falha: r.em_falha,
			timeout_ms: Number(r.timeout_ms), tentativas: Number(r.tentativas), idempotencia: r.idempotencia, mapa_entrada: json(r.mapa_entrada), mapa_saida: json(r.mapa_saida), cabecalhos_fixos: json(r.cabecalhos_fixos) };
		if (await executar(() => api.salvarConector(empresa.id, ajustes, c?.id ?? null), c ? 'Conector salvo. Mudança técnica volta para rascunho: teste e ative de novo.' : 'Conector criado como rascunho.')) { aoMudar(); if (!c) onFechar(); }
	}
	const sel = (k: keyof Rasc, op: Record<string, string>) => <select value={String(r[k])} disabled={dis} onChange={e => set(k, e.target.value)} className={`${campoCls} w-full`} style={campoStyle}>{Object.entries(op).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>;
	const s = c ? sit(c) : null;
	return (
		<Gaveta aberta onFechar={onFechar} titulo={c ? `C${c.id} · ${c.nome}` : 'Novo conector'} sub={s ? s.t : 'Finalidade, endereço, autenticação e campos. Nasce rascunho.'} largura={600}
			pe={cuida ? <>
				<Botao secundario onClick={() => void salvar()} disabled={problemas.length > 0}>Salvar</Botao>
				{c && c.situacao !== 'ativo' && c.teste_ok && <Botao secundario onClick={() => void executar(() => api!.situacaoConector(c.id, 'ativo'), 'Conector ativo: os fluxos já podem usar.').then(aoMudar)}>Ativar</Botao>}
				{c && c.situacao === 'ativo' && <Botao secundario onClick={() => void executar(() => api!.situacaoConector(c.id, 'pausado'), 'Conector pausado.').then(aoMudar)}>Pausar</Botao>}
				{c && <Botao onClick={() => void executar(() => api!.testarConector(c.id), 'Teste pedido. A VM chama o CRM com o cliente de teste CLI-00001; o resultado aparece aqui.').then(aoMudar)} disabled={!c.segredo_ref}>Testar conector</Botao>}
			</> : undefined}>
			{!cuida && <Aviso tom="info" titulo="Gerenciado pela equipe MotorCX.">Cadastro técnico, credencial e teste são da equipe (permissão de conectores). Para mudar, peça pelo Suporte.</Aviso>}
			{usos.length > 0 && <p className="text-[12.5px] text-[var(--base-texto-2)]">Usado em: {usos.join('; ')}.</p>}
			{c?.teste_pedido_em && <Aviso tom="info" titulo="Teste em andamento.">Pedido em {dataCurta(c.teste_pedido_em)}. Atualize em instantes.</Aviso>}
			{problemas.length > 0 && cuida && <Aviso tom="erro" titulo="Antes de salvar:">{problemas.join(' ')}</Aviso>}
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Nome"><input value={r.nome} maxLength={60} disabled={dis} onChange={e => set('nome', e.target.value)} className={`${campoCls} w-full`} style={campoStyle} /></Campo>
				<Campo rotulo="Finalidade">{sel('finalidade', { buscar_ofertas: 'Buscar ofertas', validar_cadastro: 'Validar cadastro', registrar_acordo: 'Registrar acordo', gerar_boleto: 'Gerar boleto', gerar_link: 'Gerar link', outro: 'Outro' })}</Campo>
				<Campo rotulo="Método">{sel('metodo', { GET: 'GET', POST: 'POST', PUT: 'PUT' })}</Campo>
				<Campo inteiro rotulo="Endereço (só https e só hosts liberados)"><input value={r.url} maxLength={500} disabled={dis} onChange={e => set('url', e.target.value.trim())} className={`${campoCls} w-full`} style={campoStyle} /></Campo>
				<Campo rotulo="Autenticação">{sel('autenticacao', AUT)}</Campo>
				<Campo rotulo="Credencial (fica no cofre)" ajuda="Só a referência do Secret Manager. O valor nunca passa pelo site nem pelo banco.">
					<input readOnly value={ref ?? (c?.segredo_ref ? `cofre://${c.segredo_ref}` : 'sem credencial')} className={`${campoCls} w-full font-mono text-[12px]`} style={campoStyle} />
				</Campo>
				<Campo inteiro rotulo="Se a API falhar">{sel('em_falha', FALHA)}</Campo>
			</div>
			{cuida && c && (
				<div className="rounded-xl border p-3 text-[12.5px]" style={{ borderColor: 'var(--base-borda)' }}>
					<p className="text-[var(--base-texto-2)]">Trocar a credencial gera uma referência nova no cofre, pausa o conector (se ativo) e pede novo teste. Grave o valor com a ferramenta da equipe, direto no Secret Manager.</p>
					<Botao secundario onClick={() => void (async () => { try { const x = await api!.trocarCredencial(c.id); setRef(`cofre://${x}`); aoMudar(); } catch (e) { void executar(() => Promise.reject(e), ''); } })()}>Gerar nova referência no cofre</Botao>
				</div>
			)}
			<div>
				<Detalhes titulo="Tempo limite e novas tentativas" qtd={`${r.timeout_ms} ms · ${r.tentativas}`}>
					<div className="grid gap-3 sm:grid-cols-2">
						<Campo rotulo="Tempo limite (ms)"><input type="number" min={500} max={8000} value={r.timeout_ms} disabled={dis} onChange={e => set('timeout_ms', e.target.value)} className={`${campoCls} w-full`} style={campoStyle} /></Campo>
						<Campo rotulo="Novas tentativas (0 a 2)"><input type="number" min={0} max={2} value={r.tentativas} disabled={dis} onChange={e => set('tentativas', e.target.value)} className={`${campoCls} w-full`} style={campoStyle} /></Campo>
						<label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" className="accent-[var(--destaque)]" checked={r.idempotencia} disabled={dis} onChange={e => set('idempotencia', e.target.checked)} /> Chave de idempotência (POST/PUT podem repetir)</label>
					</div>
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Entre 500 e 8.000 ms; enquanto espera, toca a fala de espera da etapa. GET repete sem risco; POST só com chave de idempotência.</p>
				</Detalhes>
				<Detalhes titulo="Campos que vão e que voltam">
					{cuida ? (
						<div className="space-y-2">
							<Campo inteiro rotulo="Vai do MotorCX (mapa de entrada, JSON)"><textarea rows={4} value={r.mapa_entrada} onChange={e => set('mapa_entrada', e.target.value)} className={`${campoCls} h-auto w-full py-2 font-mono text-[12px]`} style={campoStyle} /></Campo>
							<Campo inteiro rotulo="Volta do CRM (mapa de saída, JSON)"><textarea rows={5} value={r.mapa_saida} onChange={e => set('mapa_saida', e.target.value)} className={`${campoCls} h-auto w-full py-2 font-mono text-[12px]`} style={campoStyle} /></Campo>
							<Campo inteiro rotulo="Cabeçalhos fixos (JSON, sem credencial)"><textarea rows={2} value={r.cabecalhos_fixos} onChange={e => set('cabecalhos_fixos', e.target.value)} className={`${campoCls} h-auto w-full py-2 font-mono text-[12px]`} style={campoStyle} /></Campo>
						</div>
					) : (
						<>
							<b className="text-[12.5px] font-semibold">Vai do MotorCX</b>
							<Linhas itens={(c?.mapa_entrada ?? []).map(m => ({ e: m.origem, d: <span className="font-normal">{m.destino}</span>, s: m.onde }))} />
							<b className="mt-2 block text-[12.5px] font-semibold">Volta do CRM</b>
							<Linhas itens={(c?.mapa_saida ?? []).map(m => ({ e: `${m.origem} → ${m.destino}`, s: m.grava === 'codigo' ? 'só o código fica no MotorCX' : 'só na ligação' }))} />
						</>
					)}
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Esquema fechado. CPF, endereço, e-mail, telefone completo e número de cartão: o banco recusa.</p>
				</Detalhes>
				{c && (
					<Detalhes titulo="Saúde · últimas 24 h">
						<Kv itens={[['95% respondem em até', ms(saude?.p95_ms)], ['Metade responde em até', ms(saude?.p50_ms)], ['Erros', saude?.erro_pct != null ? pctTxt(Number(saude.erro_pct) / 100) : '—'], ['Chamadas', nTxt(saude?.volume_24h ?? 0)], ['Versão do conector', `v${c.versao}`], ['Finalidade', nomeFinalidade(c.finalidade)]]} />
					</Detalhes>
				)}
			</div>
		</Gaveta>
	);
}
