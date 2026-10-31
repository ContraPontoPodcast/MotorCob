// Frentes do MotorCX: MotorCob (Cobrança) e MotorCli (Jornada do Cliente).
// A frente ativa define o nome do produto mostrado ao cliente e a cor de destaque (--frente).

export type FrenteId = 'motorcob' | 'motorcli';

export type FrenteInfo = {
	id: FrenteId;
	nome: string;
	area: string;
	cor: string;
	sigla: string;
};

export const FRENTES: Record<FrenteId, FrenteInfo> = {
	motorcob: { id: 'motorcob', nome: 'Cobrança', area: 'Cobrança', cor: '#C9A35A', sigla: 'COB' },
	motorcli: { id: 'motorcli', nome: 'Jornada do Cliente', area: 'Jornada do Cliente', cor: '#8E8E93', sigla: 'CLI' },
};

export const FRENTE_STORAGE_KEY = 'mc-frente';

/** Frente do link (?frente=), guardada em sessionStorage ao abrir /login. */
export const FRENTE_LINK_KEY = 'mc-frente-link';

/** Aviso de frente não liberada, lido pelo topo do Workspace. */
export const FRENTE_AVISO_KEY = 'mc-frente-aviso';

/** Valida a frente vinda do link: só 'motorcob' ou 'motorcli'; qualquer outro valor é ignorado. */
export function frenteDoLink(valor: string | null | undefined): FrenteId | null {
	return valor === 'motorcob' || valor === 'motorcli' ? valor : null;
}

/** Lista de frentes retornada por rpc('minhas_frentes'). */
export type FrenteRow = { frente: FrenteId; nome?: string | null };

/** Frente padrão quando o backend não retorna nada (ou RPC indisponível). */
export const FRENTE_PADRAO: FrenteId = 'motorcob';

export function frenteInfo(id: FrenteId | string | null | undefined): FrenteInfo {
	return FRENTES[(id as FrenteId) ?? FRENTE_PADRAO] ?? FRENTES[FRENTE_PADRAO];
}

/** Frente ativa desta aba (sessionStorage). Não há mais frente lembrada entre
 *  sessões: o login sempre entra no Início e a área é trocada pelo menu. */
export function frenteDaSessao(): FrenteId | null {
	if (typeof window === 'undefined') return null;
	try {
		const v = sessionStorage.getItem(FRENTE_STORAGE_KEY);
		return v === 'motorcli' || v === 'motorcob' ? v : null;
	} catch { return null; }
}
