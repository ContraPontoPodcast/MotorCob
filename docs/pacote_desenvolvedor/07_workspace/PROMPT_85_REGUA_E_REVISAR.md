# Prompt Horizons — 85: passo Régua (por estágio) e passo Revisar e salvar

UX, 28/10/2026. Rode depois do 84. Protótipo: passos 4 e 5. A régua continua sendo o editor de raias de hoje
(1º canal em destaque, conectores Sempre/Senão/Junto/Reserva, bolinhas coloridas, Raias | Fluxo do 80b).

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não mude o editor de raias por dentro nem o formato
das ações. Grave só em estrategias.definicao, pelo Salvar de hoje. Nada de CPF ou nome de devedor.

## 1. Passo 4 — Régua
- Topo: o seletor de segmento (prompt 83) e uma fileira de chips com os estágios do segmento, na ordem de
  prioridade (desligados esmaecidos; sem régua: " · sem régua"). O chip escolhido define a régua editada.
- Linha de resumo do estágio: "Quem entra: … · de X a Y dias, contando … · sai: … → …" + link "editar"
  (volta ao passo 3 no mesmo estágio).
- Estágio que é fase: o editor de raias de hoje daquela fase (os mesmos dados de hoje). Deu CPC continua com
  os campos de hoje (ordem dos canais, intervalos, tentativas).
- Estágio que é etapa: o MESMO editor de raias, com os passos da etapa (etapas[i].passos {"<dia>": [ações]}).
  Colunas: sem ciclo, os dias de "de" a "até" (rótulo pelo "contando": entrada "Dia N", atraso "Atraso N",
  vencimento "D-N/D0/D+N", coluna "Dia N"); com ciclo, "Dia 1 do ciclo" … "Dia N do ciclo".
- "Usar a régua de…": lista réguas que o cliente já tem (o mesmo estágio em outras carteiras e as
  estratégias "Da sua empresa" do prompt 82). Usar = copiar os passos para este estágio; texto: "Usar =
  copiar. A cópia é sua: mudar aqui não muda a origem." Nada vem do padrão MotorCX por aqui.
- Bloco recolhido "Regras de contato desta régua": as Travas de hoje da estratégia (resumo na linha
  fechada: ações por dia, horário, intervalo, tentativas do discador). Abre o painel Travas que já existe.
- Botões: "Voltar: estágios" · "Continuar: revisar".

## 2. Passo 5 — Revisar e salvar
Lista de conferência (um cartão por linha, ícone ✓ verde ou ! âmbar):
- Carteira: nome, tipo, clientes.
- Quem: segmentos e clientes de cada um.
- Em que estágio: N estágios (N desligados). Com clientes sem estágio (prompt 84, item 3): "≈ N clientes
  sem estágio ficam sem ação. Pode salvar assim, se for de propósito." + link "Ver estágios".
- O que fazer: "N de M estágios com régua"; os sem régua listados com "Montar agora" (o motor ignora
  estágio sem régua).
- Regras de contato: "dentro das faixas de segurança" (o texto das Travas de hoje).
Cartão "Salvar" à direita:
- Chave "Guardar como modelo da empresa" (desligada): ao salvar, também cria uma estratégia nova com a
  mesma definição, nome "<nome> (modelo)" (se já existir, " (modelo 2)", " (modelo 3)"…: o nome é único
  na empresa), frente 'motorcob', padrao false, sem vínculo com segmento (aparece em "Da sua
  empresa"). Texto: "Quem usar recebe uma cópia."
- "Salvar estratégia": grava definicao (update da estratégia própria; se compartilhada, o aviso de hoje
  antes). Toast: "Estratégia de <carteira> salva. Vale na próxima lista do dia." Avisos de sem estágio e de
  estágio sem régua NÃO bloqueiam. Só bloqueiam os erros de campo do prompt 84 (item 5).
- Depois de salvar: mostre os avisos do motor sobre esta definição, se a tela já os recebe hoje.

Aceite: o chip de estágio troca a régua editada; etapa mostra colunas pela janela ou pelo ciclo; "Usar a
régua de…" copia sem ligar à origem; o Revisar mostra o que falta sem impedir salvar; "Guardar como modelo"
cria uma estratégia sem uso que aparece em "Da sua empresa"; nenhuma definição gravada fica {}. 1440 e
390 px, claro e escuro, como Admin e Operação (só leitura).
```
