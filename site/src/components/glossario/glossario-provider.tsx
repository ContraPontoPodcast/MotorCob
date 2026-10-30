import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buscarGlossario, type GlossarioTerm } from '@/lib/glossario';
import { useMotorAuth } from '@/components/auth-provider';

type GlossarioContextValue = {
	terms: GlossarioTerm[];
	bySlug: Map<string, GlossarioTerm>;
	loading: boolean;
	reload: () => Promise<void>;
};

const Ctx = createContext<GlossarioContextValue>({
	terms: [],
	bySlug: new Map(),
	loading: true,
	reload: async () => {},
});

export function useGlossario() {
	return useContext(Ctx);
}

/** Carrega o glossário uma vez por sessão e cacheia por slug para os (i) da plataforma. */
export function GlossarioProvider({ children }: { children: ReactNode }) {
	const { session } = useMotorAuth();
	const [terms, setTerms] = useState<GlossarioTerm[]>([]);
	const [loading, setLoading] = useState(true);

	async function reload() {
		try {
			const all = await buscarGlossario('');
			setTerms(all);
		} catch {
			setTerms([]);
		} finally {
			setLoading(false);
		}
	}

	// O glossário só é usado na área logada (popovers Info e a página
	// /ajuda/o-que-significa). No site público (anon) a tabela não é legível,
	// e a chamada devolvia 401 a cada carregamento de página.
	useEffect(() => {
		if (!session) {
			setTerms([]);
			setLoading(false);
			return;
		}
		void reload();
	}, [session]);

	const bySlug = useMemo(() => {
		const m = new Map<string, GlossarioTerm>();
		for (const t of terms) m.set(t.slug, t);
		return m;
	}, [terms]);

	return <Ctx.Provider value={{ terms, bySlug, loading, reload }}>{children}</Ctx.Provider>;
}
