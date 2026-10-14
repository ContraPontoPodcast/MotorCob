# Prompt Horizons — 45: menus com subtítulo, um nome por conceito e textos sem código (blocos 4 e 5)

Rode depois do SQL 32 e do prompt 43. Protótipo aprovado: `docs/homologacao/bloco5-repaginada-prototipo.html`
(abas Menus, Um nome por conceito e Antes e depois). Lista completa: `bloco5-revisao-telas-1.md` e `-2-console.md`.

```text
MotorCX (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas. Mude só textos e menus.

## 1. Menu da plataforma (cada item com uma linha de subtítulo, 12 px, texto secundário)
Operação: Início (Resumo de hoje) · Lista do dia (Quem recebe o quê hoje) · Mapa da Esteira (Em que fase está
cada cliente) · Clientes (Histórico de um cliente) · Enviar arquivos (Cargas, pagamentos e retornos).
Estratégia: Orquestração (Régua de cada segmento) · Segmentos (Grupos de clientes por regra) · Personas ·
Canais e mensagens (Horários, limites e textos de cada canal).
Mensageria: Campanhas · Respostas · Modelos de mensagem (Textos-padrão aprovados).
Resultados: Indicadores · Comitê · Relatórios.
Empresa: Dados e contatos · Pessoas e perfis (junta Membros, Usuários e Permissões) · Auditoria (desta empresa)
· Faturas · Suporte.  Ajuda: O que significa.
Some o grupo sem título do fim do menu (Usuários, Permissões, Auditoria foram para Empresa).

## 2. Menu do Console (abre em Empresas)
Clientes: Empresas (Contratação, Pessoas e Faturas dentro de cada uma) · Saúde · Carteiras.
Suporte: Atendimento.  Financeiro: Faturamento · Margem (MC).
Mensageria: Produtos e preços · Fornecedores e rotas.  Administração: Equipe MotorCob · Auditoria (todas as
empresas).

## 3. Um nome por conceito (troque em todas as telas, botões, filtros e mensagens)
Localização/Novo/LOC → Cliente novo · Giro/NCP → Não CPC · G1, G2 → 1º ciclo, 2º ciclo · RE → Parado · aguarda
enriquecimento · CPC A/CPA → CPC · em negociação · CPC B/CPB/T1 → CPC · sem resposta · 1ª tentativa ·
Colchão → Acordo em dia · Preventivo → Acordo · antes do vencimento · Quebra → Acordo · parcela vencida ·
Cluster → Segmento · Credor → Carteira · Hot/telefone Hot → Contato principal · Fila/Ações de hoje → Lista do dia
· Templates/Frases → Modelos de mensagem · Falhas → Não entregues · Membros/Usuários → Pessoas e perfis ·
Frente/COB/CLI → Área: Cobrança ou Jornada do Cliente · MotorCob/MotorCli dentro da plataforma → MotorCX.
Mantêm o nome, com (i): Fallback, MC, %MC, Auditoria, DLR (Delivery Report — só em SMS e RCS; WhatsApp mostra
"status de entrega", e-mail mostra "bounce").

## 4. Nenhum código interno nem erro técnico cru
- Erro do banco/servidor: frase do que houve + "Tente de novo; se repetir, abra um chamado." e um "Ver detalhe
  técnico" recolhido com a mensagem original. Vale para toda a plataforma e o Console.
- Status: pendente/processado/erro → Na fila · Processado · Com erro; ok/erro/rodando → Concluída · Com erro ·
  Em andamento; true/false → Sim/Não; Flat/Escalonado → Preço único/Preço por faixa; Competência → Mês de
  referência; Dia de corte → Dia de fechamento; oxigenados → clientes que ganharam contato novo.
- Motivo do fornecedor (UNDELIV etc.) → "Número inexistente", "Aparelho desligado"…
- Reenquadrar demorando: "O pedido está demorando mais que o normal. Aguarde alguns minutos; se continuar, fale
  com o suporte." (sem citar Mac, vigia ou scripts).

## 5. Senha e arquivos (iguais em todo lugar)
Senha: uma regra só, mostrada igual em cadastro, troca e redefinição: "12 caracteres ou mais, com letra e
número", com checagem ao digitar. Envio de arquivos (cargas, campanhas, listas): aceite .csv, .txt e .xlsx em
todos os campos de arquivo, com o texto "CSV, TXT ou XLSX".

Confira em 1440 e 390 px.
```
