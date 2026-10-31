// Agente de voz (SQL 56): rótulos, validações e cálculos usados pelas telas do Console e da Empresa.
// O banco é a fonte da verdade: estes cálculos só mostram na tela o que as funções do banco fazem
// (segundos_tarifados, custo_voz). LGPD: nada aqui guarda ou mostra telefone de devedor, CPF ou nome.

/** IPs fixos de saída do Asterisk do MotorCX (São Paulo): a operadora que autentica por IP libera estes. */
export const IPS_SAIDA_MOTORCX = ['35.198.40.10', '34.39.217.31'] as const;

export const PROVEDORES_VOZ: { id: string; nome: string; desc: string }[] = [
	{ id: 'montagem_motorcx', nome: 'Montagem MotorCX', desc: 'Pipeline próprio ligado ao Asterisk: fala para texto, modelo de linguagem e voz neural pt-BR. Cada peça é trocável.' },
	{ id: 'elevenlabs', nome: 'ElevenLabs', desc: 'Agente pronto da ElevenLabs, ligado ao Asterisk por SIP.' },
	{ id: 'simulador', nome: 'Simulador', desc: 'Nada é falado de verdade: respostas simuladas para testar a régua.' },
];

export const MODOS_VOZ: { id: 'simulado' | 'teste' | 'real'; nome: string; desc: string }[] = [
	{ id: 'simulado', nome: 'Simulado', desc: 'Nada liga. O Simulador responde.' },
	{ id: 'teste', nome: 'Só números de teste', desc: 'Liga de verdade, mas só para os números de teste da equipe.' },
	{ id: 'real', nome: 'Real', desc: 'Liga para a Lista do dia, dentro das janelas por UF e DDD.' },
];

export const TIPOS_ROTA: Record<string, string> = {
	fixo_local: 'Fixo local',
	fixo_ldn: 'Fixo LDN',
	movel_vc1: 'Móvel VC1',
	movel_vc2_vc3: 'Móvel VC2/VC3',
};

export const TRANSPORTES = ['udp', 'tcp', 'tls'] as const;

export const FORMATOS_DISCAGEM: { id: string; nome: string; exemplo: string }[] = [
	{ id: 'tech_ddd_numero', nome: 'Tech prefix + DDD + número', exemplo: '1021 11 9••••-••••' },
	{ id: 'tech_0_csp_ddd_numero', nome: 'Tech prefix + 0 + CSP + DDD + número', exemplo: '1021 0 15 11 9••••-••••' },
	{ id: 'tech_55_ddd_numero', nome: 'Tech prefix + 55 + DDD + número', exemplo: '1021 55 11 9••••-••••' },
];

export const CODECS = ['alaw', 'ulaw', 'g729', 'g722', 'opus'] as const;

/** Itens que o MotorCX fatura do agente de voz (cobranca_itens, produto agente_voz). Telefonia não é item. */
export const ITENS_FATURA_VOZ = ['voz_plataforma', 'voz_minuto_ia', 'voz_minuto_ia_pico', 'voz_transcricao', 'gestao_tronco_sip'] as const;

/** Mesma regra de public.segundos_tarifados: sem carência; 0 se não atendeu; o mínimo inicial; depois, blocos. */
export function segundosTarifados(billsec: number, inicial: number, incremento: number): number {
	if (!Number.isFinite(billsec) || billsec <= 0) return 0;
	if (inicial < 1 || incremento < 1) return 0;
	if (billsec <= inicial) return inicial;
	return inicial + Math.ceil((billsec - inicial) / incremento) * incremento;
}

/** Mesma regra de public.custo_voz: segundos × preço do minuto ÷ 60, com 5 casas. */
export function custoVoz(segundos: number, precoMinuto: number): number {
	return Math.round((segundos * precoMinuto / 60) * 100000) / 100000;
}

export const cadenciaTxt = (ini: unknown, inc: unknown) => `${Number(ini)}/${Number(inc)}`;

