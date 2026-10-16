"""E-mails do sistema (SQL 42): o motor dispara a fila dos avisos que viram e-mail, confere o domínio dos remetentes
e apaga o registro antigo.

* A cada 10 minutos: a função "emails" pega os avisos do sino que viram e-mail (os obrigatórios e os que a pessoa
  ligou) e manda um por destinatário, no modelo único.
* Uma vez por dia: SPF, DKIM e DMARC do domínio (consulta DNS pública, sem chave) para o Console mostrar se os
  e-mails vão chegar; e o registro de envios com mais de 180 dias sai do banco.
Banco ou função ainda sem o SQL 42: nada acontece e o plantão segue.
"""
import json
import urllib.parse
import urllib.request

DOH = "https://dns.google/resolve"


def avisos(sb, out=print) -> int:
    try:
        r = sb.funcao("emails", {"acao": "avisos"}) or {}
    except Exception as erro:  # noqa: BLE001 — função ainda não publicada ou fora do ar: o sino segue
        out(f"e-mails: fila de avisos não rodou ({str(erro)[:120]})")
        return 0
    n = int(r.get("enviados") or 0)
    if n or r.get("erros"):
        out(f"e-mails: {n} aviso(s) por e-mail" + (f", {r['erros']} não saíram" if r.get("erros") else ""))
    return n


def _txt(nome: str, consultar=None) -> list[str]:
    """Registros TXT de um nome (DNS público por HTTPS). Erro de rede = lista vazia."""
    if consultar:
        return consultar(nome)
    url = DOH + "?" + urllib.parse.urlencode({"name": nome, "type": "TXT"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/dns-json"}), timeout=15) as r:
            j = json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return []
    return ["".join(p.strip('"') for p in a.get("data", "").split('" "')) for a in j.get("Answer") or [] if a.get("type") == 16]


def conferir_dominio(dominio: str, seletor: str | None, consultar=None) -> dict:
    """SPF (v=spf1 no domínio), DMARC (_dmarc) com a política e DKIM (seletor._domainkey), quando há seletor."""
    spf = [t for t in _txt(dominio, consultar) if t.lower().startswith("v=spf1")]
    dmarc = [t for t in _txt(f"_dmarc.{dominio}", consultar) if t.upper().startswith("V=DMARC1")]
    politica = None
    if dmarc:
        for parte in dmarc[0].split(";"):
            k, _, v = parte.strip().partition("=")
            if k.strip().lower() == "p":
                politica = v.strip().lower()
    if seletor:
        dk = [t for t in _txt(f"{seletor}._domainkey.{dominio}", consultar) if "p=" in t]
        dkim = "ok" if dk else "ausente"
    else:
        dkim = "sem_seletor"
    return {"spf": "ok" if len(spf) == 1 else ("duplicado" if spf else "ausente"),
            "spf_locaweb": bool(spf) and "locaweb" in spf[0].lower(),
            "dkim": dkim, "dmarc": "ok" if dmarc else "ausente", "politica_dmarc": politica}


def verificar(sb, out=print, consultar=None) -> dict | None:
    try:
        cfg = (sb.selecionar("email_config", {"id": "eq.1"}) or [None])[0]
    except Exception:  # noqa: BLE001 — banco ainda sem o SQL 42
        return None
    if not cfg:
        return None
    r = conferir_dominio(cfg.get("dominio") or "motorcob.online", cfg.get("dkim_seletor"), consultar)
    try:
        sb.rpc("registrar_verificacao_email", {"resultado": r})
    except Exception:  # noqa: BLE001
        return r
    falta = [k.upper() for k in ("spf", "dkim", "dmarc") if r[k] != "ok"]
    if falta:
        out(f"e-mails: domínio {cfg.get('dominio')} sem {', '.join(falta)} — veja 02_supabase_painel/EMAILS_SISTEMA.md")
    return r


def limpar(sb) -> None:
    try:
        sb.rpc("limpar_emails_sistema")
    except Exception:  # noqa: BLE001 — banco ainda sem o SQL 42
        pass
