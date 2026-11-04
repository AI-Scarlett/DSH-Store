#!/usr/bin/env bash
set -Eeuo pipefail

echo "=================================================="
echo "  DSH Store 大模型后台配置与推荐服务一键部署程序  "
echo "=================================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "[!] 错误：请以 root 权限运行此脚本：sudo bash $0" >&2
  exit 1
fi

node_bin="$(command -v node || true)"
if [ -z "$node_bin" ]; then
  for candidate in /usr/bin/node /usr/local/bin/node /snap/bin/node; do
    if [ -x "$candidate" ]; then
      node_bin="$candidate"
      break
    fi
  done
fi

if [ -z "$node_bin" ]; then
  echo "[*] 未检测到 Node.js，正在尝试安装..."
  apt-get update -y && apt-get install -y nodejs || true
  node_bin="$(command -v node || true)"
fi

if [ -z "$node_bin" ]; then
  echo "[!] 错误：未找到 Node.js 运行时环境，请先安装 Node.js (v18+)" >&2
  exit 1
fi

echo "[+] Node.js 路径: $node_bin ($($node_bin -v))"

SERVICE_DIR="/opt/dsh-model-service"
mkdir -p "$SERVICE_DIR" "$SERVICE_DIR/src" "$SERVICE_DIR/scripts"

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || echo "")"

if [ -f "$REPO_ROOT/scripts/serve-marketplace.mjs" ] && [ -f "$REPO_ROOT/src/ai-model-settings.mjs" ]; then
  echo "[+] 从本地代码仓库复制后端服务代码..."
  cp "$REPO_ROOT/package.json" "$SERVICE_DIR/"
  cp "$REPO_ROOT/src/ai-model-settings.mjs" "$SERVICE_DIR/src/"
  cp "$REPO_ROOT/src/ai-recommend.mjs" "$SERVICE_DIR/src/"
  cp "$REPO_ROOT/scripts/serve-marketplace.mjs" "$SERVICE_DIR/scripts/"
else
  echo "[+] 解包内置自包含后端服务模块..."
  cat << 'BUNDLE_EOF' | base64 -d | tar -xz -C "$SERVICE_DIR"
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
BUNDLE_EOF
fi

test -f "$SERVICE_DIR/package.json"
test -f "$SERVICE_DIR/scripts/serve-marketplace.mjs"
test -f "$SERVICE_DIR/src/ai-model-settings.mjs"
test -f "$SERVICE_DIR/src/ai-recommend.mjs"

mkdir -p /var/lib/dsh-store
chmod 700 /var/lib/dsh-store

echo "[+] 配置 systemd 守护进程 (/etc/systemd/system/dsh-model-service.service)..."
cat << SERVICE_EOF > /etc/systemd/system/dsh-model-service.service
[Unit]
Description=DSH Store AI Model Config & Recommendation Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dsh-model-service
Environment=DSH_MARKETPLACE_PORT=4173
Environment=MODEL_SETTINGS_CONFIG_PATH=/var/lib/dsh-store/model-settings.json
Environment=MODEL_SETTINGS_KEY_PATH=/var/lib/dsh-store/model-settings.key
ExecStart=$node_bin scripts/serve-marketplace.mjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable dsh-model-service
systemctl restart dsh-model-service

echo "[+] 正在验证 Node.js 后端接口连通性..."
api_ok=false
for i in $(seq 1 10); do
  if curl -s -f http://127.0.0.1:4173/api/ai/public-config >/dev/null 2>&1; then
    api_ok=true
    break
  fi
  sleep 1
done

if [ "$api_ok" = true ]; then
  echo "[✓] 后台 Node.js 服务运行正常 (127.0.0.1:4173)"
else
  echo "[!] 提示：127.0.0.1:4173 启动较慢，可使用 journalctl -u dsh-model-service -n 50 查看日志"
fi

mkdir -p /etc/nginx/snippets
cat << 'NGINX_SNIPPET' > /etc/nginx/snippets/dsh-model-api.conf
# DSH Store AI Model API & Admin Proxy
location /api/ {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}

location /marketplace/api/ {
    proxy_pass http://127.0.0.1:4173/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
NGINX_SNIPPET

echo "[+] 正在检测并接入 Nginx 站点配置..."
nginx_updated=false
for conf in /etc/nginx/sites-available/dsh-store-pending.conf /etc/nginx/sites-available/dsh-store.cn.conf /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf /etc/nginx/sites-available/default; do
  [ -f "$conf" ] || continue
  if grep -q "location /api/" "$conf" || grep -q "dsh-model-api.conf" "$conf"; then
    echo "  - $conf: 已包含 /api/ 代理规则"
    nginx_updated=true
    continue
  fi
  if grep -q "server {" "$conf" || grep -q "server_name" "$conf"; then
    echo "  - 正在向 $conf 注入 include /etc/nginx/snippets/dsh-model-api.conf; ..."
    bak="$conf.bak.$(date +%s)"
    cp "$conf" "$bak"
    python3 - "$conf" << 'PY'
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    c = f.read()
idx = c.rfind("}")
if idx != -1:
    new_c = c[:idx] + "
    # DSH Store AI API Include
    include /etc/nginx/snippets/dsh-model-api.conf;
" + c[idx:]
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_c)
    print("    -> 规则注入成功")
PY
    if nginx -t >/dev/null 2>&1; then
      nginx_updated=true
    else
      echo "    [!] nginx -t 校验失败，回滚 $conf"
      mv "$bak" "$conf"
    fi
  fi
done

if [ "$nginx_updated" = true ]; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    echo "[✓] Nginx 配置重载成功！"
  else
    echo "[!] Nginx 配置检查未通过，请手动检查 nginx -t"
  fi
else
  echo "[!] 提示：请在您的 Nginx 站点配置 server 块中手动添加：include /etc/nginx/snippets/dsh-model-api.conf; 然后运行 sudo nginx -t && sudo systemctl reload nginx"
fi

echo ""
echo "=================================================="
echo "🎉 部署完毕！后台服务已就绪！"
echo "=================================================="
echo "【管理后台登录地址】"
echo "  国际站: https://dsh.store/admin/"
echo "  国内站: https://dsh-store.cn/admin/"
echo ""
echo "【管理员凭据】"
echo "  账号: admin"
echo "  初始密码: dsh2026admin"
echo ""
echo "【安全提示】"
echo "  • 登录后台后，可在控制台卡片底部直接修改管理员密码。"
echo "  • 大模型 API Key 均采用 AES-256-GCM 加密保存在 /var/lib/dsh-store/model-settings.json"
echo "  • 密钥保存在 /var/lib/dsh-store/model-settings.key (权限 0600)，不会泄露给前端或第三方。"
echo "=================================================="
