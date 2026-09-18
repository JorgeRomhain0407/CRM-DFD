---
tipo: pendientes
actualizado: 2026-09-08
tags: [progreso, pendientes, backlog, mejoras, versiones-futuras]
---

# En Progreso — Pendientes por entregar + Mejoras de versiones futuras

> **Regla de oro (la puso el usuario):** aquí SOLO se **registran** tareas. **No se implementan** hasta que él lo pida explícitamente. Mientras estén en esta página son ideas/cableado pendiente.
> **Cómo cerrar un ítem:** él entrega la tarea → yo la muevo a [[Estado_Actual]] a la sección "En curso/Hecho" con su `#V{n}` → él la aprueba en la siguiente sesión.
> La cédula (`#V25` CHECK) **ya la corrió el usuario con Success** → ese CHECK está DESPLEGADO, no es pendiente.

---

## A · TAREAS PENDIENTES — ENTREGADAS POR EL USUARIO (registradas, NO implementadas)

> Estas son las 8 que él me indicó hoy. Están **numero #V28…#V35**. **Quedan AQUÍ como registro; no se tocan hasta pedirlo.**

| # | Tarea (tal como la entregó) | Impacto | Departamento |
|---|-----------------------------|---------|--------------|
| **#V28** | **Estados de orden en WhatsApp**: que el bot responda con el **estado del carrito actual** si el cliente lo solicita; y **una vez verificado el carrito**, enviar **resumen del mismo con disclaimer**: "el monto total puede variar al momento del despacho por cambios en la taza de cambio, etc." | Alto | Backend + Bot |
| **#V29** | **Alertas preventivas de recompra**: disparar aviso cuando un paciente esté **por agotar su tratamiento crónico o suplementos**, permitiendo **recompra directa desde el mismo mensaje de WhatsApp**. (Sugerencia: ActivePieces, o mejor opción si la hay.) | Alto | Backend + Bot |
| **#V30** | **Gestión ágil de BD no estructurada (Supabase)**: historial de chat + preferencias de producto, **escalable y con tiempos de respuesta ultrarrápidos para el bot** | Medio | Backend / BD |
| **#V31** | **Paneles de analítica visual**: dashboards interactivos que crucen **ventas con patrones estacionales** (ej: picos de antihistamínicos en primavera) para optimizar campañas de marketing y abastecimiento | Medio | Panel / Frontend |
| **#V32** | **WhatsApp Flows**: interfaces enriquecidas en el chat (catálogos desplegables, formularios de tipo de piel, calendario para agendar asesoría) en lugar de comandos largos / menús numéricos | Medio | Bot / Frontend |
| **#V33** | **Recuperación de carritos abandonados**: detectar pedido iniciado y no finalizado → mensaje amigable a las 2 h / 12 h ("¿Olvidaste algo en tu carrito? Finaliza tu compra aquí") | Medio-Alto | Backend + Bot |
| **#V34** | **Notas de voz y fotos de receta**: que el bot entienda notas de voz y fotos de recetas médicas; si no puede, **derivar a atención humana** | Alto | Bot / IA |
| **#V35** | **Análisis de sentimiento**: capa de IA que detecte frustración / confusión / urgencia en texto o voz → etiqueta "prioridad roja" y **derivación a atención humana** | Alto | Bot / IA |

---

## B · MEJORAS OPCIONALES — PRÓXIMAS VERSIONES (NO se ejecutan hasta pedirlo)

> Las 7 que él listó como "posibles mejoras pendientes / versiones futuras". **Solo registro.**

| # | Mejora | Detalle |
|---|--------|---------|
| **#V36** | **Programa de fidelización (puntos)** | Asignar puntos por compras de parafarmacia / vitaminas / dermocosmética; saldo en el perfil del cliente para **descuentos automáticos** en su próxima interacción |
| **#V37** | **Triaje y escalado humano** | Que la IA detecte síntomas complejos o **interacciones medicamentosas** y derive a **farmacéutico colegiado** inmediatamente (seguridad sanitaria) |
| **#V38** | **Consolidación omnicanal (Meta Business Suite)** | Centralizar atención integrando **Instagram y Facebook Messenger**; perfil de usuario unificado en el CRM |
| **#V39** | **Campañas estacionales predictivas** | Segmentar perfiles por hábitos → difusiones personalizadas (ej: **protectores solares en verano** para quien compró dermocosmética; **vitaminas en otoño** según historial del año anterior) |
| **#V40** | **Secuencias de nutrición (Drip Campaigns)** | Al detectar compra de tratamiento continuo / kit, programar **mensajes educativos espaciados** con consejos de uso (posiciona la farmacia como asesora de bienestar) |
| **#V41** | **Venta cruzada inteligente (Cross-selling)** | Al cerrar el carrito, sugerir complementario según perfil (ej: champú anticaída → ampollas complementarias con 10% dto.) |
| **#V42** | **Etiquetado dinámico de clientes** | Auto-etiquetas por clics/consultas (ej: "Comprador frecuente", "Interesado en Skincare", "Solo promociones") para retargeting futuro |

---

## C · CÓMO SE ACTUALIZA
- Al recibir una entrega tuya → la muevo de aquí a [[Estado_Actual]] §"En curso" asignando `#V{n}` y **cableo/implemento solo lo que pidas**.
- Lo que NO pidas queda **documentado aquí como backlog de versión futura** (#V36…#V42).
