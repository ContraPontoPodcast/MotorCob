// Agente Voz/CX › Telefonia editável (SQL 113 e 114, SPEC Canais §3.4, seções E e F do parecer): o formulário do
// tronco (seis passos), o teste da rota, a ficha técnica para a operadora e os erros da operadora (D11). Só regras e
// textos, sem React: telefonia.test.tsx confere. O banco confere tudo de novo (salvar_tronco_voz, pedir_teste_tronco_voz).
// LGPD: o número de teste nunca vai ao banco nem volta inteiro para a tela: a tela manda o número uma vez, para a Edge
// Function segredo-tronco-voz, que o grava no cofre; o banco guarda só o hash e a máscara.
import {
	CPS_MAX, DURACAO_MAX, DURACAO_MIN, IPS_SAIDA_MOTORCX, RE_BINA, RE_CSP, RE_DDD, RE_HOST, RE_IP, RE_REALM, RE_REFERENCIA,
	RE_USUARIO, TOQUE_MAX, TOQUE_MIN, ipsMotivo, lerIps, prefixoOk,
} from '@/lib/voz';

export type FormTronco = {
	referencia: string; operadora: string; liga_para: string; declaro: boolean;
	autenticacao: string; usuario: string; realm: string; from_usuario: string; ips: string;
	host: string; porta: string; transporte: string; codecs: string[]; dtmf: string; verificar_options: boolean;
	bina: string; autenticacao_operadora: string; retorno_bina: string; ddd_origem: string; cabecalho_bina: string;
	formato_discagem: string; csp: string; tech_prefix: string;
	canais: string; cps: string; toque_max_s: string; duracao_max_min: string;
};

export const PASSOS_TRONCO = ['Operadora', 'Como a operadora reconhece o MotorCX', 'Endereço do tronco',
	'Número que aparece para o cliente (bina)', 'Formato do número', 'Capacidade'] as const;

/** Sugestão do nome curto a partir da operadora ("Operadora Alfa" → "operadora-alfa-1"). */
export function sugerirReferencia(operadora: string): string {
	const base = operadora.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '').slice(0, 30);
	return base.length >= 1 ? `${base}-1` : '';
}

/** Formulário a partir do tronco lido (views voz_troncos_empresa + voz_troncos_campos_empresa). */
export function formDoTronco(t: Record<string, unknown> | null): FormTronco {
	const s = (k: string, p = '') => (t && t[k] != null ? String(t[k]) : p);
	const ips = t && Array.isArray(t.ips_operadora) ? (t.ips_operadora as string[]) : [];
	return {
		referencia: s('referencia'), operadora: s('operadora'), liga_para: s('liga_para', 'fixo_movel'), declaro: false,
		autenticacao: s('autenticacao', 'ip'), usuario: s('usuario'), realm: s('realm'), from_usuario: s('from_usuario'),
		ips: ips.map(i => i.replace(/\/32$/, '')).join('\n'),
		host: s('host'), porta: s('porta', '5060'), transporte: s('transporte', 'udp'),
		codecs: t && Array.isArray(t.codecs) ? (t.codecs as string[]) : ['alaw', 'ulaw'], dtmf: s('dtmf', 'auto'),
		verificar_options: t ? t.verificar_options !== false : true,
		bina: s('bina'), autenticacao_operadora: s('autenticacao_operadora', 'nao_sei'), retorno_bina: s('retorno_bina'),
		ddd_origem: s('ddd_origem'), cabecalho_bina: s('cabecalho_bina', 'from_pai'),
		formato_discagem: s('formato_discagem', 'tech_ddd_numero'), csp: s('csp'), tech_prefix: s('tech_prefix'),
		canais: s('canais'), cps: s('cps', '10'), toque_max_s: s('toque_max_s', '30'), duracao_max_min: s('duracao_max_min', '20'),
	};
}

const PRIVADO = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^2(2[4-9]|[3-5]\d)\./];

