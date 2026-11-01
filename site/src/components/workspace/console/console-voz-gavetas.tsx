// Gavetas do Console › Fornecedores e rotas › Agente virtual: tronco SIP, rota com vigência e transferência
// para o discador do cliente. Só a equipe com gerenciar_troncos_voz abre. A senha do tronco nunca é digitada
// aqui: a equipe grava no cofre e o formulário guarda só a referência (segredo_ref).
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase, friendlyError, today, type Row } from '@/lib/supabase';
import {
	CODECS, FORMATOS_DISCAGEM, IPS_SAIDA_MOTORCX, RE_BINA, RE_CSP, RE_DDD, RE_DESTINO_SIP, RE_HOST, RE_IP, RE_REFERENCIA,
	RE_TECH, RE_USUARIO, TIPOS_ROTA, TRANSPORTES, cadenciaTxt, lerNumero, reais, segundosTarifados, hashNumeroTeste,
	segredoTroncoOk,
} from '@/lib/voz';
import { Aviso, Campo, Dialogo, Gaveta, Trava, btnPrim, btnSec, campoCls } from '@/components/comuns/voz-ui';

function erroDoBanco(e: unknown): string {
	// As funções do SQL 56 já falam português ("o formato 0 + CSP ... precisa do CSP"); mostramos a frase do banco
	// quando ela vem de raise exception (P0001). O resto vira a mensagem genérica do site.
	const x = e as { code?: string; message?: string } | null;
	if (x?.code === 'P0001' && x.message) return x.message.charAt(0).toUpperCase() + x.message.slice(1) + '.';
	return friendlyError(e);
}

