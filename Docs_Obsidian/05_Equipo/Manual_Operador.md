---
tipo: manual
rol: operador
actualizado: 2026-11-06
tags: [manual, operador, mostrador, habitos, ventas]
---

# Manual de uso — Operador (Farmacia)

> Ejemplar de bolsillo. Panel: **https://gestiondfd.com** · Versión del sistema: `v1.0.0`.

## 1. Entrar y seguridad
1. Entra con **tu usuario y tu contraseña** (te los da el gestor). Nunca compartas tu cuenta: **cada cambio en el panel queda firmado con tu usuario** (la venta la firma el TPV).
2. Abajo a la izquierda ves tu nombre y rol (**Operador**). Para salir, usa **Salir**.
3. ¿Olvidaste la contraseña o tu cuenta no entra? Solo un **gestor** puede cambiarla o reactivarla (Usuarios).
4. Si ves **401** o te saca del panel: cierra sesión y vuelve a entrar (la sesión caducó).

## 2. Mapa del panel
| Vista | Para qué sirve |
|---|---|
| **Conversaciones** | Chats de WhatsApp: el bot contesta solo; tú entras cuando pide una persona. |
| **Clientes** | Fichas: teléfono, cédula, compras, carrito y **hábitos de consumo**. |
| **Productos** | Catálogo con precio; no muestra stock exacto (solo disponibilidad). |
| **Ventas / Pedidos** | Historial y carritos de WhatsApp. **La venta real se cobra en el TPV**, no aquí. |
| **Dashboard / Analítica** | Resumen del día y de conversaciones. |
| **Guía** | Resumen rápido dentro del panel. |

**No puedes (solo gestor, da 403):** crear/editar usuarios, cambiar la configuración del bot, usar *Test del bot*, tocar fidelización o base de conocimiento. Si lo necesitas, avisa a un gestor.

## 3. Cómo se hace la venta (TPV + panel)
> **La venta se hace en el TPV SOINFARMA.** El panel **no vende, no cobra y no toca stock**: sirve para fichas, hábitos, WhatsApp y consulta.

1. **Escanea y cobra en el TPV** como siempre: producto + cantidad + forma de pago. La venta se escanea **una sola vez**.
2. **Antes de cerrar el cobro, pide cédula y teléfono** (ver §4) y regístralos en la ficha del cliente de la factura en el TPV.
3. **El CRM lee la factura solo** y añade los productos comprados a los **hábitos del cliente** automáticamente. **No vuelvas a teclear los productos en el panel**: sería doble trabajo y puede duplicar.
4. **Si el cliente no da datos**, la venta se cobra igual y queda **sin ficha**. No inventes cédula ni teléfono; se completará otro día.
5. **Precios:** se ven en **Bs y USD**; la tasa se aplica al cobrar y puede variar respecto a lo que vio el cliente por WhatsApp.
6. **Pedido de WhatsApp:** en *Pedidos* ves carritos abiertos; para cobrarlo, escanéalo en el TPV como cualquier venta.
7. **Lotes y vencimientos los actualiza el TPV**, no el panel. Si algo “no cuadra”, avisa al gestor — no lo corrijas a mano.


## 4. Convencer al cliente de dar sus datos (en cada compra)
**Regla:** en **cada compra** intenta registrar al cliente. No lo obligues, pero sí ofrécelo siempre. Un dato bien tomado vale más que diez ventas anónimas.

**Qué pedir (en este orden):** 1) **Cédula** (es la que cruza la venta del TPV con su ficha) 2) **Teléfono** (+58…, es la llave de la ficha) 3) **Nombre**.

### Mina de argumentos (frases listas)
- *“¿Me da su cédula? Con eso la compra que acaba de hacer entra sola en su historial, sin que yo tenga que volver a escribir los productos.”*
- *“¿Me regala su número? Le guardo el historial de lo que se lleva para atenderlo más rápido la próxima vez.”*
- *“Con su teléfono le avisamos cuando vuelva a llegar lo que suele comprar.”*
- *“Si se le olvida el nombre de la medicina, con su número o su cédula la encontramos al instante.”*
- *“Es solo para su ficha aquí en la farmacia, no le mandamos publicidad ni la compartimos.”*
- *“Tarda 20 segundos y la próxima compra sale volando.”*
- *“¿Quiere que le anote este producto como frecuente? Así el sistema se lo sugiere cuando pregunte por WhatsApp.”*
- *“Muchos clientes ya lo usan para no repetir toda la consulta cada vez.”*
- *“Si prefiere, con la cédula basta para el historial; el teléfono me ayuda a avisarle.”* (salida suave)
- *“¿Le dejo guardado lo que llevó hoy? Por si vuelve por lo mismo.”*

