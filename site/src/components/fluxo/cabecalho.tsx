// Cabeçalho das telas do Agente virtual com as sub-abas (Configuração do canal e Modelos de mensagem são telas que já
// existem; "Roteiro (antigo)" aparece enquanto nenhum fluxo está em uso na carteira).
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
					{ id: 'canal', nome: 'Configuração do canal', to: '/canais' },
					{ id: 'frases', nome: 'Modelos de mensagem', to: '/canais?secao=frases' },
					{ id: 'lista', nome: 'Fluxos', to: rota('lista') },
					{ id: 'testar', nome: 'Testar conversa', to: rota('testar') },
					{ id: 'desempenho', nome: 'Desempenho', to: rota('desempenho') },
					...(roteiroAntigo ? [{ id: 'roteiro', nome: 'Roteiro (antigo)', to: rota('roteiro') }] : []),
				]} />
			)}
		</>
	);
}

