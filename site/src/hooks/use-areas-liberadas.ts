import { useEffect, useState } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { supabase, type Row } from '@/lib/supabase';
import { CANAL_STORAGE_KEY, isCanalValido, type CanalId } from '@/lib/mensageria-produtos';
import type { FrenteId } from '@/lib/frentes';

export type AreasLiberadas = {
	cobranca: boolean;
	jornada: boolean;
	mensageria: boolean;
	/** Canais contratados da mensageria (empresa_modulos.canais da linha mensageria ativa). */
	canais: CanalId[];
	/** Último canal usado se ainda contratado, senão o 1º dos contratados. Nunca 'sms' fixo. */
	canalPadrao: CanalId;
	/** Destino da Mensageria: o canal (com algum canal contratado) ou /mensageria (escolha do canal). */
	destinoMensageria: string;
	/** Equipe sem empresa na pílula (vê todas as áreas). */
	semEmpresa: boolean;
	/** false enquanto os módulos da empresa ainda estão sendo lidos. */
	pronto: boolean;
};

type DadosEmpresa = {
	/** Módulos ativos (empresa_modulos.ativo = true). */
	modulos: Set<string>;
	canais: CanalId[];
	/** Frentes ativas da empresa (empresa_frentes): valem para a equipe com a pílula. */
	frentesEmpresa: FrenteId[];
};

const VAZIO: DadosEmpresa = { modulos: new Set(), canais: [], frentesEmpresa: [] };

// Uma leitura por empresa, compartilhada pela moldura (trilho, abas, Início, gaveta, Relatórios).
const cache = new Map<string, DadosEmpresa>();
const emVoo = new Map<string, Promise<DadosEmpresa>>();

async function carregar(empresaId: string): Promise<DadosEmpresa> {
	if (!supabase) return VAZIO;
	const [mods, fr] = await Promise.all([
		supabase.from('empresa_modulos').select('modulo,ativo,canais').eq('empresa_id', empresaId),
		supabase.from('empresa_frentes').select('frente,ativo').eq('empresa_id', empresaId),
	]);
	const rows = (mods.data ?? []) as Row[];
	const modulos = new Set(rows.filter(r => r.ativo).map(r => String(r.modulo)));
	const msg = rows.find(r => r.modulo === 'mensageria' && r.ativo);
	const canais = Array.isArray(msg?.canais) ? (msg!.canais as string[]).filter((x): x is CanalId => isCanalValido(x)) : [];
	const frentesEmpresa = ((fr.data ?? []) as Row[])
		.filter(r => r.ativo !== false)
		.map(r => String(r.frente))
		.filter((f): f is FrenteId => f === 'motorcob' || f === 'motorcli');
	return { modulos, canais, frentesEmpresa };
}

function dadosDaEmpresa(empresaId: string): Promise<DadosEmpresa> {
	const lido = cache.get(empresaId);
	if (lido) return Promise.resolve(lido);
	let p = emVoo.get(empresaId);
	if (!p) {
		p = carregar(empresaId)
			.then(d => { cache.set(empresaId, d); return d; })
			.finally(() => { emVoo.delete(empresaId); });
		emVoo.set(empresaId, p);
	}
	return p;
}

const EVENTO_AREAS = 'mc:areas-mudaram';

/** Esquece o que foi lido e relê (ex.: a equipe ligou ou desligou um módulo ou canal da empresa). */
export function esquecerAreasLiberadas(empresaId?: string) {
	if (empresaId) cache.delete(empresaId); else cache.clear();
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_AREAS));
}

/**
 * Regra única de áreas liberadas, a mesma de numeros_areas() no banco: "contratada" = módulo ativo na empresa
 * E área liberada para a pessoa.
 * - Cobrança: frente motorcob E módulo orquestracao ativo;
 * - Jornada do Cliente: frente motorcli E módulo jornada ativo;
 * - Mensageria: módulo mensageria ativo.
 * Empresa só de Mensageria (Orquestração e Jornada desligadas na Contratação/Integrações) fica só com a
 * Mensageria e os Relatórios. Cliente: frentes da pessoa (minhas_frentes). Equipe com a pílula: as frentes da
 * empresa escolhida (vê o que o cliente vê). Equipe SEM empresa na pílula vê todas as áreas.
 */
export function useAreasLiberadas(): AreasLiberadas {
	const { perfil, empresa } = useMotorAuth();
	const { frentes } = useFrente();
	const empresaId = empresa?.id ?? null;
	const [dados, setDados] = useState<DadosEmpresa | null>(() => (empresaId ? cache.get(empresaId) ?? null : null));
	const [versao, setVersao] = useState(0);

	const isEquipe = !!perfil?.equipe;
	const semEmpresa = isEquipe && !empresa;

	useEffect(() => {
		if (!empresaId) { setDados(null); return; }
		const lido = cache.get(empresaId);
		if (lido) { setDados(lido); return; }
		setDados(null);
		let active = true;
		dadosDaEmpresa(empresaId)
			.then(d => { if (active) setDados(d); })
			.catch(() => { if (active) setDados(VAZIO); });
		return () => { active = false; };
	}, [empresaId, versao]);

	useEffect(() => {
		function mudou() { setVersao(v => v + 1); }
		window.addEventListener(EVENTO_AREAS, mudou);
		return () => window.removeEventListener(EVENTO_AREAS, mudou);
	}, []);

	const pronto = semEmpresa || !empresaId || dados !== null;
	const modulos = dados?.modulos ?? VAZIO.modulos;
	const canais = dados?.canais ?? VAZIO.canais;
	const frentesDaPessoa: FrenteId[] = isEquipe && dados ? dados.frentesEmpresa : frentes;

	const cobranca = semEmpresa || (frentesDaPessoa.includes('motorcob') && modulos.has('orquestracao'));
	const jornada = semEmpresa || (frentesDaPessoa.includes('motorcli') && modulos.has('jornada'));
	const mensageria = semEmpresa || modulos.has('mensageria');

	// Canal padrão: último usado se ainda contratado, senão o 1º dos contratados.
	let canalPadrao: CanalId = 'sms';
	let stored: string | null = null;
	try { stored = localStorage.getItem(CANAL_STORAGE_KEY); } catch { /* ignore */ }
	if (stored && isCanalValido(stored) && canais.includes(stored)) canalPadrao = stored;
	else if (canais.length > 0) canalPadrao = canais[0];
	else if (stored && isCanalValido(stored)) canalPadrao = stored;

	const destinoMensageria = canais.length > 0 ? `/mensageria/${canalPadrao}` : '/mensageria';

	return { cobranca, jornada, mensageria, canais, canalPadrao, destinoMensageria, semEmpresa, pronto };
}
