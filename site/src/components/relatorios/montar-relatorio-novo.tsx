import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { MontarRelatorio } from '@/components/relatorios/montar-relatorio';
import { produtoAtivo, type RelatorioBase, type RelatorioCampo } from '@/lib/relatorios';

/** Página /relatorios/novo: carrega bases e campos do produto da aba e renderiza o montador de 3 passos. */
export function MontarRelatorioNovo() {
	const { empresa } = useMotorAuth();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const [bases, setBases] = useState<RelatorioBase[]>([]);
	const [camposByBase, setCamposByBase] = useState<Record<string, RelatorioCampo[]>>({});
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		(async () => {
			// Módulos contratados para definir o produto ativo.
			const { data: mods } = await supabase.from('empresa_modulos').select('modulo,ativo').eq('empresa_id', empresa.id);
			const m: Record<string, boolean> = {};
			(mods ?? []).forEach((r: Row) => { m[r.modulo] = !!r.ativo; });
			const mod = { mensageria: !!m.mensageria, orquestracao: !!(m.orquestracao || m.cobranca), jornada: !!m.jornada };
			const produto = produtoAtivo(params.get('produto'), mod);

			const [bs, cs] = await Promise.all([
				supabase.from('relatorio_bases').select('*').eq('visivel', true).order('ordem'),
				supabase.from('relatorio_campos').select('*').order('ordem'),
			]);
			if (!active) return;
			if (bs.error || cs.error) { setErro(friendlyError()); setLoading(false); return; }
			setBases(((bs.data ?? []) as RelatorioBase[]).filter(b => b.produto === produto));
			const map: Record<string, RelatorioCampo[]> = {};
			(cs.data ?? []).forEach((c: Row) => { (map[c.base] ??= []).push(c as RelatorioCampo); });
			setCamposByBase(map);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, params]);

	if (loading) return <div className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando…</div>;
	if (erro) return <div className="mx-auto max-w-[860px] px-4 py-6"><p className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</p></div>;

	return (
		<MontarRelatorio
			bases={bases}
			camposByBase={camposByBase}
			onBack={() => navigate('/relatorios')}
			onSaved={() => navigate('/relatorios')}
		/>
	);
}
