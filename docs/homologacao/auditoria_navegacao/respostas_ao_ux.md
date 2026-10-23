# Respostas do CX ao UX — perguntas da proposta e revisão do PROMPT_73

23/10/2026 · Fontes:
- Bundle publicado: `/tmp/claude-0/site2/js` e a cópia legível em `scratchpad/cx/pretty/`.
- CSS publicado (baixado em `scratchpad/cx/css/index.css`).
- Migrations em `/home/user/motorcob/supabase/migrations` e na `origin/main`: SQL 45 = `20261212000001_links_inicio.sql`; prompts 71 e 72.
- Duas chamadas sem login à função `api` (só leitura).

Legenda: **confirmado** = está no código publicado ou no SQL do repositório · **suspeita** = deduzido, com risco de o banco de produção ser diferente do repositório · **sem login** = não dá para saber sem entrar.

## Antes das respostas: três achados novos que mudam o prompt 73

**N1. `escolherFrente(x, false)` apaga a preferência. Suspeita forte.**
- O que o código faz:
  - `frente-provider-PSGHOLbq.js`, função `b(e, t)`: grava a frente em sessionStorage; com `t=false` faz `localStorage.removeItem('mc-frente')`; depois chama `rpc('escolher_frente', { p_frente: e, p_lembrar: t })`.
  - No SQL (`20261115000001_motorcli.sql`), `escolher_frente` faz `update perfis set frente_preferida = case when p_lembrar then p_frente end`. Com `p_lembrar=false`, grava **NULL**.
- Consequência: hoje, a gaveta do celular (`p('motorcob', !1)`) e o botão "Trocar para…" (`n(a, !1)`) apagam a "Área que abre primeiro" da pessoa no banco e no navegador.
- Correção para o prompt 73: a troca automática pela rota tem que usar `aplicarFrente(f)`, que só grava em sessionStorage e não chama RPC. Nunca usar `escolherFrente(f, false)` nem `setFrente`, que também apaga o localStorage.

**N2. `ver_painel` e `ver_clientes` não existem no catálogo de permissões. Suspeita forte.**
- O que o código faz:
  - O site esconde "Clientes" e "Personas" (`perm: p.verClientes`) e "Painel" (`perm: p.verPainel`) de quem não tem essas permissões.
  - A tela `/painel` fica atrás de um RoleGate com `ver_painel`.
  - A lista de permissões vem de `rpc('permissoes_do_usuario')`. Essa função faz `cross join public.permissoes_catalogo`.
  - A última versão do catálogo (`20261204000001_faturas_contratacao.sql`) tem 16 códigos, e `ver_painel`, `ver_clientes`, `buscar_cliente` e `exportar_dados` não estão entre eles.
- Consequência: se o banco de produção for igual ao repositório, nenhum cliente vê Clientes, Personas nem Painel no menu, e `/painel` responde "Acesso não autorizado para este perfil." para todos.
- Isso explicaria parte dos "bugs de navegação". Confirmar logado (basta ver se o menu da Cobrança mostra "Clientes"). Se confirmar, é **Alta** e a correção é no **banco** (pôr os códigos no catálogo). O prompt 73 diz "Não exige SQL novo", o que pode não ser verdade.

**N3. O modelo de dados não tem "cliente só de Mensageria". Confirmado no SQL.**
- O que o código faz:
  - Toda empresa nova ganha a frente `motorcob` pelo gatilho `frente_inicial` e o módulo `orquestracao` pelo gatilho `modulo_inicial`.
  - `salvar_frentes` (a Contratação do Console) recusa lista vazia ("escolha o MotorCob, o MotorCli ou os dois") e força `orquestracao` ativo.
- Consequência: uma empresa "só Mensageria" sempre aparece com Cobrança (ou Jornada) contratada, tanto no Áreas ▾ quanto em `numeros_areas`.
- O cenário de teste do prompt 73 ("outra só com Mensageria (WhatsApp)") não pode ser montado. E mesmo com o menu certo em `/mensageria/*`, essa empresa continua vendo a Cobrança como contratada.
- Para resolver de verdade é preciso uma decisão de produto mais SQL (permitir zero frentes, ou tratar `orquestracao` como contratado à parte). Fica fora da Onda 1, mas o prompt não deve prometer isso.

## Respostas às 14 perguntas

