// Sessão de treino por VOZ no navegador (Roleplay, SQL 119). Regras sem rede e sem áudio de verdade: o áudio do
// microfone vira PCM 16 kHz para o serviço de voz da VM (voz/treino_voz.py, WebSocket seguro), a voz da cliente
// simulada volta em PCM 16 kHz, e a tela mostra a transcrição ao vivo que a VM manda (já mascarada).
// Áudio nunca é guardado: nem aqui, nem na VM.

export const TAXA_VOZ = 16000;
/** Sem fone, o alto-falante volta para o microfone: enquanto a cliente fala, o microfone vai mudo (meia via). */
export const CHAVE_FONE = 'treino-voz-fone';

/** Mensagens que a VM manda (JSON). O binário é a voz da cliente simulada. */
export type MensagemVoz =
	| { tipo: 'pronto'; limite_s: number }
	| { tipo: 'fala'; quem: 'persona' | 'operador'; texto: string; t?: number }
	| { tipo: 'parcial'; texto: string }
	| { tipo: 'interromper' }
	| { tipo: 'tempo'; segundos: number }
	| { tipo: 'desligou' }
	| { tipo: 'avaliando' }
	| { tipo: 'fim'; situacao: 'avaliada' | 'abandonada' | 'falhou'; motivo?: string; erro?: string }
	| { tipo: 'erro'; erro: string };

/** Lê uma mensagem da VM; o que não for do protocolo vira null (ignorado). */
export function lerMensagemVoz(bruto: string): MensagemVoz | null {
	let d: unknown;
	try { d = JSON.parse(bruto); } catch { return null; }
	if (!d || typeof d !== 'object') return null;
	const m = d as Record<string, unknown>;
	const txt = (v: unknown) => (typeof v === 'string' ? v.slice(0, 600) : '');
	switch (m.tipo) {
		case 'pronto': return { tipo: 'pronto', limite_s: Number(m.limite_s) || 0 };
		case 'fala': return m.quem === 'persona' || m.quem === 'operador' ? { tipo: 'fala', quem: m.quem, texto: txt(m.texto), ...(typeof m.t === 'number' ? { t: m.t } : {}) } : null;
		case 'parcial': return { tipo: 'parcial', texto: txt(m.texto) };
		case 'interromper': case 'desligou': case 'avaliando': return { tipo: m.tipo };
		case 'tempo': return { tipo: 'tempo', segundos: Math.max(0, Number(m.segundos) || 0) };
		case 'fim': return m.situacao === 'avaliada' || m.situacao === 'abandonada' || m.situacao === 'falhou'
			? { tipo: 'fim', situacao: m.situacao, ...(typeof m.motivo === 'string' ? { motivo: m.motivo } : {}), ...(typeof m.erro === 'string' ? { erro: txt(m.erro) } : {}) } : null;
		case 'erro': return { tipo: 'erro', erro: txt(m.erro) || 'O treino por voz não respondeu.' };
		default: return null;
	}
}

/** Áudio do microfone (Float32, na taxa do navegador) → PCM 16 bits little-endian a 16 kHz (média por janela). */
export function paraPCM16(amostras: Float32Array, taxaEntrada: number): Uint8Array<ArrayBuffer> {
	const razao = taxaEntrada / TAXA_VOZ;
	const n = Math.floor(amostras.length / razao);
	const out = new DataView(new ArrayBuffer(n * 2));
	for (let i = 0; i < n; i++) {
		const ini = Math.floor(i * razao), fim = Math.max(ini + 1, Math.floor((i + 1) * razao));
		let soma = 0;
		for (let k = ini; k < fim && k < amostras.length; k++) soma += amostras[k];
		const v = Math.max(-1, Math.min(1, soma / (fim - ini)));
		out.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
	}
	return new Uint8Array(out.buffer);
}

/** PCM 16 bits little-endian (a voz da cliente) → Float32 para tocar. */
export function dePCM16(b: ArrayBuffer): Float32Array {
	const v = new DataView(b);
	const n = Math.floor(b.byteLength / 2);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
	return out;
}

/** Nível do microfone de 0 a 1 (para a barrinha do teste de microfone). */
export function nivel(amostras: Float32Array): number {
	if (!amostras.length) return 0;
	let s = 0;
	for (const x of amostras) s += x * x;
	return Math.min(1, Math.sqrt(s / amostras.length) * 4);
}

