#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/JetBrains/bonsai.git"
REPO_DIR="bonsai"

echo "Cloning $REPO_URL..."
git clone "$REPO_URL" "$REPO_DIR"

cd "$REPO_DIR"

echo "Running deploy.sh..."
bash deploy.sh
