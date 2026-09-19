#!/bin/sh
set -e

mkdir -p /data
chown -R node:node /data 2>/dev/null || true

exec /usr/bin/s6-svscan /etc/services.d
