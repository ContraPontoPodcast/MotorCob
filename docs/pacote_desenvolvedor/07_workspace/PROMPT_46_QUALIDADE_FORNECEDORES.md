# Prompt Horizons — 46: Console › Qualidade dos fornecedores e função Técnico (bloco 6)

Rode depois do SQL 33. Protótipo aprovado: `docs/homologacao/bloco6-qualidade-score-prototipo.html`.

```text
Console MotorCX (motorcob.online/console). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Equipe: função Técnico
No controle de função (prompts 30 e 40) entra a 5ª opção: Master · Comercial · Atendimento · Administrativo ·
Técnico → rpc definir_funcao_equipe(id, 'tecnico'). Texto: "Vê a qualidade dos fornecedores e o detalhe técnico
dos envios, configura o filtro de inteligência e os nomes devolvidos ao cliente. Atende chamados."
A tabela de permissões (permissoes_equipe_catalogo) ganha a coluna Técnico e o grupo "Técnico".
Menu do Técnico: Empresas, Saúde, Atendimento, Qualidade dos fornecedores, Filtro de inteligência.

## 2. Mensageria › Qualidade dos fornecedores (permissão ver_qualidade)
Topo: Canal (SMS · RCS), período com "De" e "Até" (data e hora; padrão: últimas 24 h), Fornecedor.
Texto abaixo do título: "No SMS, o % entregue reflete a qualidade do mailing. Aqui o fornecedor é medido pela
velocidade e pela DLR."
- Cartões: Disparados · Aceite pelo fornecedor (mediana) · Tempo até a DLR (mediana) · Sem DLR após N min.
- Alertas abertos: rpc alertas_qualidade(canal) → (fornecedor, operadora, nivel 'atencao'|'critico', motivo).
  Cartão por alerta com selo âmbar "Atenção" ou vermelho "Crítico". Também na Saúde do Console.
- Tabela fornecedor × operadora: rpc qualidade_fornecedores(de, ate, canal) → Disparados, Aceite (med · p90),
  DLR (med · p90) em segundos, Sem DLR %, Entregue no lote %, Situação (Normal/Atenção/Crítico pelos limites de
  mensageria_alertas_config). Nota: "Dentro do mesmo lote a rota sorteia o tráfego: a coluna Entregue no lote
  compara fornecedores com a mesma qualidade de mailing."
- Gráfico de linhas "Tempo até a DLR, por hora": rpc qualidade_por_hora(de, ate, canal), uma linha por
  fornecedor e a linha tracejada do limite.
- Limites de alerta (botão "Limites", só com configurar_score): edita mensageria_alertas_config (minutos sem DLR,
  % sem DLR, DLR p90 em segundos, janela em minutos).

## 3. Detalhe técnico (só com ver_detalhe_tecnico: Master e Técnico)
Bloco recolhível "Detalhe técnico" no fim da tela: rpc detalhe_tecnico_envios(de, ate, fornecedor, 200) →
Envio (#id), Destino (sempre mascarado), Fornecedor, Operadora, Código original (dlr_codigo em fonte mono, ex.:
DELIVRD), Enviado, Confirmado, DLR (horas com segundos), Fallback, Faixa do Score, Controle. Para os outros
perfis o bloco não aparece.

Confira em 1440 e 390 px, claro e escuro.
```
