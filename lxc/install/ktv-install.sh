#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: cantiuschew
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/ethereal-sheep/ktv-proxy

# Edit before first use: where the app source lives.
KTV_REPO="https://github.com/ethereal-sheep/ktv-proxy.git"

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y git
msg_ok "Installed Dependencies"

NODE_VERSION="24" setup_nodejs

msg_info "Installing KTV"
$STD git clone --depth 1 "$KTV_REPO" /opt/ktv
cd /opt/ktv
$STD npm ci
$STD npm run build
rm -rf node_modules # server/ only uses Node built-ins, so nothing is needed at runtime
mkdir -p /var/lib/ktv
msg_ok "Installed KTV"

msg_info "Creating Service"
cat <<EOT >/etc/systemd/system/ktv.service
[Unit]
Description=KTV remote
After=network-online.target

[Service]
WorkingDirectory=/opt/ktv
Environment=PORT=8080
Environment=KTV_CONFIG=/var/lib/ktv/config.json
ExecStart=/usr/bin/node server/serve.ts
Restart=always

[Install]
WantedBy=multi-user.target
EOT
systemctl enable -q --now ktv
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc
