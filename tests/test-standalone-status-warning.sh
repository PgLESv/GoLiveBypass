#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
sh -n "$ROOT/standalone/golivebypass-standalone.sh"
grep -F 'O standalone CLI esta temporariamente indisponivel.' "$ROOT/standalone/golivebypass-standalone.sh" >/dev/null
grep -F 'Use a GUI 2.0.0 de teste' "$ROOT/standalone/golivebypass-standalone.sh" >/dev/null
grep -F 'O standalone CLI esta temporariamente indisponivel.' "$ROOT/standalone/GoLiveBypass-Standalone.ps1" >/dev/null
grep -F 'Use a GUI 2.0.0 de teste' "$ROOT/standalone/GoLiveBypass-Standalone.ps1" >/dev/null
grep -F 'Plugin e standalone CLI estao temporariamente fora do ar.' "$ROOT/installer/golivebypass-installer.sh" >/dev/null
grep -F 'Use a GUI 2.0.0 de teste' "$ROOT/installer/golivebypass-installer.sh" >/dev/null
grep -F 'Plugin e standalone CLI estao temporariamente fora do ar.' "$ROOT/installer/GoLiveBypass-Installer.ps1" >/dev/null
grep -F 'Use a GUI 2.0.0 de teste' "$ROOT/installer/GoLiveBypass-Installer.ps1" >/dev/null
echo 'standalone status warnings: ok'
