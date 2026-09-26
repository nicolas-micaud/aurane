#!/usr/bin/env bash
# install-timers.sh — installs (or refreshes) the Aurane backup units on aurane-app1 from /srv/aurane/backup:
# aurane-pg-backup.timer (nightly 04:20) and aurane-restore-test.timer (weekly, Sunday 05:10). Idempotent.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
chmod +x ./*.sh
install -m 644 aurane-pg-backup.service aurane-pg-backup.timer aurane-restore-test.service aurane-restore-test.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now aurane-pg-backup.timer aurane-restore-test.timer
systemctl list-timers --all | grep -E 'aurane-(pg-backup|restore-test)'
