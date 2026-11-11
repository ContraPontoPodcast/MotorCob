// Agente Voz/CX › Telefonia (SPEC Canais §3.4). PR T5 (SQL 114): o Admin do cliente configura a rota direta dele.
// Lê pelas views sem segredo (voz_troncos_empresa + voz_troncos_campos_empresa, voz_rotas_empresa +
// voz_rotas_prefixo_empresa, voz_pausas_empresa, voz_numeros_teste_empresa) e escreve só por RPC, que pedem a permissão
// configurar_telefonia e a verificação em duas etapas. O tronco abre em /voz/telefonia/tronco/:ref (assistente de seis
// passos, senha no cofre e "Testar a rota" ao vivo). A senha nunca volta para a tela; o número de teste só aparece com
// o DDD e os 2 últimos dígitos.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, Download } from 'lucide-react';
import { PageHeading, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, Botao, BotaoLink, Cartao, Pilula } from '@/components/ds';
import { Campo, Gaveta, TabelaRolavel, btnPrim, btnSec, campoCls, tdCls, thCls } from '@/components/comuns/voz-ui';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { FUNCAO_SEGREDO_TRONCO, IPS_SAIDA_MOTORCX, MODOS_VOZ, PERM_VOZ, TIPOS_ROTA, binaMascara, cadenciaTxt, lerNumero, prefixoOk, prefixoRota, baixarTexto, RE_DESTINO_SIP, lerIps, ipsMotivo } from '@/lib/voz';
import { erroDaFuncao } from '@/lib/funcoes';
import { checklistReal, digitosNumeroTeste, fichaTecnica, motivoPausa } from '@/lib/telefonia';
import { supabase, dateTimeBR, friendlyError, today, type Row } from '@/lib/supabase';

/** Frase do banco (raise exception) ou a mensagem genérica. */
export function erroBanco(e: unknown): string {
	const x = e as { code?: string; message?: string } | null;
	if (x?.code === 'P0001' && x.message) return x.message.charAt(0).toUpperCase() + x.message.slice(1).replace(/\.?$/, '.');
	return friendlyError(e);
}

/** Situação de um tronco para quem não é da equipe (sem segredo, sem detalhe técnico do cofre). */
export function situacaoTroncoCliente(t: Row, pausado = false): { tom: 'ok' | 'erro' | 'neutro' | 'atencao'; txt: string } {
	if (pausado) return { tom: 'erro', txt: 'Rota pausada' };
	if (t.autenticacao === 'senha' && !t.segredo_no_cofre) return { tom: 'atencao', txt: 'Falta guardar a senha' };
	if (Array.isArray(t.ips_operadora) && t.ips_operadora.length === 0) return { tom: 'atencao', txt: 'Faltam os IPs da operadora' };
	if (Array.isArray(t.ips_pendentes) && t.ips_pendentes.length > 0) return { tom: 'atencao', txt: 'IPs esperando a equipe MotorCX' };
	if (t.teste_ok === false) return { tom: 'erro', txt: 'O teste não passou' };
	if (t.teste_ok !== true) return { tom: 'atencao', txt: 'Falta testar a rota' };
	if (t.ativo === false) return { tom: 'neutro', txt: 'Testado · ainda não está em uso' };
	return { tom: 'ok', txt: 'Em uso' };
}

/** Junta as linhas de duas views pelo id (os campos do SQL 113 vêm de uma view própria). */
export function juntarPorId(base: Row[], extra: Row[]): Row[] {
	const por = new Map(extra.map(x => [String(x.id), x]));
	return base.map(b => ({ ...b, ...(por.get(String(b.id)) ?? {}) }));
}

type Dados = { troncos: Row[]; rotas: Row[]; pausas: Row[]; numeros: Row[]; transferencias: Row[]; config: Row | null };

