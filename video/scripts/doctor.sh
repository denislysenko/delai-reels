#!/bin/bash
# Checks everything the pipeline needs and prints one line per item: ok / MISSING + how to fix.
# Never prints a key — only whether it is set. Exit code = number of missing REQUIRED items.
cd "$(dirname "$0")/.."
miss=0
ok()   { printf "  ok       %-22s %s\n" "$1" "$2"; }
need() { printf "  MISSING  %-22s → %s\n" "$1" "$2"; miss=$((miss + 1)); }
opt()  { printf "  optional %-22s → %s\n" "$1" "$2"; }
has()  { command -v "$1" >/dev/null 2>&1; }
cfg()  { node -p "require('../harness.config.json').$1" 2>/dev/null; }

echo "required"
if has node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then ok node "$(node -v)"; else need node "brew install node (18+)"; fi
[ -d node_modules/remotion ] && ok "npm packages" "installed" || need "npm packages" "cd video && npm install"
has ffmpeg && ok ffmpeg "$(ffmpeg -version | head -1 | cut -d' ' -f3)" || need ffmpeg "brew install ffmpeg"
has python3 && ok python3 "$(python3 --version | cut -d' ' -f2)" || need python3 "brew install python"

echo "transcription ($(cfg transcription))"
if [ "$(cfg transcription)" = "elevenlabs" ]; then
  grep -q '^ELEVENLABS_API_KEY=.\+' .env 2>/dev/null && ok "ELEVENLABS_API_KEY" "set in video/.env" || need "ELEVENLABS_API_KEY" "put it in video/.env"
else
  has whisper-cli && ok whisper-cli "$(command -v whisper-cli)" || need whisper-cli "brew install whisper-cpp"
  M="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-large-v3-turbo.bin}"
  [ -f "$M" ] && ok "whisper model" "$(du -h "$M" | cut -f1)" || need "whisper model" "mkdir -p ~/.cache/whisper && curl -L -o $M https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin (1.6 GB)"
fi

echo "poster behind the head ($(cfg style.poster.enabled))"
if [ "$(cfg style.poster.enabled)" = "true" ]; then
  python3 -c "import rembg" 2>/dev/null && ok rembg "installed" || need rembg "pip3 install 'rembg[cpu]' (model birefnet-portrait downloads on first run, ~900 MB)"
fi
python3 -c "import numpy, scipy, PIL" 2>/dev/null && ok "numpy scipy pillow" "for the cover sticker" || opt "numpy scipy pillow" "pip3 install numpy scipy pillow (cover sticker)"

echo "agent tooling"
[ -d ../.claude/skills/remotion-best-practices ] && ok "remotion skills" "installed" || need "remotion skills" "cd .. && npx -y skills add remotion-dev/skills --skill '*' --agent claude-code -y"
has yt-dlp && ok yt-dlp "for reference reels" || opt yt-dlp "brew install yt-dlp (download reference reels)"

# Access: keys are read into shell variables and checked live — never echoed. A service that is
# switched on in the profile and does not answer is a MISSING item; one that is off is optional.
echo "access (see SERVICES.md)"
key() { sed -n "s/^$1=//p" .env 2>/dev/null | tr -d '"' | head -1; }
on()  { [ "$(cfg "integrations['$1']")" = "true" ] || { [ "$1" = elevenlabs ] && [ "$(cfg transcription)" = "elevenlabs" ]; }; }
bad() { if on "$1"; then need "$2" "$3"; else opt "$2" "$3"; fi; }

EL=$(key ELEVENLABS_API_KEY)
if [ -z "$EL" ]; then bad elevenlabs "ElevenLabs key" "not set — SERVICES.md → ElevenLabs"
else
  R=$(curl -s -m 15 -w ' %{http_code}' -H "xi-api-key: $EL" https://api.elevenlabs.io/v1/user)
  case "$R" in
    *" 200") ok "ElevenLabs key" "works" ;;
    *missing_permissions*) ok "ElevenLabs key" "works (restricted key)" ;;
    *) bad elevenlabs "ElevenLabs key" "rejected (${R##* }) — create a new one, SERVICES.md" ;;
  esac
fi

T=$(key TWENTYFIRST_API_KEY)
if [ -z "$T" ]; then bad 21st "21st.dev key" "not set — SERVICES.md → 21st.dev"
else
  C=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST https://21st.dev/api/mcp -H "x-api-key: $T" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"doctor","version":"1"}}}')
  [ "$C" = 200 ] && ok "21st.dev key" "works" || bad 21st "21st.dev key" "rejected ($C) — SERVICES.md → 21st.dev"
fi

# MCP servers: what Claude Code itself reports (needs the `claude` CLI on PATH)
if has claude; then
  LIST=$(cd .. && claude mcp list 2>/dev/null)
  for s in elevenlabs higgsfield 21st buffer; do
    on "$s" || continue
    line=$(printf '%s\n' "$LIST" | grep "^$s:")
    case "$line" in
      *Connected*) ok "MCP $s" "connected" ;;
      *"Needs authentication"*) need "MCP $s" "restart Claude Code here, /mcp → $s → Authenticate" ;;
      "") [ "$s" = elevenlabs ] && ok "MCP $s" "not used — the API key covers it" || need "MCP $s" "not configured — setup step 3.5" ;;
      *) need "MCP $s" "$(printf '%s' "$line" | sed 's/^[^-]*- //')" ;;
    esac
  done
else
  opt "claude CLI" "not on PATH — check MCP status with /mcp inside Claude Code"
fi

echo
[ $miss -eq 0 ] && echo "all required tools are in place" || echo "$miss required item(s) missing"
exit $miss
