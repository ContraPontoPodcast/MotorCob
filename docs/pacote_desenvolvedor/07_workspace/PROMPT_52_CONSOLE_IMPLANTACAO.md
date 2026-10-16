# Prompt Horizons — 52: Console › Implantação (empresas novas e pedido de envio real)

Rode depois do SQL 35 e do prompt 51. Protótipo aprovado em 15/10/2026:
`docs/homologacao/primeiro-uso-prototipo.html` (tela "Console · implantação").

```text
Console MotorCX (motorcob.online/console). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Menu
Grupo Empresas ganha "Implantação" (subtítulo "Onde cada cliente parou"), rota /console/implantacao, para quem
tem ver_empresas. Pílula com o número de pedidos de envio real em aberto ao lado do item.

## 2. Lista (rpc implantacao_empresas())
Devolve empresa_id, nome, criada_em, total, feitos, proximo, ultima_atividade, pedido_em, vendedor_id: empresas
criadas há menos de 90 dias com passo em aberto, pedidos de envio real primeiro.
Colunas: Empresa · Situação · Passos · Próximo passo · Parada há · Responsável (nome do vendedor_id) · ação.
- Situação: pedido_em preenchido → pílula âmbar "Pediu envio real"; sem pedido e ultima_atividade há mais de 7
  dias → pílula vermelha "Parada"; senão neutra "Em implantação".
- Passos: barra verde fina + "feitos de total".
- Próximo passo: o texto de proximo. Com pedido: "Ligar o envio real · pedido há {minutos} min (prazo 1 h)";
  passado de 1 hora, o trecho do prazo fica vermelho: "atrasado {minutos} min".
- Parada há: dias desde ultima_atividade ("hoje" quando 0).
- Ação: com pedido, botão "Ligar envio real"; sem pedido, link "Ver passos", que abre a linha com rpc
  primeiros_passos(empresa_id) (feitos e o que falta, só leitura).
- No celular, cada linha vira cartão (prompt 49, item 6): empresa e situação; barra de passos; próximo passo e a
  ação.
- Vazio: "Nenhuma empresa em implantação. Empresa nova aparece aqui até terminar os primeiros passos."

## 3. Responder o pedido de envio real (pode_equipe('ligar_envio_real'): Master e Atendimento)
- "Ligar envio real" → confirmação do prompt 49: "As mensagens da {empresa} passam a sair de verdade e entram na
  fatura. Confira a rota e o template antes." → "Ligar envio real" → rpc ligar_envio_real(empresa_id). Mensagem:
  "Envio real ligado. A empresa recebe o aviso no sino." O chamado do pedido é encerrado sozinho.
- Ao lado, link "Devolver ao cliente" → campo "O que falta (o cliente vê esta frase)" (5 a 400 caracteres) →
  "Devolver" → rpc recusar_envio_real(empresa_id, motivo). O chamado fica "Aguardando cliente".
- Sem a permissão: no lugar do botão, a etiqueta com cadeado "Só Master e Atendimento ligam o envio real".
- O mesmo botão aparece no chamado "Ligar envio real" (Console › Atendimento) e em Console › Empresa › Mensageria.

## 4. Avisos
O motor avisa no sino: pedido de envio real (para a equipe), pedido sem resposta em 1 hora (vermelho) e empresa
parada há mais de 7 dias (para o vendedor da carteira). O link do aviso abre /console/implantacao.

Confira em 1440 e 390 px, claro e escuro.
```
