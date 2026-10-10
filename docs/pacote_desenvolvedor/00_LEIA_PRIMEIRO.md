# MotorCob — pacote para o desenvolvedor

Site: **motorcob.online** (Hostinger Horizons, React) · Banco/Auth/Storage: **Supabase** (projeto `jxwppkrkuckfwmphqjva`)
Repositório do motor e do banco: github.com/ContraPontoPodcast/MotorCob (migrações em `supabase/migrations/`).

Este pacote junta tudo o que falta no site. Faça **na ordem** abaixo: cada passo depende do anterior.

| # | Pasta | O que é | Onde se faz | Prazo sugerido |
|---|---|---|---|---|
| 1 | `02_supabase_painel` | **Segurança urgente**: fechar o cadastro aberto, URLs de retorno, MFA | Painel do Supabase | Hoje |
| 2 | `01_banco` | SQL da página comercial (mídia pública + formulário de contato) | Supabase › SQL Editor | Hoje |
| 3 | `03_site_comercial_e_login` | Nova home comercial em "/", novo login, plataforma em "/inicio", fim do "/cadastro" | Site | 1º |
| 4 | `05_usuarios_permissoes_seguranca` | Menus por permissão, página Permissões, Auditoria, MFA do Admin, páginas de senha | Site | 2º |
| 5 | `04_tema_preto_ambar` | Troca de cores da plataforma (só cores) | Site | 3º |

Cada pasta do site tem:
- `ESPECIFICACAO.md` — o que fazer, com critérios de aceite (para quem programa à mão);
- `PROMPT_HORIZONS.md` — o mesmo conteúdo como prompt pronto para colar no Hostinger Horizons (< 100 linhas cada).
Use um ou outro, não os dois.

## Regras que valem para tudo
- **Nada de dado pessoal na tela**: o site mostra só o ID do cliente (sem CPF, telefone ou nome do devedor).
- **Nunca colocar a chave service_role no site.** O site usa só a chave pública (anon / publishable). Ações de
  administrador (convite, desativar, reset de senha) passam pela Edge Function `admin-usuarios`, já publicada.
- **Permissão é garantida no banco** (RLS + função `pode()`); o site só esconde o que o usuário não pode usar.
- Mensagens de erro em português, sem detalhe técnico. Login nunca diz se um e-mail existe.
- Não alterar tabelas, views, políticas ou funções do banco sem falar com o MotorCob (todas são versionadas e
  testadas no repositório; 253 testes de acesso).

## Já pronto (não refazer)
Banco com permissões por perfil e por usuário, auditoria, contatos do site · Edge Function `admin-usuarios`
publicada · motor rodando no Google Cloud (São Paulo) · Orquestração com frases por dia e no CPC · tela Usuários
com convite e acessos.

## Como conferir no final (checklist de aceite)
- [ ] `https://motorcob.online/` abre a página comercial (sem login).
- [ ] "Entrar" leva ao login novo; depois do login cai em `/inicio`.
- [ ] `/cadastro` não existe mais (redireciona para `/login`) e o Supabase recusa cadastro novo (passo 1).
- [ ] Formulário de contato grava em `contatos_site`; o visitante não consegue ler a tabela.
- [ ] Usuário Operação não vê menus de configuração; Admin vê Usuários, Permissões e Auditoria.
- [ ] Admin precisa do código do autenticador para entrar.
- [ ] Link de convite e de "esqueci a senha" abrem a página de criar senha.
- [ ] Plataforma em preto e âmbar, sem azul-petróleo; alertas em laranja-avermelhado.
- [ ] Nenhuma rolagem lateral em 1280, 1440 e 390 px (celular).

Dúvidas de regra de negócio: Marcos Guerra (MotorCob).
