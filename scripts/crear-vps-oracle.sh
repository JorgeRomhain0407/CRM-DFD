#!/usr/bin/env bash
set -euo pipefail

# ---- CONFIG: edita solo lo que necesites ----
NAME_PREFIX="crdfd"
OCI_REGION="${OCI_REGION:-}"          # ej. eu-madrid-1 (si vacio, se lee del oci config)
OCI_TENANCY="${OCI_TENANCY:-}"        # ocid de la tenancy (si vacio, se lee del oci config)
COMPARTMENT_OCID="${COMPARTMENT_OCID:-}"  # vacio = raiz de la tenancy
SHAPE="VM.Standard.A1.Flex"
OCPUS="${OCPUS:-4}"                   # limite Always Free A1: 4 OCPU / 24 GB
MEM_GB="${MEM_GB:-24}"
VCN_CIDR="10.0.0.0/16"
SUBNET_CIDR="10.0.1.0/24"
INGRESS_PORTS=(22 80 443 3000)
UBUNTU_VERSION="24.04"
SSH_PUB_KEY_FILE="${SSH_PUB_KEY_FILE:-$HOME/.ssh/id_rsa.pub}"
# -----------------------------------------

command -v oci >/dev/null 2>&1 || {
  echo "[!] El CLI de OCI no esta instalado."
  echo "    Usa la Cloud Shell de Oracle Cloud (ya viene configurada) o instala:"
  echo "    https://docs.oracle.com/iaas/Content/API/SDKDocs/cliinstall.htm"
  exit 1
}

if [ ! -f "$SSH_PUB_KEY_FILE" ]; then
  echo "[!] No existe la clave publica SSH en: $SSH_PUB_KEY_FILE"
  echo "    Generala con:  ssh-keygen -t rsa -b 3072"
  echo "    (usa RSA si tu sistema o la instancia estan en modo FIPS;"
  echo "     Ed25519 no esta permitido en FIPS)."
  echo "    O apunta SSH_PUB_KEY_FILE a tu clave publica (.pub)."
  exit 1
fi

if [ -z "$OCI_TENANCY" ] || [ -z "$OCI_REGION" ]; then
  CFG="$HOME/.oci/config"
  [ -f "$CFG" ] || { echo "[!] Falta ~/.oci/config. Ejecuta: oci setup config"; exit 1; }
  OCI_TENANCY="${OCI_TENANCY:-$(awk -F= '/tenancy=/ {gsub(/[[:space:]]/,"",$2); print $2; exit}' "$CFG")}"
  OCI_REGION="${OCI_REGION:-$(awk -F= '/region=/ {gsub(/[[:space:]]/,"",$2); print $2; exit}' "$CFG")}"
fi
COMPARTMENT_OCID="${COMPARTMENT_OCID:-$OCI_TENANCY}"

echo "==> Tenancy     : $OCI_TENANCY"
echo "==> Region      : $OCI_REGION"
echo "==> Compartimento: $COMPARTMENT_OCID"
echo "==> Shape       : $SHAPE (${OCPUS} OCPU / ${MEM_GB} GB)"

echo; echo "==> Dominios de disponibilidad disponibles:"
command -v python3 >/dev/null 2>&1 || {
  echo "[!] Falta python3 en Cloud Shell. Instalalo o extrae los AD con:"
  echo "    oci iam availability-domain list --compartment-id \"$COMPARTMENT_OCID\" --region \"$OCI_REGION\""
  exit 1
}
AD_LIST=$(oci iam availability-domain list --compartment-id "$COMPARTMENT_OCID" \
  --region "$OCI_REGION" --output json \
  | python3 -c "import sys,json; [print(a['name']) for a in json.load(sys.stdin)['data']]")
echo "$AD_LIST"

# ---------- Red: VCN idempotente ----------
echo; echo "==> Creando/recuperando red..."
VCN=$(oci network vcn list --compartment-id "$COMPARTMENT_OCID" --display-name "$NAME_PREFIX-vcn" \
  --region "$OCI_REGION" --query "data[0].id" --raw-output 2>/dev/null || true)
if [ -z "$VCN" ] || [ "$VCN" = "null" ]; then
  VCN=$(oci network vcn create --compartment-id "$COMPARTMENT_OCID" \
    --cidr-blocks "[\"$VCN_CIDR\"]" --display-name "$NAME_PREFIX-vcn" \
    --dns-label crdfdvcn --region "$OCI_REGION" --query "data.id" --raw-output)
  echo "VCN creada: $VCN"
