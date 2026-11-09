#!/bin/sh
# Bring the Claude directory copy of the plugin (github alireza12t/foldline-claude-plugin) in line with this repo:
# copies the Foldline skill (foldline-plugin/skills/foldline/SKILL.md) and sets its plugin.json version to package.json's.
# Run it after every release, and whenever that SKILL.md changes. It prints what changed; you review, commit and push there.
# That repo's CI ("In sync with Foldline", daily and on each push) fails when its skill or version differ from this repo's main branch.
#   sh tools/sync-claude-plugin.sh [path to the plugin repo clone]   (default $FOLDLINE_PLUGIN_REPO, else ~/Desktop/foldline-claude-plugin; cloned if missing)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR="${1:-${FOLDLINE_PLUGIN_REPO:-$HOME/Desktop/foldline-claude-plugin}}"
if [ ! -d "$DIR/.git" ]; then git clone -q https://github.com/alireza12t/foldline-claude-plugin.git "$DIR"; fi
[ -z "$(git -C "$DIR" status --porcelain)" ] || { echo "sync-claude-plugin: $DIR has uncommitted changes; commit or clear them first" >&2; exit 1; }
git -C "$DIR" pull -q --ff-only
cp "$ROOT/foldline-plugin/skills/foldline/SKILL.md" "$DIR/skills/foldline/SKILL.md"
ROOT="$ROOT" DIR="$DIR" node -e '
const fs = require("fs"), v = require(process.env.ROOT + "/package.json").version, f = process.env.DIR + "/.claude-plugin/plugin.json";
const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = v; fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
console.log("plugin version: " + v);'
if [ -z "$(git -C "$DIR" status --porcelain)" ]; then echo "already in sync: $DIR"; else git -C "$DIR" status --short; echo "review, then commit and push in $DIR"; fi
