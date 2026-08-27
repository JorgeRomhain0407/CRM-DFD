# CRM DFD

CRM omnicanal para farmacia: asistente de WhatsApp (Meta Cloud API + OpenAI Assistants con function calling) y mostrador web para fichas y compras físicas.

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
npm run create-assistant
# pega OPENAI_ASSISTANT_ID en .env

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

## Seguridad

- **Helmet**: cabeceras HTTP seguras (CSP deshabilitado para el frontend estático).
- **Rate limiting**: 60 req/min en `/api`, 300 req/min en `/webhook`.
- **Firma HMAC**: verificación de `x-hub-signature-256` de Meta (omisible en desarrollo).
- **Validación E.164**: todos los teléfonos se validan contra formato internacional.
- **Idempotencia**: `webhook_events` evita procesar el mismo mensaje de WhatsApp dos veces.

## Frontend del mostrador

- Ficha de cliente con alta/búsqueda.
- Registro de compra física con descuento automático de stock.
- Control de estado del chat IA (handoff).
- Vista del carrito WhatsApp con posibilidad de eliminar ítems.
- Tabla de últimas ventas con indicador de canal (mostrador/whatsapp).
- Dashboard de resumen de ingresos y unidades vendidas.