export function useTelefonia(empresaId: number | null, ligado: boolean) {
	const [d, setD] = useState<Dados | null>(null);
	const [erro, setErro] = useState('');
	const carregar = useCallback(async () => {
		if (!supabase || !empresaId || !ligado) return;
		const sb = supabase;
		const [tr, tc, ro, rp, pa, nu, tf, cf] = await Promise.all([
			sb.from('voz_troncos_empresa').select('*').eq('empresa_id', empresaId).order('referencia'),
			sb.from('voz_troncos_campos_empresa').select('*').eq('empresa_id', empresaId),
			sb.from('voz_rotas_empresa').select('*').eq('empresa_id', empresaId).order('tipo').order('prioridade'),
			sb.from('voz_rotas_prefixo_empresa').select('*').eq('empresa_id', empresaId),
			sb.from('voz_pausas_empresa').select('*').eq('empresa_id', empresaId).order('pausado_em', { ascending: false }).limit(50),
			sb.from('voz_numeros_teste_empresa').select('*').eq('empresa_id', empresaId).order('criado_em'),
			sb.from('voz_transferencias').select('id,nome,credor_id,destino_sip,metodo,tronco_id,ativo,testado_em,teste_ok,ips_operadora').eq('empresa_id', empresaId).order('id'),
			sb.from('voz_config').select('modo,aviso_gravacao,retencao_dias').eq('empresa_id', empresaId).maybeSingle(),
		]);
		const falha = [tr, tc, ro, rp, pa, nu, tf].find(r => r.error);
		if (falha?.error) { setErro(friendlyError(falha.error)); return; }
		setErro('');
		setD({
			troncos: juntarPorId((tr.data ?? []) as Row[], (tc.data ?? []) as Row[]),
			rotas: juntarPorId((ro.data ?? []) as Row[], (rp.data ?? []) as Row[]),
			pausas: (pa.data ?? []) as Row[], numeros: (nu.data ?? []) as Row[], transferencias: (tf.data ?? []) as Row[],
			config: (cf.data ?? null) as Row | null,
		});
	}, [empresaId, ligado]);
	useEffect(() => { void carregar(); }, [carregar]);
	return { d, erro, carregar };
}

export function situacaoRota(r: Row, hoje: string, pausado: boolean): { tom: 'ok' | 'erro' | 'neutro' | 'atencao'; txt: string } {
	if (r.vigente_ate && String(r.vigente_ate) < hoje) return { tom: 'neutro', txt: 'Encerrada' };
	if (String(r.vigente_desde) > hoje) return { tom: 'neutro', txt: 'Agendada' };
	if (pausado) return { tom: 'erro', txt: 'Pausada' };
	return { tom: 'ok', txt: 'Em uso' };
}

async function copiar(txt: string) {
	try { await navigator.clipboard.writeText(txt); } catch { /* sem permissão: o botão Baixar continua */ }
}

export function FichaTecnica({ tronco }: { tronco: Row | null }) {
	const txt = fichaTecnica(tronco);
	return (
		<div className="space-y-2">
			<pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--base-fill)] p-3 text-[12.5px] leading-relaxed text-[var(--base-texto)]">{txt}</pre>
			<div className="flex flex-wrap gap-2">
				<Botao tipo="secundario" pequeno onClick={() => void copiar(txt)}><Copy size={14} /> Copiar</Botao>
				<Botao tipo="secundario" pequeno onClick={() => baixarTexto('ficha-tecnica-motorcx.txt', txt, 'text/plain;charset=utf-8')}><Download size={14} /> Baixar</Botao>
			</div>
		</div>
	);
}

