#!/usr/bin/env sh
set -eu

node /opt/opengram/web/deploy/docker/run-migrations.js
exec node server.js
