# Prompt do site — faixas que abrem pelo cabeçalho todo, frases no Deu CPC e convite com acessos

Antes: rode no Supabase o SQL `20261025000001_permissoes_usuario.sql` e atualize a função `admin-usuarios`
(Edge Functions › admin-usuarios › Code › cole a versão nova › Deploy). Cole no Hostinger Horizons e publique:

---

```text
Três ajustes. Não mude o que não está descrito aqui.

## 1. Bug: faixas da Orquestração só abrem clicando no título
Hoje só o título abre/fecha; a seta (chevron) e o lado direito do cabeçalho não respondem. Corrija em TODAS as faixas
(Cliente novo, Deu CPC, Não CPC, Clientes em acordo, Prioridade dos telefones) e nos blocos "Frases desta faixa":
- O cabeçalho inteiro (título, resumo, espaço vazio e a seta) alterna abrir/fechar com um clique, cursor-pointer.
- O interruptor Ligado/Desligado continua funcionando sozinho: no clique dele use e.stopPropagation() para não
  abrir/fechar a faixa junto.
- Enter/Espaço no cabeçalho alternam; aria-expanded correto.
- "Expandir tudo" abre também o bloco "Frases desta faixa" do Deu CPC (hoje o cpc fica de fora).

## 2. Frases no "Deu CPC"
O Deu CPC não é por dia: a frase fica no canal.
- Cartão "★ Canal do CPC · telefone Hot": ganha o balão 💬 (mesmo editor das outras faixas: "Do playbook" /
  "Escrever"). O editor tem uma aba por canal ligado na empresa (o canal do CPC varia por cliente) e, em cada aba, a
  opção "Mesma frase para CPC A e CPC B" (padrão) ou duas abas internas CPC A / CPC B.
  Grava em definicao.cpc.mensagem_hot = { "<canal>": "texto" | {"frase_id": n} | {"cpa": …, "cpb": …}, … }
  (só os canais preenchidos; vazio = apague a chave).
- Cada canal da ordem de reserva (definicao.cpc.ordem[i]) e do reforço "junto" (definicao.cpc.junto[i]) ganha o
  balão 💬. Grava em .mensagem: "texto" | {"frase_id": n} | {"cpa": …, "cpb": …}.
- Bloco "Frases desta faixa" (mesmo padrão de recolher das outras faixas) dentro do Deu CPC, com as linhas:
  "Canal do CPC · <canal> · CPC A/B", "Reserva 1 · <canal>", "Junto · <canal>", com Editar/Limpar e o resumo
  "N de M com frase".
- Balão vazio/azul/vermelho como nas outras faixas (vermelho = frase do playbook desativada ou apagada).

## 3. Convite completo na página Usuários
Botão "+ Convidar usuário" abre um painel lateral com:
- Nome (obrigatório), E-mail (obrigatório), Perfil (Admin só aparece para quem é Admin).
- Acessos: a lista de permissões (select * from permissoes_catalogo, agrupadas por grupo), com interruptor em cada.
  Começa com o que o perfil escolhido já tem (padrão MotorCob + ajuste da empresa em permissoes_papel); ao trocar
  o perfil, recalcula. Interruptor mudado em relação ao perfil ganha a etiqueta "exceção" (âmbar) e um "↺" para
  voltar ao do perfil. Grupo Administração desabilitado para quem não é Admin. Perfil Admin: "Gerenciar usuários" e
  "Gerenciar permissões" travados ligados.
- Botão "Enviar convite" → supabase.functions.invoke('admin-usuarios', { body: { acao: 'convidar', email, nome,
  papel, acessos } }), onde acessos = só as exceções ({ "reenquadrar": true, "baixar_listas": false }).
  Sucesso: "Convite enviado para <e-mail>." e a pessoa aparece na lista como "Convite enviado" até o 1º acesso
  (ultimo_acesso vazio).
- Em cada linha da lista, botão "Acessos" abre o mesmo painel para o usuário existente:
  select * from permissoes_do_usuario('<id>') → codigo, permitido, origem ('padrao' | 'perfil' | 'usuario').
  Etiqueta por linha: Padrão MotorCob / Ajuste do perfil / Exceção deste usuário.
  Mudar um interruptor → upsert em permissoes_usuario (usuario_id, permissao, permitido), conflito em
  usuario_id,permissao. "↺ Voltar ao perfil" → delete from permissoes_usuario where usuario_id = … and permissao = ….
  "Voltar tudo ao perfil" → apaga todas as exceções do usuário.
- Na própria linha do usuário logado o botão "Acessos" é só leitura ("Você não pode alterar os seus próprios acessos").
- Erro do banco → mostre a mensagem em português (ex.: "só um Admin libera acessos de administração").
```
