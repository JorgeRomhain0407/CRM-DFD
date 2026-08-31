# CRM DFD

CRM omnicanal para farmacia: asistente de WhatsApp (Meta Cloud API + OpenAI Responses API con function calling) y mostrador web para fichas y compras físicas.

## Requisitos

- Node.js 20+
- Proyecto [Supabase](https://supabase.com) (PostgreSQL)
- Cuenta Meta WhatsApp Cloud API
- API key de OpenAI

## Arranque rápido

```bash
copy .env.example .env
# edita .env con tus secretos

npm install
npm run check-openai
# verifica que la key de OpenAI responde (no hace falta crear un asistente)

npm run dev
```

1. En Supabase SQL Editor ejecuta `sql/schema.sql` y luego `sql/seed.sql`.
2. Activa la extensión `pg_cron` si el `cron.schedule` del esquema no se aplicó.
3. Expón el webhook (ngrok, Cloudflare Tunnel, etc.) y configúralo en Meta:
   - Callback URL: `https://TU_DOMINIO/webhook`
   - Verify token: el mismo `META_VERIFY_TOKEN`
   - Suscripción al campo `messages`
4. Mostrador: `http://localhost:3000` con header `x-api-key` = `MOSTRADOR_API_KEY`.

## Flujo

- El teléfono E.164 es la clave del cliente.
- El bot **nunca** inventa precio ni stock: llama a `consultar_precio_y_stock`.
- El carrito caduca **24 h después del primer artículo** (`purgar_carritos_expirados` + trigger + `pg_cron`).
- `solicitar_asistencia_humana` pone `esperando_operador` y el webhook **no** vuelve a invocar OpenAI hasta que el mostrador restaure `bot_activo`.

## API mostrador

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/productos` | Catálogo |
| GET | `/api/clientes?q=` | Búsqueda |
| PUT | `/api/clientes` | Alta/edición de ficha |
| POST | `/api/ventas` | Compra física (descuenta stock) |
| GET | `/api/ventas` | Historial de ventas (?limit=N) |
| GET | `/api/ventas/resumen` | Resumen de ingresos por canal |
| PATCH | `/api/estado-chat/:telefono` | Handoff / reactivar bot |
| GET | `/api/carrito/:telefono` | Carrito WhatsApp vigente |
| DELETE | `/api/carrito/:telefono/:itemId` | Eliminar ítem del carrito |

### Configuración y conversaciones (`/api/bot`)

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/bot/config` | Leer system prompt / temperatura del bot |
| PUT | `/api/bot/config` | Entrenar bot (guardar system prompt) |
| GET | `/api/bot/conversaciones` | Inbox: lista de chats con su estado |
| GET | `/api/bot/conversaciones/:telefono` | Detalle de una conversación |
| POST | `/api/bot/test` | Probar el bot (no envía WhatsApp) |

## Panel web

Interfaz SPA con 4 zonas:
- **Dashboard**: métricas, venta física, ficha de cliente, control de estado.
- **Conversaciones**: inbox estilo WhatsApp con etiquetas de estado (`bot_activo`, `esperando_operador`, `humano_activo`) y avatares con iniciales.
- **Test del bot**: chatea con FarmaBot sin tocar WhatsApp (persiste en `mensajes` con `canal='test'`).
- **Configuración**: edita el nombre, la temperatura y el *system prompt* de Berta para entrenarla.

## Seguridad

- **Helmet**: cabeceras HTTP seguras (CSP deshabilitado para el frontend estático).
- **Rate limiting**: 60 req/min en `/api`, 300 req/min en `/webhook`.
- **Firma HMAC**: verificación de `x-hub-signature-256` de Meta (omisible en desarrollo).
- **Validación E.164**: todos los teléfonos se validan contra formato internacional.
- **Idempotencia**: `webhook_events` evita procesar el mismo mensaje de WhatsApp dos veces.

## Crear la base de datos en Supabase

1. Crea un proyecto nuevo en [supabase.com](https://supabase.com) (región cercana a tus clientes).
2. Ve a **SQL Editor** (menú lateral) y pega el contenido de `sql/schema.sql`, ejecuta.
   Crea `clientes`, `productos`, `carritos_temporales`, `estado_chat`, `ventas`, `webhook_events`, `bot_config` y `mensajes`, con RLS, triggers de carrito caduco y `pg_cron`.
3. Sin salir del editor, ejecuta `sql/seed.sql` para cargar productos de ejemplo.
4. Activa **Database → Extensions** si `pg_cron` no se activó solo.
5. En **Project Settings → API** copia:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` (clave secreta, **solo backend**) → `SUPABASE_SERVICE_ROLE_KEY`
6. Pega esos dos valores en tu `.env`.

> ⚠️ Nunca uses la `service_role` en el navegador; el backend la usa para saltarse RLS.

## Verificar la key de OpenAI

El bot usa la **Responses API** (no requiere crear un asistente). Verifica que la key funciona:

```bash
npm run check-openai
```

## Conectar el webhook de WhatsApp (Meta)

1. Arranca el servidor: `npm run dev`.
2. Expón tu `localhost:3000` a internet con [ngrok](https://ngrok.com) u otro túnel:
   ```bash
   ngrok http 3000
   # copia la URL https, p. ej. https://abcd-xxxx.ngrok.io
   ```
3. En [developers.facebook.com](https://developers.facebook.com) crea una app de tipo **Business** (WhatsApp Cloud API).
4. En **WhatsApp → Configuration → Webhook**:
   - **Callback URL**: `https://TU_TUNEL.ngrok.io/webhook`
   - **Verify token**: el valor de `META_VERIFY_TOKEN` de tu `.env`
   - Pulsa *Verify and save* (se valida el `GET /webhook`).
5. En la misma pantalla, en *Webhook fields*, suscríbete al campo **`messages`**.
6. En tu app de Meta obtén:
   - Token permanente (System User/App token con `whatsapp_business_messaging`) → `META_ACCESS_TOKEN`
   - `App secret` → `META_APP_SECRET`
   - `Phone number ID` del número verificado → `WHATSAPP_PHONE_NUMBER_ID`
7. Rellena todos esos valores en tu `.env` y reinicia el servidor.

> Con `META_APP_SECRET` el backend valida la firma `x-hub-signature-256` de cada webhook (rechaza peticiones falsas). En desarrollo puedes dejarlo vacío, pero el log te avisará.

## Ponerlo en producción (VPS + PM2)

Costo objetivo: **~$0–5/mes** (OpenAI, menos de $10; hosting gratuito con Oracle Cloud; Supabase gratis; WhatsApp ventana de 24 h gratis).

1. **VPS**: crea una instancia *Always Free* en [Oracle Cloud](https://www.oracle.com/cloud/free/) (Ubuntu). Asegúrate de generarte un par de claves SSH.
2. **Instala lo básico** en el VPS vía SSH:
   ```bash
   sudo bash deploy/setup-vps.sh
   ```
   Instala Node 22, PM2 y Caddy. Al final imprime qué puertos abrir en la *Security List* de Oracle (80 y 443) y en iptables/UFW.
3. **Copia el código y las credenciales**:
   ```bash
   git clone https://github.com/JorgeRomhain0407/CRM-DFD.git
   cd CRM-DFD
   cp .env.example .env
   nano .env   # pega SUPABASE_URL, service_role, OPENAI_API_KEY, META_* y MOSTRADOR_API_KEY
   npm install --omit=dev
   ```
   > El `.env` no se sube a GitHub: tienes que crearlo a mano en el VPS.
4. **Arranca con PM2**:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup   # para que arranque con el servidor
   ```
5. **HTTPS con Caddy**: crea un registro DNS tipo **A** (tu dominio o subdominio) apuntando a la IP pública de la instancia. Luego:
   ```bash
   sudo cp Caddyfile /etc/caddy/Caddyfile
   sudo sed -i 's/crm.midominio.com/TU-DOMINIO/' /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Caddy pedirá y renovará el certificado HTTPS automáticamente. Comprueba `https://TU-DOMINIO/health`.
6. **Apunta el webhook a producción** (paso 4 de Meta): Callback URL = `https://TU-DOMINIO/webhook` con tu `META_VERIFY_TOKEN`.
7. **Registra PM2 para arrancar solo** con `pm2 startup` si no lo hizo el paso 4.

> **Costes reales (2026):** el plan gratis de Oracle es para siempre; Supabase gratis cubre este uso; los mensajes de servicio de WhatsApp (respuestas en la ventana de 24 h) son gratis; OpenAI con `gpt-4o-mini` ronda los **$3–10/mes** según volumen. Pon un límite de gasto en [OpenAI Limits](https://platform.openai.com/settings/organization/limits).

## Seguridad
