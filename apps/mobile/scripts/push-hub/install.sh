#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 2 ]] || { echo 'Usage: install.sh <absolute-node-path> <absolute-hub-directory>' >&2; exit 1; }
node_binary=$1
hub_directory=$2
[[ $node_binary == /* && -x $node_binary && $hub_directory == /* && -s $hub_directory/main.mjs && -s $hub_directory/config.json ]] || { echo 'Missing Node, bundle or hub config.' >&2; exit 1; }
[[ $("$node_binary" -p 'Number(process.versions.node.split(".")[0]) >= 24') == true ]] || { echo 'Node 24 or newer is required.' >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"
plist="$HOME/Library/LaunchAgents/com.viktorrudi.t3-personal-push.plist"
/usr/bin/python3 - "$plist" "$node_binary" "$hub_directory" <<'PY'
import os, plistlib, sys
path, node, directory = sys.argv[1:]
with open(path, 'wb') as output:
    plistlib.dump({'Label':'com.viktorrudi.t3-personal-push','ProgramArguments':[node,os.path.join(directory,'main.mjs'),'run',os.path.join(directory,'config.json')], 'WorkingDirectory':directory,'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,'EnvironmentVariables':{'WS_NO_BUFFER_UTIL':'1','WS_NO_UTF_8_VALIDATE':'1'},'StandardOutPath':os.path.join(directory,'service.log'),'StandardErrorPath':os.path.join(directory,'service-error.log')}, output)
os.chmod(path, 0o600)
PY
plutil -lint "$plist"
if launchctl print "gui/$(id -u)/com.viktorrudi.t3-personal-push" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/com.viktorrudi.t3-personal-push"
fi
for attempt in 1 2 3; do
  if launchctl bootstrap "gui/$(id -u)" "$plist"; then break; fi
  [[ $attempt != 3 ]] || exit 1
  sleep 1
done
launchctl print "gui/$(id -u)/com.viktorrudi.t3-personal-push"
