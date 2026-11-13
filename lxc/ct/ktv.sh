#!/usr/bin/env bash
# Fetch install/ktv-install.sh from this repo instead of the upstream community-scripts one.
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/ethereal-sheep/ktv-proxy/main/lxc}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2021-2026 community-scripts ORG
# Author: cantiuschew
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/ethereal-sheep/ktv-proxy

APP="KTV"
var_tags="${var_tags:-karaoke;remote}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-1024}" # the one-off vite build needs it; the running app uses ~60MB
var_disk="${var_disk:-4}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/ktv ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  NODE_VERSION="24" setup_nodejs

  msg_info "Stopping Service"
  systemctl stop ktv
  msg_ok "Stopped Service"

  msg_info "Updating ${APP}"
  cd /opt/ktv
  $STD git pull --ff-only
  $STD npm ci
  $STD npm run build
  rm -rf node_modules
  msg_ok "Updated ${APP}"

  # the saved box address lives in /var/lib/ktv, so it survives the update
  msg_info "Starting Service"
  systemctl start ktv
  msg_ok "Started Service"
  msg_ok "Updated successfully!"
  exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Open it and enter the KTV machine's IP, or let it search the network:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:8080${CL}"
