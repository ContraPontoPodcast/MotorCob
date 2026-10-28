# Prompt Horizons — 75a: demo de venda sem mexer na moldura (marca MotorCX, tema escuro, carteira, empresa da equipe)

UX + CX, 25/10/2026. Rode depois do 74 e do SQL 46 (já rodado). Vale com o menu lateral de hoje e pode ir ao site já,
junto com o 76 (site público). A moldura nova (trilho e abas) é o 75b. Resolve UX-02 (app e login), 03, 04 e 11.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor. Não mude a moldura (menu
lateral, barra do topo), rotas, ids (motorcob, motorcli, mc-frente) nem parâmetros. Só o que está abaixo.

## 1. Marca MotorCX
1.1 No helper seo (o que monta title, og:title, twitter:title e description), antes de montar as tags: troque
    "MotorCob" por "MotorCX" no título e na descrição, e o " | " final do título por " · ". Depois troque também o
    texto no meta de cada rota ("Lista do dia | MotorCob" → "Lista do dia · MotorCX").
1.2 Regra geral: todo texto visível "MotorCob" vira "MotorCX" e "MotorCli" vira "Jornada do Cliente". Exceções: ids
    e códigos internos, empresas.nome (é dado), o nome do fator do autenticador (duasEtapasLogica: fica para o 76) e
    o site público (76). Inclui, entre outros: "O Suporte da MotorCob responde…", "Equipe MotorCob no Console",
    "Aceitar a sugestão do MotorCob…", "fale com o suporte MotorCob", "Acesse a plataforma MotorCob…", "Modelos
    MotorCob", "(formato MotorCob)", "endereços curtos do MotorCob", "Gerado pelo MotorCob", "playbook MotorCob" →
    "padrão MotorCX", e os filtros "MotorCob"/"MotorCli" do Console › Assistente → "Cobrança"/"Jornada do Cliente".
1.3 Onde hoje aparece frentes.nome, mostre o nome da área ("Cobrança", "Jornada do Cliente"), sem mexer no id:
    cartões de escolha do login · pílula do Início ("Cobrança", não "MotorCob · Cobrança") · aviso do Workspace
    ("Sua empresa ainda não tem a Cobrança"). O logo do login (marca-motorcx), mesmo com frente no link, mostra só
    "MotorCX" (sem "MotorCob por MotorCX"). Login: "Uma conta para todas as áreas." e "Quem tem acesso a uma área
    só entra direto nela, sem esta escolha."
1.4 Aceite: com curl, o view-source de /login e de /fila não tem nenhum "MotorCob"; dentro do app, nenhum texto
    visível tem MotorCob ou MotorCli fora das exceções do 1.2.

## 2. Cor de destaque (só as variáveis e um componente)
2.1 No CSS global:
:root{--destaque:#8A6A2E;--destaque-forte:#6F5424;--destaque-suave:#F4EDE0;--destaque-texto:#FFFFFF}
[data-tema=escuro]{--destaque:#D9B26B;--destaque-forte:#E8C688;--destaque-suave:#3A2F1C;--destaque-texto:#1D1D1F}
2.2 No cabeçalho de página X (app-shell), o botão da ação principal passa a usar fundo var(--destaque), texto
    var(--destaque-texto) e hover var(--destaque-forte). Não troque #1D1D1F nem #0F4C5C em nenhum outro lugar (fica
    para o 77).
2.3 Aceite: só o botão principal dos cabeçalhos X fica ouro; o resto continua como está.

## 3. Tema escuro: cole no CSS global (classes escritas como no código, com maiúsculas)
.mc-platform .bg-\[\#FFE8E6\],.mc-platform .hover\:bg-\[\#FFE8E6\]:hover{background-color:var(--estado-erro-fundo)}
.mc-platform .bg-\[\#E8F8EC\],.mc-platform .hover\:bg-\[\#E8F8EC\]:hover{background-color:var(--estado-pronto-fundo)}
.mc-platform .bg-\[\#E8F1FF\]{background-color:var(--estado-info-fundo)}
.mc-platform .text-\[\#0A60D0\]{color:var(--estado-info)} .mc-platform .border-\[\#0A60D0\]{border-color:var(--estado-info)}
.mc-platform .text-\[\#FF3B30\],.mc-platform .hover\:text-\[\#FF3B30\]:hover{color:var(--estado-erro)}
.mc-platform .border-\[\#FF3B30\]{border-color:var(--estado-erro)} .mc-platform .text-\[\#248A3D\]{color:var(--estado-pronto-texto)}
[data-tema=escuro] .mc-platform :is(.bg-\[\#FFF3E8\],.bg-\[\#FFF7E8\],.bg-\[\#FFF8E1\],.bg-\[\#FFF3DF\],.hover\:bg-\[\#FFF1D8\]:hover){background-color:var(--estado-atencao-fundo)}
[data-tema=escuro] .mc-platform :is(.bg-\[\#E8E8ED\],.bg-\[\#E5E5EA\],.bg-\[\#EEEEF0\],.bg-\[\#F0F0F2\],.hover\:bg-\[\#E8E8ED\]:hover,.hover\:bg-\[\#E5E5EA\]:hover,.hover\:bg-\[\#EEEEF0\]:hover){background-color:var(--base-fill)}
[data-tema=escuro] .mc-platform :is(.bg-\[\#FAFAFC\],.bg-\[\#FAFAFB\],.bg-\[\#F8F8F9\],.bg-\[\#F8F9FB\],.hover\:bg-\[\#FAFAFC\]:hover){background-color:var(--base-cartao)}
[data-tema=escuro] .mc-platform .border-\[\#FFE08A\]{border-color:var(--base-borda)}
Aceite: no CSS publicado, grep "FFE8E6" e "0A60D0" (em maiúsculas) acha estas regras; no tema claro nada muda de
cor; no escuro, Faturas, Pessoas, Atendimento e Templates ficam legíveis.

## 4. Carteira
4.1 Lista do dia, Orquestração, Personas e Comitê: com "Todas as carteiras" no seletor do cabeçalho, troque o aviso
    "Escolha o credor no topo para ver esta página." por um cartão "Escolha a carteira" (fundo var(--base-fill),
    borda tracejada, raio 14): título "Escolha a carteira", uma linha explicando ("A Lista do dia é por carteira."),
    e um botão em contorno por carteira ativa, com o nome; clicar chama selectCredor (o mesmo do seletor). Com uma
    carteira só, ela já vem escolhida (como hoje).
4.2 Enviar arquivos: só a palavra ("Escolha a carteira no topo do bloco de envio"); o formulário não muda.
4.3 Textos visíveis "credor(es)" → "carteira(s)" (inclui "Todos os credores", "Abrir configurações do credor" e o
    título "Credores"), EXCETO docs-api, /documentacao e nomes de parâmetro ou campo (?credor=, credor_id, escopos).
4.4 Aceite: nenhuma tela do app diz "Escolha o credor"; a documentação da API continua igual.

## 5. Empresa da equipe
No auth-provider, ao sair (logout), não apague a chave mc-empresa do localStorage. Aceite: a equipe sai, entra de
novo e a pílula volta com a última empresa escolhida.

Confira em 1440 e 390 px, claro e escuro, como cliente (Admin, Operação) e como equipe.
```
