// Speech Analytics › Roleplay: treino de operadores humanos com cliente simulado (SPEC do Roleplay, PR 3: leitura e
// Cadastro para treino). Quem vê: quem tem treinar_operadores ou editar_cenarios_treino (Admin e Qualidade). O
// Roleplay vem com o módulo speech_analytics: sem ele, "Treinos indisponíveis" (o banco confere de novo em
// treino_liberado e em toda RPC do treino).
// Telas: Painel (/speech-analytics/roleplay), Cenários (/cenarios?f=), cenário (/cenarios/:id: editor para o da
// empresa), Novo cenário (/cenarios/novo), Treinos atribuídos (/atribuicoes?sit=), o treino (/atribuicoes/:id),
// Atribuir treino (/atribuir?cen=&ops=&sug=), Cadastro para treino (/operadores?eq=) e a pessoa (/operadores/:op). Rotas, trilha e títulos em lib/roleplay.ts; o "← Voltar"
// em lib/rota-pai.ts.
import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { Estado } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { usePodeRoleplay } from '../abas-speech';
import { MolduraRP } from './moldura';
import { treinoLiberado } from './dados';
import { Painel } from './painel';
import { Cenarios, DetalheCenario, NovoCenario } from './cenarios';
import { Atribuicoes, DetalheAtribuicao } from './atribuicoes';
import { AtribuirTreino } from './atribuir';
import { Cadastro } from './cadastro';
import { PaginaPessoa } from './pessoa';

export type TelaRP = { tipo: 'painel' } | { tipo: 'cenarios' } | { tipo: 'cenario'; id: string } | { tipo: 'novo_cenario' } | { tipo: 'cadastro' }
	| { tipo: 'pessoa'; id: string } | { tipo: 'atribuicoes' } | { tipo: 'atribuicao'; id: string } | { tipo: 'atribuir' };
export type PodeRP = { treinar: boolean; cenarios: boolean };

const TITULO_PADRAO: Record<TelaRP['tipo'], string> = {
	painel: 'Roleplay', cenarios: 'Cenários', cenario: 'Cenário', novo_cenario: 'Novo cenário', cadastro: 'Cadastro para treino', pessoa: 'Pessoa',
	atribuicoes: 'Treinos atribuídos', atribuicao: 'Treino', atribuir: 'Atribuir treino',
};

/** Estado de bloqueio, já dentro da moldura (trilha, abas e sub-navegação continuam). */
function Bloqueado({ tela, children }: { tela: TelaRP; children: ReactNode }) {
	return <MolduraRP titulo={TITULO_PADRAO[tela.tipo]}>{children}</MolduraRP>;
}

export function TreinosIndisponiveis() {
	return (
		<Estado tipo="semPermissao" titulo="Treinos indisponíveis">
			O Roleplay faz parte do Speech Analytics, que não está ativo para esta empresa. Quem contrata é o Admin, em
			Empresa › Contratação. Enquanto isso, nenhum treino abre, nem pelo link do operador.
		</Estado>
	);
}

export function Roleplay({ tela }: { tela: TelaRP }) {
	const { empresa, loading } = useMotorAuth();
	const { treinar, cenarios, ve } = usePodeRoleplay();
	const areas = useAreasLiberadas();
	const empresaId = empresa ? Number(empresa.id) : null;
	const [liberado, setLiberado] = useState<boolean | null>(null);

	useEffect(() => {
		if (!supabase || !empresaId || !ve) { setLiberado(null); return; }
		let ativo = true;
		setLiberado(null);
		treinoLiberado(supabase, empresaId).then(v => { if (ativo) setLiberado(v); }).catch(() => { if (ativo) setLiberado(false); });
		return () => { ativo = false; };
	}, [empresaId, ve]);

	if (loading) return <Bloqueado tela={tela}><Estado tipo="carregando" /></Bloqueado>;
	if (!empresaId) return <Bloqueado tela={tela}><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></Bloqueado>;
	if (!ve) {
		return (
			<Bloqueado tela={tela}>
				<Estado tipo="semPermissao" titulo="Seu perfil não vê os treinos de operadores.">
					O Roleplay é da Qualidade e do Admin. Quem libera é o Admin, em Empresa › Pessoas e perfis.
				</Estado>
			</Bloqueado>
		);
	}
	if ((areas.pronto && !areas.speech) || liberado === false) return <Bloqueado tela={tela}><TreinosIndisponiveis /></Bloqueado>;
	if (liberado === null || !areas.pronto) return <Bloqueado tela={tela}><Estado tipo="carregando" /></Bloqueado>;

	const pode: PodeRP = { treinar, cenarios };
	switch (tela.tipo) {
		case 'painel': return <Painel empresa={empresaId} pode={pode} />;
		case 'cenarios': return <Cenarios empresa={empresaId} pode={pode} />;
		case 'cenario': return <DetalheCenario empresa={empresaId} id={tela.id} pode={pode} />;
		case 'novo_cenario': return <NovoCenario empresa={empresaId} pode={pode} />;
		case 'atribuicoes': return <Atribuicoes empresa={empresaId} pode={pode} />;
		case 'atribuicao': return <DetalheAtribuicao empresa={empresaId} id={tela.id} pode={pode} />;
		case 'atribuir': return <AtribuirTreino empresa={empresaId} pode={pode} />;
		case 'cadastro': return <Cadastro empresa={empresaId} pode={pode} />;
		case 'pessoa': return <PaginaPessoa empresa={empresaId} id={tela.id} pode={pode} />;
	}
}
