# Changelog

Todos los cambios notables del CRM DFD se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto usa [SemVer](https://semver.org/lang/es/).

> El proyecto mantiene además una numeración humana `#V{n}` en `Docs_Obsidian/04_Historial/Changelog_Versionado.md`, mapeada a hashes git reales. Este CHANGELOG es el registro de **releases** (snapshots taggeados); el vault es el registro de **cambios individuales**.

## [Unreleased]

### Añadido

- **Auditoría legible para el gestor** (#V86): `GET /api/auditoria` (solo gestor) con paginación (`limit` 1–200, `offset`), filtros por acción, entidad, usuario y rango de fechas, y vista **Auditoría** en el panel con tabla, filtros y paginación. `detalle` expone solo los nombres de los campos modificados, nunca sus valores.

## [1.0.0] — 2026-10-20

**Primer release SemVer formal.** El proyecto usaba una numeración de build (`28.0.0`–`32.2.0`); este release **resetea la versión a `1.0.0`** y consolida todo lo que ya estaba en producción. Alcance del día 1: **panel + mostrador**. WhatsApp productivo entra cuando Meta apruebe la verificación del negocio (no bloquea este tag).

### Añadido

- **Autenticación real del panel** (#V59): login por usuario con cookie de sesión `HttpOnly` + `Secure` (HMAC + `scrypt`, `token_version`), roles **operador/gestor** y bootstrap del gestor inicial.
- **Hábitos de consumo como tabla** (#V65): `cliente_habitos` por `producto_id` (sin texto libre), selector multi-producto en alta y ficha, y auto-relleno con lo comprado.
- **Analítica de conversación** (#V54): RPC `analitica_conversaciones`, `GET /api/analitica` y vista *Analítica*.
- **Router de intents + overlays + memoria** (#V52), **fallback/escalado multicapa determinista** (#V53) y **telemetría de latencia** `bot_respuesta` (#V51).
- **Gate `check-tools` en CI** (#V71): `npm run check-tools` y job `guard` que bloquea el deploy si el contrato de tools se rompe.
- **Guía de uso en el panel** (#V81): vista *Guía* para operador y gestor (atender chats, vender, permisos, atajos).
- **QA de aceptación del operador** (#V81): script black-box que crea un operador real y verifica RBAC (25/25).
- **Snapshot pre-release** (`backup_release_20261020`, #V82): copia lógica en un schema aislado, accesible solo por `service_role`.

### Cambiado

- **El bot no revela el stock exacto** (#V72): las tools devuelven `disponible` + `disponibilidad` (`disponible`/`ultimas_unidades`/`agotado`), nunca la cantidad.
- **Política de tools por intent** (#V76): `consultar_precio_y_stock` solo en `buscar`/`carrito`; `puntos`/`recomendar` sin precio; `saludo`/`general` sin tools.
- **Config de producción** (#V80): `DEFAULT_PHONE_PREFIX=+58`.
- **SemVer**: reset de `32.2.0` → `1.0.0`.

### Corregido

- **Pérdida silenciosa de hábitos** (#V73): `PUT /api/clientes` con un `producto_id` inexistente borraba los hábitos y respondía 200; ahora valida **antes** de escribir y devuelve **400** sin tocar la ficha.
- **Falso positivo del QA de banda de stock** (#V74): el dígito dentro de los emojis de lista (`1️⃣`) se confundía con una cifra de stock.
- **Guardia sanitaria** (#V48): patrón conservador para «¿cuánto X le puedo dar/tomar?».
- **Puerto 3000 expuesto** (#V49): el servicio escucha en `HOST` (`127.0.0.1` en producción, detrás de nginx).

### Seguridad

- **Advisors de Supabase a cero** (#V75): `search_path=''` en las funciones restantes y `pg_trgm` movido al schema `extensions`; quedan solo INFO `rls_enabled_no_policy` intencionales.
- **RBAC verificado end-to-end** (#V81): el operador opera el mostrador pero recibe **403** en usuarios, configuración/test del bot, fidelización y escrituras de la base de conocimiento.
- **BD cerrada**: `REVOKE` de `anon`/`authenticated` + `GRANT` a `service_role`, RLS en tablas sensibles y `auditoria` append-only.

### Rendimiento

- **Latencia del bot** (#V76): prep en paralelo, prefetch de `buscar` y política de tools por intent. Bench e2e (32 turnos, `gpt-4o-mini`): **p50 4038 ms / p95 9238 ms**; `saludo` p50 2044 / p95 2556. **Desviación del objetivo (`p50<2500`, `p95<3500`) aceptada y documentada por el owner**: para WhatsApp ~4 s es razonable y el coste restante está en los turnos que legítimamente usan herramientas.

### Limitaciones conocidas

- **WhatsApp productivo pendiente de Meta**: Business Verification sin iniciar y número WABA aún sin configurar (no bloquea el tag).
- **Fidelización OFF** y **base de conocimiento vacía** en 1.0.0.
- El backup de este release es un **snapshot lógico en la BD**; se recomienda además una copia externa desde el panel de Supabase.

## [28.0.0] — 2026-09-18 (histórico; numeración anterior al reset SemVer)

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

[1.0.0]: https://github.com/JorgeRomhain0407/CRM-DFD/releases/tag/v1.0.0
[28.0.0]: https://github.com/JorgeRomhain0407/CRM-DFD/releases/tag/v28.0.0