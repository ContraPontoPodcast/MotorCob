import { useEffect, useState } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { supabase, type Row } from '@/lib/supabase';
import { CANAL_STORAGE_KEY, isCanalValido, type CanalId } from '@/lib/mensageria-produtos';

export type AreasLiberadas = {
	cobranca: boolean;
	jornada: boolean;
	mensageria: boolean;
	/** Canais contratados da mensageria (empresa_modulos.canais da linha mensageria ativa). */
	canais: CanalId[];
	/** Último canal usado se ainda contratado, senão o 1º dos contratados. Nunca 'sms' fixo. */
	canalPadrao: CanalId;
	/** Equipe sem empresa na pílula (vê todas as áreas). */
	semEmpresa: boolean;
};

/**
 * Regra única de áreas liberadas, igual para cliente e equipe com pílula:
 * Cobrança se a empresa tem a frente motorcob; Jornada se tem motorcli;
 * Mensageria se empresa_modulos.modulo='mensageria' com ativo=true.
 * Equipe SEM empresa na pílula vê todas as áreas.
 */
export function useAreasLiberadas(): AreasLiberadas {
	const { perfil, empresa } = useMotorAuth();
	const { frentes } = useFrente();
	const [canais, setCanais] = useState<CanalId[]>([]);
	const [mensageriaAtiva, setMensageriaAtiva] = useState(false);

	const isEquipe = !!perfil?.equipe;
	const semEmpresa = isEquipe && !empresa;

	useEffect(() => {
		if (!supabase || !empresa) { setCanais([]); setMensageriaAtiva(false); return; }
		let active = true;
		(async () => {
			try {
				const { data } = await supabase.from('empresa_modulos').select('modulo,ativo,canais').eq('empresa_id', empresa.id);
				if (!active) return;
				const rows = (data ?? []) as Row[];
				const msg = rows.find(r => r.modulo === 'mensageria');
				setMensageriaAtiva(!!msg?.ativo);
				const c = Array.isArray(msg?.canais) ? (msg!.canais as string[]).filter((x): x is CanalId => isCanalValido(x)) : [];
				setCanais(c);
			} catch { if (active) { setCanais([]); setMensageriaAtiva(false); } }
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	const cobranca = semEmpresa || frentes.includes('motorcob');
	const jornada = semEmpresa || frentes.includes('motorcli');
	const mensageria = semEmpresa || mensageriaAtiva;

	// Canal padrão: último usado se ainda contratado, senão o 1º dos contratados.
	let canalPadrao: CanalId = 'sms';
	let stored: string | null = null;
	try { stored = localStorage.getItem(CANAL_STORAGE_KEY); } catch { /* ignore */ }
	if (stored && isCanalValido(stored) && canais.includes(stored)) canalPadrao = stored;
	else if (canais.length > 0) canalPadrao = canais[0];
	else if (stored && isCanalValido(stored)) canalPadrao = stored;

	return { cobranca, jornada, mensageria, canais, canalPadrao, semEmpresa };
}
