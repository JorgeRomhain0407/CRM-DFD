---
tipo: negocio
actualizado: 2026-09-08
tags: [negocio, vision, farmacia]
---

# Visión General — Farmacia DFD

## Problema a resolver
Los clientes de la farmacia preguntan por WhatsApp sobre **disponibilidad, precios y reservas de productos**. Un ser humano no puede atender a todas horas ni a ritmo de chat, pero la farmacia **no puede responder con información inventada** (stock real, precios, equivalentes).

El mostrador necesita que esas conversaciones aterricen en un **pedido preparado** con datos reales del catálogo y con intervención humana cuando haga falta.

## Propuesta de valor
Un **asistente de IA (FarmaBot)** que:
- Responde al instante con el **catálogo real** (máximo 3 opciones por consulta, con rotación de marcas equivalentes).
- Gestiona el **carrito y el pedido** hasta dejarlo reservado para retiro en mostrador.
- **Traslada a un farmacéutico humano** cuando el caso lo exige (urgencias, recetas, dudas clínicas) **o cuando el operador decide tomar el control**.

Un **panel web (Mostrador)** donde el equipo:
- Ve todas las conversaciones en un inbox con estado (`bot_activo`, `esperando_operador`, `humano_activo`).
- Puede **tomar el control en cualquier momento**, responder por WhatsApp y devolver el chat al bot.

## Modelo de negocio
Farmacia física que vende en mostrador. El chat **reserva pedidos**; el pago y la entrega se cierran en tienda. No hay cobro online.

## Casos de uso principales
| Caso | Canal | Flujo |
|---|---|---|
| Consulta disponibilidad/precio | WhatsApp | IA llama a `consultar_precio_y_stock`, muestra ≤3 opciones |
| Pedir "lo más barato" | WhatsApp | IA pasa `orden_precio=asc` y prioriza precio |
| Montar pedido | WhatsApp | `agregar_al_carrito` + confirmación explícita |
| Confirmar pedido | WhatsApp | `actualizar_estado_pedido`; pide **nombre** para prepararlo |
| Necesita humano | WhatsApp / panel | `solicitar_asistencia_humana` o el operador toma el chat |
| Seguimiento y despacho | Panel | Inbox de conversaciones + vista de pedidos |

## Horizonte
- **FEFO** (priorizar por vencimiento) cuando el TPV aporte lotes y fechas.
- **Datos reales del TPV** (marcas, lotes, vencimientos) vía middleware de sincronización.

## Enlaces
- [[Contexto_IA]] · [[Stack_y_BD]] · [[Estado_Actual]] · [[Decision_Log_001]]