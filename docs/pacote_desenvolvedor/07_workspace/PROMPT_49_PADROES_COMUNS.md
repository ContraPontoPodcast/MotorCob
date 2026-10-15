# Prompt Horizons — 49: Padrões comuns (sino, processo demorado, salvar com revisão, confirmação, leitura, celular)

Rode depois do SQL 34. Vale para a plataforma do cliente e o Console. Protótipo aprovado em 15/10/2026:
`docs/homologacao/padroes-comuns-prototipo.html`. O prompt 50 aplica estes componentes nas telas que já existem.

```text
MotorCX (motorcob.online), plataforma e Console. NÃO crie, altere ou apague tabelas, views ou políticas.
Crie componentes reutilizáveis; nenhuma tela nova de negócio.

## 1. Sino de avisos (barra do topo, à direita, plataforma e Console)
- Ícone de sino com o número de avisos novos (rpc avisos_novos(), a cada 60 s e ao voltar para a aba). Sem
  novos, sem número. aria-label "Avisos" ou "Avisos, N novos".
- Clique abre um painel (380 px; no celular, largura da tela menos 32 px) com rpc meus_avisos(30): id, tipo
  ('pronto' | 'atencao' | 'erro'), titulo, texto, link, criado_em, lido. Não lido: ponto na cor da área e título
  em negrito. Cada aviso: título, texto em cinza, hora relativa ("há 5 min") e o botão do link quando houver
  ("Abrir"). O link é sempre uma rota interna: navegue com o router e marque o aviso como lido
  (rpc marcar_avisos_lidos([id])). Topo do painel: "Avisos" e "Marcar todas como lidas"
  (rpc marcar_avisos_lidos() sem argumento). Vazio: "Nenhum aviso nos últimos 90 dias."
- Fecha ao clicar fora ou com Esc. Ninguém cria aviso pelo site: quem grava é o motor.

## 2. Processo demorado (componente ProcessoLongo)
Para tudo que leva mais de 5 s (importar lista, calcular a prévia do Score, enriquecer, sincronizar).
- Título com a etapa atual, lista de etapas em pílulas (feita ✓, atual na cor da área, futura cinza), barra de
  progresso e, à direita, "18.420 de 26.000 linhas · cerca de 3 min" quando houver número; sem número, só a etapa.
  Tempo restante só depois da primeira etapa.
- Texto fixo embaixo: "Pode sair desta tela. Quando terminar, o aviso chega no sino."
- Ao terminar com a tela aberta: resumo do resultado no lugar da barra. Abaixo de 5 s: só o botão em "Salvando…".

## 3. Salvar com revisão (componente PainelEdicao)
Para tudo que mexe em dinheiro ou em regra de envio (preços, rotas, configuração do Score, orçamento).
- O botão "Editar …" abre um painel lateral à direita (440 px; no celular, tela cheia) com fundo escurecido; a
  tabela atrás continua mostrando o valor atual. Campo alterado fica com borda na cor da área.
- Rodapé: "N alterações" + botão "Revisar N alterações" (desabilitado sem mudança).
- Revisar: lista "Produto · campo", valor antigo riscado → valor novo em negrito e a variação em %, e quando vale
  ("Vale a partir de 01/11/2026"). Botões "Voltar a editar" e "Salvar N alterações" (chama a rpc da tela).
- Fechar, Esc ou clique fora com alteração pendente: no próprio painel, "Descartar N alterações?" com
  "Continuar editando" e "Descartar". Sair da página com o painel sujo: aviso do navegador (beforeunload).
- Depois de salvar: mensagem curta embaixo da tela ("2 preços salvos. Vale a partir de 01/11 e ficou na
  Auditoria."). Ajuste simples sem efeito financeiro (nome, cor, favorito) salva direto, com "Salvo".

## 4. Confirmação de ação sem volta (componente ConfirmaAcao)
Nunca use window.confirm. Ao clicar, o botão some e no lugar aparece um quadro (borda na cor da área; vermelho
para cancelar/apagar) com o efeito concreto, em números, e dois botões: o que confirma repete o verbo e o número
("Agendar 16.210 SMS", "Cancelar a campanha") e "Voltar"/"Manter …". Foco vai para o botão de confirmar.

## 5. Somente leitura com o motivo
Quem não pode editar vê a mesma tela. O botão de ação vira uma etiqueta cinza com cadeado e a frase com o papel
que pode ("Só o Administrativo altera preços"); formulários ficam somente leitura com a mesma frase no topo.
Nunca "sem permissão". Esconder só o que é sigiloso: custo do fornecedor e margem (fora de Master e
Administrativo), dados de outra empresa e, sempre, CPF e nome de devedor.

## 6. Tabela no celular
Abaixo de 600 px de largura do contêiner (use container query), cada linha vira um cartão: linha 1 com o nome
em negrito e, à direita, a situação em pílula; linhas 2 e 3 com os dois outros campos principais; "Ver" à
direita abre o detalhe. Cada tela diz quais são os campos principais (prompt 50). Rolagem lateral só nas
tabelas técnicas do Console.

## 7. Faixas do Score de Entrega
Pílulas e barras das faixas usam só as variáveis do tema: --score-alto / --score-alto-texto, --score-medio,
--score-baixo, --score-sem (e os *-texto). Nunca verde/amarelo/vermelho para faixa: essas cores são de pronto,
alerta e erro. O nome da faixa sempre escrito; Sem histórico com o (i): "Número que ainda não passou pela
Mensageria: o Score não tem como classificar."

Confira em 1440 e 390 px, claro e escuro, e só com teclado (Tab, Enter, Esc).
```