// ============================================================== tronco
export function TroncoGaveta({ empresaId, empresaNome, tronco, onClose, onSaved }: {
	empresaId: string; empresaNome: string; tronco: Row | null; onClose: () => void; onSaved: (msg: string) => void;
}) {
	const novo = !tronco;
	const [referencia, setReferencia] = useState(String(tronco?.referencia ?? ''));
	const [operadora, setOperadora] = useState(String(tronco?.operadora ?? ''));
	const [host, setHost] = useState(String(tronco?.host ?? ''));
	const [porta, setPorta] = useState(String(tronco?.porta ?? 5060));
	const [transporte, setTransporte] = useState(String(tronco?.transporte ?? 'udp'));
	const [autenticacao, setAutenticacao] = useState(String(tronco?.autenticacao ?? 'ip'));
	const [usuario, setUsuario] = useState(String(tronco?.usuario ?? ''));
	const [segredo, setSegredo] = useState(String(tronco?.segredo_ref ?? ''));
	const [canais, setCanais] = useState(String(tronco?.canais ?? ''));
	const [cps, setCps] = useState(String(tronco?.cps ?? 10));
	const [bina, setBina] = useState('');
	const [ddd, setDdd] = useState(String(tronco?.ddd_origem ?? ''));
	const [formato, setFormato] = useState(String(tronco?.formato_discagem ?? 'tech_ddd_numero'));
	const [csp, setCsp] = useState(String(tronco?.csp ?? ''));
	const [codecs, setCodecs] = useState<string[]>(Array.isArray(tronco?.codecs) ? (tronco!.codecs as string[]) : ['alaw', 'ulaw']);
	const [ativo, setAtivo] = useState(tronco ? tronco.ativo !== false : true);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [tentou, setTentou] = useState(false);

	const binaDig = bina.replace(/\D/g, '');
	// Editando: a bina já cadastrada não volta para a tela; em branco, mantém a atual.
	const binaFinal = binaDig || (tronco ? String(tronco.bina ?? '') : '');
	const e: Record<string, string> = {};
	if (!RE_REFERENCIA.test(referencia.trim().toLowerCase())) e.referencia = 'Letras minúsculas, números, - e _ (2 a 40). Ex.: trk-aurora-01';
	if (operadora.trim().length < 2 || operadora.trim().length > 60) e.operadora = 'Nome da operadora (2 a 60 letras).';
	if (!(RE_IP.test(host.trim()) || RE_HOST.test(host.trim()))) e.host = 'IP (198.51.100.20) ou host (sip.operadora.com.br).';
	const portaN = Number(porta); if (!Number.isInteger(portaN) || portaN < 1 || portaN > 65535) e.porta = 'De 1 a 65535.';
	if (autenticacao === 'senha') {
		if (!RE_USUARIO.test(usuario.trim())) e.usuario = 'Usuário SIP do contrato.';
		if (!segredoTroncoOk(segredo, tronco?.segredo_ref == null ? null : String(tronco.segredo_ref))) e.segredo = 'Nome do segredo no cofre, começando com voz/. Ex.: voz/trunk/aurora-opb';
	}
	const canaisN = Number(canais); if (!Number.isInteger(canaisN) || canaisN < 1 || canaisN > 10000) e.canais = 'De 1 a 10.000.';
	const cpsN = Number(cps); if (!Number.isInteger(cpsN) || cpsN < 1 || cpsN > 1000) e.cps = 'De 1 a 1.000.';
	if (!RE_BINA.test(binaFinal)) e.bina = 'DDD + número da empresa (10 ou 11 dígitos), 0800/0300 ou 4004.';
	if (!RE_DDD.test(ddd.trim())) e.ddd = 'Dois dígitos. Ex.: 11';
	if (formato === 'tech_0_csp_ddd_numero' && !RE_CSP.test(csp.trim())) e.csp = 'O formato com CSP precisa do código da prestadora (2 dígitos).';
	else if (csp.trim() && !RE_CSP.test(csp.trim())) e.csp = 'Use 2 dígitos.';
	if (codecs.length === 0) e.codecs = 'Escolha ao menos um codec.';
	const ok = Object.keys(e).length === 0;
	const err = (k: string) => (tentou ? e[k] : undefined);

	async function salvar() {
		setTentou(true);
		if (!ok || !supabase) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('cadastrar_tronco_voz', {
			empresa: Number(empresaId), referencia: referencia.trim().toLowerCase(), operadora: operadora.trim(), host: host.trim(),
			canais: canaisN, autenticacao, ddd_origem: ddd.trim(), bina: binaFinal,
			segredo_ref: autenticacao === 'senha' ? segredo.trim() : null, usuario: autenticacao === 'senha' ? usuario.trim() : null,
			porta: portaN, transporte, cps: cpsN, codecs, formato_discagem: formato, ativo, csp: csp.trim() || null,
		});
		setBusy(false);
		if (error) { setErro(erroDoBanco(error)); return; }
		onSaved(novo ? 'Tronco cadastrado. O Asterisk faz a chamada de teste e a divisão da concorrência é refeita.' : 'Tronco atualizado. Se mudou a conexão, o teste roda de novo.');
	}

	return (
		<Gaveta titulo={novo ? `Novo tronco · ${empresaNome}` : `Editar tronco · ${String(tronco?.referencia)}`} onClose={onClose} largura={520}
			rodape={<>
				<button onClick={onClose} className={btnSec}>Cancelar</button>
				<button onClick={() => void salvar()} disabled={busy} className={btnPrim}>{busy ? 'Salvando...' : novo ? 'Testar e cadastrar' : 'Salvar'}</button>
			</>}>
			<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">Os dados vêm do contrato da empresa com a operadora. A senha, quando houver, não é digitada aqui: a equipe grava no cofre (Secret Manager do MotorCX) e este formulário guarda só a referência.</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Referência" erro={err('referencia')} ajuda={novo ? undefined : 'A referência não muda depois de criada.'}>
					<input value={referencia} disabled={!novo} onChange={x => setReferencia(x.target.value.toLowerCase())} placeholder="trk-aurora-03" className={`${campoCls} font-mono`} />
				</Campo>
				<Campo rotulo="Operadora" erro={err('operadora')}>
					<input value={operadora} onChange={x => setOperadora(x.target.value)} placeholder="Operadora C" className={campoCls} />
				</Campo>
				<Campo rotulo="IP ou host" erro={err('host')}>
					<input value={host} onChange={x => setHost(x.target.value)} placeholder="198.51.100.40" className={`${campoCls} font-mono`} />
				</Campo>
				<div className="grid grid-cols-2 gap-3">
					<Campo rotulo="Porta" erro={err('porta')}>
						<input value={porta} inputMode="numeric" onChange={x => setPorta(x.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
					</Campo>
					<Campo rotulo="Transporte">
						<select value={transporte} onChange={x => setTransporte(x.target.value)} className={campoCls}>
							{TRANSPORTES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
						</select>
					</Campo>
				</div>
			</div>

			<Campo rotulo="Autenticação">
				<select value={autenticacao} onChange={x => setAutenticacao(x.target.value)} className={campoCls}>
					<option value="ip">Por IP (a operadora libera os IPs do MotorCX)</option>
					<option value="senha">Usuário e senha (senha no cofre)</option>
				</select>
			</Campo>
			{autenticacao === 'ip' ? (
				<Trava icone={<KeyRound size={16} />} titulo={<>A operadora libera os IPs de saída do MotorCX: <span className="font-mono">{IPS_SAIDA_MOTORCX.join(' e ')}</span></>}>
					Nenhuma senha é guardada para este tronco.
				</Trava>
			) : (
				<div className="grid gap-3 sm:grid-cols-2">
					<Campo rotulo="Usuário SIP" erro={err('usuario')}>
						<input value={usuario} onChange={x => setUsuario(x.target.value)} autoComplete="off" className={`${campoCls} font-mono`} />
					</Campo>
					<Campo rotulo="Referência da senha no cofre" erro={err('segredo')} ajuda="Só o nome do segredo, começando com voz/ (no cofre vira motorcx-voz-…). A senha nunca passa por esta tela.">
						<input value={segredo} onChange={x => setSegredo(x.target.value)} placeholder="voz/trunk/aurora-opc" autoComplete="off" className={`${campoCls} font-mono`} />
					</Campo>
				</div>
			)}

			<div className="grid grid-cols-2 gap-3">
				<Campo rotulo="Canais" erro={err('canais')} ajuda="Ligações simultâneas do contrato.">
					<input value={canais} inputMode="numeric" onChange={x => setCanais(x.target.value.replace(/\D/g, ''))} placeholder="100" className={`${campoCls} tnum`} />
				</Campo>
				<Campo rotulo="Chamadas por segundo (CPS)" erro={err('cps')}>
					<input value={cps} inputMode="numeric" onChange={x => setCps(x.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
				</Campo>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Número exibido (bina)" erro={err('bina')} ajuda={tronco ? 'Em branco, mantém a bina atual. Precisa estar no Origem Verificada da operadora.' : 'Número da própria empresa. Precisa estar no Origem Verificada da operadora.'}>
					<input value={bina} inputMode="tel" autoComplete="off" onChange={x => setBina(x.target.value)} placeholder={tronco ? 'manter a atual' : '1130000000'} className={`${campoCls} tnum`} />
				</Campo>
				<Campo rotulo="DDD de origem" erro={err('ddd')} ajuda="Separa fixo local de LDN e móvel VC1 de VC2/VC3.">
					<input value={ddd} inputMode="numeric" maxLength={2} onChange={x => setDdd(x.target.value.replace(/\D/g, ''))} placeholder="11" className={`${campoCls} tnum`} />
				</Campo>
			</div>

			<div className="grid gap-3 sm:grid-cols-[1fr_120px]">
				<Campo rotulo="Formato de discagem" ajuda={`Ex.: ${FORMATOS_DISCAGEM.find(f => f.id === formato)?.exemplo ?? ''}`}>
					<select value={formato} onChange={x => setFormato(x.target.value)} className={campoCls}>
						{FORMATOS_DISCAGEM.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
					</select>
				</Campo>
				<Campo rotulo="CSP" erro={err('csp')} ajuda={formato === 'tech_0_csp_ddd_numero' ? 'Obrigatório neste formato.' : 'Opcional.'}>
					<input value={csp} inputMode="numeric" maxLength={2} onChange={x => setCsp(x.target.value.replace(/\D/g, ''))} placeholder="15" className={`${campoCls} tnum`} />
				</Campo>
			</div>

			<div>
				<span className="mb-1.5 block text-[13px] font-semibold text-[var(--base-texto)]">Codecs</span>
				<div className="flex flex-wrap gap-3">
					{CODECS.map(c => (
						<label key={c} className="flex items-center gap-1.5 text-[14px] text-[var(--base-texto)]">
							<input type="checkbox" checked={codecs.includes(c)} onChange={x => setCodecs(p => x.target.checked ? [...new Set([...p, c])] : p.filter(y => y !== c))} />
							<span className="font-mono text-[13px]">{c}</span>
						</label>
					))}
				</div>
				{err('codecs') && <p className="mt-1 text-[12px]" style={{ color: 'var(--estado-erro-texto)' }}>{err('codecs')}</p>}
			</div>

			<label className="flex items-center gap-2 text-[14px] text-[var(--base-texto)]">
				<input type="checkbox" checked={ativo} onChange={x => setAtivo(x.target.checked)} /> Tronco ativo
			</label>
			<p className="text-[12px] leading-relaxed text-[var(--base-texto-3)]">Ao salvar, o Asterisk confere o segredo no cofre, recarrega a configuração e faz uma chamada de teste. O item "Gestão de tronco SIP" entra na fatura do MotorCX no mês seguinte.</p>
			{erro && <Aviso tom="erro">{erro}</Aviso>}
		</Gaveta>
	);
}

// ============================================================== rota
export function RotaGaveta({ empresaId, troncos, rotaBase, prefixoSugerido, onClose, onSaved }: {
	empresaId: string; troncos: Row[]; rotaBase: Row | null; prefixoSugerido?: string; onClose: () => void; onSaved: (msg: string) => void;
}) {
	const ativos = troncos.filter(t => t.ativo !== false);
	const [tech, setTech] = useState(String(rotaBase?.tech_prefix ?? prefixoSugerido ?? ''));
	const [tipo, setTipo] = useState(String(rotaBase?.tipo ?? 'fixo_local'));
	const [tronco, setTronco] = useState(String(rotaBase?.tronco_id ?? ativos[0]?.id ?? ''));
	const [prioridade, setPrioridade] = useState(String(rotaBase?.prioridade ?? 1));
	const [ini, setIni] = useState(String(rotaBase?.cadencia_inicial_s ?? 30));
	const [inc, setInc] = useState(String(rotaBase?.cadencia_incremento_s ?? 6));
	const [preco, setPreco] = useState(rotaBase ? String(rotaBase.preco_minuto).replace('.', ',') : '');
	const [desde, setDesde] = useState(today());
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [tentou, setTentou] = useState(false);

	const iniN = Number(ini), incN = Number(inc), precoN = lerNumero(preco), prioN = Number(prioridade);
	const e: Record<string, string> = {};
	if (!RE_TECH.test(tech.trim())) e.tech = 'Só números (1 a 8 dígitos).';
	if (!tronco) e.tronco = 'Cadastre um tronco ativo antes.';
	if (!Number.isInteger(prioN) || prioN < 1 || prioN > 9) e.prioridade = 'De 1 a 9.';
	if (!Number.isInteger(iniN) || iniN < 1 || iniN > 600) e.ini = 'De 1 a 600 s.';
	if (!Number.isInteger(incN) || incN < 1 || incN > 600) e.inc = 'De 1 a 600 s.';
	if (!Number.isFinite(precoN) || precoN < 0 || precoN > 99999) e.preco = 'Preço do minuto do contrato. Ex.: 0,055';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) e.desde = 'Escolha a data.';
	const ok = Object.keys(e).length === 0;
	const err = (k: string) => (tentou ? e[k] : undefined);
	const ex47 = ok ? segundosTarifados(47, iniN, incN) : null;

	async function salvar() {
		setTentou(true);
		if (!ok || !supabase) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('salvar_rota_voz', {
			empresa: Number(empresaId), tronco: Number(tronco), tech_prefix: tech.trim(), tipo, prioridade: prioN,
			cadencia_inicial_s: iniN, cadencia_incremento_s: incN, preco_minuto: precoN, desde,
		});
		setBusy(false);
		if (error) { setErro(erroDoBanco(error)); return; }
		onSaved(rotaBase ? 'Nova vigência salva. A anterior foi encerrada no dia de antes e ficou no histórico.' : 'Rota cadastrada. As tentativas a partir da vigência passam a ter custo.');
	}

	return (
		<Gaveta titulo={rotaBase ? `Nova vigência · tech prefix ${String(rotaBase.tech_prefix)}` : 'Nova rota'} onClose={onClose}
			rodape={<>
				<button onClick={onClose} className={btnSec}>Cancelar</button>
				<button onClick={() => void salvar()} disabled={busy} className={btnPrim}>{busy ? 'Salvando...' : 'Salvar rota'}</button>
			</>}>
			<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">Use os dados do contrato da empresa com a operadora. Preço e cadência não se editam: se o tech prefix já existe, a vigência atual é encerrada no dia anterior e fica no histórico.</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Tech prefix" erro={err('tech')} ajuda="O prefixo que a operadora usa para escolher a tarifa.">
					<input value={tech} disabled={!!rotaBase} inputMode="numeric" maxLength={8} onChange={x => setTech(x.target.value.replace(/\D/g, ''))} className={`${campoCls} font-mono`} />
				</Campo>
				<Campo rotulo="Tipo de número">
					<select value={tipo} onChange={x => setTipo(x.target.value)} className={campoCls}>
						{Object.entries(TIPOS_ROTA).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
					</select>
				</Campo>
				<Campo rotulo="Tronco" erro={err('tronco')}>
					<select value={tronco} onChange={x => setTronco(x.target.value)} className={campoCls}>
						{ativos.length === 0 && <option value="">Nenhum tronco ativo</option>}
						{ativos.map(t => <option key={String(t.id)} value={String(t.id)}>{String(t.referencia)} · {String(t.operadora)}</option>)}
					</select>
				</Campo>
				<Campo rotulo="Prioridade" erro={err('prioridade')} ajuda="1ª sai primeiro; se falhar ou estiver cheia, sai pela 2ª.">
					<select value={prioridade} onChange={x => setPrioridade(x.target.value)} className={campoCls}>
						{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}ª</option>)}
					</select>
				</Campo>
				<Campo rotulo="Mínimo inicial (s)" erro={err('ini')}>
					<input value={ini} inputMode="numeric" onChange={x => setIni(x.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
				</Campo>
				<Campo rotulo="Incremento (s)" erro={err('inc')}>
					<input value={inc} inputMode="numeric" onChange={x => setInc(x.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
				</Campo>
				<Campo rotulo="Preço do minuto (R$)" erro={err('preco')}>
					<input value={preco} inputMode="decimal" onChange={x => setPreco(x.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,055" className={`${campoCls} tnum`} />
				</Campo>
				<Campo rotulo="Vale a partir de" erro={err('desde')}>
					<input type="date" value={desde} onChange={x => setDesde(x.target.value)} className={`${campoCls} tnum`} />
				</Campo>
			</div>
			{ex47 != null && (
				<p className="text-[12px] leading-relaxed text-[var(--base-texto-3)]">Sem carência: em {cadenciaTxt(iniN, incN)}, 47 s atendidos viram {ex47} s tarifados, 2 s viram {segundosTarifados(2, iniN, incN)} s e quem não atendeu não paga. Custo de 47 s: {reais(ex47 / 60 * precoN, 4)}. O preço não entra na fatura do MotorCX.</p>
			)}
			{erro && <Aviso tom="erro">{erro}</Aviso>}
		</Gaveta>
	);
}

// ============================================================== transferência
export function TransferenciaGaveta({ empresaId, troncos, atual, onClose, onSaved }: {
	empresaId: string; troncos: Row[]; atual: Row | null; onClose: () => void; onSaved: (msg: string) => void;
}) {
	const [nome, setNome] = useState(String(atual?.nome ?? 'Fila de negociação'));
	const [destino, setDestino] = useState(String(atual?.destino_sip ?? ''));
	const [metodo, setMetodo] = useState(String(atual?.metodo ?? 'refer'));
	const [tronco, setTronco] = useState(String(atual?.tronco_id ?? ''));
	const [tech, setTech] = useState(String(atual?.tech_prefix ?? ''));
	const [ativo, setAtivo] = useState(atual ? atual.ativo !== false : true);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [tentou, setTentou] = useState(false);

	const e: Record<string, string> = {};
	if (nome.trim().length < 2 || nome.trim().length > 60) e.nome = 'De 2 a 60 letras.';
	if (!RE_DESTINO_SIP.test(destino.trim())) e.destino = 'Ex.: sip:fila-negociacao@discador.empresa.com.br:5061';
	if (metodo === 'ponte' && !tronco) e.tronco = 'A ponte sai por um tronco da empresa.';
	if (tech.trim() && !RE_TECH.test(tech.trim())) e.tech = 'Só números (1 a 8 dígitos).';
	const ok = Object.keys(e).length === 0;
	const err = (k: string) => (tentou ? e[k] : undefined);

	async function salvar() {
		setTentou(true);
		if (!ok || !supabase) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('salvar_transferencia_voz', {
			empresa: Number(empresaId), nome: nome.trim(), destino_sip: destino.trim(), metodo,
			tronco: tronco ? Number(tronco) : null, tech_prefix: tech.trim() || null, credor: null, ativo,
			transferencia: atual?.id != null ? Number(atual.id) : null,
		});
		setBusy(false);
		if (error) { setErro(erroDoBanco(error)); return; }
		onSaved('Transferência salva. Se o destino mudou, o teste roda de novo.');
	}

	return (
		<Gaveta titulo={atual ? 'Editar transferência' : 'Configurar transferência'} onClose={onClose}
			rodape={<>
				<button onClick={onClose} className={btnSec}>Cancelar</button>
				<button onClick={() => void salvar()} disabled={busy} className={btnPrim}>{busy ? 'Salvando...' : 'Salvar'}</button>
			</>}>
			<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">Para onde o agente manda a chamada quando precisa de um operador. Vale para a empresa toda.</p>
			<Campo rotulo="Nome" erro={err('nome')}>
				<input value={nome} onChange={x => setNome(x.target.value)} className={campoCls} />
			</Campo>
			<Campo rotulo="Destino SIP" erro={err('destino')}>
				<input value={destino} onChange={x => setDestino(x.target.value)} placeholder="sip:fila@discador.empresa.com.br:5061" className={`${campoCls} font-mono`} />
			</Campo>
			<Campo rotulo="Como transferir">
				<select value={metodo} onChange={x => setMetodo(x.target.value)} className={campoCls}>
					<option value="refer">SIP REFER (o discador recebe a chamada)</option>
					<option value="ponte">Nova chamada pelo tronco e ponte (discador sem REFER)</option>
				</select>
			</Campo>
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Tronco" erro={err('tronco')} ajuda={metodo === 'refer' ? 'Opcional no REFER.' : undefined}>
					<select value={tronco} onChange={x => setTronco(x.target.value)} className={campoCls}>
						<option value="">{metodo === 'refer' ? 'Nenhum' : 'Escolha'}</option>
						{troncos.filter(t => t.ativo !== false).map(t => <option key={String(t.id)} value={String(t.id)}>{String(t.referencia)}</option>)}
					</select>
				</Campo>
				<Campo rotulo="Tech prefix" erro={err('tech')} ajuda="Opcional.">
					<input value={tech} inputMode="numeric" maxLength={8} onChange={x => setTech(x.target.value.replace(/\D/g, ''))} className={`${campoCls} font-mono`} />
				</Campo>
			</div>
			<Trava icone={<KeyRound size={16} />} titulo="Cabeçalhos enviados: ID da chamada, ID da ação, ação e motivo">
				Nunca vão CPF, nome, valor ou transcrição.
			</Trava>
			<label className="flex items-center gap-2 text-[14px] text-[var(--base-texto)]">
				<input type="checkbox" checked={ativo} onChange={x => setAtivo(x.target.checked)} /> Transferência ativa
			</label>
			{erro && <Aviso tom="erro">{erro}</Aviso>}
		</Gaveta>
	);
}

// ============================================================== números de teste
export function NumerosTesteDialogo({ empresaId, onClose, onSaved }: { empresaId: string; onClose: () => void; onSaved: (msg: string) => void }) {
	const [texto, setTexto] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	async function salvar() {
		if (!supabase) return;
		const linhas = texto.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
		if (linhas.length === 0 || linhas.length > 20) { setErro('Informe de 1 a 20 números.'); return; }
		setBusy(true); setErro('');
		const hashes: string[] = [];
		for (const l of linhas) {
			const h = await hashNumeroTeste(l);
			if (!h) { setBusy(false); setErro('Algum número está incompleto. Use DDD + número (10 ou 11 dígitos).'); return; }
			hashes.push(h);
		}
		const { error } = await supabase.rpc('configurar_voz_equipe', { empresa: Number(empresaId), ajustes: { numeros_teste_hash: [...new Set(hashes)] } });
		setBusy(false);
		setTexto('');
		if (error) { setErro(erroDoBanco(error)); return; }
		onSaved(`${new Set(hashes).size} número(s) de teste guardado(s), só o hash.`);
	}

	return (
		<Dialogo titulo="Trocar os números de teste" onClose={onClose}
			texto="Os números da equipe que recebem as ligações no modo Só números de teste. O navegador calcula o hash e só ele vai para o banco; o número não é guardado."
			acoes={<>
				<button onClick={onClose} disabled={busy} className={btnSec}>Cancelar</button>
				<button onClick={() => void salvar()} disabled={busy || !texto.trim()} className={btnPrim}>{busy ? 'Salvando...' : 'Trocar'}</button>
			</>}>
			<textarea value={texto} onChange={x => setTexto(x.target.value)} rows={4} autoComplete="off" placeholder="Um por linha, com DDD"
				className="w-full resize-none rounded-lg border border-[var(--base-field-border)] px-3 py-2 text-[14px] outline-none focus:border-[var(--destaque)]" />
			{erro && <Aviso tom="erro" className="mt-2">{erro}</Aviso>}
		</Dialogo>
	);
}