else
  echo "VCN existente: $VCN"
fi

IGW=$(oci network internet-gateway list --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --display-name "$NAME_PREFIX-igw" --region "$OCI_REGION" --query "data[0].id" --raw-output 2>/dev/null || true)
if [ -z "$IGW" ] || [ "$IGW" = "null" ]; then
  IGW=$(oci network internet-gateway create --compartment-id "$COMPARTMENT_OCID" \
    --vcn-id "$VCN" --is-enabled true --display-name "$NAME_PREFIX-igw" \
    --region "$OCI_REGION" --query "data.id" --raw-output)
  echo "Internet Gateway creado: $IGW"
else
  echo "Internet Gateway existente: $IGW"
fi

RT=$(oci network route-table list --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --display-name "$NAME_PREFIX-rt" --region "$OCI_REGION" --query "data[0].id" --raw-output 2>/dev/null || true)
if [ -z "$RT" ] || [ "$RT" = "null" ]; then
  RT=$(oci network route-table create --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
    --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW\"}]" \
    --display-name "$NAME_PREFIX-rt" --region "$OCI_REGION" --query "data.id" --raw-output)
  echo "Route table creada: $RT"
else
  echo "Route table existente: $RT"
fi

SL=$(oci network security-list list --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --display-name "$NAME_PREFIX-sl" --region "$OCI_REGION" --query "data[0].id" --raw-output 2>/dev/null || true)
if [ -z "$SL" ] || [ "$SL" = "null" ]; then
  INGRESS="["
  for P in "${INGRESS_PORTS[@]}"; do
    INGRESS+="{\"isStateless\":false,\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":$P,\"max\":$P}}},"
  done
  INGRESS="${INGRESS%,}]"
  SL=$(oci network security-list create --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
    --ingress-security-rules "$INGRESS" \
    --egress-security-rules "[{\"isStateless\":false,\"protocol\":\"all\",\"destination\":\"0.0.0.0/0\"}]" \
    --display-name "$NAME_PREFIX-sl" --region "$OCI_REGION" --query "data.id" --raw-output)
  echo "Security list creada (puertos ${INGRESS_PORTS[*]}): $SL"
else
  echo "Security list existente: $SL"
fi

SUBNET=$(oci network subnet list --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --display-name "$NAME_PREFIX-sub" --region "$OCI_REGION" --query "data[0].id" --raw-output 2>/dev/null || true)
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  SUBNET=$(oci network subnet create --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
    --cidr-block "$SUBNET_CIDR" --route-table-id "$RT" --security-list-ids "[\"$SL\"]" \
    --prohibit-public-ip-on-vnic false --display-name "$NAME_PREFIX-sub" \
    --dns-label crdfdsub --region "$OCI_REGION" --query "data.id" --raw-output)
  echo "Subred creada: $SUBNET"
else
  echo "Subred existente: $SUBNET"
fi

echo "==> Esperando a que la subred este AVAILABLE..."
for _ in $(seq 1 30); do
  STATE=$(oci network subnet get --subnet-id "$SUBNET" --region "$OCI_REGION" \
    --query "data.\"lifecycle-state\"" --raw-output)
  [ "$STATE" = "AVAILABLE" ] && break
  sleep 5
done
echo "Subred: $STATE"

# ---------- Imagen ----------
echo; echo "==> Buscando imagen Canonical Ubuntu para $SHAPE"
IMAGE=""
for VER in "$UBUNTU_VERSION" "22.04" "20.04"; do
  CANDIDATE=$(oci compute image list --compartment-id "$COMPARTMENT_OCID" \
    --operating-system "Canonical Ubuntu" --operating-system-version "$VER" \
    --shape "$SHAPE" --sort-by TIMECREATED --region "$OCI_REGION" \
    --query "data[0].id" --raw-output 2>/dev/null || true)
  case "$CANDIDATE" in
    ocid1.image.*) IMAGE="$CANDIDATE"; break ;;
  esac
done
if [ -z "$IMAGE" ]; then
  IMAGE=$(oci compute image list --compartment-id "$COMPARTMENT_OCID" \
    --operating-system "Canonical Ubuntu" --shape "$SHAPE" \
    --region "$OCI_REGION" --query "data[0].id" --raw-output)
