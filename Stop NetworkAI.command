#!/bin/sh
cd "$(dirname "$0")"
sh scripts/local.sh stop
printf '\nNetworkAI stopped. Your data is preserved. Press Return to close.'
read -r unused
