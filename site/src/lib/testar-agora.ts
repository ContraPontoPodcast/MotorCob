// "Testar agora" do Agente de voz (SQL 116; PR 9 do plano Canais/Agente Voz/CX; SPEC §1.2): o resultado em lista
// ✓ / ! / ✕ e a frase final ("Tudo certo", "Funciona, com um ponto de atenção", "O teste encontrou um problema").
// Regras puras (sem React, sem Supabase). O pedido nunca leva o número: só o id do número de teste (máscara na tela).

export type SituacaoTeste = 'pedido' | 'ligando' | 'concluido' | 'recusado' | 'expirado' | 'cancelado';
export type PassosTeste = Partial<{
	tocou: boolean; atendeu: boolean; agente: boolean; gravada: boolean; aviso_gravacao: boolean;
	identidade_confirmada: boolean; transferiu: boolean; segundos: number; toque_s: number; sip: number;
}>;
export type TesteAgora = {
	id: number; credor_id: number; numero_id: number; mascara: string; situacao: SituacaoTeste; motivo: string | null;
	desfecho: string | null; passos: PassosTeste | null; pedido_em: string; pego_em: string | null; concluido_em: string | null;
};
export type NumeroTeste = { id: number; mascara: string; pronto: boolean };
export type TomItem = 'ok' | 'atencao' | 'erro' | 'pendente';
export type ItemTeste = { tom: TomItem; titulo: string; texto?: string };

/** Até 5 por dia por empresa (= public.testes_agora_voz_limite()). */
export const LIMITE_DIA = 5;
export const COLUNAS = 'id,credor_id,numero_id,mascara,situacao,motivo,desfecho,passos,pedido_em,pego_em,concluido_em';
export const FINAL: ReadonlySet<SituacaoTeste> = new Set(['concluido', 'recusado', 'expirado', 'cancelado']);

/** As regras que valem para o teste (o mesmo caminho das ligações do lote). */
export const REGRAS_TESTE: { titulo: string; texto: string }[] = [
	{ titulo: 'Só números de teste confirmados', texto: 'O número fica no cofre; o MotorCX guarda só a máscara e um código. Cadastre e confirme em Agente Voz/CX › Telefonia.' },
	{ titulo: 'Fluxo em uso da carteira e a rota de hoje', texto: 'A ligação sai como as do lote: o mesmo tronco, a bina, o CPS e o robô reservado antes de discar.' },
	{ titulo: 'Horário do estado do número, nunca domingo', texto: 'Respeita os horários por UF/DDD da carteira (ou a prévia) e os freios de chamadas curtas.' },
	{ titulo: 'Abertura com o aviso de gravação', texto: 'Diz que a ligação é gravada (se a empresa grava) e que quem fala é um assistente virtual. O credor e a dívida só depois de confirmar a identidade.' },
	{ titulo: `Até ${LIMITE_DIA} por dia, um de cada vez`, texto: 'É uma ligação de verdade: conta nas ligações do dia, no custo da operadora e nas chamadas curtas (se durar até 6 s).' },
];

const seg = (n?: number) => (n == null ? '' : ` · ${n} s`);

/** O resultado em lista, na ordem do que acontece. */
export function itensTeste(t: TesteAgora): ItemTeste[] {
	const out: ItemTeste[] = [{ tom: 'ok', titulo: 'Pedido aceito', texto: `Para ${t.mascara}, com as travas conferidas no banco.` }];
	if (t.situacao === 'cancelado') return [...out, { tom: 'erro', titulo: 'Cancelado', texto: t.motivo ?? 'Cancelado antes de ligar.' }];
	if (t.situacao === 'expirado') return [...out, { tom: 'erro', titulo: 'Não ligou a tempo', texto: t.motivo ?? 'O pedido expirou.' }];
	if (t.situacao === 'pedido') return [...out, { tom: 'pendente', titulo: 'Esperando o servidor de voz', texto: 'Ele confere tudo de novo e liga em até 1 minuto.' }];
	out.push({ tom: 'ok', titulo: 'O servidor de voz pegou o pedido', texto: 'Leu o número no cofre e conferiu o horário, a rota e os freios.' });
	if (t.situacao === 'recusado') return [...out, { tom: 'erro', titulo: 'Não ligou', texto: t.motivo ?? 'O servidor de voz recusou o teste.' }];
	if (t.situacao === 'ligando') return [...out, { tom: 'pendente', titulo: 'Ligando…', texto: 'Atenda o celular de teste e converse com o agente.' }];
	const p = t.passos ?? {};
	if (!p.tocou) return [...out, { tom: 'erro', titulo: 'O celular não tocou', texto: `A operadora não completou a ligação${p.sip ? ` (SIP ${p.sip})` : ''}. Veja a rota em Agente Voz/CX › Telefonia.` }];
	out.push({ tom: 'ok', titulo: 'O celular tocou', texto: p.toque_s != null ? `Tocou por ${p.toque_s} s.` : undefined });
	if (t.desfecho === 'maquina' || t.desfecho === 'caixa_postal') return [...out, { tom: 'atencao', titulo: 'Caiu na caixa postal', texto: 'O MotorCX detectou uma máquina e desligou. Teste de novo e atenda antes de cair na caixa.' }];
	if (!p.atendeu) return [...out, { tom: 'atencao', titulo: 'Ninguém atendeu', texto: 'A rota funciona até o toque. Teste de novo e atenda para ouvir o agente.' }];
	if (!p.agente) return [...out, { tom: 'erro', titulo: 'Atendeu, mas o agente não entrou', texto: 'A pessoa ouviu a mensagem de identificação: faltou robô livre ou o provedor de voz não abriu a sessão.' }];
	out.push({ tom: 'ok', titulo: 'Atendeu e o agente falou', texto: `Conversa${seg(p.segundos)}${p.transferiu ? ' · passou para o seu operador' : ''}.` });
	out.push(p.gravada
		? (p.aviso_gravacao
			? { tom: 'ok', titulo: 'Aviso de gravação na abertura', texto: 'Disse que a ligação é gravada e que quem fala é um assistente virtual.' }
			: { tom: 'atencao', titulo: 'Gravada sem o aviso', texto: 'Ligue o aviso de gravação em Empresa › Privacidade e gravações.' })
		: { tom: 'ok', titulo: 'Abertura', texto: 'A empresa não grava esta ligação; a abertura diz que quem fala é um assistente virtual.' });
	out.push({ tom: 'ok', titulo: 'Identidade antes da dívida', texto: p.identidade_confirmada
		? 'Confirmou a identidade antes de falar do credor e do valor.'
		: 'A identidade não foi confirmada, então o agente não falou do credor nem da dívida (como deve ser).' });
	return out;
}

/** A frase final do teste. */
export function fraseFinal(itens: ItemTeste[]): { tom: TomItem; texto: string } {
	if (itens.some(i => i.tom === 'erro')) return { tom: 'erro', texto: 'O teste encontrou um problema' };
	if (itens.some(i => i.tom === 'pendente')) return { tom: 'pendente', texto: 'Testando…' };
	if (itens.some(i => i.tom === 'atencao')) return { tom: 'atencao', texto: 'Funciona, com um ponto de atenção' };
	return { tom: 'ok', texto: 'Tudo certo' };
}

/** Quantos testes contam no limite de hoje (o cancelado não conta). */
export function usadosHoje(testes: TesteAgora[], hoje: string): number {
	return testes.filter(t => t.situacao !== 'cancelado' && new Date(t.pedido_em).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) === hoje).length;
}
