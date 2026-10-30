import {
	Activity, Building, Building2, ClipboardList, FileUp, FileChartColumn, Landmark, LayoutDashboard, Map, MessageSquare,
	Route, ShieldCheck, Users, UsersRound, Wallet, type LucideIcon,
} from 'lucide-react';
import { PERM } from '@/lib/permissoes';

export type AtalhoAssistente = {
	id: string;
	nome: string;
	produto: string;
	descricao: string;
	icon: LucideIcon;
	rota: (canal: string) => string;
	perm?: string;
	equipe?: boolean;
};

/** Atalhos das telas que a pessoa pode abrir — mesmos itens dos menus dos produtos ativos. */
export const ATALHOS_ASSISTENTE: AtalhoAssistente[] = [
	// Orquestração
	{ id: 'inicio', nome: 'Início', produto: 'Orquestração', descricao: 'Visão geral do dia', icon: LayoutDashboard, rota: () => '/inicio' },
	{ id: 'lista', nome: 'Lista do dia', produto: 'Orquestração', descricao: 'Clientes que entram em ação', icon: ClipboardList, rota: () => '/fila' },
	{ id: 'acoes', nome: 'Ações', produto: 'Orquestração', descricao: 'Acompanhamento de ações', icon: Activity, rota: () => '/acoes' },
	{ id: 'painel', nome: 'Painel', produto: 'Orquestração', descricao: 'Métricas e indicadores', icon: LayoutDashboard, rota: () => '/painel', perm: PERM.verPainel },
	{ id: 'clientes', nome: 'Clientes', produto: 'Orquestração', descricao: 'Carteira e enquadramento', icon: Wallet, rota: () => '/clientes', perm: PERM.verClientes },
	{ id: 'personas', nome: 'Personas', produto: 'Orquestração', descricao: 'Personas da inteligência', icon: UsersRound, rota: () => '/personas', perm: PERM.verClientes },
	{ id: 'credores', nome: 'Carteiras', produto: 'Orquestração', descricao: 'Gestão de carteiras', icon: Landmark, rota: () => '/credores' },
	{ id: 'mapa', nome: 'Mapa da Esteira', produto: 'Orquestração', descricao: 'Fluxo de operação', icon: Map, rota: () => '/mapa' },
	{ id: 'orquestracao', nome: 'Orquestração', produto: 'Orquestração', descricao: 'Segmentos e estratégias', icon: Route, rota: () => '/orquestracao' },
	{ id: 'comite', nome: 'Comitê', produto: 'Orquestração', descricao: 'Arquivos de comitê', icon: ShieldCheck, rota: () => '/comite', perm: PERM.baixarComite },
	{ id: 'envios', nome: 'Enviar arquivos', produto: 'Orquestração', descricao: 'Cargas e retornos', icon: FileUp, rota: () => '/envios', perm: PERM.enviarArquivos },
	{ id: 'canais', nome: 'Canais e mensagens', produto: 'Orquestração', descricao: 'Horários, limites e textos de cada canal', icon: Activity, rota: () => '/canais', perm: PERM.editarCanais },
	// Mensageria
	{ id: 'mens_painel', nome: 'Painel', produto: 'Mensageria', descricao: 'Funil de envios', icon: MessageSquare, rota: c => `/mensageria/${c}` },
	{ id: 'mens_campanhas', nome: 'Campanhas', produto: 'Mensageria', descricao: 'Campanhas de envio', icon: MessageSquare, rota: c => `/mensageria/${c}/campanhas` },
	{ id: 'mens_lotes', nome: 'Lotes do dia', produto: 'Mensageria', descricao: 'Lotes de hoje', icon: MessageSquare, rota: c => `/mensageria/${c}/lotes` },
	{ id: 'mens_respostas', nome: 'Respostas', produto: 'Mensageria', descricao: 'Caixa de respostas', icon: MessageSquare, rota: c => `/mensageria/${c}/respostas` },
	{ id: 'mens_templates', nome: 'Templates', produto: 'Mensageria', descricao: 'Modelos de mensagem', icon: MessageSquare, rota: c => `/mensageria/${c}/templates` },
	{ id: 'mens_listas', nome: 'Listas', produto: 'Mensageria', descricao: 'Bloqueio e favoritos', icon: MessageSquare, rota: c => `/mensageria/${c}/listas` },
	{ id: 'mens_config', nome: 'Configurações', produto: 'Mensageria', descricao: 'Centros de custo', icon: MessageSquare, rota: c => `/mensageria/${c}/config` },
	{ id: 'relatorios', nome: 'Relatórios', produto: 'Mensageria', descricao: 'Relatórios e exportação', icon: FileChartColumn, rota: () => '/relatorios' },
	// Empresa
	{ id: 'empresa', nome: 'Empresa', produto: 'Empresa', descricao: 'Visão geral', icon: Building, rota: () => '/empresa' },
	{ id: 'faturamento', nome: 'Faturamento', produto: 'Empresa', descricao: 'Faturas e consumo', icon: Building2, rota: () => '/empresa/faturamento', perm: PERM.verFaturamento },
	{ id: 'membros', nome: 'Pessoas e perfis', produto: 'Empresa', descricao: 'Usuários da empresa', icon: Users, rota: () => '/empresa/pessoas?aba=pessoas' },
	{ id: 'modulos', nome: 'Integrações', produto: 'Empresa', descricao: 'Orquestração e Mensageria', icon: Building2, rota: () => '/empresa/integracoes' },
	// Minha conta
	{ id: 'conta', nome: 'Minha conta', produto: 'Minha conta', descricao: 'Dados do perfil', icon: Users, rota: () => '/conta' },
	{ id: 'seguranca', nome: 'Segurança', produto: 'Minha conta', descricao: 'Senha e verificação', icon: ShieldCheck, rota: () => '/conta?aba=seguranca' },
	{ id: 'tokens', nome: 'Tokens de API', produto: 'Empresa', descricao: 'Chaves de acesso', icon: ShieldCheck, rota: () => '/empresa/integracoes', perm: PERM.gerenciarApi },
	// Suporte
	{ id: 'suporte', nome: 'Suporte', produto: 'Suporte', descricao: 'Meus chamados', icon: ShieldCheck, rota: () => '/suporte' },
	{ id: 'chamado', nome: 'Abrir chamado', produto: 'Suporte', descricao: 'Novo chamado', icon: ShieldCheck, rota: () => '/suporte/novo' },
	// Documentação
	{ id: 'docs', nome: 'Documentação', produto: 'Documentação', descricao: 'Manual e API', icon: FileUp, rota: () => '/docs' },
	// Console (equipe)
	{ id: 'console', nome: 'Console MotorCX', produto: 'Console', descricao: 'Empresas e saúde', icon: Activity, rota: () => '/console', equipe: true },
];
