---
tipo: orquestacion
titulo: Plan de Orquestacion — Director de Orquesta
actualizado: 2026-09-08
tags: [orquestacion, plan, departamentos, d01, d02, d03, d04, d05]
departamentos: [D01-Backend, D02-Frontend, D03-QA, D04-Seguridad, D05-Release]
---

# 🎼 Plan de Orquestación — CRM DFD (Director de Orquesta)

> **Rol del director (yo):** recibo tus pedidos → los convierto en tareas `#V{n}` → las **delego al departamento dueño** con prompt y criterio de salida → QA valida → Seguridad audita → Release decide si despliega. **NUNCA ejecuto sin tu OK** (regla de oro, la pusiste tú).

---

## 0 · Reparto de responsabilidades (quién hace qué — no se pisan)

| Sesión | Departamento | Alcance | ¿Commitea? | ¿Despliega? |
|--------|--------------|---------|-----------|-------------|
| **D01** | Backend / Engineering | API, bot, Supabase, middleware, motor de recomendación | No** | No |
| **D02** | Frontend / Diseño | Panel web, UX mostrador, caja recomendaciones, dashboards | No | No |
| **D03** | QA / Testing | Pruebas mostrador→venta→recomendación, regresiones, repro | No | No |
| **D04** | Seguridad | CHECK cédula, x-api-key, sanitización, auditoría, triaje | No | No |
| **D05** | Release | Versionado `#V{n}`, merges, changelog, **deploy** | **SÍ** | **SÍ — único** |

---

## 1 · Mapa de dependencias (QUÉ habilita QUÉ)

```
             #V30  Supabase BD ágil (base de datos no estructurada)
               │  ── es prerequisito ──►  #V29  recompra (necesita historial+preferencias)
               │  ── es prerequisito ──►  #V31  analítica (necesita datos cruzados)
               │  ── es prerequisito ──►  #V33  carrito abandonado (necesita carrito persistido)
               │  ── es prerequisito ──►  #V34  notas de voz / fotos (necesita historial chat ágil)
               │  ── es prerequisito ──►  #V35  sentimiento (necesita historial chat ágil)

#V28  estado de pedido/carrito = STANDALONE (no necesita #V30; sólo estado carrito en runtime)
#V32  WhatsApp Flows = STANDALONE (interfaz bot; no bloquea ni es bloqueado)

Orden de fase sugerido:
  FASE 1 (fundación)   → #V30
  FASE 2 (bot core)    → #V28 → #V33 → #V29
  FASE 3 (IA)          → #V34 → #V35
  FASE 4 (interfaz)    → #V32 → #V31
```

**Decisión de fase:** los `#V36–#V42` (mejoras opcionales V2x) quedan **congelados** — solo se entra a ellos cuando pides "abrir fase V2x". Son fidelización, triaje humano, omnicanal, estacionales, drip, cross-selling, etiquetado.

---

## 2 · Plan por pasos POR TAREA (prompt de cada agente + criterio de salida)

> **Cómo usar:** para encender una tarea me dices "lanza #V29". El director (yo) deja paso a tu OK y entonces D-se asigna el prompt. Formato de cada entrada: `▶ prompt` (lo que pega la sesión) + `✅ salida` (definición de hecho) + `🔀 depende de`.

---

### FASE 1 — FUNDACIÓN

**#V30 · Supabase BD ágil para datos no estructurados**
- **Dueño:** D01-Backend · **Revisa:** D04-Seguridad · **Valida:** D03-QA
- `▶ prompt D01:` "Tarea #V30: diseña en Supabase el esquema escalable para datos no estructurados (historial de chat + preferencias de producto). Decide `jsonb + índices GIN` vs tablas relacionales según volumen proyectado. Objetivo: consultas ultrarrápidas para el bot (< 300 ms). Entrégalo como migración SQL versionada + prueba de carga básica. No hagas cross-ing de vendas ni toques el frontend."
- `✅ salida:` migración aplicada en staging + benchmark de latencia documentado + punto de contacto con #V29/#V31/#V33/#V34/#V35.
- `🔀 requiere:` nada (es la base).

---

### FASE 2 — BOT CORE

**#V28 · Estados de orden en WhatsApp (carrito + resumen con disclaimer)**
- **Dueño:** D01-Backend · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V28: el bot debe responder con el **estado del carrito actual** si el cliente lo pide, y tras **verificar pedido**, enviar **resumen del carrito con disclaimer**: 'el monto total puede variar al momento del despacho por cambios en la tasa de cambio, etc.'. Implementa comando + endpoint de estado; cableá el disclaimer en el resumen."
- `✅ salida:` `GET /carrito/:ident/estado` + resumen con disclaimer en el texto del bot, probado en staging.
- `🔀 requiere:` nada (standalone).