export function Telefonia() {
	const { perfil, empresa } = useMotorAuth();
	const { agenteVoz } = useAreasLiberadas();
	const pode = usePermissao(PERM_VOZ.configurarTelefonia);
	const equipe = !!perfil?.equipe;
	const empresaId = empresa ? Number(empresa.id) : null;
	const { d, erro, carregar } = useTelefonia(empresaId, agenteVoz);
	const [ficha, setFicha] = useState(false);
	const [msg, setMsg] = useState('');
	const [gaveta, setGaveta] = useState<null | 'rota' | 'transferencia'>(null);
	const hoje = today();

	const pausaDo = (tid: unknown) => d?.pausas.find(p => p.tronco_id === tid && !p.retomado_em) ?? null;
	const ativas = (d?.pausas ?? []).filter(p => !p.retomado_em);
	const problemas = [
		...ativas.map(p => `rota ${String(d?.troncos.find(t => t.id === p.tronco_id)?.referencia ?? '')} pausada`),
		...(d?.troncos ?? []).filter(t => t.teste_ok === false).map(t => `${String(t.referencia)} não passou no teste`),
	];
	const emUso = (d?.troncos ?? []).filter(t => t.ativo && !pausaDo(t.id));
	const estado = !d ? null : d.troncos.length === 0 ? { tom: 'neutro' as const, txt: 'Não configurado' }
		: problemas.length ? { tom: 'erro' as const, txt: 'Com problema' }
			: emUso.length ? { tom: 'ok' as const, txt: 'Funcionando' } : { tom: 'atencao' as const, txt: 'Falta pôr um tronco em uso' };

	async function retomar(p: Row) {
		if (!supabase) return;
		const { error } = await supabase.rpc('retomar_rota_voz', { pausa: Number(p.id) });
		setMsg(error ? erroBanco(error) : 'Rota retomada. O servidor de voz volta a discar por ela em até 1 minuto.');
		void carregar();
	}
	async function encerrar(r: Row) {
		if (!supabase) return;
		const { error } = await supabase.rpc('encerrar_rota_voz', { rota: Number(r.id), ate: hoje });
		setMsg(error ? erroBanco(error) : 'Rota encerrada hoje.');
		void carregar();
	}
	async function removerNumero(n: Row) {
		if (!supabase) return;
		// a Edge Function apaga a linha (remover_numero_teste_voz, com o seu login) e destrói o número no cofre
		const { data, error } = await supabase.functions.invoke(FUNCAO_SEGREDO_TRONCO, { body: { remover_numero_teste: Number(n.id) } });
		const m = await erroDaFuncao(error, data);
		setMsg(m || 'Número de teste removido (e apagado do cofre).');
		void carregar();
	}

	const modo = MODOS_VOZ.find(m => m.id === d?.config?.modo) ?? MODOS_VOZ[0];
	const check = d ? checklistReal({ troncos: d.troncos, numeros: d.numeros, transferenciaTestada: d.transferencias.some(t => t.ativo && t.teste_ok), avisoGravacao: d.config ? d.config.aviso_gravacao === true : null }) : [];

	return (
		<>
			<PageHeading title="Telefonia" description="Por onde o MotorCX liga: a rota da sua operadora (tronco SIP), as rotas por tipo de número e para onde a chamada vai quando precisa de um operador." semControles
				actions={equipe ? <BotaoLink to="/console/fornecedores?aba=voz">Console (equipe MotorCX)</BotaoLink> : undefined} />
			{!agenteVoz ? (
				<Aviso tom="info" titulo="O agente de voz MotorCX não está contratado.">O discador e o AGV da sua empresa usam a telefonia de vocês, fora do MotorCX.</Aviso>
			) : (
				<div className="space-y-4">
					<p className="text-[12.5px] text-[var(--base-texto-3)]">Quem altera: perfis com <b>Configurar a telefonia</b> (padrão: só o Admin), com a verificação em duas etapas. Mudança de endereço, senha ou bina avisa todos os Admins por e-mail.</p>
					{!pode && <Aviso tom="info">Você vê a telefonia, mas não altera. Peça ao Admin da empresa.</Aviso>}
					{erro && <Aviso tom="erro">{erro}</Aviso>}
					{msg && <Aviso tom="info">{msg}</Aviso>}

					<Cartao titulo="Estado" direita={<Botao tipo="secundario" pequeno onClick={() => setFicha(x => !x)}>{ficha ? 'Fechar a ficha técnica' : 'Ficha técnica para a operadora'}</Botao>}>
						{!estado ? <p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p> : (
							<div className="space-y-3">
								<div className="flex flex-wrap items-center gap-2">
									<Pilula tom={estado.tom}>{estado.txt}</Pilula>
									<span className="text-[13px] text-[var(--base-texto-2)]">{d!.troncos.length} tronco(s) · {emUso.length} em uso{problemas.length ? ` · ${problemas.join(' · ')}` : ''}</span>
								</div>
								{ativas.map(p => {
									const t = d!.troncos.find(x => x.id === p.tronco_id);
									return (
										<Aviso key={String(p.id)} tom="erro" titulo={`A rota ${String(t?.referencia ?? '')} está pausada desde ${dateTimeBR(String(p.pausado_em))}.`}>
											{motivoPausa(p.motivo, p.causa_sip)} O que fazer: resolva com a operadora, rode o Testar a rota completo e toque em Retomar.
										</Aviso>
									);
								})}
								{ficha && <FichaTecnica tronco={null} />}
								<div>
									<p className="mb-1 text-[13px] font-semibold text-[var(--base-texto)]">Caminho até as ligações reais</p>
									<div className="flex flex-wrap items-center gap-2 text-[13px]">
										{MODOS_VOZ.map(m => <Pilula key={m.id} tom={m.id === modo.id ? 'destaque' : 'neutro'}>{m.nome}</Pilula>)}
									</div>
									<p className="mt-1 text-[12.5px] text-[var(--base-texto-3)]">Na primeira vez da empresa, a equipe MotorCX confere e liga as ligações reais (até 1 dia útil). Depois disso, um tronco novo que passa no teste entra em uso pelo Admin, e a equipe é avisada.</p>
								</div>
							</div>
						)}
					</Cartao>

					{d && (
						<Cartao titulo="Antes de ligar de verdade" linha="O que a tela consegue conferir. Horários por UF e o corte de chamadas curtas ficam em Discagem.">
							<ul className="grid gap-2 sm:grid-cols-2">
								{check.map(c => <li key={c.txt} className="flex items-center gap-2 text-[13px]"><Pilula tom={c.ok ? 'ok' : 'atencao'}>{c.ok ? '✓' : 'falta'}</Pilula>{c.txt}</li>)}
							</ul>
						</Cartao>
					)}

					<Cartao titulo="Troncos da sua operadora" linha="Cada tronco é uma conexão com a operadora. Um tronco com erro não para os outros."
						direita={pode ? <BotaoLink pequeno to="/voz/telefonia/tronco/novo">Adicionar tronco</BotaoLink> : undefined}>
						{!d ? <p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p>
							: d.troncos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhum tronco ainda. {pode ? 'Toque em Adicionar tronco: são seis passos.' : ''}</p>
								: <TabelaRolavel minW={620}>
									<thead><tr><th className={thCls}>Tronco</th><th className={thCls}>Como autentica</th><th className={thCls}>Bina</th><th className={thCls}>Último teste</th><th className={thCls}>Situação</th><th className={thCls} /></tr></thead>
									<tbody>
										{d.troncos.map(t => {
											const s = situacaoTroncoCliente(t, !!pausaDo(t.id));
											return (
												<tr key={String(t.id)}>
													<td className={tdCls}><b className="font-mono">{String(t.referencia)}</b><br /><span className="text-[12px] text-[var(--base-texto-3)]">{String(t.operadora)}</span></td>
													<td className={tdCls}>{t.autenticacao === 'senha' ? <>Usuário e senha<br /><span className="text-[12px] text-[var(--base-texto-3)]">{t.segredo_no_cofre ? `senha guardada em ${dateTimeBR(String(t.segredo_guardado_em))}` : 'senha ainda não guardada'}</span></> : 'Por IP'}</td>
													<td className={tdCls}><span className="tnum">{binaMascara(t.bina)}</span><br /><span className="text-[12px] text-[var(--base-texto-3)]">{t.autenticacao_operadora === 'sim' ? 'autenticada' : t.autenticacao_operadora === 'nao' ? 'não autenticada' : 'autenticação: não sei'}</span></td>
													<td className={tdCls}>{t.testado_em ? `${dateTimeBR(String(t.testado_em))} ${t.teste_ok ? '✓' : '✕'}` : '—'}</td>
													<td className={tdCls}><Pilula tom={s.tom}>{s.txt}</Pilula></td>
													<td className={tdCls}><BotaoLink pequeno to={`/voz/telefonia/tronco/${encodeURIComponent(String(t.referencia))}`}>Abrir</BotaoLink></td>
												</tr>
											);
										})}
									</tbody>
								</TabelaRolavel>}
					</Cartao>

					<Cartao titulo="Rotas por tipo de número" linha="Qual tronco liga para cada tipo de número. Se a 1ª cair, a 2ª assume."
						direita={pode && (d?.troncos.length ?? 0) > 0 ? <Botao tipo="secundario" pequeno onClick={() => setGaveta('rota')}>Nova rota</Botao> : undefined}>
						{!d || d.rotas.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhuma rota ainda. O tronco novo já cria as rotas pelo "liga para".</p> : (
							<TabelaRolavel minW={640}>
								<thead><tr><th className={thCls}>Tipo de número</th><th className={thCls}>Tronco</th><th className={thCls}>Prioridade</th><th className={thCls}>Prefixo</th><th className={thCls}>Cadência</th><th className={thCls}>Situação</th></tr></thead>
								<tbody>
									{d.rotas.filter(r => !r.vigente_ate || String(r.vigente_ate) >= hoje).map(r => {
										const t = d.troncos.find(x => x.id === r.tronco_id);
										const pausa = pausaDo(r.tronco_id);
										const s = situacaoRota(r, hoje, !!pausa);
										return (
											<tr key={String(r.id)}>
												<td className={tdCls}>{TIPOS_ROTA[String(r.tipo)] ?? String(r.tipo)}</td>
												<td className={tdCls}><span className="font-mono">{String(t?.referencia ?? r.tronco_id)}</span></td>
												<td className={tdCls}>{String(r.prioridade)}ª{Number(r.prioridade) > 1 ? ' (reserva)' : ''}</td>
												<td className={tdCls}><span className="font-mono">{prefixoRota(r)}</span></td>
												<td className={tdCls}>{cadenciaTxt(r.cadencia_inicial_s, r.cadencia_incremento_s)}<br /><span className="text-[12px] text-[var(--base-texto-3)]">desde {String(r.vigente_desde).split('-').reverse().join('/')}</span></td>
												<td className={tdCls}>
													<Pilula tom={s.tom}>{s.txt}</Pilula>
													{pausa && <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">{motivoPausa(pausa.motivo, pausa.causa_sip)}</p>}
													{pode && (
														<div className="mt-1 flex flex-wrap gap-1.5">
															{pausa && <BotaoLink pequeno to={`/voz/telefonia/tronco/${encodeURIComponent(String(t?.referencia ?? ''))}`}>Testar a rota</BotaoLink>}
															{pausa && <Botao tipo="secundario" pequeno disabled={!(t?.teste_ok && t?.testado_em && String(t.testado_em) > String(pausa.pausado_em))} title="Retomar depois de um teste completo que passou" onClick={() => void retomar(pausa)}>Retomar</Botao>}
															{!pausa && s.txt === 'Em uso' && <Botao tipo="fantasma" pequeno onClick={() => void encerrar(r)}>Encerrar</Botao>}
														</div>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</TabelaRolavel>
						)}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Só saem números nacionais de 10 ou 11 dígitos. Emergência (190, 192, 193…), 0300/0500/0900, internacional e números curtos são bloqueados.</p>
					</Cartao>

					<div className="grid gap-4 lg:grid-cols-2">
						<Cartao titulo="Transferência para o seu operador" linha="Para onde o agente passa a chamada quando a pessoa pede um humano."
							direita={pode ? <Botao tipo="secundario" pequeno onClick={() => setGaveta('transferencia')}>Editar</Botao> : undefined}>
							{!d || d.transferencias.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhuma fila cadastrada.</p> : (
								<ul className="space-y-2">
									{d.transferencias.filter(x => x.ativo).map(x => (
										<li key={String(x.id)} className="text-[13px]">
											<span className="block font-semibold text-[var(--base-texto)]">{x.credor_id ? `Carteira ${String(x.credor_id)}` : 'Empresa toda'}</span>
											<span className="block break-all font-mono text-[12.5px] text-[var(--base-texto-2)]">{String(x.destino_sip)}</span>
											<span className="block text-[12.5px] text-[var(--base-texto-3)]">{x.metodo === 'ponte' ? 'O MotorCX segura a ligação e chama a fila (recomendado)' : 'Passa a chamada (REFER)'}</span>
										</li>
									))}
								</ul>
							)}
							<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Se ninguém atender, a pessoa volta ao agente, que pede desculpas e agenda um retorno. Nunca desligamos na cara.</p>
						</Cartao>
						<NumerosTeste empresaId={empresaId} numeros={d?.numeros ?? []} pode={pode} onMudou={(m) => { setMsg(m); void carregar(); }} onRemover={removerNumero} />
					</div>

					<Cartao titulo="Fica com a equipe MotorCX">
						<Pares itens={[
							['Ligações ao mesmo tempo', 'Sua parte no contrato da MotorCX (vale junto com os canais do seu tronco)'],
							['Provedor de voz', 'Montagem MotorCX ou ElevenLabs, escolhido pela equipe'],
							['IPs de saída do MotorCX', <span key="ip" className="font-mono">{IPS_SAIDA_MOTORCX.join(' · ')}</span>],
							['Gravação', d?.config ? `Aviso ${d.config.aviso_gravacao ? 'ligado' : 'desligado'} · retenção de ${String(d.config.retencao_dias ?? 90)} dias (altera em Empresa › Privacidade)` : '—'],
						]} />
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">A equipe MotorCX também pode alterar a sua telefonia (por exemplo, num chamado). Toda mudança e todo teste ficam na Auditoria da empresa.</p>
					</Cartao>
				</div>
			)}
			{gaveta === 'rota' && d && empresaId && <RotaGaveta empresaId={empresaId} troncos={d.troncos} rotas={d.rotas} onClose={() => setGaveta(null)} onSaved={m => { setGaveta(null); setMsg(m); void carregar(); }} />}
			{gaveta === 'transferencia' && d && empresaId && <TransferenciaGaveta empresaId={empresaId} atual={d.transferencias.find(x => x.ativo && !x.credor_id) ?? null} troncos={d.troncos} onClose={() => setGaveta(null)} onSaved={m => { setGaveta(null); setMsg(m); void carregar(); }} />}
		</>
	);
}

/** Rótulo e valor: empilhados no celular, lado a lado no computador (textos longos não se sobrepõem). */
export function Pares({ itens }: { itens: [string, ReactNode][] }) {
	return (
		<dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[220px_1fr]">
			{itens.map(([k, v]) => <div key={k} className="contents"><dt className="text-[var(--base-texto-3)]">{k}</dt><dd className="mb-1 min-w-0 break-words text-[var(--base-texto)] sm:mb-0">{v}</dd></div>)}
		</dl>
	);
}

/** Mantido para quem importava a leitura antiga (PR T3). */
export const TelefoniaLeitura = Telefonia;

function NumerosTeste({ empresaId, numeros, pode, onMudou, onRemover }: { empresaId: number | null; numeros: Row[]; pode: boolean; onMudou: (m: string) => void; onRemover: (n: Row) => void }) {
	const [num, setNum] = useState('');
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState(false);
	async function adicionar() {
		const d = digitosNumeroTeste(num);
		if (!d) { setErro('Celular ou fixo com DDD (10 ou 11 dígitos).'); return; }
		if (!supabase || !empresaId) return;
		setBusy(true); setErro('');
		// SQL 114: o número vai direto para o cofre (Edge Function); o banco guarda só o hash e a máscara
		const { data, error } = await supabase.functions.invoke(FUNCAO_SEGREDO_TRONCO, { body: { empresa: empresaId, numero_teste: d } });
		setNum('');
		const msg = await erroDaFuncao(error, data);
		setBusy(false);
		if (msg) { setErro(msg); return; }
		onMudou('Número de teste guardado no cofre. Ele fica confirmado quando você digitar o código da tela no primeiro Testar a rota.');
	}
	return (
		<Cartao titulo="Números de teste" linha="Celulares da sua equipe, até 5. O número vai direto para o cofre de segredos (só o servidor de voz lê, na hora do teste); a tela mostra só o DDD e os 2 últimos dígitos. Cada um fica confirmado quando a pessoa digita, no Testar a rota, o código que aparece na tela.">
			{numeros.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhum número de teste.</p> : (
				<ul className="divide-y divide-[var(--base-borda)]">
					{numeros.map(n => (
						<li key={String(n.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
							<span className="tnum text-[13.5px]">{String(n.mascara)}</span>
							<span className="flex items-center gap-2">
								<Pilula tom={n.confirmado_em ? 'ok' : n.guardado_em ? 'neutro' : 'atencao'}>{n.confirmado_em ? 'Confirmado por código' : n.guardado_em ? 'Aguardando o código' : 'Não guardado: cadastre de novo'}</Pilula>
								{pode && <Botao tipo="fantasma" pequeno onClick={() => onRemover(n)}>Remover</Botao>}
							</span>
						</li>
					))}
				</ul>
			)}
			{pode && numeros.length < 5 && (
				<div className="mt-3 flex flex-wrap items-end gap-2">
					<div className="min-w-[200px] flex-1"><Campo rotulo="Adicionar número" erro={erro || undefined}>
						<input value={num} onChange={e => setNum(e.target.value)} inputMode="tel" autoComplete="off" placeholder="(11) 9xxxx-xxxx" className={campoCls} />
					</Campo></div>
					<button type="button" className={btnSec} disabled={busy || !num} onClick={() => void adicionar()}>{busy ? 'Salvando...' : 'Adicionar'}</button>
				</div>
			)}
		</Cartao>
	);
}

function RotaGaveta({ empresaId, troncos, rotas, onClose, onSaved }: { empresaId: number; troncos: Row[]; rotas: Row[]; onClose: () => void; onSaved: (m: string) => void }) {
	const [tronco, setTronco] = useState(String(troncos[0]?.id ?? ''));
	const t = troncos.find(x => String(x.id) === tronco);
	const [tipo, setTipo] = useState('fixo_local');
	const usadas = rotas.filter(r => r.tipo === tipo && !r.vigente_ate).map(r => Number(r.prioridade));
	const [prioridade, setPrioridade] = useState('');
	const [prefixo, setPrefixo] = useState(String(t?.tech_prefix ?? ''));
	const [ini, setIni] = useState('30');
	const [inc, setInc] = useState('6');
	const [preco, setPreco] = useState('');
	const [desde, setDesde] = useState(today());
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState(false);
	const prio = Number(prioridade || (usadas.length ? Math.max(...usadas) + 1 : 1));
	const precoN = lerNumero(preco);
	async function salvar() {
		if (!prefixoOk(prefixo)) { setErro('Prefixo: de 1 a 8 dígitos, ou em branco.'); return; }
		if (!Number.isFinite(precoN) || precoN < 0) { setErro('Preço do minuto do contrato. Ex.: 0,055'); return; }
		if (!supabase) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('salvar_rota_voz', {
			empresa: empresaId, tronco: Number(tronco), tech_prefix: prefixo.trim(), tipo, prioridade: prio,
			cadencia_inicial_s: Number(ini), cadencia_incremento_s: Number(inc), preco_minuto: precoN, desde,
		});
		setBusy(false);
		if (error) { setErro(erroBanco(error)); return; }
		onSaved('Rota salva. Preço não se edita: uma vigência nova fecha a anterior.');
	}
	return (
		<Gaveta titulo="Nova rota" onClose={onClose} rodape={<><button className={btnSec} onClick={onClose}>Cancelar</button><button className={btnPrim} disabled={busy} onClick={() => void salvar()}>{busy ? 'Salvando...' : 'Salvar rota'}</button></>}>
			<Campo rotulo="Tipo de número"><select className={campoCls} value={tipo} onChange={e => setTipo(e.target.value)}>{Object.entries(TIPOS_ROTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
			<Campo rotulo="Tronco"><select className={campoCls} value={tronco} onChange={e => { setTronco(e.target.value); setPrefixo(String(troncos.find(x => String(x.id) === e.target.value)?.tech_prefix ?? '')); }}>{troncos.map(x => <option key={String(x.id)} value={String(x.id)}>{String(x.referencia)}{x.ativo ? '' : ' (ainda não está em uso)'}</option>)}</select></Campo>
			<div className="grid grid-cols-2 gap-3">
				<Campo rotulo="Prioridade" ajuda="1 liga primeiro; 2 é a reserva."><input className={campoCls} inputMode="numeric" value={prioridade} placeholder={String(prio)} onChange={e => setPrioridade(e.target.value.replace(/\D/g, '').slice(0, 1))} /></Campo>
				<Campo rotulo="Prefixo da operadora" ajuda="Em branco se a operadora não usa."><input className={`${campoCls} font-mono`} inputMode="numeric" value={prefixo} onChange={e => setPrefixo(e.target.value.replace(/\D/g, '').slice(0, 8))} /></Campo>
				<Campo rotulo="Primeiro bloco (s)"><input className={campoCls} inputMode="numeric" value={ini} onChange={e => setIni(e.target.value.replace(/\D/g, ''))} /></Campo>
				<Campo rotulo="Incremento (s)"><input className={campoCls} inputMode="numeric" value={inc} onChange={e => setInc(e.target.value.replace(/\D/g, ''))} /></Campo>
				<Campo rotulo="Preço do minuto" ajuda="Só para conferir a conta da operadora. Não entra na fatura do MotorCX."><input className={campoCls} inputMode="decimal" value={preco} placeholder="0,055" onChange={e => setPreco(e.target.value)} /></Campo>
				<Campo rotulo="Vale a partir de"><input className={campoCls} type="date" min={today()} value={desde} onChange={e => setDesde(e.target.value)} /></Campo>
			</div>
			{erro && <Aviso tom="erro">{erro}</Aviso>}
		</Gaveta>
	);
}

function TransferenciaGaveta({ empresaId, atual, troncos, onClose, onSaved }: { empresaId: number; atual: Row | null; troncos: Row[]; onClose: () => void; onSaved: (m: string) => void }) {
	const [nome, setNome] = useState(String(atual?.nome ?? 'Fila da empresa'));
	const [destino, setDestino] = useState(String(atual?.destino_sip ?? ''));
	const [metodo, setMetodo] = useState(String(atual?.metodo ?? 'ponte'));
	const [tronco, setTronco] = useState(String(atual?.tronco_id ?? troncos.find(t => t.ativo)?.id ?? troncos[0]?.id ?? ''));
	const ipsAntes = Array.isArray(atual?.ips_operadora) ? (atual!.ips_operadora as string[]).map(i => i.replace(/\/32$/, '')) : [];
	const [ips, setIps] = useState(ipsAntes.join('\n'));
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState(false);
	async function salvar() {
		if (nome.trim().length < 2) { setErro('Dê um nome à fila.'); return; }
		if (!RE_DESTINO_SIP.test(destino.trim())) { setErro('Endereço SIP da fila do seu discador: sip:fila@pabx.suaempresa.com.br'); return; }
		const lista = lerIps(ips);
		const m = lista.length ? ipsMotivo(lista) : null;
		if (m) { setErro(m); return; }
		if (metodo === 'ponte' && !tronco) { setErro('A ponte sai pelo tronco: cadastre um tronco antes.'); return; }
		if (!supabase) return;
		setBusy(true); setErro('');
		const { data: id, error } = await supabase.rpc('salvar_transferencia_voz', {
			empresa: empresaId, nome: nome.trim(), destino_sip: destino.trim(), metodo, tronco: metodo === 'ponte' ? Number(tronco) : null,
			transferencia: atual ? Number(atual.id) : null,
		});
		if (error) { setBusy(false); setErro(erroBanco(error)); return; }
		if (lista.join(',') !== ipsAntes.join(',') && id != null) {
			const { error: e2 } = await supabase.rpc('definir_ips_voz', { tipo: 'transferencia', id: Number(id), ips: lista });
			if (e2) { setBusy(false); setErro(`A fila foi salva, mas os IPs não: ${erroBanco(e2)}`); return; }
		}
		setBusy(false);
		onSaved('Transferência salva. IPs novos do PABX esperam a liberação da equipe MotorCX no firewall.');
	}
	return (
		<Gaveta titulo="Transferência para o seu operador" onClose={onClose} rodape={<><button className={btnSec} onClick={onClose}>Cancelar</button><button className={btnPrim} disabled={busy} onClick={() => void salvar()}>{busy ? 'Salvando...' : 'Salvar'}</button></>}>
			<Campo rotulo="Nome"><input className={campoCls} value={nome} onChange={e => setNome(e.target.value)} /></Campo>
			<Campo rotulo="Destino" ajuda="Endereço SIP da fila do seu discador (sip:fila@pabx…)."><input className={`${campoCls} font-mono`} value={destino} onChange={e => setDestino(e.target.value)} placeholder="sip:fila@pabx.suaempresa.com.br" /></Campo>
			<Campo rotulo="IPs do seu PABX/discador" ajuda="Para o firewall do MotorCX deixar o áudio passar. Um por linha (IPv4 público ou faixa até /24)."><textarea className={`${campoCls} h-20 py-2 font-mono`} value={ips} onChange={e => setIps(e.target.value)} /></Campo>
			<Campo rotulo="Como passa">
				<select className={campoCls} value={metodo} onChange={e => setMetodo(e.target.value)}>
					<option value="ponte">O MotorCX segura a ligação e chama a sua fila (recomendado)</option>
					<option value="refer">Passa a chamada (REFER): só se a sua operadora confirmar que aceita</option>
				</select>
			</Campo>
			{metodo === 'ponte' && <Campo rotulo="Sai pelo tronco"><select className={campoCls} value={tronco} onChange={e => setTronco(e.target.value)}>{troncos.map(t => <option key={String(t.id)} value={String(t.id)}>{String(t.referencia)}</option>)}</select></Campo>}
			<p className="text-[12px] text-[var(--base-texto-3)]">Vão junto só o id da chamada, o id da ação, a ação e o motivo. Nunca CPF, nome ou valor.</p>
			{erro && <Aviso tom="erro">{erro}</Aviso>}
		</Gaveta>
	);
}