/** Erros por campo e por passo (0 a 5). `novo`: tronco novo (declaração obrigatória). `binaAntes`: a bina gravada. */
export function validarTronco(f: FormTronco, novo: boolean, binaAntes = ''): { erros: Record<string, string>; passo: Record<string, number> } {
	const e: Record<string, string> = {};
	const passo: Record<string, number> = {};
	const marca = (k: string, p: number, msg: string) => { e[k] = msg; passo[k] = p; };
	if (f.operadora.trim().length < 2 || f.operadora.trim().length > 60) marca('operadora', 0, 'Nome da operadora (2 a 60 letras).');
	if (!RE_REFERENCIA.test(f.referencia.trim().toLowerCase())) marca('referencia', 0, 'Letras minúsculas, números, - e _ (2 a 40). Ex.: alfa-sp-1');
	const bina = f.bina.replace(/\D/g, '');
	if ((novo || bina !== binaAntes) && !f.declaro) marca('declaro', novo ? 0 : 3, 'Marque as declarações do contrato e da bina.');
	if (f.autenticacao === 'senha' && !RE_USUARIO.test(f.usuario.trim())) marca('usuario', 1, 'O usuário SIP que a operadora mandou.');
	if (f.realm.trim() && !RE_REALM.test(f.realm.trim())) marca('realm', 1, 'Nome de host. Ex.: sip.operadora.com.br');
	if (f.from_usuario.trim() && !RE_USUARIO.test(f.from_usuario.trim())) marca('from_usuario', 1, 'Só dígitos ou o usuário.');
	const ips = lerIps(f.ips);
	const mIps = ips.length === 0 ? 'Informe ao menos um IP da operadora (sinalização e áudio).' : ipsMotivo(ips);
	if (mIps) marca('ips', 1, mIps);
	const host = f.host.trim();
	if (!(RE_IP.test(host) || RE_HOST.test(host))) marca('host', 2, 'IP ou nome que a operadora passou. Ex.: sip.operadora.com.br');
	else if (RE_IP.test(host) && PRIVADO.some(r => r.test(host))) marca('host', 2, 'Endereço interno ou reservado: use o endereço público da operadora.');
	else if ((IPS_SAIDA_MOTORCX as readonly string[]).includes(host)) marca('host', 2, 'Esse é um IP do próprio MotorCX.');
	const porta = Number(f.porta);
	if (!Number.isInteger(porta) || !((porta >= 1024 && porta <= 65535) || porta === 5060 || porta === 5061)) marca('porta', 2, 'Quase sempre 5060 (de 1024 a 65535).');
	if (f.codecs.length === 0) marca('codecs', 2, 'Escolha ao menos um formato de áudio.');
	if (!RE_BINA.test(bina)) marca('bina', 3, 'DDD + número da empresa (10 ou 11 dígitos), 0800 ou 4004/3003.');
	if (f.ddd_origem.trim() && !RE_DDD.test(f.ddd_origem.trim())) marca('ddd_origem', 3, 'Dois dígitos. Ex.: 11');
	if (!f.ddd_origem.trim() && !/^[1-9][1-9]/.test(bina)) marca('ddd_origem', 3, 'Informe o DDD de origem (a bina não tem DDD).');
	if (f.retorno_bina.trim() && (f.retorno_bina.trim().length < 2 || f.retorno_bina.trim().length > 80)) marca('retorno_bina', 3, 'Texto curto (até 80 letras).');
	if (f.formato_discagem === 'tech_0_csp_ddd_numero' && !RE_CSP.test(f.csp.trim())) marca('csp', 4, 'O formato com CSP precisa do código de 2 dígitos.');
	else if (f.csp.trim() && !RE_CSP.test(f.csp.trim())) marca('csp', 4, 'Use 2 dígitos.');
	if (!prefixoOk(f.tech_prefix)) marca('tech_prefix', 4, 'De 1 a 8 dígitos, ou em branco se a operadora não usa.');
	const canais = Number(f.canais);
	if (!Number.isInteger(canais) || canais < 1 || canais > 10000) marca('canais', 5, 'De 1 a 10.000.');
	const cps = Number(f.cps);
	if (!Number.isInteger(cps) || cps < 1 || cps > CPS_MAX) marca('cps', 5, 'De 1 a 500. Na dúvida, 10.');
	const toque = Number(f.toque_max_s);
	if (!Number.isInteger(toque) || toque < TOQUE_MIN || toque > TOQUE_MAX) marca('toque_max_s', 5, `De ${TOQUE_MIN} a ${TOQUE_MAX} s.`);
	const dur = Number(f.duracao_max_min);
	if (!Number.isInteger(dur) || dur < DURACAO_MIN || dur > DURACAO_MAX) marca('duracao_max_min', 5, `De ${DURACAO_MIN} a ${DURACAO_MAX} min.`);
	return { erros: e, passo };
}

