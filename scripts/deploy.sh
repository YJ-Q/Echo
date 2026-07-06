#!/bin/bash
set -euo pipefail

# Echo Deployment Script
# Requires: docker, docker compose
# Usage: SILICONFLOW_API_KEY=sk-... bash scripts/deploy.sh

APP_NAME="echo-backend"
PORT="${PORT:-3000}"

if [ -z "${SILICONFLOW_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "⚠️  No LLM API key set. Echo will run in local fallback mode."
  echo "   Set SILICONFLOW_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to use a real LLM."
fi

echo "🏗️  Building Docker image..."
docker compose build

echo "🚀 Starting Echo service..."
docker compose up -d

echo "✅ Echo is running at http://localhost:${PORT}"
echo "   Health check: curl http://localhost:${PORT}/health"