**1. Canais contratados. Confirmado.**
- A tela `/mensageria` (`mensageria-index`) lê `from('empresa_modulos').select('canais').eq('empresa_id', e.id).eq('modulo','mensageria').maybeSingle()` e marca como contratado o canal que está em `canais`. Ela não olha `ativo`.
- O `app-shell` lê a mesma tabela (`modulo,ativo,canais`), e o seletor de canal também usa `canais` sem olhar `ativo`.
- RLS: `empresa_modulos_ver ... using (empresa_id in (select public.minhas_empresas()))`, então o cliente lê.
- Para o menu, a regra é: canais = `canais` da linha `modulo='mensageria'` **com `ativo=true`**. Sem `ativo`, uma Mensageria desligada continua mostrando canais.
- Detalhe: `mensageria_lotes.canal` só aceita `sms`, `email` e `rcs` (check em `20261110000001_rotas_margem.sql`). No WhatsApp, "Lotes" fica sempre vazio (**suspeita** de que não deva aparecer).

**2. A frente filtra dados? Confirmado: quase nada.**
- A frente não filtra Lista do dia, `/clientes`, `/painel` nem o seletor de carteira.
  - O `auth-provider` carrega `credores` da empresa sem filtrar por `frente` (função `L`).
  - O cabeçalho mostra todas as carteiras, inclusive as da Jornada.
- Onde a frente pesa:
  - menu e tema;
  - pílula no Início;
  - contexto enviado ao Assistente (`assistente-context`, `frente: i`);
  - `jornada-shell`, que filtra `credores` com `frente === 'motorcli'`.
- Efeitos colaterais da troca: não recarrega a página e não limpa a carteira escolhida (que fica em localStorage por empresa).
- O 2º argumento de `p('motorcob', !1)` é `lembrar`. Com `false`, **apaga** a preferência no localStorage e no banco (N1). Use `aplicarFrente`.
- Atenção (suspeita): para a equipe, o provider troca a frente sozinho para a 1ª frente da empresa escolhida na pílula (efeito sobre `empresa_frentes`). Isso pode brigar com a troca pela rota. Testar com uma conta da equipe.

**3. Cliente só de Mensageria. Confirmado no SQL; ver N3.**
- `minhas_frentes()` devolve as frentes ativas da empresa (união com as duas para a equipe), filtradas por `usuario_frentes` se houver.
- Na prática, uma empresa de Mensageria sempre tem `motorcob`, porque o gatilho cria e `salvar_frentes` não aceita lista vazia.
- Se a RPC falhar ou vier vazia, o site cai em `['motorcob']`: `i.length || (i = [s])` no `frente-provider`.
- Resposta direta: sim, o Áreas ▾ de hoje mostra a Cobrança como contratada (`P = N || u.includes('motorcob')`).
- **Suspeita** a verificar logado: `minhas_frentes` é `returns setof text`, mas o site faz `t.map(e => e.frente)`. Se o PostgREST devolver `["motorcob","motorcli"]` (valores soltos), o `.frente` vira `undefined` e **todo mundo** fica com `['motorcob']`. Com o bloqueio "não faz parte do plano" do prompt 73, isso trancaria os clientes da Jornada fora de `/jornada/*`. Confirmar no console do navegador (`await supabase.rpc('minhas_frentes')`) antes de publicar.

**4. Mensageria por pessoa. Confirmado.**
- Não existe forma de tirar a Mensageria de uma pessoa. `usuario_frentes` e `pessoas_empresa.areas` só conhecem `cobranca` e `jornada`.
- A Mensageria é o módulo da empresa (`empresa_modulos`, `mensageria` ativo) mais a permissão `enviar_mensagens` para agir. O padrão do catálogo é Admin e Planejamento, não Operação e Gestão.
- `enviar_mensagens` é checada dentro das telas (`mensageria-atendimento`, `-campanhas`, `-campanha-detalhe`, `-canal-layout`), não no menu.
- Conclusão: "contratada" = módulo ativo. A Operação entra na Mensageria, mas não aprova nem pausa lotes.

**5. Permissões. Confirmado (padrão do catálogo, ajustável por empresa em `permissoes_papel`).**