/** Objeto de salvar_tronco_voz (SQL 113). A senha nunca vai aqui: vai pela Edge Function segredo-tronco-voz. */
export function payloadTronco(f: FormTronco): Record<string, unknown> {
	const bina = f.bina.replace(/\D/g, '');
	return {
		referencia: f.referencia.trim().toLowerCase(), operadora: f.operadora.trim(), liga_para: f.liga_para,
		autenticacao: f.autenticacao, usuario: f.autenticacao === 'senha' ? f.usuario.trim() : '',
		realm: f.realm.trim(), from_usuario: f.from_usuario.trim(),
		host: f.host.trim().toLowerCase(), porta: Number(f.porta), transporte: f.transporte, codecs: f.codecs, dtmf: f.dtmf,
		verificar_options: f.verificar_options,
		bina, autenticacao_operadora: f.autenticacao_operadora, retorno_bina: f.retorno_bina.trim(),
		ddd_origem: f.ddd_origem.trim() || bina.slice(0, 2), cabecalho_bina: f.cabecalho_bina,
		formato_discagem: f.formato_discagem, csp: f.csp.trim(), tech_prefix: f.tech_prefix.trim(),
		canais: Number(f.canais), cps: Number(f.cps), toque_max_s: Number(f.toque_max_s), duracao_max_min: Number(f.duracao_max_min),
		...(f.declaro ? { declaro: true } : {}),
	};
}

/** Número de teste digitado → dígitos sem o 55, ou null. */
export function digitosNumeroTeste(n: string): string | null {
	let d = n.replace(/\D/g, '');
	if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
	return /^[1-9][1-9]\d{8,9}$/.test(d) ? d : null;
}

/** "(11) 9••••-••41": DDD e os 2 últimos dígitos (o mesmo formato que o banco aceita em voz_numeros_teste.mascara). */
export function mascaraNumeroTeste(d: string): string {
	return `(${d.slice(0, 2)}) ${d.length === 11 ? '9••••' : '••••'}-••${d.slice(-2)}`;
}

// ---------------------------------------------------------------- teste da rota (seção F)
export const PASSOS_TESTE: { n: number; titulo: string; obrigatorio: boolean }[] = [
	{ n: 0, titulo: 'Conferência antes de ligar', obrigatorio: true },
	{ n: 1, titulo: 'A operadora está no ar?', obrigatorio: false },
	{ n: 2, titulo: 'A operadora aceitou o MotorCX?', obrigatorio: true },
	{ n: 3, titulo: 'O número foi aceito?', obrigatorio: true },
	{ n: 4, titulo: 'O celular tocou?', obrigatorio: true },
	{ n: 5, titulo: 'O áudio chega ao celular e as teclas voltam?', obrigatorio: true },
	{ n: 6, titulo: 'O áudio do celular chega ao MotorCX?', obrigatorio: true },
	{ n: 7, titulo: 'Qualidade da linha', obrigatorio: false },
	{ n: 8, titulo: 'A bina está certa?', obrigatorio: true },
	{ n: 9, titulo: 'O desligamento chega ao MotorCX?', obrigatorio: true },
];

export type PassoTeste = { passo: number; resultado: string; mensagem?: string };

export const SITUACAO_TESTE: Record<string, { txt: string; tom: 'ok' | 'erro' | 'atencao' | 'neutro' | 'info' }> = {
	pedido: { txt: 'Na fila do servidor de voz', tom: 'info' },
	rodando: { txt: 'Testando… ao vivo', tom: 'info' },
	passou: { txt: 'A rota passou no teste', tom: 'ok' },
	atencao: { txt: 'Funciona, com pontos de atenção', tom: 'atencao' },
	falhou: { txt: 'Não passou', tom: 'erro' },
	incompleto: { txt: 'Teste incompleto', tom: 'atencao' },
	cancelado: { txt: 'Cancelado', tom: 'neutro' },
	expirado: { txt: 'Teste incompleto', tom: 'atencao' },
};

/** Linhas do teste para a tela: cada passo com o resultado gravado ou "não testado". */
export function linhasTeste(passos: PassoTeste[] | null | undefined): { n: number; titulo: string; obrigatorio: boolean; resultado: string; mensagem: string }[] {
	const por = new Map((passos ?? []).map(p => [Number(p.passo), p]));
	return PASSOS_TESTE.map(p => {
		const r = por.get(p.n);
		return { ...p, resultado: r?.resultado ?? 'nao_testado', mensagem: r?.mensagem ?? 'não testado' };
	});
}

/** O que a pessoa precisa fazer agora no celular, pelo passo em andamento. */
export function instrucaoTeste(passos: PassoTeste[] | null | undefined, situacao: string): string | null {
	if (situacao === 'pedido') return 'Deixe o celular de teste por perto: o MotorCX vai ligar.';
	if (situacao !== 'rodando') return null;
	const atual = (passos ?? []).find(p => p.resultado === 'rodando');
	switch (atual?.passo) {
		case 2: case 3: case 4: return 'Ligando… atenda o celular de teste.';
		case 5: return 'Você vai ouvir bipes: digite no celular o código abaixo.';
		case 6: return 'Agora diga no celular: "testando, um, dois, três".';
		case 8: return 'Confira o número que apareceu no celular e responda abaixo.';
		case 9: return 'Pode desligar o celular agora.';
		default: return 'Testando…';
	}
}

