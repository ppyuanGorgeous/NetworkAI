#!/bin/sh
cd "$(dirname "$0")"
sh scripts/local.sh up
printf '\nPress Return to close this window.'
read -r unused
