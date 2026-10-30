// Descrições dos perfis de acesso da empresa.
// Separado em arquivo próprio para evitar dependência circular entre os componentes.

export const PERFIS_INFO = [
  { id: 'admin', nome: 'Admin', desc: 'Tudo da empresa: pessoas e perfis, faturas, integrações e configurações.' },
  { id: 'planejamento', nome: 'Planejamento', desc: 'Monta estratégias, campanhas e réguas; envia cargas; vê resultados.' },
  { id: 'operacao', nome: 'Operação', desc: 'Trabalha a Lista do dia e as respostas dos clientes; não muda estratégias.' },
  { id: 'gestao', nome: 'Gestão', desc: 'Acompanha resultados e relatórios; não muda nada na operação.' },
] as const;

export type PerfilId = 'admin' | 'planejamento' | 'operacao' | 'gestao';
