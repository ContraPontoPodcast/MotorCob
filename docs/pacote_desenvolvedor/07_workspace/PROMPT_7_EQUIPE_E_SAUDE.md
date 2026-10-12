# Prompt Horizons — Workspace 7: Console › Equipe (Master e Atendimento) e Saúde do sistema

Rode depois dos SQL 10 e 11 e da função `admin-usuarios` nova (18a). Cole no Horizons e publique:

```text
No Console MotorCob (/console), acrescente duas abas e ajuste quem vê o quê. Não mude tabelas, views ou políticas.

QUEM VÊ O QUÊ (perfis.equipe = true; Master = papel 'admin', Atendimento = papel 'operacao')
- Master: todas as abas (Saúde, Empresas, Atendimento, Faturamento, Fornecedores, Equipe) e todos os botões.
- Atendimento: Saúde, Empresas (só leitura) e Atendimento. Esconda Faturamento, Fornecedores, Equipe e os botões de
  cadastro/edição. O banco já recusa o resto; o site só esconde.
- Na barra do topo, ao lado de "Console MotorCob", selo pequeno "Master" (champanhe #C9A35A) ou "Atendimento" (cinza).
- A aba inicial do Console passa a ser Saúde (/console/saude); Empresas continua em /console.

ABA SAÚDE (/console/saude) — rpc('saude_empresas'), atualiza a cada 60 s com a aba visível
- Topo: 4 KPIs #F5F5F7: "Críticas" (nivel critico, número em #D70015), "Pedem atenção" (atencao, #B25000),
  "Em dia" (ok, #248A3D), "Faturas vencidas" (soma de valor_vencido em R$).
- Lista (críticas primeiro, já vem ordenada): ponto 10px (critico #FF3B30, atencao #FF9500, ok #34C759), nome da
  empresa e selo da situação; à direita, só os alertas que existirem, como pílulas clicáveis:
  "Rotina com erro: {ultima_rotina_erro}" (vermelha) → Console › Empresas › empresa › execuções ·
  "Rotina de hoje não rodou" (vermelha, quando rotina_hoje = false e nivel critico) ·
  "{cargas_erro_7d} cargas com erro" → Enviar arquivos da empresa ·
  "{cargas_aguardando} cargas aguardando mapeamento" → Mapeamento ·
  "{lotes_parados} lotes parados" e "{lotes_aguardando} lotes aguardando aprovação" → Mensageria da empresa ·
  "{chamados_atrasados} chamados atrasados" → Console › Atendimento filtrado pela empresa ·
  "{faturas_vencidas} faturas vencidas · R$ {valor_vencido}" → Console › Faturamento.
  Clicar na pílula torna a empresa ativa antes de navegar. Empresa ok: "Tudo em dia" em #248A3D.
- Linha secundária 13px #6E6E73: "Última rotina {há quanto tempo} · {ok | erro | rodando}".
- Sem empresas: "Nenhuma empresa ativa ainda."

ABA EQUIPE (/console/equipe, só Master)
- Lista: rpc('listar_equipe') → Nome · E-mail · Função (selo "Master" champanhe ou "Atendimento" cinza) · Duas etapas
  ("Ligada" verde ou "Desligada" laranja) · Último login · Situação (ativo). A própria linha mostra "(você)".
- "Convidar para a equipe" (modal): Nome, E-mail*, Função (segmentado Master / Atendimento, com a legenda:
  Master "Cadastra empresas, libera módulos, fecha faturas e gerencia a equipe." · Atendimento "Vê todas as empresas
  e responde chamados.") → supabase.functions.invoke('admin-usuarios', {body: {acao: 'convidar_equipe', email, nome,
  funcao: 'master' | 'atendimento'}}). Sucesso: "Convite enviado. No primeiro acesso, Master cadastra o autenticador."
- Em cada linha (não na própria): "Tornar Master" / "Mudar para Atendimento" → rpc('definir_funcao_equipe',
  {usuario: id, funcao}); "Resetar duas etapas" → invoke admin-usuarios {acao: 'resetar_2fa', usuario_id};
  "Desativar" / "Reativar" → invoke admin-usuarios {acao: 'desativar' | 'reativar', usuario_id}. Confirmação na
  própria linha antes de cada ação.
- Erros do banco/função em texto: "entre com o seu código de duas etapas para mudar a equipe" (mostre também
  "Sair e entrar de novo"), "a equipe precisa de pelo menos um Master ativo", "ninguém muda a própria função".
- Rodapé: "Master entra sempre com o código de duas etapas. Mantenha pelo menos dois Masters para não ficar sem
  acesso."

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