fi
case "$IMAGE" in
  ocid1.image.*) echo "Imagen: $IMAGE" ;;
  *) echo "[!] El CLI no devolvio ninguna imagen de Ubuntu para este shape/region."
     echo "    Comprueba con: oci compute image list --compartment-id \"$COMPARTMENT_OCID\" --operating-system \"Canonical Ubuntu\""
     exit 1 ;;
esac

# ---------- Lanzamiento con reintento por AD ----------
SSH_KEY=$(tr -d '\n\r' < "$SSH_PUB_KEY_FILE")
INSTANCE=""
LAUNCHED_AD=""
attempted=0
for AD in $AD_LIST; do
  case "$AD" in
    "" | null) continue ;;
  esac
  echo; echo "==> Intentando lanzar instancia en $AD (${OCPUS} OCPU / ${MEM_GB} GB)..."
  attempted=1
  if oci compute instance launch \
      --compartment-id "$COMPARTMENT_OCID" \
      --availability-domain "$AD" \
      --image-id "$IMAGE" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEM_GB}}" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --display-name "$NAME_PREFIX" \
      --metadata "{\"ssh_authorized_keys\": \"$SSH_KEY\"}" \
      --wait-for-state RUNNING --wait-interval-seconds 15 \
      --region "$OCI_REGION" --query "data.id" --raw-output > /tmp/oci_vps_instance 2>/tmp/oci_vps_err; then
    INSTANCE=$(cat /tmp/oci_vps_instance)
    LAUNCHED_AD="$AD"
    break
  else
    ERR=$(grep -o '"code": *"[^"]*"' /tmp/oci_vps_err | head -1)
    echo "    $AD -> fallo (${ERR:-ver error})"
  fi
done

if [ -z "$INSTANCE" ]; then
  echo; echo "[!] No se pudo lanzar la instancia en ninguna AD."
  if [ "$attempted" = "0" ]; then
    echo "    No se llego a ejecutar ningun lanzamiento (lista de AD vacia o invalida)."
    echo "    Comprueba: oci iam availability-domain list --compartment-id \"$COMPARTMENT_OCID\" --region \"$OCI_REGION\""
  elif grep -qi "capacity\|quota\|availability" /tmp/oci_vps_err; then
    echo "    Parece falta de capacidad del plan Always Free."
    echo "    Opciones: probar otra region (OCI_REGION=...), usar 2 OCPU/12 GB (OCPUS=2 MEM_GB=12)"
    echo "    o reintentar mas tarde."
  else
    echo "    Error de peticion (no es capacidad). Ultima salida del CLI:"
    echo "    -----------------------------------------------------------"
    head -c 2500 /tmp/oci_vps_err
    echo
    echo "    -----------------------------------------------------------"
    echo "    Comando que fallo (anade --debug para mas detalle):"
    echo "    oci compute instance launch --compartment-id \"$COMPARTMENT_OCID\" --availability-domain \"$AD\" --image-id \"$IMAGE\" --shape \"$SHAPE\" --shape-config '{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM_GB}' --subnet-id \"$SUBNET\" --assign-public-ip true --display-name \"$NAME_PREFIX\" --metadata '{\"ssh_authorized_keys\": \"<CLAVE>\"}' --region \"$OCI_REGION\" --debug"
    echo
    echo "    Si persiste, pegame esta salida completa para depurarla."
  fi
  exit 1
fi

echo; echo "==> Instancia lanzada en $LAUNCHED_AD: $INSTANCE"
echo "==> Esperando IP publica..."
for _ in $(seq 1 20); do
  IP=$(oci compute instance list-vnics --instance-id "$INSTANCE" --region "$OCI_REGION" \
    --query "data[0].\"public-ip\"" --raw-output 2>/dev/null || true)
  [ -n "$IP" ] && [ "$IP" != "null" ] && break
  sleep 5
done

echo
echo "=================================================="
echo " VPS creada (Always Free, shape $SHAPE)"
echo " Nombre  : $NAME_PREFIX"
echo " Region  : $OCI_REGION / AD: $LAUNCHED_AD"
echo " IP      : ${IP:-pendiente de asignar}"
echo " Puertos : ${INGRESS_PORTS[*]}"
echo "  SSH:"
  echo "   ssh -o IdentitiesOnly=yes -i ${SSH_PUB_KEY_FILE%.pub} ubuntu@${IP:-<ip>}"
  echo "=================================================="