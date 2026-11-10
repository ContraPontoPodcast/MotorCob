// Agente Voz/CX › Telefonia › tronco (SPEC Canais §3.4, seções E e F do parecer; SQL 113 e 114).
// /voz/telefonia/tronco/novo: os seis passos do assistente (o Avançado fica recolhido, com padrão). Ao salvar, o tronco
// nasce inativo e as rotas por tipo de número saem do "liga para". /voz/telefonia/tronco/:ref: o mesmo formulário, a
// senha no cofre (Edge Function segredo-tronco-voz: nunca volta para a tela), o "Testar a rota" ao vivo e o caminho para
// usar o tronco (usar_tronco_voz: na primeira vez da empresa a equipe MotorCX confere; depois, o Admin).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeading, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, Botao, Cartao, Detalhes, Pilula } from '@/components/ds';
import { Campo, TabelaRolavel, btnPrim, btnSec, campoCls, tdCls, thCls } from '@/components/comuns/voz-ui';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import {
	AUTENTICACAO_OPERADORA, CABECALHOS_BINA, CODECS, DTMFS, FORMATOS_DISCAGEM, FUNCAO_SEGREDO_TRONCO, IPS_SAIDA_MOTORCX, LIGA_PARA,
	PERM_VOZ, TRANSPORTES, binaMascara, lerIps, senhaTroncoMotivo,
} from '@/lib/voz';
import {
	ERROS_OPERADORA, LIMITE_TESTE_DIA, LIMITE_TESTE_HORA, PASSOS_TRONCO, SITUACAO_TESTE, formDoTronco,
	codigosTxt, instrucaoTeste, linhasTeste, motivoPausa, payloadTronco, sugerirReferencia, tomSaude, validarTronco,
	type FormTronco, type PassoTeste, type SaudeTronco,
} from '@/lib/telefonia';
import { erroDaFuncao } from '@/lib/funcoes';
import { supabase, dateTimeBR, today, type Row } from '@/lib/supabase';
import { FichaTecnica, Pares, erroBanco, situacaoTroncoCliente, useTelefonia } from './telefonia';

const ICONE: Record<string, string> = { ok: '✓', aviso: '!', falha: '✕', inconclusivo: '?', rodando: '…', nao_testado: '–', pulado: '–' };
const COR: Record<string, string> = { ok: 'var(--estado-ok-texto)', aviso: 'var(--estado-atencao-texto)', falha: 'var(--estado-erro-texto)', inconclusivo: 'var(--estado-atencao-texto)' };

