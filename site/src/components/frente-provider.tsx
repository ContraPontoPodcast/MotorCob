import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { FRENTES, FRENTE_PADRAO, FRENTE_STORAGE_KEY, frenteInfo, frenteLembrada, guardarFrente, type FrenteId, type FrenteInfo, type FrenteRow } from '@/lib/frentes';

type FrenteState = {
	frentes: FrenteId[];
	frente: FrenteId;
	info: FrenteInfo;
	loading: boolean;
	/** Define a frente ativa (sem chamar o backend). */
	setFrente: (id: FrenteId) => void;
	/** Escolhe a frente chamando rpc('escolher_frente') e atualiza o contexto. */
	escolherFrente: (id: FrenteId, lembrar: boolean) => Promise<void>;
	/** Aplica a frente do link: troca só o contexto (sessionStorage), sem chamar o
	 *  backend nem mexer na frente preferida (localStorage). */
	aplicarFrente: (id: FrenteId) => void;
};

const Context = createContext<FrenteState>({
	frentes: [FRENTE_PADRAO],
	frente: FRENTE_PADRAO,
	info: FRENTES[FRENTE_PADRAO],
	loading: true,
	setFrente: () => {},
	escolherFrente: async () => {},
	aplicarFrente: () => {},
});

export const useFrente = () => useContext(Context);

export function FrenteProvider({ children }: { children: ReactNode }) {
	const [frentes, setFrentes] = useState<FrenteId[]>([FRENTE_PADRAO]);
	const [frente, setFrenteState] = useState<FrenteId>(FRENTE_PADRAO);
	const [loading, setLoading] = useState(true);

	// Carrega as frentes do usuário depois do login.
	useEffect(() => {
		if (!supabase) { setLoading(false); return; }
		let active = true;
		async function load() {
			const { data: session } = await supabase.auth.getSession();
			if (!session.session) { if (active) { setFrentes([FRENTE_PADRAO]); setFrenteState(FRENTE_PADRAO); setLoading(false); } return; }
			let ids: FrenteId[] = [FRENTE_PADRAO];
			try {
				const { data, error } = await supabase.rpc('minhas_frentes');
				if (!active) return;
				if (!error && Array.isArray(data) && data.length) {
					ids = (data as FrenteRow[]).map(r => r.frente).filter((f): f is FrenteId => f === 'motorcob' || f === 'motorcli');
					if (!ids.length) ids = [FRENTE_PADRAO];
				}
			} catch { /* RPC indisponível — usa a padrão */ }
			if (!active) return;
			setFrentes(ids);
			const lembrada = frenteLembrada();
			const inicial = lembrada && ids.includes(lembrada) ? lembrada : ids[0];
			setFrenteState(inicial);
			setLoading(false);
		}
		void load();
		const { data: listener } = supabase.auth.onAuthStateChange((event) => {
			if (event === 'SIGNED_OUT') { setFrentes([FRENTE_PADRAO]); setFrenteState(FRENTE_PADRAO); sessionStorage.removeItem(FRENTE_STORAGE_KEY); }
			else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') { void load(); }
		});
		return () => { active = false; listener.subscription.unsubscribe(); };
	}, []);

	// Aplica a cor da frente como variável CSS global.
	useEffect(() => {
		document.documentElement.style.setProperty('--frente', frenteInfo(frente).cor);
	}, [frente]);

	// Para a equipe, a frente vem da empresa selecionada (empresa_frentes),
	// não de uma escolha da pessoa. Clientes continuam com a frente escolhida.
	const { perfil, empresa } = useMotorAuth();
	useEffect(() => {
		if (!supabase || !perfil?.equipe || !empresa) return;
		let active = true;
		(async () => {
			const { data } = await supabase.from('empresa_frentes').select('frente').eq('empresa_id', empresa.id);
			if (!active) return;
			const ids = ((data ?? []) as { frente: string }[]).map(r => r.frente).filter((f): f is FrenteId => f === 'motorcob' || f === 'motorcli');
			if (ids.length === 0) return;
			// Se a frente atual não está entre as da empresa, troca para a primeira.
			if (!ids.includes(frente)) {
				setFrenteState(ids[0]);
				try { sessionStorage.setItem(FRENTE_STORAGE_KEY, ids[0]); } catch { /* ignore */ }
			}
		})();
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [perfil?.equipe, empresa?.id]);

	function setFrente(id: FrenteId) {
		setFrenteState(id);
		guardarFrente(id, false);
	}

	async function escolherFrente(id: FrenteId, lembrar: boolean) {
		setFrenteState(id);
		guardarFrente(id, lembrar);
		if (supabase) { try { await supabase.rpc('escolher_frente', { p_frente: id, p_lembrar: lembrar }); } catch { /* ignora */ } }
	}

	function aplicarFrente(id: FrenteId) {
		setFrenteState(id);
		try { sessionStorage.setItem(FRENTE_STORAGE_KEY, id); } catch { /* ignore */ }
	}

	return (
		<Context.Provider value={{ frentes, frente, info: frenteInfo(frente), loading, setFrente, escolherFrente, aplicarFrente }}>
			{children}
		</Context.Provider>
	);
}