| Tela (RoleGate) | Permissão | Perfis no padrão |
|---|---|---|
| Comitê `/comite` | `baixar_comite` | Admin, Planejamento, Gestão |
| Auditoria `/empresa/auditoria` | `ver_auditoria` | Admin |
| Enviar carga `/envios` | `enviar_arquivos` | Admin, Planejamento |
| Painel `/painel` | `ver_painel` | **nenhum: o código não está no catálogo (N2)** |
| Faturas `/empresa/faturamento` (checagem própria, não RoleGate) | `ver_faturamento` | Admin, Gestão |
| Pagar e recarregar (dentro de Faturas) | `pagar_faturas` | Admin |
| `/empresas` (checagem própria) | equipe com papel admin | só equipe |

- O RoleGate só recebe a permissão. Para o texto "{Tela} é do perfil {…}", leia `permissoes_catalogo` (a view é legível por `authenticated`) mais os ajustes de `permissoes_papel` da empresa.
- A Operação abre `/empresa/pessoas`? A tela abre, sem bloqueio, e mostra "Quem convida e ajusta perfis é o Admin da sua empresa." Mas a lista vem de `from('perfis')`, e a RLS `perfis_ver` só deixa ver o próprio perfil, a menos que a pessoa seja Admin da empresa ou da equipe. **Confirmado no SQL:** a Operação vê só a si mesma. "Ver quem é o Admin" vira beco.
- Saídas possíveis: (a) a tela Pessoas passa a usar `rpc('pessoas_empresa')`, que é security definer e devolve todos com nome (o e-mail vem vazio para quem não gerencia), como o prompt 69 já pedia; ou (b) trocar o link por texto.

**6. Faixas de bloqueio. Confirmado.**
- `rpc('acesso_da_empresa')` devolve `bloqueada = situacao in ('suspensa','encerrada','inadimplente')`. Faixas no `app-shell`:
  1. Bloqueada com acordo quebrado e saldo: "O acordo de pagamento foi desfeito… pague em Faturamento para liberar" + Pagar agora.
  2. Bloqueada `inadimplente`: "A fatura está vencida há mais de 10 dias. O acesso está bloqueado e os envios estão parados…" + Pagar agora.
  3. Bloqueada `suspensa`/`encerrada`: "Acesso suspenso pela equipe MotorCX. Fale com o Suporte." (sem botão).
  4. Não bloqueada, parcela do acordo vencida: aviso + Pagar agora.
  5. Acordo em dia: só aparece se `pathname` for `/inicio` ou `/empresa/faturamento`. Essas rotas usam o `workspace-shell`, então **essa faixa nunca aparece** (código morto).
  6. `liberada_ate`: "Acesso liberado pela MotorCX até… pague até lá" + Pagar agora.
- O que bloqueia de fato, quando `bloqueada`:
  - **Todo** o conteúdo das áreas (`app-shell`) é trocado pelo cartão "Acesso bloqueado por fatura vencida · Pague a fatura em aberto…" + Pagar agora.
  - Isso vale **também para suspensa/encerrada**, ou seja, texto errado e botão de pagar para uma empresa suspensa pela equipe.
  - A exceção por regex (`/^\/(empresa\/faturamento|suporte)/`) nunca vale dentro do `app-shell`, porque essas rotas estão no Workspace.
  - O Workspace (Início, Empresa, Suporte, Conta) **não** bloqueia nada.
  - "Envios parados" é afirmação do texto; quem pausa é o motor e não deu para verificar no site (**sem login**).
- `pagar_faturas` é a permissão certa para os botões de pagar (`empresa-faturamento`: `Z = n.includes('pagar_faturas')`). Mas a página inteira exige antes `ver_faturamento`. Para mostrar "Pagar agora", exija as duas.

**7. Score. Confirmado que a tela ignora o canal.**
- `mensageria-score` não usa `:canal`: lê `empresa_score` e as RPCs `economia_score`, `controle_score`, `score_formacao` e `vitrine_score`, todas por empresa.
- O preço de referência é `preco_sms`, e `score_entrega(..., item_produto default 'sms')`.
- Hoje a tela abre em qualquer canal com o mesmo conteúdo (título "Economia do Score · Mensageria"). O único link vem de `mensageria-campanha-nova` (caixa `score-formacao-box`).
- "Só em SMS" é coerente com o preço, mas o score vale por produto/campanha. Prefira um item **fora do bloco do canal** ("Score de Entrega", em Atendimento/Resultados) ou só em SMS e RCS. Decisão de produto; **suspeita** quanto ao RCS.

