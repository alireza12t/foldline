#!/bin/sh
# Copy the root llms.txt and llms-full.txt into docs/ for the GitHub Pages site
# (Pages serves only docs/). docs/index.md is the Markdown version of the landing page.
# Run from the repo folder after changing either file: sh tools/sync-pages.sh
set -e
cd "$(dirname "$0")/.."
cp llms.txt docs/llms.txt
cp llms-full.txt docs/llms-full.txt
cp llms-full.txt docs/index.md
echo "docs/llms.txt, docs/llms-full.txt and docs/index.md updated"
