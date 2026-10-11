# MotorCob — pacote para o desenvolvedor (linha Apple)

Site: **motorcob.online** (Hostinger Horizons, React) · Banco/Auth/Storage: **Supabase** (projeto `jxwppkrkuckfwmphqjva`).
Motor e banco: github.com/ContraPontoPodcast/MotorCob (migrações em `supabase/migrations/`).

**Referência visual oficial:** `03_site_e_login/referencia/motorcob-prototipo.html`. Abra no navegador: é o
protótipo aprovado, navegável (site → "Entrar" → qualquer senha → qualquer código → sistema). Dados fictícios.
Ele substitui tudo o que foi enviado antes (tema preto e âmbar, site com vídeo): **descarte o pacote anterior.**

Faça **na ordem**; cada passo depende do anterior.

| # | Pasta | O que é | Onde | Quando |
|---|---|---|---|---|
| 1 | `02_supabase_painel` | **Segurança urgente**: fechar cadastro aberto, URLs de retorno, MFA | Painel Supabase | Hoje |
| 2 | `01_banco` | 4 SQLs: contato do site, Lista do dia agrupada, templates, workspace (fase 1) | Supabase › SQL Editor | Hoje |
| 3 | `03_site_e_login` | Site público em "/", login novo, plataforma em "/inicio", fim do "/cadastro" | Site | 1º |
| 4 | `04_sistema_linha_apple` | Visual do sistema: menu escuro, telas brancas, Lista do dia nova | Site | 2º |
| 5 | `05_usuarios_permissoes_seguranca` | Menus por permissão, Permissões, Auditoria, páginas de senha, sessão | Site | 3º |
| 6 | `04_sistema_linha_apple/PROMPT_TEMPLATES.md` | WhatsApp/RCS com template (busca); discador, e-mail e bureau sem frase | Site | 4º |
| 7 | `03_site_e_login/PROMPT_SITE_V3_CARROSSEL.md` | Site v3: carrossel com as 6 funções e uma seção por função (Orquestração, Mensageria, Arquivo ou API, Workspace) | Site | 5º |

Cada pasta do site tem `ESPECIFICACAO.md` (para quem programa à mão, com critérios de aceite) e `PROMPT_HORIZONS.md`
(o mesmo como prompt para colar no Horizons, com menos de 100 linhas). Use um ou outro.
`06_referencias`: guia do designer, **decisões do produto sobre o guia** (vencem o guia), segurança e nuvem.

## Regras que valem para tudo
- **Nada de dado pessoal na tela**: só o ID do cliente. Busca só por ID ou contrato (nunca CPF, nome ou telefone).
- **Nunca colocar a chave service_role no site.** Só a chave pública (anon/publishable). Ações de administrador
  passam pela Edge Function `admin-usuarios`, já publicada.
- Permissão é garantida no banco (RLS + `pode()`); o site só esconde o que a pessoa não pode usar.
- Erros em português, sem detalhe técnico. O login nunca diz se um e-mail existe.
- Não alterar tabelas, views, políticas ou funções sem falar com o MotorCob (versionadas e com 300 testes de acesso).

## Já pronto (não refazer)
Permissões por perfil e por usuário, auditoria, contatos do site, motivos agrupados da Lista do dia (após o SQL 2)
· Edge Function `admin-usuarios` · motor no Google Cloud (São Paulo) · Orquestração com frases · tela Usuários com convite.

## Checklist de aceite
- [ ] `/` abre o site; cabeçalho escuro; cada atalho (Plataforma, Orquestração, Mensageria, Personas, Workspace, Segurança, Contato) rola até a seção.
- [ ] Carrossel #plataforma: 6 slides, setas e pontos funcionam, ‹ desabilitado no 1º e › no último, sem rolagem automática.
- [ ] "Entrar" → login branco "Entre no MotorCob." → código (Admin) → `/inicio`.
- [ ] `/cadastro` redireciona para `/login` e o Supabase recusa cadastro novo.
- [ ] Contato grava em `contatos_site`; o visitante não lê a tabela.
- [ ] Sistema com menu escuro, telas brancas, fonte do sistema; champanhe só no símbolo; sem azul-petróleo nem âmbar.
- [ ] Lista do dia com os 4 grupos vindos de `motivos_hoje`; Orquestração com canais coloridos.
- [ ] WhatsApp e RCS escolhem template com busca; SMS e Agente virtual, frase; Discador, E-mail e Enriquecimento sem campo.
- [ ] Operação não vê menus de configuração; Admin vê Usuários, Permissões e Auditoria.
- [ ] Links de convite e "esqueci a senha" abrem a página de criar senha.
- [ ] Sem rolagem lateral em 1440, 1024 e 390 px, no Mac e no Windows.

Dúvidas de regra de negócio: Marcos Guerra (MotorCob).
