# Prompt Horizons — Site v3: carrossel da plataforma e uma seção por função

Rode depois do site publicado (passo 6 e, se usou, a correção de logo e personas). Só muda o site público em "/".
Login, plataforma e banco não mudam. Referência visual: protótipo, aba Site, seção "Plataforma".

```text
Atualize só o site público em "/". Não mude login, plataforma, tabelas, views ou políticas. Mantenha estilo, logo,
cabeçalho escuro, personas, agentes, contato e rodapé como estão. Todos os dados abaixo são fictícios e fixos.

1. CABEÇALHO: troque os links por Plataforma, Orquestração, Mensageria, Personas, Workspace, Segurança, Contato.
   Destinos (rolagem suave): #plataforma, #orquestracao-site, #mensageria-site, #personas-site, #workspace-site,
   #seguranca, #contato. Mantenha scroll-margin-top 64px (92px no celular) e "Entrar" à direita.

2. #produto: o subtítulo vira "Da carga à ação, com inteligência. Uma plataforma, cada função no seu lugar."
   A janela da Lista do dia (#lista-site) passa a ser o 1º slide de um CARROSSEL com id "plataforma".

CARROSSEL (#plataforma)
- Trilho horizontal com scroll-snap-type x mandatory, cada slide 100% da largura, sem barra de rolagem visível.
- Slide: fundo #F5F5F7, raio 18, padding 40px (20px no celular); grade 0.8fr | 1.2fr com gap 32px: à esquerda o
  número "01".."06" (13px 600 #6E6E73), título (36px 700, -0.03em) e texto (17px #6E6E73); à direita o visual.
  No celular: uma coluna, conteúdo alinhado ao topo.
- Controles abaixo, centralizados: botão "‹" (aria-label "Anterior"), 6 pontos e "›" ("Próximo"). Botões 36px
  redondos #F2F2F7. Ponto 8px #C7C7CC; o atual vira pílula 24px #1D1D1F (aria-selected). "‹" desabilitado no 1º e
  "›" no último (opacidade .35). Setas do teclado ← → funcionam com o trilho em foco. SEM rolagem automática.
  Com prefers-reduced-motion, troca sem animação. Ao redimensionar a tela, continua no mesmo slide.
- Slides (título · texto · visual):
  01 Lista do dia · "Às 6h, a carga vira a lista de quem acionar hoje, por canal, com o motivo de quem ficou de
     fora." · a janela da Lista do dia que já existe (mesmos KPIs e linhas).
  02 Orquestração · "A régua de cada segmento, dia a dia: canal principal, “senão” e o telefone Hot primeiro." ·
     janela branca (barra "Orquestração · Atraso recente"), título "Cliente novo · ainda não deu CPC" e 4 colunas
     #F5F5F7 raio 10 (2 colunas no celular): D+1 pílula WhatsApp #1F8A4C, "senão", pílula SMS #7A4FB0 · D+2 "sem
     ação" cinza · D+3 RCS #3B5BA9, "senão", SMS #7A4FB0 · D+5 Agente virtual #0E7C86, "reserva", Discador #475569.
     Pílula: texto BRANCO 11.5px 600, raio 8, sem quebrar (reticências).
  03 Mensageria · RCS · "SMS, e-mail e RCS saem da própria plataforma. No RCS, o cliente vê o logo da sua marca,
     cartões, carrossel e botões." · celular 230px (moldura #1D1D1F raio 28, tela #F2F2F7 raio 20): topo com logo
     redondo 26px #3B5BA9 "AD", "Assessoria Demo" e selo ✔ azul #0A84FF (agente verificado, sem número curto);
     cartão branco com imagem em gradiente #3B5BA9→#9DB4E0 (96px), "Condição especial para o seu contrato",
     "Quite com desconto até sexta." e 3 botões azuis #0A60D0 separados por linha: Negociar agora · Ligar ·
     Lembrar no vencimento.
  04 Workspace · "Ao entrar, só o que pede atenção hoje. Produtos, membros, faturas e documentação no mesmo
     lugar." · cartão branco centralizado: "Bom dia, Marcos." (24px 700), campo "O que você quer fazer?" e 3 linhas
     com ponto 7px: verde "1.869 clientes entram em ação hoje" · laranja "O suporte respondeu o chamado
     MC-2026-000142" · cinza "Fatura de outubro vence em 10 de novembro".
  05 Suporte · "Chamado com motivo, anexo e protocolo. A resposta chega na plataforma, com histórico." · cartão
     branco: "Carga do Banco X rejeitada", "MC-2026-000142 · Envio de arquivos", balão #F5F5F7 "Ana Ribeiro / A carga
     de segunda voltou como rejeitada." com anexo "carga_banco_x.csv" e balão branco com sombra "Suporte MotorCob /
     Ajustamos o mapeamento. Pode reenviar?".
  06 Arquivo ou API · "Cada credor escolhe como a carga chega: arquivo, como o credor manda hoje, ou API, direto do
     sistema." · duas opções lado a lado: "Arquivo / CSV, TXT ou XLSX, do jeito que o credor manda" (selecionada:
     fundo branco, contorno 1.5px #1D1D1F) e "API / POST /v1/credores/102/cargas" (#F5F5F7); abaixo "Mesmo relatório
     nos dois: linhas aceitas, rejeitadas e o motivo."

3. NOVAS SEÇÕES. Modelo: duas colunas (1 no celular), padding vertical 96px. Esquerda: rótulo 17px 600 #6E6E73,
   título até 52px 700 e texto 18px #6E6E73. Direita: lista com linhas finas (nome 17px 600 + texto cinza) ou
   cartões raio 16 (brancos com sombra leve sobre #F5F5F7; #F5F5F7 sobre branco).
   a) #orquestracao-site (branco), ANTES de #personas-site: "Orquestração" / "Cada cliente no canal certo, no dia
      certo." / "Segmentos, réguas e personas decidem quem acionar, por qual canal e em qual telefone. O motor
      aprende com cada ocorrência e propõe mudanças com evidência." Lista: Réguas por segmento "Dia a dia, com
      “senão” e reserva para quem não atendeu." · Telefone Hot primeiro "Quem deu CPC vira prioridade em todos os
      canais." · Lista do dia com motivo "Quem entra, quem fica de fora e por quê." · Comitê pronto "O relatório
      mensal sai sozinho."
   b) #mensageria-site (#F5F5F7), logo depois: "Mensageria" / "Do arquivo ao envio, sem trocar de sistema." / "Os
      lotes da Lista do dia saem da plataforma no horário permitido, e a entrega, a leitura e o descadastro voltam
      para o motor." Cartões: SMS "Remetente da empresa · respostas “SAIR” viram descadastro" · E-mail "Domínio
      verificado (SPF, DKIM, DMARC)" · RCS "Agente com o seu logo · Basic, Single e Conversacional · cartões,
      carrossel e botões · SMS de reserva" · WhatsApp "Em breve" (opacidade .6).
   c) #carga-site (branco), ANTES de #agentes: "Arquivo ou API" / "Sua carga, do jeito que ela existe hoje." / "Cada
      credor escolhe como os dados chegam. Começa por arquivo e passa para API quando a integração estiver pronta,
      sem refazer nada." Cartões: Arquivo "Carga geral, incremental, retirada, acordos, pagamentos e ocorrências. O
      MotorCob reconhece o layout." · API "O sistema do credor manda direto, com token e escopo. Mesmo relatório do
      arquivo."
   d) #workspace-site (#F5F5F7), logo depois: "Workspace" / "Tudo da sua empresa em um lugar." / "Um início que
      mostra só o que pede atenção, e o resto a um atalho de distância." Lista: Membros e perfis "Convite, perfil
      por produto e verificação em duas etapas." · Suporte por chamado "Protocolo, anexos e resposta na
      plataforma." · Faturas e consumo "Mensalidade, uso do mês, boleto e nota fiscal." · Documentação e dicas
      "Respostas rápidas sem sair da tela."
   #personas-site passa a ter fundo branco.

4. #seguranca: mantenha os 3 itens e acrescente: Duas etapas e sessões "Código do autenticador, sessões visíveis e
   encerráveis." · Tokens com escopo "A API só faz o que o token permite, e expira." · Anexos e fotos privados
   "Arquivos de suporte e fotos ficam só para a empresa." Grade de 3 colunas (1 no celular).

Nenhum CPF, nome de devedor ou telefone completo em lugar nenhum. Sem rolagem lateral em 1440, 1024 e 390px.
```