export function TelefoniaTronco() {
	const { ref = 'novo' } = useParams();
	const novo = ref === 'novo';
	const nav = useNavigate();
	const { empresa } = useMotorAuth();
	const { agenteVoz } = useAreasLiberadas();
	const pode = usePermissao(PERM_VOZ.configurarTelefonia);
	const empresaId = empresa ? Number(empresa.id) : null;
	const { d, carregar } = useTelefonia(empresaId, agenteVoz);
	const tronco = useMemo(() => (novo ? null : d?.troncos.find(t => String(t.referencia) === ref) ?? null), [d, novo, ref]);
	const [f, setF] = useState<FormTronco>(formDoTronco(null));
	const [carregado, setCarregado] = useState(false);
	const [tentou, setTentou] = useState(false);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [msg, setMsg] = useState('');
	const [refManual, setRefManual] = useState(false);

	useEffect(() => {
		if (carregado || !d) return;
		if (tronco) setF(formDoTronco(tronco));
		setCarregado(true);
	}, [d, tronco, carregado]);

	const muda = <K extends keyof FormTronco>(k: K, v: FormTronco[K]) => setF(x => ({ ...x, [k]: v }));
	const { erros } = validarTronco(f, novo, String(tronco?.bina ?? ''));
	const err = (k: string) => (tentou ? erros[k] : undefined);
	const pausa = tronco ? d?.pausas.find(p => p.tronco_id === tronco.id && !p.retomado_em) ?? null : null;

	async function salvar() {
		setTentou(true);
		if (Object.keys(erros).length || !supabase || !empresaId) { setErro(Object.keys(erros).length ? 'Confira os campos marcados.' : ''); return; }
		setBusy(true); setErro(''); setMsg('');
		const { data: tid, error } = await supabase.rpc('salvar_tronco_voz', { empresa: empresaId, tronco: payloadTronco(f) });
		if (error || tid == null) { setBusy(false); setErro(erroBanco(error)); return; }
		const ips = lerIps(f.ips);
		const antes = Array.isArray(tronco?.ips_operadora) ? (tronco!.ips_operadora as string[]).map(i => i.replace(/\/32$/, '')) : [];
		if (ips.join(',') !== antes.join(',')) {
			const { error: e2 } = await supabase.rpc('definir_ips_voz', { tipo: 'tronco', id: Number(tid), ips });
			if (e2) { setBusy(false); setErro(`O tronco foi salvo, mas os IPs não: ${erroBanco(e2)}`); return; }
		}
		if (novo) {
			// "Este tronco liga para": cria as rotas por tipo de número (prioridade livre de cada tipo; preço a informar)
			const tipos = LIGA_PARA.find(l => l.id === f.liga_para)?.tipos ?? [];
			for (const tipo of tipos) {
				const usadas = (d?.rotas ?? []).filter(r => r.tipo === tipo && !r.vigente_ate).map(r => Number(r.prioridade));
				const prioridade = usadas.length ? Math.max(...usadas) + 1 : 1;
				if (prioridade > 9) continue;
				await supabase.rpc('salvar_rota_voz', {
					empresa: empresaId, tronco: Number(tid), tech_prefix: f.tech_prefix.trim(), tipo, prioridade,
					cadencia_inicial_s: 30, cadencia_incremento_s: 6, preco_minuto: 0, desde: today(),
				});
			}
		}
		setBusy(false);
		await carregar();
		if (novo) nav(`/voz/telefonia/tronco/${encodeURIComponent(f.referencia.trim().toLowerCase())}`, { replace: true });
		setMsg(novo
			? 'Tronco cadastrado (ainda sem ligar para clientes). Agora: guarde a senha (se for o caso), espere a equipe MotorCX liberar os IPs da operadora e rode o Testar a rota.'
			: 'Tronco salvo. Se mudou como ele conecta, o teste zera e ele sai de uso até passar de novo.');
		setCarregado(false);
	}

	if (!agenteVoz) return <><PageHeading title="Tronco" semControles /><Aviso tom="info">O agente de voz MotorCX não está contratado.</Aviso></>;
	if (d && !novo && !tronco) return <><PageHeading title="Tronco" semControles /><Aviso tom="erro">Tronco não encontrado.</Aviso></>;
	const so = !pode;
	const s = tronco ? situacaoTroncoCliente(tronco, !!pausa) : null;

	return (
		<>
			<PageHeading title={novo ? 'Adicionar tronco da sua operadora' : `Tronco ${ref}`} semControles
				description={novo ? 'Seis passos. O MotorCX confere cada um antes de salvar.' : `${String(tronco?.operadora ?? '')}`}
				titleExtra={s ? <Pilula tom={s.tom}>{s.txt}</Pilula> : undefined} />
			<div className="space-y-4">
				{so && <Aviso tom="info">Você vê o tronco, mas não altera. Quem altera é o Admin, com a verificação em duas etapas.</Aviso>}
				{msg && <Aviso tom="info">{msg}</Aviso>}
				{pausa && <Aviso tom="erro" titulo={`Rota pausada desde ${dateTimeBR(String(pausa.pausado_em))}.`}>{motivoPausa(pausa.motivo, pausa.causa_sip)} Depois de resolver, rode o Testar a rota completo e toque em Retomar em Telefonia.</Aviso>}

				<fieldset disabled={so || busy} className="space-y-4">
					<Cartao titulo={`1 · ${PASSOS_TRONCO[0]}`}>
						<div className="grid gap-3 sm:grid-cols-2">
							<Campo rotulo="Operadora" ajuda="Nome da operadora do contrato." erro={err('operadora')}>
								<input className={campoCls} value={f.operadora} onChange={e => { muda('operadora', e.target.value); if (novo && !refManual) muda('referencia', sugerirReferencia(e.target.value)); }} />
							</Campo>
							<Campo rotulo="Nome curto do tronco" ajuda="Aparece nas rotas e nos relatórios. Não muda depois." erro={err('referencia')}>
								<input className={`${campoCls} font-mono`} disabled={!novo} value={f.referencia} onChange={e => { setRefManual(true); muda('referencia', e.target.value.toLowerCase()); }} />
							</Campo>
							<Campo rotulo="Este tronco liga para" ajuda="Criamos as rotas por tipo de número para você.">
								<select className={campoCls} value={f.liga_para} onChange={e => muda('liga_para', e.target.value)}>{LIGA_PARA.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
							</Campo>
						</div>
					</Cartao>

					<Cartao titulo={`2 · ${PASSOS_TRONCO[1]}`}>
						<div className="space-y-3">
							<div className="flex flex-wrap gap-4 text-[14px]">
								<label className="flex items-center gap-2"><input type="radio" checked={f.autenticacao === 'ip'} onChange={() => muda('autenticacao', 'ip')} /> Por IP (recomendado)</label>
								<label className="flex items-center gap-2"><input type="radio" checked={f.autenticacao === 'senha'} onChange={() => muda('autenticacao', 'senha')} /> Usuário e senha</label>
								<label className="flex items-center gap-2 text-[var(--base-texto-3)]"><input type="radio" disabled /> Registro · em breve</label>
							</div>
							{f.autenticacao === 'ip'
								? <p className="text-[13px] text-[var(--base-texto-2)]">A operadora libera os IPs do MotorCX: <span className="font-mono">{IPS_SAIDA_MOTORCX.join(' e ')}</span>.</p>
								: <Campo rotulo="Usuário" ajuda="O usuário SIP que a operadora mandou (quando ela pede usuário e senha em cada ligação)." erro={err('usuario')}><input className={`${campoCls} font-mono`} value={f.usuario} onChange={e => muda('usuario', e.target.value)} autoComplete="off" /></Campo>}
							<Campo rotulo="IPs da operadora (sinalização e áudio)" ajuda="Peça à operadora a lista de IPs do equipamento SIP dela (SBC). Sem eles, o firewall do MotorCX barra o áudio de volta. Um por linha; a equipe MotorCX confere e libera." erro={err('ips')}>
								<textarea className={`${campoCls} h-20 py-2 font-mono`} value={f.ips} onChange={e => muda('ips', e.target.value)} />
							</Campo>
							{tronco && Array.isArray(tronco.ips_pendentes) && tronco.ips_pendentes.length > 0 && <p className="text-[12.5px]" style={{ color: 'var(--estado-atencao-texto)' }}>Esperando a liberação da equipe MotorCX: {(tronco.ips_pendentes as string[]).join(', ')}</p>}
							<Detalhes resumo="Avançado">
								<div className="grid gap-3 sm:grid-cols-2">
									<Campo rotulo="Domínio de autenticação (realm)" ajuda="Só se a operadora informar." erro={err('realm')}><input className={`${campoCls} font-mono`} value={f.realm} onChange={e => muda('realm', e.target.value)} /></Campo>
									<Campo rotulo='Número da conta no "De" (From)' ajuda="Algumas operadoras exigem. Se não souber, deixe em branco." erro={err('from_usuario')}><input className={`${campoCls} font-mono`} value={f.from_usuario} onChange={e => muda('from_usuario', e.target.value)} /></Campo>
								</div>
							</Detalhes>
						</div>
					</Cartao>
				</fieldset>
				{tronco && f.autenticacao === 'senha' && tronco.autenticacao === 'senha' && <SenhaNoCofre tronco={tronco} desabilitado={so} onGuardada={m => { setMsg(m); void carregar(); }} />}
				{novo && f.autenticacao === 'senha' && <p className="text-[12.5px] text-[var(--base-texto-3)]">A senha é guardada logo depois de salvar o tronco.</p>}

				<fieldset disabled={so || busy} className="space-y-4">
					<Cartao titulo={`3 · ${PASSOS_TRONCO[2]}`}>
						<div className="grid gap-3 sm:grid-cols-[1fr_140px]">
							<Campo rotulo="Endereço do tronco (host)" ajuda="Nome ou IP que a operadora passou. Endereço interno ou do MotorCX é recusado." erro={err('host')}><input className={`${campoCls} font-mono`} value={f.host} onChange={e => muda('host', e.target.value)} /></Campo>
							<Campo rotulo="Porta" ajuda="Quase sempre 5060." erro={err('porta')}><input className={`${campoCls} tnum`} inputMode="numeric" value={f.porta} onChange={e => muda('porta', e.target.value.replace(/\D/g, ''))} /></Campo>
						</div>
						<Detalhes resumo="Avançado">
							<div className="grid gap-3 sm:grid-cols-2">
								<Campo rotulo="Transporte" ajuda="UDP é o padrão das operadoras. TLS criptografa a sinalização."><select className={campoCls} value={f.transporte} onChange={e => muda('transporte', e.target.value)}>{TRANSPORTES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}</select></Campo>
								<Campo rotulo="Criptografar o áudio (SRTP)" ajuda="Em breve."><select className={campoCls} disabled><option>Não</option></select></Campo>
								<Campo rotulo="Envio das teclas (DTMF)" ajuda="'Automático' resolve quase sempre."><select className={campoCls} value={f.dtmf} onChange={e => muda('dtmf', e.target.value)}>{DTMFS.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></Campo>
								<label className="mt-6 flex items-center gap-2 text-[14px]"><input type="checkbox" checked={f.verificar_options} onChange={e => muda('verificar_options', e.target.checked)} /> Verificar a cada 60 s se a operadora está no ar</label>
							</div>
							<div className="mt-3">
								<p className="mb-1 text-[13px] font-semibold">Codecs (formato do áudio)</p>
								<div className="flex flex-wrap gap-3 text-[14px]">
									{CODECS.map(c => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={f.codecs.includes(c)} onChange={e => muda('codecs', e.target.checked ? [...f.codecs, c] : f.codecs.filter(x => x !== c))} />{c === 'alaw' ? 'G.711 A-law' : c === 'ulaw' ? 'G.711 μ-law' : c.toUpperCase()}</label>)}
								</div>
								{f.codecs.includes('g729') && <p className="mt-1 text-[12.5px]" style={{ color: 'var(--estado-atencao-texto)' }}>G.729 economiza banda, mas piora o entendimento do agente.</p>}
								{err('codecs') && <p className="mt-1 text-[12px]" style={{ color: 'var(--estado-erro-texto)' }}>{err('codecs')}</p>}
							</div>
						</Detalhes>
					</Cartao>

					<Cartao titulo={`4 · ${PASSOS_TRONCO[3]}`}>
						<div className="grid gap-3 sm:grid-cols-2">
							<Campo rotulo="Número exibido (bina)" ajuda={tronco ? `Hoje: ${binaMascara(tronco.bina)}. Um número da sua empresa, deste contrato. Nunca o número de um cliente.` : 'Um número da sua empresa, deste contrato. Nunca o número de um cliente.'} erro={err('bina')}>
								<input className={`${campoCls} tnum`} inputMode="tel" value={f.bina} onChange={e => muda('bina', e.target.value)} />
							</Campo>
							<Campo rotulo="A sua operadora autentica as suas ligações?" ajuda="Origem Verificada / STIR-SHAKEN.">
								<select className={campoCls} value={f.autenticacao_operadora} onChange={e => muda('autenticacao_operadora', e.target.value)}>{AUTENTICACAO_OPERADORA.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>
							</Campo>
							<Campo rotulo="Quem liga de volta para a bina cai em" ajuda="Precisa atender: URA ou equipe." erro={err('retorno_bina')}><input className={campoCls} value={f.retorno_bina} onChange={e => muda('retorno_bina', e.target.value)} /></Campo>
						</div>
						{f.autenticacao_operadora !== 'sim' && <Aviso tom="atencao">Ligações não autenticadas podem ser bloqueadas ou aparecer como suspeitas. Peça à operadora para ativar a Origem Verificada nesta bina (está na ficha técnica).</Aviso>}
						<div className="mt-3 space-y-2 text-[13.5px]">
							<label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.declaro} onChange={e => muda('declaro', e.target.checked)} />
								<span>Declaro que o contrato com a operadora está no CNPJ da minha empresa (ou do credor que nos autorizou) e que a bina é da minha empresa (ou do credor que autorizou), deste contrato ou portada para ele.</span></label>
							{tronco?.declaracao_em && !f.declaro && <p className="text-[12px] text-[var(--base-texto-3)]">Declarado em {dateTimeBR(String(tronco.declaracao_em))}. Trocar a bina pede a declaração de novo.</p>}
							{err('declaro') && <p className="text-[12px]" style={{ color: 'var(--estado-erro-texto)' }}>{err('declaro')}</p>}
						</div>
						<Detalhes resumo="Avançado">
							<div className="grid gap-3 sm:grid-cols-2">
								<Campo rotulo="DDD de origem" ajuda="Calculado da bina. Só mude se a operadora pedir." erro={err('ddd_origem')}><input className={campoCls} inputMode="numeric" value={f.ddd_origem} placeholder={f.bina.replace(/\D/g, '').slice(0, 2)} onChange={e => muda('ddd_origem', e.target.value.replace(/\D/g, '').slice(0, 2))} /></Campo>
								<Campo rotulo="Como a bina vai na ligação"><select className={campoCls} value={f.cabecalho_bina} onChange={e => muda('cabecalho_bina', e.target.value)}>{CABECALHOS_BINA.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
							</div>
						</Detalhes>
					</Cartao>

					<Cartao titulo={`5 · ${PASSOS_TRONCO[4]}`}>
						<div className="grid gap-3 sm:grid-cols-3">
							<Campo rotulo="Como a operadora quer o número" ajuda="Está no e-mail técnico da operadora."><select className={campoCls} value={f.formato_discagem} onChange={e => muda('formato_discagem', e.target.value)}>{FORMATOS_DISCAGEM.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></Campo>
							<Campo rotulo="CSP da operadora" ajuda="2 dígitos; só no formato com CSP." erro={err('csp')}><input className={campoCls} inputMode="numeric" value={f.csp} onChange={e => muda('csp', e.target.value.replace(/\D/g, '').slice(0, 2))} /></Campo>
							<Campo rotulo="Prefixo da operadora (tech prefix)" ajuda="Deixe em branco se a operadora não usa." erro={err('tech_prefix')}><input className={`${campoCls} font-mono`} inputMode="numeric" value={f.tech_prefix} onChange={e => muda('tech_prefix', e.target.value.replace(/\D/g, '').slice(0, 8))} /></Campo>
						</div>
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Exemplo do que enviamos: {f.tech_prefix}{FORMATOS_DISCAGEM.find(x => x.id === f.formato_discagem)?.exemplo.replace(/^1021 ?/, '')}. Só saem números nacionais; emergência, 0300/0500/0900, internacional e números curtos são bloqueados.</p>
					</Cartao>

					<Cartao titulo={`6 · ${PASSOS_TRONCO[5]}`}>
						<div className="grid gap-3 sm:grid-cols-2">
							<Campo rotulo="Ligações ao mesmo tempo (canais)" ajuda="Quantas ligações o contrato aguenta juntas." erro={err('canais')}><input className={`${campoCls} tnum`} inputMode="numeric" value={f.canais} onChange={e => muda('canais', e.target.value.replace(/\D/g, ''))} /></Campo>
							<Campo rotulo="Ligações novas por segundo (CPS)" ajuda="Na dúvida, 10. Acima do contratado a operadora pode bloquear." erro={err('cps')}><input className={`${campoCls} tnum`} inputMode="numeric" value={f.cps} onChange={e => muda('cps', e.target.value.replace(/\D/g, ''))} /></Campo>
						</div>
						<Detalhes resumo="Avançado">
							<div className="grid gap-3 sm:grid-cols-2">
								<Campo rotulo="Tempo máximo tocando (s)" ajuda="Mais de 30 s costuma cair na caixa postal." erro={err('toque_max_s')}><input className={`${campoCls} tnum`} inputMode="numeric" value={f.toque_max_s} onChange={e => muda('toque_max_s', e.target.value.replace(/\D/g, ''))} /></Campo>
								<Campo rotulo="Duração máxima da ligação (min)" ajuda="Proteção contra ligação pendurada." erro={err('duracao_max_min')}><input className={`${campoCls} tnum`} inputMode="numeric" value={f.duracao_max_min} onChange={e => muda('duracao_max_min', e.target.value.replace(/\D/g, ''))} /></Campo>
							</div>
						</Detalhes>
					</Cartao>
				</fieldset>

				{!so && (
					<div className="flex flex-wrap items-center gap-2">
						<button type="button" className={btnPrim} disabled={busy} onClick={() => void salvar()}>{busy ? 'Salvando...' : novo ? 'Salvar o tronco' : 'Salvar as mudanças'}</button>
						{erro && <span className="text-[13px]" style={{ color: 'var(--estado-erro-texto)' }}>{erro}</span>}
					</div>
				)}

				{tronco && <Saude tronco={tronco} />}
				{tronco && <TestarRota tronco={tronco} numeros={d?.numeros ?? []} pode={pode} onFim={() => void carregar()} />}
				{tronco && pode && <UsarTronco tronco={tronco} pausado={!!pausa} onMudou={m => { setMsg(m); void carregar(); }} />}

				<Detalhes solto resumo="Erros da operadora e o que fazer">
					<TabelaRolavel minW={560}>
						<thead><tr><th className={thCls}>Código</th><th className={thCls}>O que a tela diz</th><th className={thCls}>O que fazer</th></tr></thead>
						<tbody>{ERROS_OPERADORA.map(x => <tr key={x.codigo}><td className={tdCls}><span className="font-mono">{x.codigo}</span></td><td className={tdCls}>{x.diz}</td><td className={tdCls}>{x.acao}</td></tr>)}</tbody>
					</TabelaRolavel>
				</Detalhes>
				<Detalhes solto resumo="Ficha técnica para a operadora"><FichaTecnica tronco={tronco} /></Detalhes>
			</div>
		</>
	);
}

function SenhaNoCofre({ tronco, desabilitado, onGuardada }: { tronco: Row; desabilitado: boolean; onGuardada: (m: string) => void }) {
	const [senha, setSenha] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const motivo = senha ? senhaTroncoMotivo(senha) : null;
	async function guardar() {
		const m = senhaTroncoMotivo(senha);
		if (m) { setErro(m); return; }
		if (!supabase) return;
		setBusy(true); setErro('');
		const { data, error } = await supabase.functions.invoke(FUNCAO_SEGREDO_TRONCO, { body: { tronco: Number(tronco.id), senha } });
		setSenha('');
		const msg = await erroDaFuncao(error, data);
		setBusy(false);
		if (msg) { setErro(msg); return; }
		onGuardada('Senha guardada no cofre. O servidor de voz lê a senha nova em até 2 minutos; rode o Testar a rota de novo.');
	}
	return (
		<Cartao titulo={tronco.segredo_no_cofre ? `Senha guardada em ${dateTimeBR(String(tronco.segredo_guardado_em))}` : 'Senha do tronco'}
			linha="A senha vai direto para o cofre de segredos. Ninguém vê pela tela e ela não volta a aparecer. Só o servidor de voz do MotorCX lê a senha, na hora de ligar.">
			{!desabilitado && (
				<div className="flex flex-wrap items-end gap-2">
					<div className="min-w-[220px] flex-1"><Campo rotulo={tronco.segredo_no_cofre ? 'Trocar a senha' : 'Senha'} erro={motivo ?? erro ?? undefined}>
						<input type="password" className={`${campoCls} font-mono`} value={senha} onChange={e => setSenha(e.target.value)} autoComplete="new-password" spellCheck={false} maxLength={128} />
					</Campo></div>
					<button type="button" className={btnSec} disabled={busy || !senha || !!motivo} onClick={() => void guardar()}>{busy ? 'Guardando...' : 'Guardar a senha no cofre'}</button>
				</div>
			)}
		</Cartao>
	);
}

function TestarRota({ tronco, numeros, pode, onFim }: { tronco: Row; numeros: Row[]; pode: boolean; onFim: () => void }) {
	const [teste, setTeste] = useState<Row | null>(null);
	const guardados = numeros.filter(n => n.guardado_em);
	const [numero, setNumero] = useState('');
	const escolhido = numero || String(guardados.find(n => n.confirmado_em)?.id ?? guardados[0]?.id ?? '');
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState(false);
	const vivo = teste && (teste.situacao === 'pedido' || teste.situacao === 'rodando');

	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		const ler = async () => {
			const { data } = await supabase!.from('voz_testes_tronco_empresa').select('*').eq('tronco_id', tronco.id).order('pedido_em', { ascending: false }).limit(1).maybeSingle();
			if (!ativo) return;
			setTeste(antes => {
				const novo = (data ?? null) as Row | null;
				if (antes && (antes.situacao === 'pedido' || antes.situacao === 'rodando') && novo && novo.situacao !== antes.situacao && !['pedido', 'rodando'].includes(String(novo.situacao))) onFim();
				return novo;
			});
		};
		void ler();
		const t = setInterval(() => { void ler(); }, vivo ? 1500 : 15000);
		return () => { ativo = false; clearInterval(t); };
	}, [tronco.id, vivo, onFim]);

	async function pedir() {
		if (!escolhido) { setErro('Cadastre antes um número em Telefonia › Números de teste.'); return; }
		if (!supabase) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('pedir_teste_tronco_voz', { tronco: Number(tronco.id), numero_teste: Number(escolhido) });
		setBusy(false);
		if (error) { setErro(erroBanco(error)); return; }
		const { data } = await supabase.from('voz_testes_tronco_empresa').select('*').eq('tronco_id', tronco.id).order('pedido_em', { ascending: false }).limit(1).maybeSingle();
		setTeste((data ?? null) as Row | null);
	}
	async function bina(resposta: string) {
		if (!supabase || !teste) return;
		const { error } = await supabase.rpc('responder_bina_teste_voz', { teste: Number(teste.id), resposta });
		if (error) setErro(erroBanco(error));
	}
	async function cancelar() {
		if (!supabase || !teste) return;
		await supabase.rpc('cancelar_teste_tronco_voz', { teste: Number(teste.id) });
	}

	const passos = (Array.isArray(teste?.passos) ? teste!.passos : []) as PassoTeste[];
	const sit = teste ? SITUACAO_TESTE[String(teste.situacao)] : null;
	const instr = teste ? instrucaoTeste(passos, String(teste.situacao)) : null;
	const naBina = passos.some(p => p.passo === 4 && (p.resultado === 'ok' || p.resultado === 'aviso'))
		&& !passos.some(p => p.passo === 8 && p.resultado !== 'rodando');

	return (
		<Cartao titulo="Testar a rota" linha={`Liga de verdade para um número de teste (custa uma ligação comum, paga à sua operadora). Limite: ${LIMITE_TESTE_HORA} testes por hora neste tronco e ${LIMITE_TESTE_DIA} por dia na empresa.`}>
			<div className="space-y-3">
				{pode && !vivo && (
					<div className="flex flex-wrap items-end gap-2">
						<div className="min-w-[220px] flex-1"><Campo rotulo="Ligar para" ajuda={guardados.length ? undefined : 'Cadastre antes um número em Telefonia › Números de teste.'} erro={erro || undefined}>
							<select className={campoCls} value={escolhido} onChange={e => setNumero(e.target.value)} disabled={!guardados.length}>
								{guardados.map(n => <option key={String(n.id)} value={String(n.id)}>{String(n.mascara)} · {n.confirmado_em ? 'confirmado' : 'confirma neste teste'}</option>)}
							</select>
						</Campo></div>
						<button type="button" className={btnPrim} disabled={busy || !escolhido} onClick={() => void pedir()}>{busy ? 'Pedindo...' : teste ? 'Testar de novo' : 'Testar a rota'}</button>
					</div>
				)}
				{teste && sit && (
					<div className="rounded-lg bg-[var(--base-fill)] p-3">
						<div className="mb-2 flex flex-wrap items-center gap-2">
							<Pilula tom={sit.tom}>{sit.txt}</Pilula>
							<span className="text-[12.5px] text-[var(--base-texto-3)]">{String(teste.numero_mascara ?? '')} · {dateTimeBR(String(teste.pedido_em))}</span>
							{vivo && pode && <Botao tipo="fantasma" pequeno onClick={() => void cancelar()}>Cancelar</Botao>}
						</div>
						{instr && <p className="mb-2 text-[14px] font-semibold text-[var(--base-texto)]">{instr}</p>}
						{vivo && teste.codigo && <p className="mb-2 text-[13px]">Código para digitar no celular: <b className="font-mono text-[18px] tracking-[0.3em]">{String(teste.codigo)}</b></p>}
						{vivo && naBina && pode && (
							<div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
								<span>A bina apareceu certa ({binaMascara(tronco.bina)})?</span>
								<Botao tipo={teste.bina_resposta === 'certa' ? 'primario' : 'secundario'} pequeno onClick={() => void bina('certa')}>Sim</Botao>
								<Botao tipo={teste.bina_resposta === 'outro' ? 'primario' : 'secundario'} pequeno onClick={() => void bina('outro')}>Apareceu outro número</Botao>
								<Botao tipo={teste.bina_resposta === 'privado' ? 'primario' : 'secundario'} pequeno onClick={() => void bina('privado')}>Privado ou Desconhecido</Botao>
							</div>
						)}
						<ol className="space-y-1.5">
							{linhasTeste(passos).map(l => (
								<li key={l.n} className="flex gap-2 text-[13px]">
									<span className="w-4 shrink-0 text-center font-bold" style={{ color: COR[l.resultado] }}>{ICONE[l.resultado] ?? '–'}</span>
									<span><b>{l.n} · {l.titulo}{l.obrigatorio ? ' ★' : ''}</b><br /><span className={l.resultado === 'nao_testado' ? 'text-[var(--base-texto-3)]' : 'text-[var(--base-texto-2)]'}>{l.mensagem}</span></span>
								</li>
							))}
						</ol>
						{teste.resumo && <p className="mt-2 text-[13.5px] font-semibold text-[var(--base-texto)]">{String(teste.resumo)}</p>}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">★ obrigatório. O teste para no primeiro ✕ obrigatório. Mudar host, porta, transporte, autenticação, usuário, senha, bina, formato ou CSP zera o teste.</p>
					</div>
				)}
				{tronco.testado_em && <Pares itens={[['Último resultado gravado no tronco', `${dateTimeBR(String(tronco.testado_em))} · ${tronco.teste_ok ? 'passou' : 'não passou'}`]]} />}
			</div>
		</Cartao>
	);
}

function UsarTronco({ tronco, pausado, onMudou }: { tronco: Row; pausado: boolean; onMudou: (m: string) => void }) {
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	async function usar(ativo: boolean) {
		if (!supabase) return;
		setBusy(true); setErro('');
		const { data, error } = await supabase.rpc('usar_tronco_voz', { tronco: Number(tronco.id), ativo });
		setBusy(false);
		if (error) { setErro(erroBanco(error)); return; }
		onMudou(data === 'pedido_equipe' ? 'Primeira vez da empresa: a equipe MotorCX confere e põe o tronco em uso em até 1 dia útil. Já avisamos a equipe.'
			: data === 'ativo' ? 'Tronco em uso. A equipe MotorCX foi avisada.' : 'Tronco fora de uso. Nada liga por ele até você pôr em uso de novo.');
	}
	const pronto = tronco.teste_ok === true && Array.isArray(tronco.ips_pendentes) && tronco.ips_pendentes.length === 0 && !pausado;
	return (
		<Cartao titulo={tronco.ativo ? 'Este tronco está em uso' : 'Usar este tronco'} linha={tronco.ativo
			? 'O agente liga por ele, nos modos Só números de teste e Real da empresa.'
			: 'Precisa passar no Testar a rota e ter os IPs da operadora liberados pela equipe MotorCX. Na primeira vez da empresa, a equipe confere antes.'}>
			<div className="flex flex-wrap items-center gap-2">
				{tronco.ativo
					? <Botao tipo="secundario" pequeno disabled={busy} onClick={() => void usar(false)}>Tirar de uso</Botao>
					: <Botao tipo="primario" pequeno disabled={busy || !pronto} onClick={() => void usar(true)}>Usar este tronco</Botao>}
				{erro && <span className="text-[13px]" style={{ color: 'var(--estado-erro-texto)' }}>{erro}</span>}
			</div>
		</Cartao>
	);
}

/** Saúde do tronco nas últimas 24 h (SQL 115, G34): o que o disjuntor olha. */
function Saude({ tronco }: { tronco: Row }) {
	const [s, setS] = useState<SaudeTronco | null | undefined>(undefined);
	useEffect(() => {
		if (!supabase) return;
		let vivo = true;
		void supabase.rpc('saude_troncos_voz', { empresa: Number(tronco.empresa_id), horas: 24 }).then(({ data }) => {
			if (!vivo) return;
			const linhas = (Array.isArray(data) ? data : []) as (SaudeTronco & { tronco_id: number })[];
			setS(linhas.find(l => Number(l.tronco_id) === Number(tronco.id)) ?? null);
		});
		return () => { vivo = false; };
	}, [tronco.id, tronco.empresa_id]);
	if (s === undefined) return null;
	const tom = tomSaude(s);
	return (
		<Cartao titulo="Saúde do tronco (24 h)" linha="Um tronco com falhas técnicas seguidas sai sozinho (disjuntor) e os outros continuam ligando. Ele volta quando o Testar a rota passar."
			direita={<Pilula tom={tom}>{tom === 'neutro' ? 'Sem ligações' : tom === 'ok' ? 'Saudável' : tom === 'atencao' ? 'Atenção' : 'Com problema'}</Pilula>}>
			{!s ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhuma ligação por este tronco nas últimas 24 horas.</p> : (
				<Pares itens={[
					['Tentativas', `${s.tentativas} · ${s.atendidas} atendidas (${String(s.pct_atendidas ?? 0).replace('.', ',')}%)`],
					['Falhas técnicas da operadora', `${s.falhas_tecnicas} (${String(s.pct_falhas ?? 0).replace('.', ',')}%)`],
					['Duração média atendida', s.duracao_media_s != null ? `${Math.round(Number(s.duracao_media_s))} s` : '—'],
					['Códigos mais comuns', codigosTxt(s.codigos)],
				]} />
			)}
		</Cartao>
	);
}
