// Barra de abas do Speech Analytics (redesign v2), a mesma nas abas e nas telas de detalhe do Roleplay: o detalhe
// continua mostrando onde a pessoa está (a aba-mãe fica marcada). A aba Roleplay só aparece para quem treina
// operadores ou cuida dos cenários (Admin e Qualidade, SQL 90).
import { Search } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { Abas } from '@/components/ds';
import { ABAS_SA, BUSCA_SA, PERM_SA, rotaSA, type AbaSA } from '@/lib/speech';

/** Quem vê a aba Roleplay. */
export function usePodeRoleplay(): { treinar: boolean; cenarios: boolean; ve: boolean } {
	const treinar = usePermissao(PERM_SA.treinarOperadores);
	const cenarios = usePermissao(PERM_SA.editarCenariosTreino);
	return { treinar, cenarios, ve: treinar || cenarios };
}

/** Abas visíveis para a pessoa (a Roleplay some sem as permissões do treino, mas fica se ela já está nela). */
export function abasVisiveis(atual: AbaSA, veRoleplay: boolean) {
	return ABAS_SA.filter(a => a.id !== 'roleplay' || veRoleplay || atual === 'roleplay');
}

export function AbasSpeech({ atual }: { atual: AbaSA }) {
	const { ve } = usePodeRoleplay();
	return (
		<Abas rotulo="Seções do Speech Analytics" atual={atual}
			itens={abasVisiveis(atual, ve).map(a => ({ id: a.id, nome: a.nome, to: rotaSA(a.id) }))}
			fim={{ id: BUSCA_SA.id, nome: BUSCA_SA.nome, to: rotaSA('busca'), icone: <Search size={14} aria-hidden="true" /> }} />
	);
}
