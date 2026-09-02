#!/bin/bash
# =============================================================================
#  oci-retry-a1.sh — Reintenta crear una VM.Standard.A1.Flex (Always Free)
#  hasta conseguir capacidad. Se ejecuta en OCI Cloud Shell (bash + oci CLI).
#
#  Uso:
#    1) Edita las variables de CONFIGURACION (tenancy OCID obligatorio).
#    2) bash oci-retry-a1.sh
#    3) Cuando lo consiga, imprime la IP publica y el comando ssh.
#
#  Nota: desde jun/2026 el free tier ARM son 2 OCPU/12 GB en TOTAL entre
#  todas tus instancias A1. Este script usa 1 OCPU / 6 GB por instancia.
# =============================================================================
set -u

# ---------------------------------------------------------------------------
# CONFIGURACION (editar)
# ---------------------------------------------------------------------------
# OCID de la tenancy: Perfil (arriba a la derecha) > Tenancy: <tu tenancy> > Copiar OCID
TENANCY_OCID="ocid1.tenancy.oc1..aaaaaaaaqw73uf7th63eh2wdmzwzpjsuit2wwuodby6s3orsctytelomfpkq"

# Compartimento donde crear la instancia. Vacio = raiz de la tenancy.
COMPARTMENT_OCID=""

INSTANCE_NAME="farmacrm-a1"
SHAPE="VM.Standard.A1.Flex"
OCPUS=1
MEMORY_GB=6.0          # minimo para A1 = 6 GB/OCPU

RETRY_EVERY_SECS=90    # segundos entre intentos
MAX_ATTEMPTS=2000      # ~2 dias con reintentos de 90s

# Subred publica existente. Vacio = el script crea VCN + subred nueva.
SUBNET_OCID=""

# ---------------------------------------------------------------------------
# Preparacion
# ---------------------------------------------------------------------------
LOG_SEP="-----------------------------------------------------------------"
echo "$LOG_SEP"
echo " oci-retry-a1.sh  (shape: $SHAPE | $OCPUS OCPU / ${MEMORY_GB} GB)"
echo "$LOG_SEP"

if [ -z "$TENANCY_OCID" ]; then
  echo "ERROR: define TENANCY_OCID en el script."
  echo "Perfil (arriba a la derecha) > Tenancy: <nombre> > Copiar OCID."
  exit 1
fi

if [ -z "$COMPARTMENT_OCID" ]; then
  COMPARTMENT_OCID="$TENANCY_OCID"
  echo "Usando compartment raiz de la tenancy."
fi

# Comprobar que el CLI responde (Cloud Shell ya esta autenticado)
if ! oci iam region list >/dev/null 2>&1; then
  echo "ERROR: el CLI de OCI no responde. Abre el Cloud Shell y vuelve a intentar."
  exit 1
fi

# Dominios de disponibilidad disponibles (regiones de 1 AD devuelven 1)
AD=$(oci iam availability-domain list --compartment-id "$TENANCY_OCID" --query "data[0].name" --raw-output 2>/dev/null)
if [ -z "$AD" ] || [ "$AD" = "null" ]; then
  echo "ERROR: no pude leer el availability domain."
  exit 1
fi
echo "Availability domain: $AD"

# Clave SSH (genera una si no existe)
KEYFILE="$HOME/.ssh/id_rsa_farmacrm"
if [ ! -f "$KEYFILE" ]; then
  mkdir -p "$HOME/.ssh"
  ssh-keygen -t rsa -b 2048 -f "$KEYFILE" -N "" -q
  echo "Clave SSH generada: $KEYFILE"
fi
PUBKEY=$(cat "$KEYFILE.pub")
echo "SSH public key: ${KEYFILE}.pub"

# ---------------------------------------------------------------------------
# Red: usar subred existente o crear VCN + subred publica
# ---------------------------------------------------------------------------
if [ -z "$SUBNET_OCID" ]; then
  echo "Buscando subred publica existente en el compartment..."
  SUBNET_OCID=$(oci network subnet list --compartment-id "$COMPARTMENT_OCID" \
      --query "data[?provisioned-public-ip == \`true\`].id | [0]" --raw-output 2>/dev/null)
fi

