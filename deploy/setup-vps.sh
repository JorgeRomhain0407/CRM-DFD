#!/usr/bin/env bash
# Prepara un VPS Ubuntu 22.04/24.04 para el CRM DFD.
# Ejecutar como root:  sudo bash deploy/setup-vps.sh
set -euo pipefail

echo "==> Instalando Node.js 22 LTS"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "==> Instalando PM2"
npm install -g pm2
pm2 install pm2-logrotate

echo "==> Instalando Caddy (proxy + HTTPS automático)"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

echo ""
echo "==> Listo: Node $(node -v), NPM $(npm -v), PM2 $(pm2 -v)"
echo ""
echo "POR HACER (manual):"
echo "  1. En Oracle Cloud Console -> instancia -> Networking -> Security List"
echo "     abre los puertos 80 y 443 (ingress TCP)."
echo "  2. El sistema (Oracle Linux/Ubuntu) tambien usa iptables:"
echo "       sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT"
echo "       sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT"
echo "       (si es Ubuntu con ufw: sudo ufw allow 80,443/tcp)"
echo "  3. Crea un registro DNS (A) de tu dominio apuntando a la IP publica."
echo "  4. Copia el repositorio y monta el .env (ver README -> Produccion)."