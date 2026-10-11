# Prompt Horizons — Workspace 3/5: Minha conta e Documentação

Rode depois do 2/5. Referência visual: protótipo do Workspace, menu do usuário › Minha conta.

```text
Crie /conta e /docs no Workspace (mesma barra do topo). Não mude tabelas, views ou políticas.

MINHA CONTA (/conta): título "Minha conta", abas segmentadas com rota: Dados (/conta) · Permissões
(/conta/permissoes) · Segurança (/conta/seguranca) · Tokens de API (/conta/tokens).

DADOS
- Foto: círculo 96px (foto ou iniciais). Botões "Trocar foto" e "Remover". Aceita JPG, PNG ou WebP até 2 MB
  (recuse antes de enviar: "Use JPG, PNG ou WebP de até 2 MB."). Recorte quadrado no centro e reduza para 512px
  antes do envio. Envio: storage.from('fotos').upload(`${user.id}/foto-${Date.now()}.jpg`, arquivo) e apague a
  anterior. O bucket é privado: para mostrar, use createSignedUrl(caminho, 3600) e guarde no contexto (o avatar
  da barra do topo usa a mesma URL).
- Campos: Nome*, Sobrenome, Telefone (máscara (11) 99999-9999), Setor; E-mail só leitura ("Para trocar o e-mail,
  fale com o Admin da sua empresa."). Salvar = supabase.rpc('atualizar_meu_perfil', {p_nome, p_sobrenome,
  p_telefone, p_setor, p_foto}) com p_foto = caminho no bucket ou null. Sucesso: "Dados salvos."

PERMISSÕES (só leitura): "O que o seu perfil pode fazer nesta empresa." Lista agrupada por grupo de
from('permissoes_catalogo').select('*').order('ordem') com ✓ verde #248A3D ou — cinza conforme
rpc('minhas_permissoes'). Rodapé: "Quem ajusta é o Admin da empresa, em Usuários e permissões."

SEGURANÇA
1. Senha: Nova senha e Repetir. Regras visíveis enquanto digita (✓ quando cumpre): 12 caracteres ou mais, uma
   letra, um número, igual nos dois campos. NÃO faça novo login para conferir a senha (isso derruba a verificação
   em duas etapas da sessão). Fluxo: supabase.auth.reauthenticate() envia um código ao e-mail; mostre "Enviamos
   um código para {e-mail}." + campo do código; depois updateUser({password: nova, nonce: código}). Código errado
   ou vencido: "Código inválido. Peça outro." Sucesso: "Senha alterada. As outras sessões continuam até você
   encerrá-las abaixo."
2. Verificação em duas etapas: mfa.listFactors(). Ligada: selo verde "Ligada", "Aplicativo autenticador · desde
   {data}", botão "Desligar" (Admin não pode desligar: "Para Admin a verificação é obrigatória."; demais: confirmar
   com código de 6 dígitos e mfa.unenroll). Desligada: botão "Ligar" → mfa.enroll({factorType:'totp'}), mostrar o
   QR e a chave para copiar, campo de 6 dígitos → challenge + verify. Sucesso: "Verificação em duas etapas ligada."
3. Sessões: "Este dispositivo" com navegador e sistema (navigator.userAgentData ou userAgent, resumido: "Mac ·
   Safari") e "Ativa agora". Botão secundário "Sair de todos os outros dispositivos" → signOut({scope:'others'})
   e aviso "Pronto. Os outros dispositivos vão pedir login de novo." Botão "Sair deste dispositivo" → signOut().

TOKENS DE API: card #F5F5F7 com ícone Code: "Os tokens de API chegam com o módulo API. Com eles, o sistema da sua
empresa envia cargas e lê a Lista do dia sem passar pelo site." Botão "Quero ser avisado" → abre /suporte/novo com
motivo 'integracao' e assunto "Interesse na API". Nada de gerar token agora.

DOCUMENTAÇÃO (/docs): busca no topo (filtra por título e texto) e 6 cards de categoria: Primeiros passos ·
Lista do dia · Orquestração · Mensageria · Arquivos e cargas · Segurança e conta. Cada artigo em /docs/{slug},
coluna de 680px, título 34px 700, texto 17px/1.6, índice lateral no desktop, "Isso ajudou? Sim / Não" (só visual)
e no fim "Não achou? Abrir chamado" → /suporte/novo. Artigos iniciais (texto curto, 3 a 5 parágrafos cada):
- primeiros-passos "Do convite à primeira Lista do dia": convite, senha, código de duas etapas, enviar a carga,
  conferir a Lista do dia às 6h.
- lista-do-dia "Como ler a Lista do dia": os quatro grupos (com ação, regra da esteira, sem contato, fora da
  cobrança) e o que fazer com quem está sem contato.
- orquestracao "Réguas, “senão” e telefone Hot": arrastar canal para o dia, reserva, Hot primeiro.
- arquivos "Arquivo ou API": carga geral, incremental, retirada, acordos, pagamentos; mapeamento de colunas;
  relatório de linhas aceitas e rejeitadas.
- mensageria "Templates e frases": WhatsApp e RCS com template aprovado, SMS e agente virtual com frase,
  descadastro respeitado em todos os canais.
- seguranca "Senha, duas etapas e sessões": como ligar o autenticador e encerrar sessões.

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