/** R$ com N casas (preço do minuto de telefonia costuma ter 3 a 5). */
export function reais(v: unknown, casas = 2): string {
	return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Número inteiro em pt-BR. */
export const inteiro = (v: unknown) => Math.round(Number(v ?? 0)).toLocaleString('pt-BR');

/** Lê número digitado em pt-BR ("0,055" ou "1.234,5"). NaN se vazio ou inválido. */
export function lerNumero(v: string): number {
	let s = String(v ?? '').trim();
	if (!s) return NaN;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return Number.isFinite(n) ? n : NaN;
}

/**
 * Bina (número da própria empresa, nunca do devedor). Na tela sai mascarada como no protótipo,
 * com DDD e os 2 últimos dígitos: "(11) 3•••-••00". O banco guarda inteira porque o Asterisk origina com ela.
 */
export function binaMascara(b: unknown): string {
	const d = String(b ?? '').replace(/\D/g, '');
	if (d.length < 6) return d ? '••••' : '—';
	if (/^0[3589]00/.test(d) || /^[34]00/.test(d)) return `${d.slice(0, 4)} •••-••${d.slice(-2)}`;
	return `(${d.slice(0, 2)}) ${d.slice(2, 3)}•••-••${d.slice(-2)}`;
}

// ---------------------------------------------------------------- validações (iguais aos checks do SQL 56)
export const RE_REFERENCIA = /^[a-z0-9][a-z0-9_-]{1,39}$/;
export const RE_IP = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
export const RE_HOST = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const RE_SEGREDO = /^[A-Za-z0-9_\-/.]{1,120}$/;
export const RE_USUARIO = /^[A-Za-z0-9_.\-+]{1,64}$/;
export const RE_DDD = /^[1-9][1-9]$/;
export const RE_BINA = /^([1-9][1-9][2-9][0-9]{7,8}|0[3589]00[0-9]{6,7}|[34]00[0-9][0-9]{4})$/;
export const RE_TECH = /^[0-9]{1,8}$/;
export const RE_CSP = /^[0-9]{2}$/;
export const RE_DESTINO_SIP = /^sips?:[A-Za-z0-9_.+-]{1,64}@[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?(;transport=(udp|tcp|tls))?$/;

/** ID do cliente no pedido do titular: nunca CPF, telefone ou nome (sequência de 10+ dígitos é recusada). */
export function idClienteValido(v: string): boolean {
	const s = v.trim();
	if (s.length < 1 || s.length > 60) return false;
	if (/[0-9]{10,}/.test(s.replace(/[.\-\s/()]/g, ''))) return false;
	if (/\s/.test(s)) return false;
	return true;
}

/**
 * Hash do número de teste no navegador (sha-256 em hex), com a mesma normalização de nuvem/mensageria.py
 * (só dígitos, sem o 55 do país). O número nunca vai para o banco.
 */
export async function hashNumeroTeste(numero: string): Promise<string | null> {
	let d = numero.replace(/\D/g, '');
	if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
	if (!/^[1-9][1-9]\d{8,9}$/.test(d)) return null;
	if (typeof crypto === 'undefined' || !crypto.subtle) return null;
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d));
	return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Primeiro dia do mês (AAAA-MM-01) de uma data ISO. */
export const inicioMes = (iso: string) => `${iso.slice(0, 7)}-01`;

/** Últimas N competências (AAAA-MM-01), da atual para trás. */
export function competencias(hojeIso: string, n = 6): string[] {
	const [a, m] = hojeIso.slice(0, 7).split('-').map(Number);
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		const d = new Date(Date.UTC(a, m - 1 - i, 1));
		out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
	}
	return out;
}

/** Linhas para CSV (separador ";", decimal com vírgula, como o Excel em pt-BR abre). */
export function paraCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
	const cel = (v: string | number | null | undefined) => {
		if (v == null) return '';
		const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
		return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return '﻿' + [cabecalho.join(';'), ...linhas.map(l => l.map(cel).join(';'))].join('\r\n') + '\r\n';
}

export function baixarTexto(nome: string, texto: string, tipo = 'text/csv;charset=utf-8') {
	const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
	const a = document.createElement('a');
	a.href = url; a.download = nome;
	document.body.appendChild(a); a.click(); a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
