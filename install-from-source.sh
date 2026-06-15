#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/JetBrains/thinkrail.git"
REPO_DIR="thinkrail"

echo "Cloning $REPO_URL ..."
git clone "$REPO_URL" "$REPO_DIR"

cd "$REPO_DIR"

echo "Running run.sh --fresh ..."
bash run.sh --fresh
