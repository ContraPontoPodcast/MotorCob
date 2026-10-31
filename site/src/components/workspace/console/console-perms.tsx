import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { type FrenteId } from '@/lib/frentes';

/** Permissões efetivas da pessoa: { chave: true | false }. */
export type EquipePerms = Record<string, boolean>;

/** Linha de rpc('listar_equipe'). */
export type EquipeMembro = {
	id: string;
	nome: string;
	email: string;
	funcao: string; // master | atendimento | comercial | administrativo
	alcance: string; // todas | carteira
	carteira: number;
	permissoes: EquipePerms;
	duas_etapas: boolean;
	ultimo_login: string | null;
	ultimo_acesso: string | null;
	ativo: boolean;
};

/** Linha de permissoes_equipe_catalogo. */
export type PermCatalogo = {
	permissao: string;
	grupo: string;
	nome: string;
	master: boolean;
	atendimento: boolean;
	comercial: boolean;
	administrativo: boolean;
	tecnico: boolean;
};

type ConsolePermsState = {
	membros: EquipeMembro[];
	eu: EquipeMembro | null;
	perms: EquipePerms;
	catalogo: PermCatalogo[];
	loading: boolean;
	isMaster: boolean;
	/** true se a pessoa pode ver a aba/permissão (Master vê tudo). */
	can: (perm: string) => boolean;
	reload: () => Promise<void>;
};

const Ctx = createContext<ConsolePermsState>({
	membros: [],
	eu: null,
	perms: {},
	catalogo: [],
	loading: true,
	isMaster: false,
	can: () => false,
	reload: async () => {},
});

export const useConsolePerms = () => useContext(Ctx);

export const PAPEL_LABEL: Record<string, string> = {
	master: 'Master',
	atendimento: 'Atendimento',
	comercial: 'Comercial',
	administrativo: 'Administrativo',
	tecnico: 'Técnico',
};

export const PAPEL_COR: Record<string, string> = {
	master: '#C9A35A',
	atendimento: '#8E8E93',
	comercial: '#0A60D0',
	administrativo: '#5856D6',
	tecnico: '#30B0C7',
};

export function ConsolePermsProvider({ children }: { children: ReactNode }) {
	const { perfil } = useMotorAuth();
	const [membros, setMembros] = useState<EquipeMembro[]>([]);
	const [catalogo, setCatalogo] = useState<PermCatalogo[]>([]);
	const [loading, setLoading] = useState(true);

	async function reload() {
		if (!supabase || !perfil?.equipe) { setLoading(false); return; }
		setLoading(true);
		const [eq, cat] = await Promise.all([
			supabase.rpc('listar_equipe'),
			supaseCatalogo(),
		]);
		const list = ((eq.data ?? []) as Row[]).map(normalizeMembro);
		setMembros(list);
		setCatalogo(cat);
		setLoading(false);
	}

	async function supaseCatalogo(): Promise<PermCatalogo[]> {
		if (!supabase) return [];
		const { data, error } = await supabase.from('permissoes_equipe_catalogo').select('*').order('grupo').order('nome');
		if (error || !data) return [];
		return (data as Row[]).map(r => ({
			permissao: String(r.permissao),
			grupo: String(r.grupo ?? ''),
			nome: String(r.nome ?? r.permissao),
			master: !!r.master,
			atendimento: !!r.atendimento,
			comercial: !!r.comercial,
			administrativo: !!r.administrativo,
			tecnico: !!r.tecnico,
		}));
	}

	useEffect(() => { void reload(); }, [perfil?.id, perfil?.equipe]);

	const eu = membros.find(m => m.id === perfil?.id) ?? null;
	// Master é da equipe: o Admin de uma empresa cliente (papel admin, sem equipe) nunca ganha permissão do Console.
	const isMaster = eu?.funcao === 'master' || (!!perfil?.equipe && perfil?.papel === 'admin');
	const perms = eu?.permissoes ?? {};

	function can(perm: string): boolean {
		if (isMaster) return true;
		return perms[perm] === true;
	}

	return (
		<Ctx.Provider value={{ membros, eu, perms, catalogo, loading, isMaster, can, reload }}>
			{children}
		</Ctx.Provider>
	);
}

/** Normaliza uma linha bruta de listar_equipe para EquipeMembro. */
function normalizeMembro(r: Row): EquipeMembro {
	const permissoes: EquipePerms = {};
	const p = r.permissoes;
	if (p && typeof p === 'object' && !Array.isArray(p)) {
		for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
			if (typeof v === 'boolean') permissoes[k] = v;
		}
	}
	return {
		id: String(r.id ?? ''),
		nome: String(r.nome ?? ''),
		email: String(r.email ?? ''),
		funcao: String(r.funcao ?? 'atendimento'),
		alcance: String(r.alcance ?? 'todas'),
		carteira: Number(r.carteira ?? 0),
		permissoes,
		duas_etapas: !!r.duas_etapas,
		ultimo_login: (r.ultimo_login as string | null) ?? null,
		ultimo_acesso: (r.ultimo_acesso as string | null) ?? null,
		ativo: r.ativo !== false,
	};
}

/** Hook: mapa empresa_id → frentes (empresa_frentes). */
export function useFrentesMap() {
	const [map, setMap] = useState<Record<string, FrenteId[]>>({});
	useEffect(() => {
		if (!supabase) return;
		let active = true;
		(async () => {
			const { data } = await supabase.from('empresa_frentes').select('empresa_id,frente');
			if (!active) return;
			const m: Record<string, FrenteId[]> = {};
			((data ?? []) as Row[]).forEach(r => {
				const id = String(r.empresa_id);
				const f = r.frente as FrenteId;
				if (f === 'motorcob' || f === 'motorcli') {
					m[id] = m[id] ? [...m[id], f] : [f];
				}
			});
			setMap(m);
		})();
		return () => { active = false; };
	}, []);
	return map;
}