**8. Telas órfãs. Confirmado.**
- `/estrategias` e `/estrategias/:id`: ainda funcionam (`estrategias-*.js` cria em `/estrategias/nova`; o editor trata `e === 'nova'`). O único link de entrada vem do Assistente do Console. A Orquestração não aponta para lá. Na prática ficaram de lado (**suspeita** de que a Orquestração as substituiu, mas o editor ainda é a única tela de regra por estratégia).
- `/empresas`: só para equipe com papel admin (`!e?.equipe || e.papel !== 'admin'` → "Acesso não autorizado"). Nenhum link no site; o Console usa `/console`. Candidata a redirecionar para `/console`.
- `/relatorios/novo`: usa o mesmo componente do montador (`montar-relatorio-CssfV_pk.js`) que o modal "Montar relatório". É a mesma coisa em página cheia, sem links de entrada.
- `/empresa/contratacao`: é o editor de Contratação do **Console** (`contratacao-empresa`, `mode: 'editar'`). Só abre com `editar_contratacao`/`editar_precos` da equipe; **cliente é redirecionado para `/empresa`**.
  - Não redirecione `/empresa/modulos` para lá: o cliente cairia em `/empresa`.
  - `/empresa/modulos` e `/empresa/integracoes` renderizam o mesmo componente (`modulos-C_4B0Cfo.js`). Redirecione `/empresa/modulos → /empresa/integracoes`.

**9. Relatórios. Confirmado.**
- `?produto=` aceita `mensageria`, `orquestracao` e `jornada`, e só vale se o produto estiver "contratado" pelo mapa da própria tela: `orquestracao: !!(n.orquestracao || n.cobranca)` a partir de `empresa_modulos`.
- Atenção: como `orquestracao` está sempre ativo (N3), uma empresa só de Jornada também tem `orquestracao` "contratado". Para escolher o padrão, use as **frentes**, não os módulos.
- Sem `produto`, o padrão de hoje é mensageria → orquestracao → jornada.
- `canal`: nenhuma ocorrência na tela. **Ignorado.**
- `?exportacao=<id>` abre a lista de exportações (`xe`); o id em si é ignorado. O voltar remove o parâmetro. O link vem do sino, gerado por `nuvem/relatorios.py` (`/relatorios?exportacao={id}`). Precisa continuar funcionando.

**10. Jornada nas telas da Cobrança. Suspeita forte.**
- A Jornada grava em `jornada_cliente`, `fila_dia`, `acoes_dia`, `jornada_desfechos` e `jornada_movimento` (`nuvem/sincronizar.py`, `_rodar_jornada`).
- `/clientes` lê `enquadramento` e `estado_cliente` (Cobrança), então para um cliente só de Jornada deve vir vazio.
- `/mapa` lê `mapa_esteira`, `fluxo_esteira` e `fila_dia`; a parte da esteira é da Cobrança.
- `/painel` lê `kpis` (**sem login** para saber se inclui a Jornada).
- `/acoes` (`acoes_dia`) provavelmente tem dados da Jornada e hoje não está no menu dela.
- Tirar Mapa, Clientes e Painel do menu da Jornada não deve tirar informação útil, mas confirme `/painel` logado. As telas próprias são `/jornada` (`jornada_resumo`) e `/jornada/lista`.

**11. 404. Confirmado: dá para fazer.**
- O site é React Router com SSR. O 404 de hoje é o próprio app: `curl /lista-do-dia` devolve o HTML do `ErrorBoundary` de `root` ("A página solicitada não foi encontrada."). Não há interceptação antes.
- Uma rota coringa `*` dentro do `workspace-layout` (moldura sem menu lateral) passa a responder a qualquer endereço desconhecido. A rota de API `api/*` fica na raiz e não é afetada.
- A sessão é do navegador: no SSR a página sai como "Carregando seu espaço…" e os shells mandam para `/login` sem sessão.
- O link "Avisar o Suporte" funciona: `suporte-novo` lê `?assunto=` e `?motivo=`.