/** Limites do teste (seção F): 10 por hora por tronco, 30 por dia na empresa. */
export const LIMITE_TESTE_HORA = 10;
export const LIMITE_TESTE_DIA = 30;

// ---------------------------------------------------------------- erros da operadora (D11)
export const ERROS_OPERADORA: { codigo: string; diz: string; acao: string }[] = [
	{ codigo: '401/407 → 403', diz: 'A operadora recusou o usuário ou a senha.', acao: 'Confira o passo 2 e guarde a senha de novo.' },
	{ codigo: '403 (por IP)', diz: 'A operadora não reconhece o MotorCX.', acao: 'Mande a ficha técnica para ela liberar os IPs do MotorCX.' },
	{ codigo: '402', diz: 'A operadora diz que acabou o crédito.', acao: 'A rota pausa e os Admins são avisados.' },
	{ codigo: '404 / 484 / 400', diz: 'A operadora não entendeu o número.', acao: 'Confira formato, prefixo e CSP (passo 5).' },
	{ codigo: '408 / sem resposta', diz: 'A operadora não respondeu.', acao: 'Confira endereço, porta e os IPs liberados.' },
	{ codigo: '480 / 486 / 487', diz: 'O número não atendeu, estava ocupado ou desligou.', acao: 'Não é falha da rota.' },
	{ codigo: '488 / 415', diz: 'A operadora não aceitou o formato do áudio.', acao: 'Em Avançado, deixe só G.711 A-law.' },
	{ codigo: '503', diz: 'A operadora está congestionada ou fora do ar.', acao: 'A reserva assume.' },
	{ codigo: '603 / 608 / 433–438', diz: 'A operadora bloqueou a originação.', acao: 'A rota pausa: fale com a operadora, teste e retome.' },
];

/** Por que a rota foi pausada, em linguagem da tela (SQL 65). */
export function motivoPausa(motivo: unknown, causa: unknown): string {
	const sip = causa ? ` (SIP ${String(causa)})` : '';
	switch (motivo) {
		case 'sem_credito': return `A operadora disse que acabou o crédito${sip}.`;
		case 'bloqueio_originacao': return `A operadora bloqueou a originação${sip}. Fale com ela antes de testar de novo.`;
		default: return `Rota pausada${sip}.`;
	}
}

// ---------------------------------------------------------------- ficha técnica (D1, seção E.2)
export function fichaTecnica(t: { referencia?: unknown; bina?: unknown; canais?: unknown; cps?: unknown; autenticacao?: unknown } | null): string {
	const linhas = [
		'Ficha técnica do MotorCX para a operadora',
		`IPs de saída do MotorCX (sinalização e áudio): ${IPS_SAIDA_MOTORCX.join(', ')}`,
		'Portas SIP: 5060 UDP e TCP · 5061 TLS',
		'Portas de áudio (RTP): UDP 10000–20000',
		'Codecs oferecidos: G.711 A-law, G.711 μ-law (pacote de 20 ms)',
		'Teclas (DTMF): RFC 4733, payload 101',
		`Registro: o MotorCX não se registra; autentica ${t?.autenticacao === 'senha' ? 'por usuário e senha em cada ligação' : 'por IP'}`,
		'Identificação: De (From) com a conta/bina; P-Asserted-Identity com a bina',
		'Ligações de entrada: não recebemos ligações por este tronco',
		'Agente de usuário (User-Agent): MotorCX',
	];
	if (t?.canais) linhas.push(`Volume máximo que enviaremos: ${String(t.canais)} ligações ao mesmo tempo, ${String(t.cps ?? 10)} novas por segundo`);
	if (t?.bina) linhas.push(`Pedido: ativar a autenticação de chamadas (Origem Verificada / STIR-SHAKEN) na bina ${String(t.bina)}.`);
	return linhas.join('\n');
}

/** Itens do "Antes de ligar de verdade" (C11) que a tela consegue conferir. */
export function checklistReal(d: { troncos: Record<string, unknown>[]; numeros: Record<string, unknown>[]; transferenciaTestada: boolean; avisoGravacao: boolean | null }): { txt: string; ok: boolean }[] {
	return [
		{ txt: 'Rota testada (áudio, teclas e bina)', ok: d.troncos.some(t => t.teste_ok === true) },
		{ txt: 'Transferência testada', ok: d.transferenciaTestada },
		{ txt: 'Números de teste confirmados por código', ok: d.numeros.some(n => !!n.confirmado_em) },
		{ txt: 'Declaração da bina', ok: d.troncos.length > 0 && d.troncos.every(t => !!t.declaracao_em) },
		{ txt: 'Aviso de gravação ligado', ok: d.avisoGravacao === true },
	];
}
