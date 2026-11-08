// Cabeçalho das telas do Agente de voz (Agente Voz/CX) com as sub-abas. "Configuração do canal" e "Modelos de mensagem"
// saíram daqui: ficam em Cobrança › Configurações › Canais e em Frases. "Roteiro (antigo)" aparece enquanto nenhum fluxo
// está em uso na carteira. O "← Agente de voz" das subtelas vem do PageHeading (lib/rota-pai.ts).
import type { ReactNode } from 'react';
import { PageHeading } from '@/components/app-shell';
import { SubAbas } from '@/components/voz/ui';
import { useFluxo, type Tela } from './contexto';

export function CabecalhoAgente({ titulo, desc, atual, acoes, titleExtra, roteiroAntigo }: { titulo: string; desc?: string; atual?: Tela; acoes?: ReactNode; titleExtra?: ReactNode; roteiroAntigo?: boolean }) {
	const { rota, demo } = useFluxo();
	return (
		<>
			<PageHeading title={titulo} description={desc} actions={acoes} titleExtra={titleExtra} semControles={demo} />
			{atual && (
				<SubAbas atual={atual} itens={[
					{ id: 'lista', nome: 'Fluxos', to: rota('lista') },
					{ id: 'testar', nome: 'Testar conversa', to: rota('testar') },
					{ id: 'desempenho', nome: 'Desempenho', to: rota('desempenho') },
					...(roteiroAntigo ? [{ id: 'roteiro', nome: 'Roteiro (antigo)', to: rota('roteiro') }] : []),
				]} />
			)}
		</>
	);
}

