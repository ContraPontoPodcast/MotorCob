"""Colunas e funções do SQL 60 que o código de voz/analise usa. supabase/testes/testar_speech.py confere cada uma
contra o banco: se um nome mudar no SQL, muda só aqui."""
from __future__ import annotations

COLUNAS: dict[str, tuple[str, ...]] = {
    "voz_trechos": ("empresa_id", "credor_id", "gravacao_id", "origem", "inicio_s", "fim_s", "falante",
                    "texto_redigido"),
    "voz_curadoria_itens": ("empresa_id", "tipo", "chamada_id", "gravacao_id", "avaliacao_id", "tema_id",
                            "trecho_redigido", "decisao_ia", "opcoes", "confianca"),
    "relatorios_credor": ("id", "empresa_id", "credor_id", "competencia", "situacao", "conteudo", "comentario",
                          "pdf_caminho"),
    "voz_analise_consumo": ("empresa_id", "dia", "componente", "chamadas", "minutos", "minutos_cobrados",
                            "tokens_entrada", "tokens_saida", "custo_real"),
    "empresas": ("id", "slug", "nome"),
    "credores": ("id", "nome"),
    "voz_analise_chamadas": ("empresa_id", "credor_id", "chamada_id", "gravacao_id", "origem", "operador_ref", "dia",
                             "situacao", "tentativas", "minutos", "codigos", "fala_agente_s", "fala_cliente_s",
                             "silencio_s", "interrupcoes", "sentimento_ini", "sentimento_fim", "versao"),
}
# coluna que só existe com a extensão pgvector (decisão 9); sem ela a VM grava o trecho sem embedding
COLUNA_EMBEDDING = "embedding"
DIMENSAO = 1536

RPCS = ("buscas_voz_pendentes", "responder_busca_voz", "gravar_relatorio_credor", "registrar_recomendacao_voz",
        "conferir_rascunhos_recomendacoes", "renitencia_voz", "avisar_alertas_voz", "apagar_analise_voz_expirada", "registrar_uso_ia_voz",
        # SQL 62 · dados do Speech Analytics (voz/analise/analisador.py e rotina.py)
        "speech_contexto_voz", "gravar_analise_voz", "agregar_speech_dia", "speech_empresas_voz",
        "dados_retroalimentacao_voz", "recomendacoes_aplicadas_voz", "gravar_impacto_voz",
        # SQL 63 · ligações da IA, temas novos (clusterização semanal) e embedding dos trechos
        "registrar_gravacoes_ia_voz", "trechos_para_temas_voz", "propor_tema_voz", "recalcular_temas_semana",
        "speech_vetor_voz", "buscas_semanticas_pendentes_voz")

CONFLITO = {"voz_trechos": "gravacao_id,inicio_s,falante"}
