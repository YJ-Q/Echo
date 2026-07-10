#!/bin/bash
set -euo pipefail

# Margin deployment script.
# Requires: docker, docker compose
# Usage: SILICONFLOW_API_KEY=sk-... bash scripts/deploy.sh

APP_NAME="margin"
PORT="${PORT:-3000}"

if [ -z "${SILICONFLOW_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "No LLM API key set. Margin will run in local fallback mode."
  echo "Set SILICONFLOW_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to use a real LLM."
fi

echo "Building ${APP_NAME} Docker image..."
docker compose build

echo "Starting Margin service..."
docker compose up -d

echo "Margin is running at http://localhost:${PORT}"
echo "Health check: curl http://localhost:${PORT}/health"