**12. Breakpoints. Confirmado.**
- O CSS publicado tem `@media (width>=1024px)` para `lg:`. O topo usa o corte de 821 px.
- Botão flutuante do Assistente: `fixed bottom-5 right-5 z-40`.
  - Fica **por cima** do fundo escuro do menu lateral das áreas (`z-30`), então dá para clicar nele com o menu aberto.
  - Fica abaixo da gaveta do Workspace (`z-[60]`).
- **Colisão confirmada em qualquer largura:** a Orquestração tem um botão `fixed bottom-6 right-6 z-40` no mesmo canto que o botão do Assistente. O ajuste "sobe 64 px" do prompt 68 não está publicado (não há lógica de deslocamento no `assistente-gaveta`).

**13. Tokens. Parcial.**
- A tabela `api_tokens` existe no repositório (`20261105000001_api_tokens.sql`, ampliada no SQL 41 `20261208000001_api_v2.sql`, com `criar_token_api` e `trocar_token_api`).
- A função `api` v2 está **no ar**: `GET .../functions/v1/api/v1/teste` sem token → 401 "envie o token no cabeçalho Authorization: Bearer mc_..."; rota desconhecida → 404 listando as rotas v1, inclusive `/v1/teste`, que é da v2.
- Se o SQL 41 rodou no banco: **sem login** (as RPCs exigem `authenticated`; o SQL 45 consultar `substituido_por` não prova nada, porque o plpgsql não valida colunas ao criar a função).
- Provável que falte só publicar a tela do prompt 63, mas confirme rodando `select 1 from api_tokens limit 1` e `\df criar_token_api` no painel do Supabase.

**14. Ações do Assistente. Confirmado (lista completa de `assistente-context`).**
- Rotas: `abrir_lista_dia /fila` · `abrir_inicio_orquestracao /inicio` · `abrir_painel_orquestracao /painel [ver_painel]` · `abrir_acoes /acoes` · `abrir_clientes /clientes [ver_clientes]` · `abrir_personas /personas [ver_clientes]` · `abrir_credores /credores` · `abrir_mapa_esteira /mapa` · `abrir_orquestracao /orquestracao` · `abrir_comite /comite [baixar_comite]` · `abrir_enviar_arquivos /envios [enviar_arquivos]` · `abrir_canais_frases /canais [editar_canais]` · `abrir_mensageria_painel /mensageria/{c}` · `abrir_campanhas …/campanhas` · `abrir_lotes …/lotes` · `abrir_respostas /mensageria/{c}/respostas` (servidor → `/mensageria/atendimento?canal=`) · `abrir_templates` · `abrir_listas` · `abrir_config_mensageria …/config` · `abrir_relatorios /relatorios` · `abrir_empresa /empresa` · `abrir_faturamento /empresa/faturamento [ver_faturamento]` · `abrir_membros /empresa/pessoas?aba=pessoas` · `abrir_modulos /empresa/integracoes` · `abrir_minha_conta /conta` · `abrir_seguranca_conta /conta?aba=seguranca` · `abrir_tokens_api /empresa/integracoes [gerenciar_api]` · `abrir_documentacao /docs` · `abrir_permissoes /empresa/pessoas?aba=perfis [gerenciar_permissoes]` · `abrir_auditoria /auditoria` (servidor → `/empresa/auditoria`) `[ver_auditoria]` · `abrir_chamado /suporte/novo` · `abrir_jornada /jornada` · `abrir_jornada_lista` · `abrir_jornada_cargas` · `abrir_jornada_carteiras` · `abrir_jornada_momentos` · `abrir_jornada_mensagens` · `abrir_caixa_atendimento /mensageria/atendimento` · `abrir_radar /mensageria/radar` · `abrir_console_empresas /console` · `abrir_console_saude` · `abrir_console_implantacao` · `abrir_console_faturamento` · `abrir_console_equipe` · `abrir_minhas_perguntas /assistente/minhas`.
- `{c}` = canal do localStorage ou `sms` (mesmo problema da CX-14). O ⌘K (`workspace-command-palette`) leva a `/fila`, `/suporte/novo`, `/suporte`, `/empresa/pessoas?aba=pessoas`, `/empresa/contatos`, `/empresa/faturamento`, `/conta`, `/conta?aba=seguranca` e `/docs`.
- Nenhuma dessas rotas some com o prompt 73. Riscos:
  - (a) com o bloqueio "não faz parte do plano", `abrir_lista_dia`, `abrir_acoes`, `abrir_mapa_esteira` e `abrir_clientes` passam a mostrar essa página para quem é só da Jornada (correto, mas o Assistente vai sugerir telas que a pessoa não pode abrir);
  - (b) `abrir_painel`, `abrir_clientes` e `abrir_personas` dependem de N2;
  - (c) `{c}='sms'` sem SMS contratado vai cair na nova página "canal não contratado". Melhor o Assistente usar a mesma regra de canal do menu.

