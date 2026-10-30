// Códigos de permissão usados em todo o site (no lugar do papel fixo).
// O contexto de auth carrega a lista efetiva do usuário via permissoes_do_usuario(uid).

export const PERM = {
  verPainel: 'ver_painel',
  baixarListas: 'baixar_listas',
  verClientes: 'ver_clientes',
  buscarCliente: 'buscar_cliente',
  reenquadrar: 'reenquadrar',
  exportarDados: 'exportar_dados',
  baixarRelatorios: 'baixar_relatorios',
  baixarComite: 'baixar_comite',
  verFaturamento: 'ver_faturamento',
  pagarFaturas: 'pagar_faturas',
  editarOrquestracao: 'editar_orquestracao',
  editarCredores: 'editar_credores',
  editarCanais: 'editar_canais',
  enviarArquivos: 'enviar_arquivos',
  verAcessos: 'ver_acessos',
  verAuditoria: 'ver_auditoria',
  gerenciarUsuarios: 'gerenciar_usuarios',
  gerenciarPermissoes: 'gerenciar_permissoes',
  gerenciarEmpresas: 'gerenciar_empresas',
  gerenciarApi: 'gerenciar_api',
} as const;

export type PermCode = (typeof PERM)[keyof typeof PERM];

/** Mensagem padrão para erro de permissão do banco (RLS / função). */
export const SEM_PERMISSAO_MSG =
  'Seu perfil não tem permissão para esta ação. Fale com o Admin da sua empresa.';

/** Retorna true se o erro do Supabase indica falta de permissão (RLS / 42501 / função). */
export function isPermissionError(err: unknown): boolean {
  const e = err as Record<string, unknown> | null;
  if (!e) return false;
  const code = String(e.code ?? '');
  const msg = String(e.message ?? '').toLowerCase();
  return code === '42501' || code === '42503' || msg.includes('permission denied') || msg.includes('não tem permissão');
}
