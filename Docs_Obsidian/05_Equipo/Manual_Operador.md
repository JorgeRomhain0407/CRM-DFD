---
tipo: manual
rol: operador
actualizado: 2026-11-06
tags: [manual, operador, mostrador, habitos, ventas]
---

# Manual de uso — Operador (Farmacia)

> Ejemplar de bolsillo. Panel: **https://gestiondfd.com** · Versión del sistema: `v1.0.0`.

## 1. Entrar y seguridad
1. Entra con **tu usuario y tu contraseña** (te los da el gestor). Nunca compartas tu cuenta: **cada venta queda firmada con tu usuario**.
2. Abajo a la izquierda ves tu nombre y rol (**Operador**). Para salir, usa **Salir**.
3. ¿Olvidaste la contraseña o tu cuenta no entra? Solo un **gestor** puede cambiarla o reactivarla (Usuarios).
4. Si ves **401** o te saca del panel: cierra sesión y vuelve a entrar (la sesión caducó).

## 2. Mapa del panel
| Vista | Para qué sirve |
|---|---|
| **Conversaciones** | Chats de WhatsApp: el bot contesta solo; tú entras cuando pide una persona. |
| **Clientes** | Fichas: teléfono, cédula, compras, carrito y **hábitos de consumo**. |
| **Productos** | Catálogo con precio; no muestra stock exacto (solo disponibilidad). |
| **Ventas / Pedidos** | Carritos abiertos y ventas registradas. |
| **Dashboard / Analítica** | Resumen del día y de conversaciones. |
| **Guía** | Resumen rápido dentro del panel. |

**No puedes (solo gestor, da 403):** crear/editar usuarios, cambiar la configuración del bot, usar *Test del bot*, tocar fidelización o base de conocimiento. Si lo necesitas, avisa a un gestor.

## 3. Hacer una venta en mostrador (paso a paso)
1. **Busca el producto:** en *Productos* usa el filtro, o **`Ctrl+K`** (buscador rápido) para ir directo.
2. **Confirma precio y disponibilidad.** El bot y el panel **nunca dicen la cantidad exacta** en stock, solo si hay o si quedan pocas unidades.
3. **Registra la venta** en el mostrador: producto + cantidad + forma de pago. El sistema te pide **confirmación dos veces** antes de cerrar; revísalo.
4. **Precios:** se ven en **Bs y USD**; la tasa se aplica al cobrar y puede variar respecto a lo que vio el cliente por WhatsApp.
5. **Lo que pasa por dentro (para no asustarte):** al registrar la venta baja el stock del producto; los **lotes y fechas de vencimiento los actualiza el TPV**, no el panel. Si algo “no cuadra”, avisa al gestor — no lo corrijas a mano.
6. **Carrito de WhatsApp:** en *Pedidos* ves carritos abiertos; para cobrar un pedido pendiente, confírmalo desde el flujo del mostrador.

## 4. Convencer al cliente de dar sus datos (en cada compra)
**Regla:** en **cada compra** intenta registrar al cliente (nombre + teléfono). No lo obligues, pero sí ofrécelo siempre. Un teléfono bien tomado vale más que diez ventas anónimas.

**Qué pedir (en este orden):** 1) **Teléfono** (+58…) 2) **Nombre** 3) **Cédula** (si la da) 4) **Hábitos** (los productos que suele comprar).

### Mina de argumentos (frases listas)
- *“¿Me regala su número? Le guardo el historial de lo que se lleva para atenderlo más rápido la próxima vez.”*
- *“Con su teléfono le avisamos cuando vuelva a llegar lo que suele comprar.”*
- *“Si se le olvida el nombre de la medicina, con su número la encontramos al instante.”*
- *“Es solo para su ficha aquí en la farmacia, no le mandamos publicidad.”*
- *“Tarda 20 segundos y la próxima compra sale volando.”*
- *“¿Quiere que le anote este producto como frecuente? Así el sistema se lo sugiere cuando pregunte por WhatsApp.”*
- *“Muchos clientes ya lo usan para no repetir toda la consulta cada vez.”*
- *“Si prefiere, solo el número está bien; lo demás lo completamos después.”* (salida suave: consigue al menos el teléfono)
- *“¿Le dejo guardado lo que llevó hoy? Por si vuelve por lo mismo.”*

**Cuándo insistir y cuándo soltar:** ofrece 1 vez claro + 1 vez suave. Si el cliente tiene prisa, está molesto o dice que no, **no insistas**: regístralo como pueda (o vende sin ficha) y sigue. Nunca discutas.

**Qué NUNCA hacer:** no inventes datos, **no metas un teléfono falso** (rompe el historial y confunde al bot), no escribas hábitos en texto libre en notas improvisadas — los hábitos van en la ficha con el **selector del catálogo**.

## 5. Fichas de clientes y hábitos
- **Buscar:** por teléfono o cédula (barra de búsqueda o `/`).
- **Alta:** crea la ficha con nombre + teléfono (+58). Si la da, agrega cédula.
- **Hábitos de consumo:** son productos del **catálogo** elegidos con chips/selector (sin texto libre). Los que compró por WhatsApp pueden aparecer solos con origen **“compra”**; los que marcas tú quedan como **manual**.

## 6. Tu trabajo con los hábitos en cada compra (importante)
El objetivo es que la ficha refleje lo que el cliente realmente compra.

| Situación | Qué haces tú |
|---|---|
| **Cliente nuevo** que da sus datos | Crea la ficha **y marca como hábitos los productos que está comprando ahora** (además de lo que diga que suele comprar). |
| **Cliente ya registrado** que **compra algo** | Abre su ficha y **añade ese producto a sus hábitos** si no está. **Cada compra de un registrado = revisar que su ficha quede al día.** |
| **Compra por WhatsApp (bot)** | El sistema añade lo comprado como hábito `compra` automáticamente (no pisa los manuales). Tú solo revisas si falta algo. |

**Regla de oro:** nunca borres hábitos buenos sin motivo. Añadir es barato; borrar información útil, no.

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
4. **Chat sin respuesta / error al enviar:** avisa a un gestor. No reintentes en bucle.
5. **Nunca** corrijas stock o datos críticos “a ojo”; repórtalo.

## 9. Atajos rápidos
`Ctrl+K` buscador/comandos · `/` enfocar buscador · `J`/`K` moverte entre chats · `Enter` abrir 1.º resultado · `Shift+?` hoja de atajos · `Esc` cerrar.

---
*Hecho para el mostrador. Dudas o permisos: hablar con el gestor.*
