# Prompt Horizons — 51: Primeiro uso do cliente (conta, primeiros passos, envio real, telas vazias)

Rode depois do SQL 35 e dos prompts 49 e 50. Protótipo aprovado em 15/10/2026:
`docs/homologacao/primeiro-uso-prototipo.html`. O e-mail de convite é configurado no painel do Supabase
(`02_supabase_painel/CONFIGURAR_SUPABASE.md`, item 5b).

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Criar a conta (/definir-senha e cadastro do código)
- Topo com os passos em pílulas: Admin vê "Senha · Código no celular · Pronto"; os outros papéis veem
  "Senha · Pronto". Passo feito com ✓, atual destacado.
- Senha: lista de requisitos marcada enquanto digita (12 caracteres ou mais · uma letra · um número), em duas
  colunas; "Continuar" só habilita com tudo marcado. Mesma regra do prompt 45.
- Código no celular (Admin): QR, os 3 passos ("Abra o aplicativo e toque em adicionar", "Aponte a câmera para o QR
  code", "Digite abaixo o código que aparecer") e o campo de 6 números; só números, "Confirmar código" habilita
  com 6. Usa o componente de duas etapas que já existe.
- Pronto: "Conta pronta. Agora é preparar a {empresa} para o primeiro envio. O Início mostra o caminho." →
  "Ir para o Início".
- Link vencido: "Este convite venceu. Peça outro a quem convidou você."

## 2. Início: primeiros passos
Enquanto houver passo não feito e perfis.ocultar_primeiros_passos = false, o Início abre com o cartão
"Primeiros passos da {empresa}" antes de "Para hoje". rpc primeiros_passos(empresa_id) devolve, em ordem:
ordem, passo, grupo ('conta' | 'empresa' | 'cobranca' | 'jornada' | 'mensageria'), titulo, feito, pulado,
da_equipe. Só vêm os passos do que foi contratado.
- Topo: título, subtítulo com o que foi contratado e barra de progresso "N de T prontos" (verde).
- Linhas agrupadas por grupo (rótulos: Sua conta · Empresa · Cobrança · Jornada do Cliente · Mensageria). Cada
  linha: círculo (✓ verde quando feito; tracejado quando da_equipe), título (riscado quando feito), descrição e,
  à direita, a ação. O primeiro passo não feito ganha a pílula "Próximo", fundo cinza claro e botão principal;
  os demais, botão secundário.
- Descrição e ação por passo:
  conta "Feito no convite." · fatura "Em Empresa › Contatos, marque Recebe faturas." → "Abrir contatos" ·
  equipe "Quem vai planejar, operar e acompanhar." → "Convidar membro" + link "Pular" (rpc
  pular_primeiro_passo(empresa_id, 'equipe'); só Admin) · carga "A carteira com os clientes e as dívidas, por
  arquivo ou pela API." → "Enviar carga" · lista "Sai às 6h da manhã seguinte à primeira carga." (sem botão;
  pílula "Depois da carga" até a carga existir) · token "Para o seu sistema mandar a carga sozinho." → "Criar
  token" · carga_jornada "Os clientes entram já em uma etapa da jornada." → "Enviar carga" · template "O texto da
  mensagem, com variáveis como {{nome}}." → "Criar template" · recarga "No pré-pago, cada envio desconta do
  saldo." → "Recarregar" · teste "Nada sai para os seus clientes." → "Nova campanha" · pedir "Depois do teste, o
  Suporte confere e liga em até 1 hora." → "Pedir envio real" (abre a faixa do item 3; pílula "Depois do teste"
  enquanto teste não estiver feito) · real "Você recebe o aviso no sino quando estiver ligado." (sem botão;
  pílula "Com o Suporte" se houver pedido aberto, senão "Depois do pedido").
- Rodapé: link "Ocultar primeiros passos" → rpc ocultar_primeiros_passos(true); o cartão some e fica em Ajuda ›
  Primeiros passos (lá, "Mostrar no Início" → ocultar_primeiros_passos(false)).
- Tudo feito: o cartão não aparece mais.

## 3. Mensageria: faixa da simulação e pedido de envio real
Leia mensageria_config.modo e o último registro de pedidos_envio_real da empresa (situacao, pedido_em,
motivo). Pré-requisitos = passos fatura, template, teste e recarga (quando vier) de primeiros_passos.
- modo 'simulado', falta pré-requisito: faixa âmbar "Simulação: nada sai para os seus clientes. Falta N passo(s)
  para pedir o envio real." + botão "Pedir envio real" desabilitado. Ao lado, o cartão "Antes de pedir o envio
  real" com os pré-requisitos (✓ ou "Fazer agora", que leva à tela do passo).
- Pronto para pedir: "Tudo pronto para pedir o envio real." + "Pedir envio real" (só para quem tem
  enviar_mensagens; os outros veem a frase "Só quem pode enviar mensagens pede o envio real"). Confirmação do
  prompt 49: "Pedir ao Suporte para ligar o envio real da {empresa}? Depois de ligado, as mensagens saem de
  verdade e entram na fatura." → "Pedir envio real" → rpc pedir_envio_real(empresa_id). Erro da rpc aparece como
  veio ("antes de pedir: …").
- Pedido aberto: faixa neutra "Envio real pedido em {data} às {hora}. O Suporte responde em até 1 hora; o aviso
  chega no sino." + pílula âmbar "Com o Suporte".
- Pedido recusado: faixa âmbar "O Suporte ainda não ligou o envio real: {motivo}" + "Pedir de novo".
- modo 'real': faixa verde "Envio real ligado. As mensagens saem de verdade e entram na fatura." (some depois de 7
  dias) e o selo "Envio real" de sempre.
- Cartão "O que muda no envio real" ao lado do pedido, com "O Suporte da MotorCob responde em até 1 hora."

## 4. Telas vazias (padrão: tag da área, título, uma frase do que aparece, uma do que fazer, um botão)
- Lista do dia sem nenhuma lista: "A primeira Lista do dia sai às 6h da manhã seguinte à primeira carga. Ela
  mostra quem recebe ação hoje, por qual canal e com qual frase." → "Enviar a primeira carga" + link "Mandar
  pela API" (só com o módulo API).
- Campanhas: "Suba uma lista com os contatos, confira as colunas e escolha o template. Em simulação, nada sai para
  os seus clientes." → "Nova campanha".
- Templates: "O template é o texto da mensagem, com variáveis como {{nome}} e {{valor}}." → "Criar o primeiro
  template".
- Jornada: "Os clientes aparecem aqui depois da primeira carga, já em uma etapa da jornada." → "Enviar a
  primeira carga".
- Filtro sem resultado é outro caso: "Nenhum resultado para este filtro" + "Limpar filtros".

Confira em 1440 e 390 px, claro e escuro.
```
