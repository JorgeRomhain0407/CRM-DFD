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

  if (name === 'conversaciones') loadConversaciones();
  if (name === 'configuracion') loadConfig();
  if (name === 'test') focusTestInput();
}

navItems.forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- Dashboard ---------- */
async function loadProductos() {
  const select = document.querySelector('#formVenta [name="producto_id"]');
  if (!hasKey()) {
    select.innerHTML = '<option value="">Introduce la clave API</option>';
    return;
  }
  try {
    const { productos } = await api('/api/productos');
    select.innerHTML = productos
      .map((p) => `<option value="${p.id}">${p.nombre} — ${formatCurrency(p.precio)} (stock ${p.stock})</option>`)
      .join('');
    if (!productos.length) select.innerHTML = '<option value="">Sin productos</option>';
  } catch (err) {
    select.innerHTML = `<option value="">${err.message}</option>`;
  }
}

async function loadVentas() {
  const tbody = document.querySelector('#tablaVentas');
  if (!hasKey()) return;
  try {
    const { ventas } = await api('/api/ventas?limit=30');
    if (!ventas.length) {
      tbody.innerHTML = '<tr><td colspan="6">Sin ventas registradas</td></tr>';
      return;
    }
    tbody.innerHTML = ventas
      .map((v) => `<tr>
        <td>${formatDate(v.fecha)}</td>
        <td>${v.cliente_nombre || v.telefono}</td>
        <td>${v.producto_nombre || '—'}</td>
        <td>${v.cantidad}</td>
        <td>${formatCurrency(v.subtotal)}</td>
        <td><span class="badge badge-${v.canal}">${v.canal}</span></td>
      </tr>`)
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">${err.message}</td></tr>`;
  }
}

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

async function loadClientes(q = '') {
  if (!hasKey()) return;
  try {
    await api(`/api/clientes?q=${encodeURIComponent(q)}`);
  } catch (err) {
    setStatus('clienteStatus', false, err.message);
  }
}

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

document.querySelector('#btnBuscar').addEventListener('click', () => {
  const tel = document.querySelector('#formCliente [name="telefono"]').value;
  const nombre = document.querySelector('#formCliente [name="nombre"]').value;
  loadClientes(tel || nombre);
});

document.querySelector('#formVenta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/ventas', {
      method: 'POST',
      body: JSON.stringify({
        telefono: fd.get('telefono'),
        items: [{ producto_id: fd.get('producto_id'), cantidad: Number(fd.get('cantidad')) }],
      }),
    });
    setStatus('ventaStatus', true, 'Venta registrada y stock actualizado.');
    loadProductos();
    loadVentas();
    loadResumenVentas();
  } catch (err) {
    setStatus('ventaStatus', false, err.message);
  }
});

document.querySelector('#formEstado').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const telefono = encodeURIComponent(fd.get('telefono'));
  try {
    const { estado_chat } = await api(`/api/estado-chat/${telefono}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: fd.get('estado') }),
    });
    setStatus('estadoStatus', true, `Estado: ${estado_chat.estado}`);
  } catch (err) {
    setStatus('estadoStatus', false, err.message);
  }
});

function refreshAll() {
  loadProductos();
  loadVentas();
  loadResumenVentas();
  loadConfig();
  if (document.getElementById('view-conversaciones').classList.contains('hidden') === false) {
    loadConversaciones();
  }
}

loadProductos();
loadVentas();
loadResumenVentas();
loadConfig();
