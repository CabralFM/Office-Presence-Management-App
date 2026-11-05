#!/usr/bin/env bash
# Proteção contra publicar uma versão ANTIGA do site.
#
# Problema: no GitHub Actions, "Re-run" numa execução antiga volta a publicar
# o código DAQUELA altura — por cima da versão mais recente.
#
# Solução: antes de publicar, comparar a versão desta execução ($GITHUB_SHA)
# com a versão atual da branch master no GitHub. Se forem diferentes, esta
# execução é antiga (ou de outra branch) e NÃO publica.
#
# Saída (para os passos seguintes do workflow): ok=true | ok=false em $GITHUB_OUTPUT.
# Termina sempre com código 0: uma execução antiga não é um erro, só não publica.

set -euo pipefail

BRANCH="${PAGES_BRANCH:-master}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
current="${GITHUB_SHA:?GITHUB_SHA não definido}"

if ! latest="$(git ls-remote --exit-code origin "refs/heads/${BRANCH}" | cut -f1)"; then
  # Sem conseguir confirmar, não arrisca repor uma versão antiga.
  echo "::warning title=Publicação cancelada::Não foi possível ler a versão atual de '${BRANCH}' no GitHub."
  echo "ok=false" >>"$OUT"
  exit 0
fi

if [ "$latest" = "$current" ]; then
  echo "Versão ${current:0:7} é a mais recente de '${BRANCH}': pode publicar."
  echo "ok=true" >>"$OUT"
else
  echo "::warning title=Versão antiga — não publicada::Esta execução é da versão ${current:0:7}, mas '${BRANCH}' já está em ${latest:0:7}. Para não repor um site antigo, nada foi publicado. Para republicar, use Actions → Publicar Presença → Run workflow (usa sempre a versão mais recente)."
  echo "ok=false" >>"$OUT"
fi