**Cuándo insistir y cuándo soltar:** ofrece 1 vez claro + 1 vez suave. Si el cliente tiene prisa, está molesto o dice que no, **no insistas**: cobra la venta y sigue. Nunca discutas.

**Qué NUNCA hacer:** no inventes datos, **no pongas una cédula ni un teléfono falsos o de otra persona** (rompen el historial y confunden al bot), y los hábitos van en la ficha con el **selector del catálogo** (nunca en texto libre).

## 5. Fichas de clientes y hábitos
- **Buscar:** por teléfono o cédula (barra de búsqueda o `/`).
- **Alta:** nombre + **teléfono** (+58) obligatorio para crear la ficha; la **cédula** es lo que permite cruzar las compras del TPV. Sin teléfono no se puede vender con ficha (decisión de la farmacia): la ficha queda **en cola** hasta completarlo.
- **Hábitos de consumo:** son productos del **catálogo** elegidos con chips/selector (sin texto libre). Las compras del **TPV** y de **WhatsApp** entran solas con origen **“compra”**; los que marcas tú quedan como **manual** (y el sistema nunca los pisa).

## 6. Hábitos en cada compra (importante)
El objetivo es que la ficha refleje lo que el cliente realmente compra **sin que tú teclees dos veces**.

| Situación | Qué haces tú |
|---|---|
| **Compra en el TPV de un cliente con ficha** | **Nada sobre los productos:** la venta entra sola a sus hábitos con origen `compra`. Solo confirma que su cédula/teléfono estén bien. |
| **Cliente nuevo que da sus datos** | Toma **cédula + teléfono** en el cobro y regístralos en el TPV. La ficha se crea sola; si falta el teléfono, queda en cola para completarla. |
| **Cliente que no da datos** | Cobra la venta igual. Queda **sin ficha**; no inventes datos. |
| **Compra por WhatsApp (bot)** | El sistema añade lo comprado como hábito `compra` automáticamente (no pisa los manuales). Tú solo revisas si falta algo. |
| **El cliente menciona algo que suele comprar y no está en la ficha** | Añádelo **manualmente** con el selector del catálogo (origen `manual`). |

**Regla de oro:** **no teclees en el panel los productos de una venta del TPV** (ya entran solos) y nunca borres hábitos buenos sin motivo. Añadir es barato; borrar información útil, no.

## 7. El bot de WhatsApp y cuándo entras tú
- El bot contesta solo consultas de precio/disponibilidad y da **máximo 3 opciones**. **No revela stock exacto**.
- Si el cliente pide hablar con una persona, el chat pasa a **“esperando operador”** → entra en *Conversaciones* y pulsa **Atender**.
- Al escribir como operador, el bot se **pausa solo** en ese chat.
- Consultas delicadas (posología, recetas, alergias) o clientes frustrados se derivan a humano: responde con calma y, si aplica, indica que lo atienda el farmacéutico.
- Canal `test`: mensajes de prueba internos, no son clientes reales.

## 8. Si algo falla
1. **Recarga la página** (F5). Muchos problemas son de sesión o caché.
2. **401** → sal y vuelve a entrar. **403** → es una acción solo de gestor.
3. **Producto no aparece:** puede estar inactivo, vencido o sin lotes cargados por el TPV; avisa al gestor.
4. **Una compra del TPV no aparece en los hábitos del cliente:** no la metas a mano en el panel; avisa al gestor (el sync la reintenta solo).
5. **Chat sin respuesta / error al enviar:** avisa a un gestor. No reintentes en bucle.
6. **Nunca** corrijas stock o datos críticos “a ojo”; repórtalo.

## 9. Atajos rápidos
`Ctrl+K` buscador/comandos · `/` enfocar buscador · `J`/`K` moverte entre chats · `Enter` abrir 1.º resultado · `Shift+?` hoja de atajos · `Esc` cerrar.

---
*Hecho para el mostrador. Dudas o permisos: hablar con el gestor.*
