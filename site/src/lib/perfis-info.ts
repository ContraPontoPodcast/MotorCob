// Descrições dos perfis de acesso da empresa.
// Separado em arquivo próprio para evitar dependência circular entre os componentes.

export const PERFIS_INFO = [
  { id: 'admin', nome: 'Admin', desc: 'Tudo da empresa: pessoas e perfis, faturas, integrações e configurações.' },
  { id: 'planejamento', nome: 'Planejamento', desc: 'Monta estratégias, campanhas e réguas; envia cargas; vê resultados.' },
  { id: 'operacao', nome: 'Operação', desc: 'Trabalha a Lista do dia e as respostas dos clientes; não muda estratégias.' },
  { id: 'gestao', nome: 'Gestão', desc: 'Acompanha resultados e relatórios; não muda nada na operação.' },
  { id: 'qualidade', nome: 'Qualidade', desc: 'Vê só a área Speech Analytics: notas, alertas, gravações e evolução dos operadores. Precisa do Speech Analytics contratado.' },
] as const;

export type PerfilId = 'admin' | 'planejamento' | 'operacao' | 'gestao' | 'qualidade';

/** Nome do perfil para a tela (papel desconhecido aparece como veio). */
export function nomePerfil(papel: string | null | undefined): string {
  return PERFIS_INFO.find(p => p.id === papel)?.nome ?? papel ?? '';
}

/** Permissões que existem dentro do Speech Analytics: as únicas que o perfil Qualidade pode ter (igual a
 *  public.permissoes_speech(), SQL 89). Fora delas o banco diz "não" para a Qualidade, mesmo com ajuste. */
export const PERMISSOES_SPEECH: readonly string[] = ['ouvir_gravacoes', 'ver_transcricoes', 'ver_operadores', 'ver_alertas', 'curadoria_voz', 'editar_checklist'];

/** Padrão MotorCX do perfil Qualidade (igual a public.permissoes_qualidade()): editar o checklist fica com o Admin. */
export const PERMISSOES_QUALIDADE: readonly string[] = ['ouvir_gravacoes', 'ver_transcricoes', 'ver_operadores', 'ver_alertas', 'curadoria_voz'];

/** O perfil só enxerga a área Speech Analytics (e a própria conta). */
export function perfilSoSpeech(perfil: { papel?: string | null; equipe?: boolean | null } | null | undefined): boolean {
  return !!perfil && !perfil.equipe && perfil.papel === 'qualidade';
}

/** Padrão MotorCX de um perfil para uma permissão. O catálogo (permissoes_catalogo) tem uma coluna por perfil antigo;
 *  o da Qualidade é a lista fixa acima (como permissao_padrao() no banco). */
export function padraoDoPerfil(papel: string, codigo: string, linhaCatalogo: Record<string, unknown> | null | undefined): boolean {
  if (papel === 'qualidade') return PERMISSOES_QUALIDADE.includes(codigo);
  return Boolean(linhaCatalogo?.[papel]);
}

/** O perfil pode ter esta permissão? (a Qualidade só as do Speech; os outros, todas) */
export function perfilPodeTer(papel: string, codigo: string): boolean {
  return papel !== 'qualidade' || PERMISSOES_SPEECH.includes(codigo);
}
