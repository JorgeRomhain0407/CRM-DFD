const apiKeyInput = document.querySelector('#apiKey');
apiKeyInput.value = sessionStorage.getItem('mostrador_api_key') || '';
apiKeyInput.addEventListener('change', () => {
  sessionStorage.setItem('mostrador_api_key', apiKeyInput.value.trim());
  refreshAll();
});

function apiKey() {
  return apiKeyInput.value.trim();
}

function hasKey() {
  if (apiKey()) return true;
  return false;
}

function setStatus(id, ok, text) {
  const el = document.getElementById(id);
  el.hidden = false;
  el.className = `status ${ok ? 'ok' : 'err'}`;
  el.textContent = text;
}

function formatCurrency(n) {
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

async function api(path, options = {}) {
  const headers = { 'x-api-key': apiKey(), ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- Navegación ---------- */
const navItems = document.querySelectorAll('.nav-item');
const views = {};

function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  navItems.forEach((b) => b.classList.toggle('active', b.dataset.view === name));

  if (name === 'dashboard') loadResumenVentas();
  if (name === 'pedidos') loadPedidos();
  if (name === 'conversaciones') loadConversaciones();
  if (name === 'configuracion') loadConfig();
  if (name === 'test') focusTestInput();
}

navItems.forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- Dashboard: métricas ---------- */
async function loadResumenVentas() {
  if (!hasKey()) return;
  try {
    const data = await api('/api/ventas/resumen');
    document.getElementById('resIngresos').textContent = formatCurrency(data.total_ingresos);
    document.getElementById('resUnidades').textContent = data.total_unidades;
    document.getElementById('resNumVentas').textContent = data.total_ventas;
    document.getElementById('resMostrador').textContent =
      data.por_canal?.mostrador ? `${data.por_canal.mostrador.ventas} ventas` : '0';
    document.getElementById('resWhatsApp').textContent =
      data.por_canal?.whatsapp ? `${data.por_canal.whatsapp.ventas} ventas` : '0';
  } catch (err) {
    document.getElementById('resIngresos').textContent = 'Error';
  }
}

/* ---------- Productos ---------- */
let productos = [];
let pedidos = [];

async function loadProductos() {
  const tbody = document.getElementById('tablaProductos');
  if (!hasKey()) {
    tbody.innerHTML = '<tr><td colspan="4">Introduce la clave API.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
  try {
    const { productos: data } = await api('/api/productos?all=true');
    productos = data || [];
    if (!productos.length) {
      tbody.innerHTML = '<tr><td colspan="4">Sin productos registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = productos
      .map(
        (p) => `<tr>
          <td>${String(p.nombre).replace(/</g, '&lt;')}</td>
          <td>${formatCurrency(p.precio)}</td>
          <td class="${p.stock === 0 ? 'stock-0' : ''}">${p.stock}</td>
          <td><span class="badge badge-${p.activo ? 'mostrador' : 'inactivo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">${err.message}</td></tr>`;
  }
}

function filaCoincide(p, term) {
  if (!term) return true;
  const hay = (v) => String(v || '').toLowerCase().includes(term);
  return hay(p.nombre) || hay(p.descripcion);
}

function filtroProductos() {
  const term = String(document.getElementById('buscarProducto').value || '').trim().toLowerCase();
  const tbody = document.getElementById('tablaProductos');
  const lista = productos.filter((p) => filaCoincide(p, term));
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4">Sin coincidencias.</td></tr>';
    return;
  }
  tbody.innerHTML = lista
    .map(
      (p) => `<tr>
        <td>${String(p.nombre).replace(/</g, '&lt;')}</td>
        <td>${formatCurrency(p.precio)}</td>
        <td class="${p.stock === 0 ? 'stock-0' : ''}">${p.stock}</td>
        <td><span class="badge badge-${p.activo ? 'mostrador' : 'inactivo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      </tr>`
    )
    .join('');
}

/* ---------- Pedidos ---------- */
const ESTADO_LABEL = {
  activo: 'Activo',
  pendiente_confirmacion: 'Pendiente de confirmar',
  pedido: 'Pedido',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

const ESTADO_CLASS = {
  activo: 'ped-activo',
  pendiente_confirmacion: 'ped-pendiente',
  pedido: 'ped-pedido',
  completado: 'ped-completado',
  cancelado: 'ped-cancelado',
};

async function loadPedidos() {
  const container = document.getElementById('listaPedidos');
  const detail = document.getElementById('pedidoDetail');
  if (!hasKey()) {
    container.innerHTML = '<div class="empty">Introduce la clave API.</div>';
    detail.innerHTML = '<div class="detail-empty">Selecciona un pedido</div>';
    return;
  }
  container.innerHTML = '<div class="empty">Cargando pedidos…</div>';
  try {
    const data = await api('/api/carritos');
    pedidos = data && data.carritos ? data.carritos : [];
    renderPedidos();
  } catch (err) {
    container.innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

function renderPedidos() {
  const container = document.getElementById('listaPedidos');
  if (!pedidos.length) {
    container.innerHTML = '<div class="empty">No hay pedidos activos.</div>';
    return;
  }
  container.innerHTML = pedidos
    .map(
      (c) => `<article class="ped-item" data-id="${c.id}">
        <div class="ped-item-head">
          <div class="avatar-sm">${initials(c.nombre || c.telefono)}</div>
          <div class="ped-item-meta">
            <strong>${String(c.nombre || 'Cliente').replace(/</g, '&lt;')}</strong>
            <span>${c.telefono}</span>
          </div>
          <span class="badge ped-${ESTADO_CLASS[c.estado] || 'ped-activo'}">${ESTADO_LABEL[c.estado] || c.estado}</span>
        </div>
        <div class="ped-item-foot">
          <span>${c.num_items} art.</span>
          <strong>${formatCurrency(c.total)}</strong>
          <span>${formatTime(c.actualizado_en)}</span>
        </div>
        <div class="ped-item-lineas">
          ${c.lineas
            .map((l) => `<div><span>${String(l.nombre).replace(/</g, '&lt;')} × ${l.cantidad}</span><span>${formatCurrency(l.subtotal)}</span></div>`)
            .join('')}
        </div>
      </article>`
    )
    .join('');
  container.querySelectorAll('.ped-item').forEach((el) =>
    el.addEventListener('click', () => abrirPedido(el.dataset.id))
  );
  if (!document.querySelector('.ped-item.active')) abrirPedido(pedidos[0].id);
}

let pedidoAbierto = null;

async function abrirPedido(id) {
  pedidoAbierto = id;
  pedidos.forEach((c) => {
    document.querySelectorAll(`.ped-item`).forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  });
  const detail = document.getElementById('pedidoDetail');
  const actual = pedidos.find((c) => c.id === id);
  if (!actual) {
    detail.innerHTML = '<div class="detail-empty">Pedido no encontrado.</div>';
    return;
  }
  detail.innerHTML = `
    <div class="ped-detail-head">
      <div>
        <h3>${String(actual.nombre || 'Cliente').replace(/</g, '&lt;')}</h3>
        <p class="hint" style="margin:0">${actual.telefono}</p>
      </div>
      <span class="badge ped-${ESTADO_CLASS[actual.estado] || 'ped-activo'}">${ESTADO_LABEL[actual.estado] || actual.estado}</span>
    </div>
    <div class="ped-detail-meta">
      <span>Actualizado ${formatDate(actual.actualizado_en)}</span>
      <span>${actual.num_items} artículos</span>
    </div>
    <ul class="ped-lista">
      ${actual.lineas
        .map(
          (l) => `<li>
            <div>
              <strong>${String(l.nombre).replace(/</g, '&lt;')}</strong>
              <span>${l.cantidad} × ${formatCurrency(l.precio_unitario)}</span>
            </div>
            <strong>${formatCurrency(l.subtotal)}</strong>
          </li>`
        )
        .join('')}
    </ul>
    <div class="ped-total">
      <span>Total</span>
      <strong>${formatCurrency(actual.total)}</strong>
    </div>
    <div class="ped-acciones">
      <button type="button" class="primary" data-pagar="${actual.id}">Marcar como pagado</button>
    </div>
    <p id="pedidoStatus" class="status" hidden></p>`;
  detail.querySelector('[data-pagar]').addEventListener('click', () => pagarPedido(actual.id));
}

async function pagarPedido(id) {
  const status = document.getElementById('pedidoStatus');
  try {
    const res = await api(`/api/carritos/${id}/pagar`, { method: 'POST' });
    setStatus('pedidoStatus', true, `${res.mensaje} — ${res.num_lineas} líneas, ${formatCurrency(res.total)}`);
    setTimeout(() => {
      pedidoAbierto = null;
      loadPedidos();
      loadResumenVentas();
      loadProductos();
    }, 1200);
  } catch (err) {
    setStatus('pedidoStatus', false, err.message);
  }
}

/* ---------- Gestiones: consultar / registrar cliente ---------- */
function renderPerfil(cliente) {
  const perfil = document.getElementById('perfilCliente');
  document.getElementById('perfilAvatar').textContent = initials(cliente.nombre);
  document.getElementById('perfilNombre').textContent = cliente.nombre || 'Sin nombre';
  document.getElementById('perfilTelefono').textContent = cliente.telefono;
  document.getElementById('perfilEdad').textContent = cliente.edad ?? '—';
  document.getElementById('perfilHabitos').textContent = cliente.habitos_consumo || '—';

  const fecha = cliente.fecha_registro
    ? new Date(cliente.fecha_registro).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  document.getElementById('perfilFecha').textContent = fecha;

  const estado = Array.isArray(cliente.estado_chat) ? cliente.estado_chat[0] : cliente.estado_chat;
  document.getElementById('perfilEstado').textContent = estado?.estado || '—';

  perfil.hidden = false;
}

async function buscarCliente(q) {
  const status = document.getElementById('consultaStatus');
  const perfil = document.getElementById('perfilCliente');
  perfil.hidden = true;
  if (!hasKey()) {
    setStatus('consultaStatus', false, 'Introduce la clave API.');
    return;
  }
  const term = String(q || '').trim();
  if (!term) {
    setStatus('consultaStatus', false, 'Introduce un teléfono o nombre.');
    return;
  }
  status.hidden = false;
  status.className = 'status';
  status.textContent = 'Consultando…';
  try {
    let cliente = null;
    if (term.startsWith('+') || /^\d+$/.test(term)) {
      try {
        const exact = await api(`/api/clientes/${encodeURIComponent(term)}`);
        cliente = exact.cliente;
      } catch (err) {
        if (err.message !== 'Cliente no encontrado.') throw err;
      }
    }
    if (!cliente) {
      const { clientes } = await api(`/api/clientes?q=${encodeURIComponent(term)}`);
      cliente = clientes[0] || null;
    }
    status.hidden = true;
    if (!cliente) {
      setStatus('consultaStatus', false, 'No se encontró ningún cliente. Puedes registrarlo en el panel de la derecha.');
      return;
    }
    renderPerfil(cliente);
  } catch (err) {
    setStatus('consultaStatus', false, err.message);
  }
}

document.getElementById('formConsultar').addEventListener('submit', (e) => {
  e.preventDefault();
  buscarCliente(document.getElementById('consultaCliente').value);
});

/* ---------- Conversaciones ---------- */
let conversaciones = [];

async function loadConversaciones() {
  const container = document.getElementById('listaConversaciones');
  if (!hasKey()) {
    container.innerHTML = '<div class="empty">Introduce la clave API para cargar.</div>';
    return;
  }
  container.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const data = await api('/api/bot/conversaciones');
    conversaciones = data.conversaciones || [];
    renderConversaciones('');
  } catch (err) {
    container.innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

function renderConversaciones(filter) {
  const container = document.getElementById('listaConversaciones');
  const f = (filter || '').toLowerCase();
  const items = conversaciones.filter(
    (c) => c.nombre.toLowerCase().includes(f) || c.telefono.includes(f)
  );

  if (!items.length) {
    container.innerHTML = '<div class="empty">Sin conversaciones</div>';
    return;
  }

  container.innerHTML = items
    .map(
      (c, i) => `<div class="conv-item" data-i="${i}">
        <div class="avatar">${initials(c.nombre)}</div>
        <div class="conv-info">
          <div class="conv-top">
            <span class="conv-name">${c.nombre}</span>
            <span class="conv-time">${formatTime(c.ultima_actualizacion)}</span>
          </div>
          <div class="conv-msg">${(c.ultimo_mensaje || '').replace(/</g, '&lt;').replace(/\n/g, ' ')}</div>
          <div class="conv-badges"><span class="tag tag-${c.estado}">${c.estado}</span></div>
        </div>
      </div>`
    )
    .join('');

  container.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.conv-item').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      abrirConversacion(conversaciones[Number(el.dataset.i)]);
    });
  });
}

async function abrirConversacion(conv) {
  const detail = document.getElementById('conversacionDetail');
  detail.innerHTML = `
    <div class="detail-head">
      <div class="detail-title">${conv.nombre}</div>
      <div class="conv-badges" style="margin-top:0.4rem">
        <span class="tag tag-${conv.estado}">${conv.estado}</span>
        <span class="conv-msg" style="margin:0">${conv.telefono}</span>
      </div>
      ${conv.motivo_handoff ? `<p class="hint">Motivo: ${conv.motivo_handoff}</p>` : ''}
    </div>
    ${conv.mensajes
      .map(
        (m) => `<div class="msg-row ${m.rol === 'usuario' ? 'usuario' : 'asistente'}">
          <div>
            <div class="bubble">${(m.contenido || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</div>
            <div class="msg-meta">${m.canal} · ${formatDate(m.created_at)}</div>
          </div>
        </div>`
      )
      .join('') || '<div class="empty">Sin mensajes</div>'}
  `;
}

document.getElementById('buscarConv').addEventListener('input', (e) => {
  renderConversaciones(e.target.value);
});

/* ---------- Test del bot ---------- */
async function loadConfig() {
  if (!hasKey()) return;
  try {
    const { config } = await api('/api/bot/config');
    const form = document.getElementById('formConfig');
    form.querySelector('[name="bot_nombre"]').value = config?.bot_nombre || 'Berta';
    form.querySelector('[name="temperatura"]').value = config?.temperatura ?? '0.7';
    document.getElementById('systemPrompt').value = config?.system_prompt || '';
  } catch (err) {
    setStatus('configStatus', false, `Error cargando: ${err.message}`);
  }
}

function appendChat(rol, text) {
  const hist = document.getElementById('chatHistory');
  const div = document.createElement('div');
  div.className = rol === 'usuario' ? 'chat-user' : 'chat-bot';
  div.textContent = text;
  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
}

function focusTestInput() {
  const input = document.querySelector('#formTest [name="texto"]');
  if (input) input.focus();
}

document.getElementById('formTest').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.querySelector('[name="texto"]');
  const texto = input.value.trim();
  if (!texto || !hasKey()) return;

  input.value = '';
  setStatus('testStatus', false, 'Pensando…');
  document.getElementById('testStatus').hidden = false;

  appendChat('usuario', texto);

  try {
    const res = await api('/api/bot/test', {
      method: 'POST',
      body: JSON.stringify({ telefono: '+34900000000', texto }),
    });
    appendChat('asistente', res.respuesta);
    document.getElementById('testStatus').hidden = true;
  } catch (err) {
    document.getElementById('testStatus').hidden = false;
    setStatus('testStatus', false, err.message);
  }
});

/* ---------- Configuración ---------- */
document.getElementById('formConfig').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const { config } = await api('/api/bot/config', {
      method: 'PUT',
      body: JSON.stringify({
        bot_nombre: fd.get('bot_nombre'),
        temperatura: fd.get('temperatura'),
        system_prompt: fd.get('system_prompt'),
      }),
    });
    setStatus('configStatus', true, `Configuración de "${config.bot_nombre}" guardada ✓`);
  } catch (err) {
    setStatus('configStatus', false, err.message);
  }
});

/* ---------- Formularios Dashboard ---------- */
document.querySelector('#formCliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const { cliente } = await api('/api/clientes', {
      method: 'PUT',
      body: JSON.stringify({
        telefono: fd.get('telefono'),
        nombre: fd.get('nombre'),
        edad: fd.get('edad'),
        habitos_consumo: fd.get('habitos_consumo'),
      }),
    });
    setStatus('clienteStatus', true, `Perfil guardado: ${cliente.telefono}`);
  } catch (err) {
    setStatus('clienteStatus', false, err.message);
  }
});

function refreshAll() {
  loadResumenVentas();
  loadProductos();
  loadPedidos();
  loadConfig();
  if (!document.getElementById('view-conversaciones').classList.contains('hidden')) {
    loadConversaciones();
  }
}

loadResumenVentas();
loadProductos();
loadPedidos();
loadConfig();

document.getElementById('buscarProducto').addEventListener('input', filtroProductos);