if [ -z "$SUBNET_OCID" ] || [ "$SUBNET_OCID" = "null" ]; then
  echo "No hay subred publica. Creando VCN 'farmacrm-vcn'..."
  VCN_ID=$(oci network vcn create --compartment-id "$COMPARTMENT_OCID" \
      --cidr-block 10.0.0.0/16 --display-name "farmacrm-vcn" \
      --wait-for-state AVAILABLE --query "data.id" --raw-output 2>/dev/null)
  [ -z "$VCN_ID" ] && echo "ERROR creando VCN" && exit 1

  IGW_ID=$(oci network internet-gateway create --compartment-id "$COMPARTMENT_OCID" \
      --vcn-id "$VCN_ID" --is-enabled true --display-name "farmacrm-igw" \
      --query "data.id" --raw-output 2>/dev/null)
  [ -z "$IGW_ID" ] && echo "ERROR creando internet gateway" && exit 1

  ROUTE_RULE="{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW_ID\"}"
  RT_ID=$(oci network route-table create --compartment-id "$COMPARTMENT_OCID" \
      --vcn-id "$VCN_ID" --display-name "farmacrm-rt" \
      --route-rules "[$ROUTE_RULE]" --wait-for-state AVAILABLE \
      --query "data.id" --raw-output 2>/dev/null)
  [ -z "$RT_ID" ] && echo "ERROR creando route table" && exit 1

  INGRESS='[{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}]'
  EGRESS='[{"destination":"0.0.0.0/0","protocol":"all"}]'
  SL_ID=$(oci network security-list create --compartment-id "$COMPARTMENT_OCID" \
      --vcn-id "$VCN_ID" --display-name "farmacrm-sl" \
      --ingress-security-rules "$INGRESS" --egress-security-rules "$EGRESS" \
      --wait-for-state AVAILABLE --query "data.id" --raw-output 2>/dev/null)
  [ -z "$SL_ID" ] && echo "ERROR creando security list" && exit 1

  SUBNET_OCID=$(oci network subnet create --compartment-id "$COMPARTMENT_OCID" \
      --vcn-id "$VCN_ID" --cidr-block 10.0.0.0/24 \
      --route-table-id "$RT_ID" --security-list-ids "[\"$SL_ID\"]" \
      --display-name "farmacrm-subnet" --wait-for-state AVAILABLE \
      --query "data.id" --raw-output 2>/dev/null)
  [ -z "$SUBNET_OCID" ] && echo "ERROR creando subnet" && exit 1
  echo "VCN y subred publica creadas."
fi
echo "Subnet OCID: $SUBNET_OCID"

# ---------------------------------------------------------------------------
# Imagen compatible con ARM (Oracle Linux 8 primero, Ubuntu como fallback)
# ---------------------------------------------------------------------------
IMAGE_ID=$(oci compute image list --compartment-id "$COMPARTMENT_OCID" \
    --operating-system "Oracle Linux" --operating-system-version "8" \
    --shape "$SHAPE" --query "data[0].id" --raw-output 2>/dev/null)
if [ -z "$IMAGE_ID" ] || [ "$IMAGE_ID" = "null" ]; then
  IMAGE_ID=$(oci compute image list --compartment-id "$COMPARTMENT_OCID" \
      --operating-system "Canonical Ubuntu" \
      --shape "$SHAPE" --query "data[0].id" --raw-output 2>/dev/null)
fi
if [ -z "$IMAGE_ID" ] || [ "$IMAGE_ID" = "null" ]; then
  echo "ERROR: no encontre imagen compatible con $SHAPE."
  echo "Creala manualmente y rellena su OCID en el script (variable IMAGE_ID)."
  exit 1
fi
echo "Imagen elegida: $IMAGE_ID"

# ---------------------------------------------------------------------------
# Bucle de reintento
# ---------------------------------------------------------------------------
ATTEMPT=0
ERR_FILE=$(mktemp)
echo "$LOG_SEP"
echo "Empezando reintentos cada ${RETRY_EVERY_SECS}s (max $MAX_ATTEMPTS)..."
echo "Ctrl+C cancela. No cierres el Cloud Shell."
echo "$LOG_SEP"

while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "[$(date +%H:%M:%S)] Intento $ATTEMPT ..."

  OUT=$(oci compute instance launch \
      --compartment-id "$COMPARTMENT_OCID" \
      --availability-domain "$AD" \
      --display-name "$INSTANCE_NAME" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\": $OCPUS, \"memory_in_gbs\": $MEMORY_GB}" \
      --image-id "$IMAGE_ID" \
      --subnet-id "$SUBNET_OCID" \
      --metadata "{\"ssh_authorized_keys\": \"$PUBKEY\"}" \
      2>"$ERR_FILE")
  RC=$?

  if [ $RC -eq 0 ]; then
    INSTANCE_ID=$(echo "$OUT" | grep -o "ocid1.instance[^\" ]*" | head -1)
    echo "*** INSTANCIA CREADA ***"
    echo "OCID: $INSTANCE_ID"
    echo "Esperando IP publica..."
    IP=""
    for _i in $(seq 1 12); do
      IP=$(oci compute instance list-vnics --instance-id "$INSTANCE_ID" \
          --all --query "data[0].public-ip" --raw-output 2>/dev/null)
      [ -n "$IP" ] && [ "$IP" != "null" ] && break
      sleep 10
    done
    echo "IP publica:   ${IP:-(revisar en la consola OCI > Instancia)}"
    echo "SSH:          ssh -i $KEYFILE ubuntu@$IP"
    echo "TIMESTAMP:    $(date '+%Y-%m-%d %H:%M:%S')"
    exit 0
  fi

  MSG=$(grep -o '"message": *"[^"]*"' "$ERR_FILE" | head -1 | cut -d: -f2- | tr -d '"')
  echo "[$(date +%H:%M:%S)] Fallo intento $ATTEMPT: ${MSG:-sin capacidad}"
  sleep "$RETRY_EVERY_SECS"
done

echo "Se alcanzo el maximo de $MAX_ATTEMPTS intentos. Revisa y vuelve a lanzar."
exit 1