**#V33 · Recuperación de carritos abandonados (2 h / 12 h)**
- **Dueño:** D01-Backend · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V33: detecta pedido iniciado no finalizado → cargo en Supabase (requiere #V30 o tabla plana primero) → disparador envíe mensaje amigable: '¿Olvidaste algo en tu carrito? Finaliza tu compra aquí' a las **2 h** y a las **12 h**. Evita spam: máx 2 avisos por carrito, no en horario nocturno."
- `✅ salida:` job programado + regla de no-repeat + carrito persiste entre sesiones.
- `🔀 requiere:` #V30 (persistencia) o tabla `carritos_abandonados`.

**#V29 · Alertas preventivas de recompra (tratamiento crónico / suplementos)**
- **Dueño:** D01-Backend · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V29: alerta cuando paciente esté **por agotar tratamiento crónico/suplementos** (según receta/historial) → mensaje con **recompra directa desde el mismo chat**. Herramienta sugerida: ActivePieces **si es la mejor opción; si no, propón la superior y cablea esa**."
- `✅ salida:` detección de fin de stock por fecha + botón/cadenena de recompra de 1 toque, validada para anti-alertas falsas.
- `🔀 requiere:` #V30 (historial de compra y dosis).

---

### FASE 3 — CAPA IA

**#V34 · Notas de voz + fotos de recetas médicas**
- **Dueño:** D01-Backend (IA) · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V34: el bot entiende **notas de voz** (transcripción) y **fotos de recetas** (OCR). Si no puede interpretar, **derivar a atención humana** (fallback). Usa Whisper/OCR según lo ya evaluado. Nunca inventes datos de una receta ilegible."
- `✅ salida:` transcripción/OCR funcional + fallback humano automático ante ilegibilidad + no-alucinación de dosis.
- `🔀 requiere:` #V30 (guardar historial) — parcial.

**#V35 · Análisis de sentimiento (frustración / confusión / urgencia)**
- **Dueño:** D01-Backend (IA) · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V35: capa de IA que etiquete **frustración, confusión o urgencia** en texto/voz → etiqueta `prioridad roja` + **derivación a atención humana**. Cablea la etiqueta en `estado_chat` y alerta al panel."
- `✅ salida:` etiquetado automático + alerta en panel + escalado humano documentado.
- `🔀 requiere:` #V30 (historial), #V34 (voz).

---

### FASE 4 — INTERFAZ

**#V32 · WhatsApp Flows (catálogos / formularios piel / calendario asesoría)**
- **Dueño:** D02-Frontend · **Revisa:** D01 (API) · **Valida:** D03
- `▶ prompt D02:` "Tarea #V32: interfaces enriquecidas en el chat: **catálogo desplegable**, **formulario tipo de piel**, **calendario para agendar asesoría** — en vez de menús numéricos largos. Cablea con los endpoints de D01 y el motor de recomendaciones."
- `✅ salida:` flows renderizados en WhatsApp con datos reales del perfil, UX fluida en mostrador.
- `🔀 requiere:` #V28 (estado carrito), endpoints de recomendaciones.

**#V31 · Paneles de analítica visual (ventas × estacionalidad)**
- **Dueño:** D02-Frontend · **Revisa:** D01 (cruce datos) · **Valida:** D03
- `▶ prompt D02:` "Tarea #V31: dashboards interactivos que crucen **ventas con patrones estacionales** (ej: picos de antihistamínicos en primavera) → optimizar campañas y abastecimiento. Responsive, datos reales de Supabase (#V30)."
- `✅ salida:` dashboard con filtros de estacionalidad, legible en pantalla de farmacia, datos en vivo.
- `🔀 requiere:` #V30 (datos), #V31 necesita que D01 exponga el cruce.

---

## 3 · Flujo de GO/No-GO (cuándo algo SÍ se ejecuta)

```
[Tú] "lanza #V29" ──► [Director] agenda la tarea en [[En_Progreso]] con estado "EN COLISION: D01"
      │
      ├─► D01 la implementa (su promp está arriba) ──► D03-QA la prueba
      │
      ├─► D04 la audita (seguridad/cumplimiento) ⓘ si es fármaco/receta → triaje
      │
      └─► D05-Reloase versiona #V29 → changelog → decide despliegue ──► tu visto bueno final
```

**Regla de oro (inalterable):** mientras una tarea esté en `[[En_Progreso]]` con etiqueta `SIN EJECUTAR`, ni D01 ni D02 la tocan. Solo el director (yo), con tu `lanza #V{n}`, la coloca en "EN COLISIÓN" y recién ahí los agentes trabajan.

---

## 4 · Próximo paso (esperando tu orden)

Dime cuál fase abres: **"abre FASE 1 (#V30)"**, o directamente **"lanza #V29"**. El director deja el plan cableado y D-empieza a correr. 🎼
