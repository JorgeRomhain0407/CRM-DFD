# Changelog

Todos los cambios notables del CRM DFD se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto usa [SemVer](https://semver.org/lang/es/).

> El proyecto mantiene además una numeración humana `#V{n}` en `Docs_Obsidian/04_Historial/Changelog_Versionado.md`, mapeada a hashes git reales. Este CHANGELOG es el registro de **releases** (snapshots taggeados); el vault es el registro de **cambios individuales**.

## [28.0.0] — 2026-09-18

Primera release con versionado formal de release (`V28+`). Ancla el estado de `main` al inicio de la era de releases; los items de backlog `#V28`–`#V42` del vault **no** están implementados y quedan en `[Unreleased]`.

### Añadido

- **CRM omnicanal de farmacia** (commit `12a1d91`): asistente WhatsApp (Meta Cloud API + OpenAI) y mostrador web.
- **Panel web SPA** (commits `28add80`, `09c1118`, `676f533`): dashboard de gestión de clientes, pedidos, inbox de conversaciones, test del bot y configuración del bot.
- **Migración a OpenAI Responses API** (`1d84a3c`): function calling estricto con 5 tools y preparación del despliegue de producción.
- **Middleware `farmacia-sync`** (`2dc6b8c`): sincronización del catálogo del TPV (SQLite/SQL Server/MySQL/Postgres) a Supabase vía `productos_tpv_upsert`, con servidor HTTP y consumidor programado.
- **Toma de control humano** (`d7ba54b`, `1539958`): notificación Telegram al pedir asistencia humana y respuesta del operador desde el panel; takeover en cualquier estado de conversación.
- **Búsqueda inteligente** (`a6216cc`): normalización de unidades, limit-3, rotación de resultados, fix de parpadeo en conversaciones.
- **Perfil de cliente editable** (`a378c82`): nombre/edad/estado, hábitos de consumo al confirmar pedido y tipos `Cliente`/`Lead`.
- **Prompt centralizado en BD** (`33852ec`): `bot_config.system_prompt` editable y protegido con clave de administrador.
- **Cédula venezolana** (`#V16`, `fcab36f`): columna inmutable con UNIQUE parcial, teléfono editable y búsqueda por cédula/teléfono.
- **Motor de recomendaciones híbrido** (`#V17`–`#V19`, `278ece6` → `47a6a06` → `5404bd1`): reparación de sintaxis, ruta API `GET /clientes/:ident/recomendaciones` y caja de recomendaciones en la ficha del cliente.
- **Precio en dólares** (`1f64e02`): `precio_usd` del TPV a Supabase, bot y panel; fixes de driver mssql (require drivers, `Number(port)`, `encrypt=false`).
- **Bóveda Obsidian** (`86063ac`, `94660c8`, `20e3976`): memoria a largo plazo versionada, `Changelog_Versionado` (#V1–#V19), Organigrama de 5 departamentos y registro de backlog de versiones futuras.

### Corregido

- **Rotación y unidades exactas** (`72adcef`): unidades exactas en la tool, upsert de contexto, y precio solo si el usuario pide "barato".
- **Ambigüedad de `estado`** en `actualizar_estado_carrito` (SQL `fix-ambiguedad-estado.sql`).
- **Campo `descripcion` ausente** en las funciones de OpenAI (error 400 `invalid_function_parameters` del 2026-09-03, corregido en `openai-tools.json` actual).
- **Sintaxis de `getRecomendaciones`** (`#V17`): purga de tokens corruptos en el motor híbrido.

### Deuda técnica conocida (no bloqueante)

- Scripts marcados como temporales/borrables en `672e32a`: `check-ctx.js`, `run-tests.js`, `scripts/crear-vps-oracle.sh`.
- No hay suite de tests automatizada (solo smoke manual vía `run-tests.js`).
- `WhatsApp en producción` pendiente: falta VPS/webhook público (ver `Docs_Obsidian/03_Progreso/Estado_Actual.md`).

### Compatibilidad

- Node.js >= 20 (raíz `crm-dfd`), >= 18 (`farmacia-sync`).
- Depende de Supabase, Meta WhatsApp Cloud API y OpenAI Responses API.

## [Unreleased]

Backlog registrado en `Docs_Obsidian/03_Progreso/En_Progreso.md` — **solo registro, NO implementado**:

- **#V28** – Estados de orden en WhatsApp (resumen de carrito con disclaimer de monto).
- **#V29** – Alertas preventivas de recompra para tratamientos crónicos/suplementos.
- **#V30** – Gestión ágil de BD no estructurada (historial de chat + preferencias).
- **#V31** – Paneles de analítica visual (ventas × patrones estacionales).
- **#V32** – WhatsApp Flows (catálogos, formularios, calendario de asesoría).
- **#V33** – Recuperación de carritos abandonados (aviso a 2 h / 12 h).
- **#V34** – Notas de voz y fotos de receta (derivación a humano si no puede).
- **#V35** – Análisis de sentimiento → etiqueta "prioridad roja" + atención humana.
- **#V36–#V42** – Mejoras opcionales V2x: fidelización, triaje farmacéutico, Meta Business Suite, campañas predictivas, drip de nutrición, cross-selling, etiquetado dinámico.

[28.0.0]: https://github.com/JorgeRomhain0407/CRM-DFD/releases/tag/v28.0.0