## Revisão do PROMPT_73 (rascunho)

### Contradiz o código publicado ou quebra o que funciona hoje

| # | Trecho do prompt | Problema | Correção sugerida |
|---|---|---|---|
| R1 | §1 "troque para motorcob sem gravar preferência" | Se o Horizons usar `escolherFrente(f, false)`, que é o padrão que a gaveta e o "Trocar para" usam hoje, **apaga** `perfis.frente_preferida` e o `mc-frente` a cada navegação (N1). | Escrever explicitamente: "use `aplicarFrente(f)` (só sessionStorage, sem RPC). `escolherFrente` só quando a pessoa escolhe de propósito (login, Minha conta, troca de área no menu)". |
| R2 | §1 "Se a pessoa não tem essa frente, mostre a página 'não faz parte do plano'" | Pode trancar clientes da Jornada se `minhas_frentes` vier como lista de textos (suspeita do item 3). O provider cai em `['motorcob']` em qualquer erro. | Antes de publicar, confirmar o formato. No prompt, ler as frentes aceitando os dois formatos (`typeof e === 'string' ? e : e.frente`). Equipe nunca vê essa página. |
| R3 | §3 "Áreas ▾ usa rpc numeros_areas()" | Para a equipe sem empresa na pílula, `numeros_areas` devolve **vazio** (`if e is null then return`). Hoje a equipe vê todas as áreas (`N = !!r?.equipe`). Também não há linha de Relatórios. E roda contagens (`fila_dia`, `mensageria_lotes`) a cada carga do topo. | "Equipe: todas as áreas contratadas, como hoje. Cliente: `numeros_areas` (só os campos `area`/`contratada`), carregado uma vez por empresa; Relatórios à parte." |
| R4 | §3 "Relatórios: sem ?produto=, Cobrança, depois Jornada, depois Mensageria (o que for contratado)" | Na tela, "contratado" é `empresa_modulos`, e `orquestracao` está ativo para **toda** empresa (N3). Um cliente só de Jornada abriria Relatórios em Cobrança. E o prompt diz "Não mude o conteúdo das telas", mas isto muda a tela de Relatórios. | "Cobrança = frente motorcob; Jornada = frente motorcli; Mensageria = módulo." Assumir que esta é a exceção à regra de não mexer nas telas. |
| R5 | §2 "Relatórios /relatorios?produto=mensageria&canal={c}" e §2 Cobrança "Canais e frases /canais" | A tela de Relatórios ignora `canal` (CX-12 continua). `/canais` exige `editar_canais` (o Assistente já filtra); sem esse filtro, a Operação e a Gestão caem num aviso. | Ou pedir que Relatórios leia `?canal=`, ou tirar o `&canal=` para não prometer. Pôr `perm: editar_canais` no item. |
| R6 | §2 Mensageria: "só com os canais contratados (a mesma fonte que /mensageria usa)" | A tela `/mensageria` não olha `ativo` (item 1). | "Canais = `empresa_modulos.canais` da linha `mensageria` com `ativo = true`." Avaliar esconder "Lotes" no WhatsApp (o banco não aceita lote de WhatsApp). |
| R7 | §2 "Score, só em SMS" | A tela de Score não é por canal (item 7); em RCS mostraria o mesmo conteúdo. Hoje o Score nem está no menu. | Item único "Score de Entrega" fora do bloco do canal, ou decidir com o produto. |
| R8 | §5 "O ☰ abre UMA gaveta… igual no Workspace e nas áreas" | A gaveta do Workspace tem `min-[821px]:hidden` e o topo usa 821 px. Se o prompt não mandar trocar **todos** os `min-[821px]` por `lg` (1024), sobra a faixa de 821 a 1023 px com topo de computador e gaveta escondida, ou o contrário. O atalho Ctrl+B (recolher) e o estado `mc-menu-recolhido` usam 980 px. | Listar: trocar `min-[821px]` → `lg` no topo e na gaveta; o recolhido só a partir de 1024 px. |
| R9 | §7 "Ver quem é o Admin → /empresa/pessoas?aba=pessoas" | A Operação só vê a si mesma lá (RLS `perfis_ver`, item 5). Vira beco. | Mostrar o nome do Admin na própria faixa, via `rpc('pessoas_empresa')` filtrando `papel='admin'`, ou só o texto "Quem paga as faturas é o Admin da sua empresa." Exigir `ver_faturamento` **e** `pagar_faturas` para o "Pagar agora". |
| R10 | §6 Sem permissão: "{Tela} é do perfil {perfis que podem}" | Para `/painel`, `ver_painel` não existe no catálogo (N2). O texto sairia "é do perfil " vazio, e o item continua escondido para todos. | Antes: SQL pondo `ver_painel`, `ver_clientes`, `buscar_cliente` e `exportar_dados` no `permissoes_catalogo` (ou o site parar de exigir essas permissões). Tirar "Não exige SQL novo" do cabeçalho se for o caso. |
| R11 | Cabeçalho "Rode depois do SQL 45" e o teste "outra só com Mensageria (WhatsApp)" | Esse cenário não dá para montar (N3). | Trocar o teste por "empresa com Cobrança + Mensageria (só WhatsApp)" e "empresa só Jornada". |
| R12 | §1 lista de rotas | `/jornada/*` precisa incluir `/jornada` (sem barra). `/mensageria` (escolha de canal), `/mensageria/atendimento`, `/mensageria/radar` e `/mensageria/config/atendimento` não têm canal na rota: dizer qual canal o seletor mostra ali. `/acoes` tem dados da Jornada (`acoes_dia`) e fica só na Cobrança. | Explicitar. Decidir se a Jornada ganha "Ações". |