export type ErroMicrofone = 'bloqueado' | 'sem_microfone' | 'sem_suporte' | 'outro';
/** Erro do getUserMedia → o que a tela diz (com "Treinar por texto" a 1 clique). */
export function erroMicrofone(e: unknown): ErroMicrofone {
	const nome = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
	if (nome === 'NotAllowedError' || nome === 'SecurityError' || nome === 'PermissionDeniedError') return 'bloqueado';
	if (nome === 'NotFoundError' || nome === 'OverconstrainedError' || nome === 'NotReadableError') return 'sem_microfone';
	if (nome === 'TypeError' || nome === 'NotSupportedError') return 'sem_suporte';
	return 'outro';
}
export const TEXTO_ERRO_MICROFONE: Record<ErroMicrofone, string> = {
	bloqueado: 'O navegador bloqueou o microfone. Libere no cadeado ao lado do endereço ou treine por texto.',
	sem_microfone: 'Não achamos um microfone funcionando. Confira o fone ou treine por texto.',
	sem_suporte: 'Este navegador não deixa usar o microfone aqui. Use o Chrome, o Edge ou o Safari atualizados, ou treine por texto.',
	outro: 'Não deu para usar o microfone agora. Tente de novo ou treine por texto.',
};

/** Fim da ligação por voz → frase para a tela (a mesma ideia do texto: nunca "reprovado"). */
export function textoFimVoz(m: { situacao: string; motivo?: string; erro?: string }): string {
	if (m.situacao === 'avaliada') return 'Conversa avaliada.';
	if (m.erro) return m.erro;
	if (m.situacao === 'abandonada') return m.motivo === 'sem_fala' ? 'A ligação terminou antes de você falar: a tentativa não contou.' : 'Você saiu sem contar: a tentativa não contou.';
	if (m.motivo === 'rede') return 'A conexão caiu no meio da ligação: a tentativa não contou. Tente de novo.';
	if (m.motivo === 'microfone') return 'O microfone parou no meio da ligação: a tentativa não contou. Confira o fone ou treine por texto.';
	return 'Não deu para avaliar agora: a tentativa não contou. Tente de novo em alguns minutos.';
}

/** Motivo do fim (vindo da VM) → aviso curto na conversa. */
export const AVISO_FIM: Record<string, string> = {
	desligou: 'A ligação foi encerrada pelo outro lado.',
	tempo: 'O tempo da ligação acabou.',
	franquia: 'Os minutos de voz do treino deste mês acabaram nesta ligação.',
	silencio: 'A ligação caiu depois de 20 segundos sem ninguém falar.',
};

/** Aviso dos minutos de voz no briefing: a partir de 80% da franquia do mês. */
export function avisoMinutosVoz(usados: number | null | undefined, franquia: number | null | undefined): string | null {
	if (usados == null || !franquia || franquia <= 0) return null;
	if (usados >= franquia) return 'Os minutos de voz do treino deste mês acabaram. O treino por texto continua.';
	if (usados >= Math.ceil(franquia * 0.8)) {
		const resta = franquia - usados;
		return `Restam ${resta} ${resta === 1 ? 'minuto' : 'minutos'} de voz no treino deste mês. Se acabar no meio, a ligação encerra e é avaliada.`;
	}
	return null;
}

/** Endereço do WebSocket: só wss (o serviço da VM fica atrás do Caddy com certificado). */
export const urlVozOk = (u: unknown): u is string => typeof u === 'string' && /^wss:\/\/[a-z0-9.-]+(:\d{2,5})?\/treino\/voz$/.test(u);

/** Código do processador de áudio do microfone (AudioWorklet): junta ~40 ms e manda para a página. */
export const CODIGO_WORKLET = `class Mic extends AudioWorkletProcessor {
	constructor() { super(); this.buf = []; this.n = 0; }
	process(inputs) {
		const c = inputs[0] && inputs[0][0];
		if (c) { this.buf.push(new Float32Array(c)); this.n += c.length; }
		if (this.n >= sampleRate / 25) {
			const out = new Float32Array(this.n); let o = 0;
			for (const b of this.buf) { out.set(b, o); o += b.length; }
			this.buf = []; this.n = 0;
			this.port.postMessage(out, [out.buffer]);
		}
		return true;
	}
}
registerProcessor('motorcx-mic', Mic);`;
