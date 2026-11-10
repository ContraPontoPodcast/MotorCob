// Robôs contratados (licenças) do Agente de voz: leitura da divisão do teto global (SQL 101) para o Console (PR 5) e
// para o cliente em Discagem (PR 7). O banco é a fonte da verdade: `divisao_concorrencia_voz()` já devolve o limite real
// de cada empresa e o motivo; aqui só os totais da tela e as frases do "por quê".
// 1 robô = 1 conversa ao mesmo tempo com a IA (não é linha discando nem canal do tronco).
// O cliente nunca vê o teto global: o motivo `teto` é "limite temporário da plataforma" para ele.
import type { Row } from './supabase';

export type MotivoLimite = 'licencas' | 'tronco' | 'teto' | 'legado';

/** Uma linha de voz_divisao_concorrencia (SQL 101). `licencas` nulo = sem licença; `contratado` nulo para o cliente. */
export type LinhaDivisao = {
	empresa_id: number;
	canais: number;
	limite: number;
	teto: number;
	pico_multiplo: number;
	licencas: number | null;
	motivo: MotivoLimite;
	contratado: number | null;
};

const MOTIVOS: MotivoLimite[] = ['licencas', 'tronco', 'teto', 'legado'];
const int = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };

/** Linha crua do Supabase → LinhaDivisao. Banco sem o SQL 101 (sem `motivo`): tudo vira `legado`. */
export function linhaDivisao(r: Row): LinhaDivisao {
	const m = String(r.motivo ?? '');
	return {
		empresa_id: int(r.empresa_id),
		canais: int(r.canais),
		limite: int(r.limite),
		teto: int(r.teto ?? r.limite),
		pico_multiplo: Math.max(1, int(r.pico_multiplo ?? 1)),
		licencas: r.licencas == null ? null : int(r.licencas),
		motivo: (MOTIVOS as string[]).includes(m) ? m as MotivoLimite : 'legado',
		contratado: r.contratado == null ? null : int(r.contratado),
	};
}

/** Tem licença que vale hoje com robôs > 0 (o resto segue o modelo antigo: só a sobra do teto). */
export const comLicenca = (l: LinhaDivisao) => l.motivo !== 'legado' && (l.licencas ?? 0) > 0;

export type EstadoTeto = 'dentro' | 'quase' | 'over';

export type ResumoRobos = {
	teto: number;
	/** Σ robôs vendidos (licenças que valem hoje). */
	vendidos: number;
	/** vendidos ÷ teto, em % inteiro (0 sem teto). */
	pct: number;
	/** Σ min(licenças, canais): o que de fato disputa o teto. */
	usaveis: number;
	/** O que sobra do teto para quem não tem licença. */
	sobra: number;
	semLicenca: number;
	/** Σ limites (o que pode estar no ar ao mesmo tempo). */
	limiteTotal: number;
	estado: EstadoTeto;
};

/** Totais do Console › Agente virtual: teto × vendidos × usáveis. */
export function resumoRobos(linhas: LinhaDivisao[], teto: number): ResumoRobos {
	const lic = linhas.filter(comLicenca);
	const vendidos = lic.reduce((t, l) => t + (l.licencas ?? 0), 0);
	const usaveis = lic.reduce((t, l) => t + Math.min(l.licencas ?? 0, l.canais), 0);
	const pct = teto > 0 ? Math.round((100 * vendidos) / teto) : 0;
	const estado: EstadoTeto = vendidos > teto ? 'over' : teto > 0 && vendidos >= 0.9 * teto && vendidos > 0 ? 'quase' : 'dentro';
	return {
		teto, vendidos, pct, usaveis,
		sobra: Math.max(0, teto - Math.min(usaveis, teto)),
		semLicenca: linhas.length - lic.length,
		limiteTotal: linhas.reduce((t, l) => t + l.limite, 0),
		estado,
	};
}

export const ROTULO_MOTIVO: Record<MotivoLimite, string> = {
	licencas: 'Licenças', tronco: 'Tronco limita', teto: 'Teto global limita', legado: 'Sem licença',
};
export const TOM_MOTIVO: Record<MotivoLimite, 'ok' | 'atencao' | 'erro' | 'neutro'> = {
	licencas: 'ok', tronco: 'atencao', teto: 'erro', legado: 'neutro',
};

const robos = (n: number) => `${n} ${n === 1 ? 'robô' : 'robôs'}`;

/** O "por quê" do limite para a equipe (Console). */
export function porQueEquipe(l: LinhaDivisao): string {
	if (l.motivo === 'tronco') return l.canais === 0
		? `Sem tronco ativo: não disca. Paga ${robos(l.licencas ?? 0)}.`
		: `O tronco tem ${l.canais} ${l.canais === 1 ? 'canal' : 'canais'}: limita a ${l.canais}, não ${l.licencas ?? 0}.`;
	if (l.motivo === 'teto') return `Robôs vendidos além do teto contratado: cai para ${l.limite} de ${l.licencas ?? 0} (corte proporcional).`;
	if (l.motivo === 'legado') {
		if (l.limite === 0) return 'Sem licença e sem sobra no teto global: não disca.';
		return l.limite >= l.canais
			? 'Sem licença (modelo antigo): usa a sobra do teto global, até os canais do tronco.'
			: `Sem licença (modelo antigo): leva só a sobra do teto global (${l.limite}).`;
	}
	return 'Igual às licenças.';
}

/** O "por quê" para o cliente: nunca cita o teto global nem o que outras empresas compraram. Vazio = sem limite extra. */
export function porQueCliente(l: LinhaDivisao): string {
	const lic = l.licencas ?? 0;
	if (l.motivo === 'tronco') return l.canais === 0
		? `Seu tronco ainda não está ativo: os ${robos(lic)} começam a valer quando ele estiver ligado em Telefonia.`
		: `Seu tronco tem ${l.canais} ${l.canais === 1 ? 'canal' : 'canais'}: hoje dá para usar ${l.canais} dos ${robos(lic)}. Para usar todos, peça mais canais à sua operadora e atualize em Telefonia.`;
	if (l.motivo === 'teto') return `Limite temporário da plataforma: ${l.limite} de ${robos(lic)} ao mesmo tempo. A equipe MotorCX acompanha e amplia a capacidade.`;
	return '';
}