### CX "Bloqueia faturar" ou "Alta" que o prompt 73 deixa sem resolver

| CX | Situação após o prompt 73 |
|---|---|
| CX-01 e CX-02 | O SQL 45 (`origin/main`, `20261212000001_links_inicio.sql`) corrige todos: `/fila` em `numeros_areas` e no "Lista do dia pronta", `/envios` para carga com erro, `/mensageria/{canal}/lotes` para pausados. **Falta só rodar.** Os parâmetros `?fatura=`, `?token=` e `?filtro=` continuam ignorados (CX-12, Média). |
| **CX-05 (tokens de API)** | **Não resolvido.** Não é navegação, mas é Alta e bloqueia quem integra por API. A função `api` v2 está no ar; falta a tela do prompt 63. Sugiro um prompt à parte (ou republicar o 63) antes de vender a API. |
| CX-09 (bloqueio por fatura) | Parcial: falta R9. E não corrige o **cartão de bloqueio** que diz "fatura vencida" com "Pagar agora" para empresa suspensa/encerrada pela equipe (item 6). Incluir: para `suspensa`/`encerrada`, "Acesso suspenso pela equipe MotorCX. Fale com o Suporte." + botão Suporte, sem Pagar. |
| CX-03 (só Mensageria) | Resolve o menu em `/mensageria/*`, mas a empresa continua "com Cobrança" no Áreas ▾, no Início e em `/fila` (N3). Depende de decisão de produto e SQL. |
| CX-11 (Jornada) | Resolvido no menu. Os dados de `/painel` para a Jornada ficam como "sem login". |
| N2 (Clientes, Personas e Painel sumidos) | Novo, suspeita Alta. Não é tratado. |
| Botão do Assistente × botão fixo da Orquestração (mesmo canto, `z-40`) | Novo, Média. Não é tratado; pôr no §5 o deslocamento de 64 px do prompt 68. |

### O que está certo no rascunho e funciona com o código
- O link do lote `/mensageria/{canal}/lotes/{id}`: o lote tem `canal` (`lotes-lista`: `e.canal`).
- A rota coringa no layout logado e o `?assunto=` do Suporte.
- `/conta?aba=perfil` existe.
- Os redirecionamentos atuais não são afetados.
- A contagem de "Respostas" no menu continua funcionando se o item mantiver `to: '/mensageria/atendimento'`; o `app-shell` acha o item por esse `to`.
