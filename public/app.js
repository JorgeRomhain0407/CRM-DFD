const apiKeyInput = document.querySelector('#apiKey');
const btnToggleKey = document.querySelector('#btnToggleKey');
const btnProbarKey = document.querySelector('#btnProbarKey');
const chkRemember = document.querySelector('#apiKeyRemember');
const REMEMBER_KEY = 'mostrador_api_key_remember';

function readStoredKey() {
  if (chkRemember && chkRemember.checked) {
    return localStorage.getItem(REMEMBER_KEY) || sessionStorage.getItem('mostrador_api_key') || '';
  }
  return sessionStorage.getItem('mostrador_api_key') || '';
}

function storeKey(value) {
  const v = value.trim();
  sessionStorage.setItem('mostrador_api_key', v);
  if (!chkRemember) return;
  if (chkRemember.checked) localStorage.setItem(REMEMBER_KEY, v);
  else localStorage.removeItem(REMEMBER_KEY);
}

if (chkRemember) chkRemember.checked = Boolean(localStorage.getItem(REMEMBER_KEY));
apiKeyInput.value = readStoredKey();

function setApiKeyStatus(ok, text) {
  const el = document.getElementById('apiKeyStatus');
  if (!el) return;
  el.hidden = false;
  el.className = ok === null ? 'status' : `status ${ok ? 'ok' : 'err'}`;
  el.textContent = text;
}

apiKeyInput.addEventListener('change', () => {
  storeKey(apiKeyInput.value);
  refreshAll();
});

if (btnToggleKey) {
  btnToggleKey.addEventListener('click', () => {
    const show = apiKeyInput.type === 'password';
    apiKeyInput.type = show ? 'text' : 'password';
    btnToggleKey.setAttribute('aria-pressed', String(show));
    btnToggleKey.title = show ? 'Ocultar clave' : 'Mostrar clave';
  });
}

let keyValidationTimer = null;
async function validarClave() {
  const k = apiKey();
  if (!k) return;
  try {
    await api('/api/ventas/resumen');
    setApiKeyStatus(true, 'Clave válida');
  } catch (err) {
    setApiKeyStatus(false, `Clave inválida: ${err.message}`);
  }
}
apiKeyInput.addEventListener('input', () => {
  clearTimeout(keyValidationTimer);
  keyValidationTimer = setTimeout(validarClave, 700);
});
if (btnProbarKey) {
  btnProbarKey.addEventListener('click', async () => {
    if (!hasKey()) { setApiKeyStatus(false, 'Escribe la clave primero.'); return; }
    btnProbarKey.disabled = true;
    setApiKeyStatus(null, 'Comprobando…');
    await validarClave();
    btnProbarKey.disabled = false;
  });
}
if (chkRemember) {
  chkRemember.addEventListener('change', () => {
    if (chkRemember.checked) localStorage.setItem(REMEMBER_KEY, apiKeyInput.value.trim());
    else localStorage.removeItem(REMEMBER_KEY);
  });
}

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
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Bs';
}

function formatCurrencyUsd(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPrecio(p) {
  const bs = formatCurrency(p.precio);
  if (Number(p.precio_usd || 0) > 0) {
    return bs + '<br><small class="muted">' + formatCurrencyUsd(p.precio_usd) + '</small>';
  }
  return bs;
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
let pollTimer = null;
let polling = false;
let configDirty = false;

function setNavActive(name) {
  navItems.forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function showView(name) {
  if (name === 'configuracion' && configDirty &&
      !window.confirm('Tienes cambios sin guardar en Configuración. ¿Descargar la configuración guardada de todos modos?')) {
    return;
  }
  for (const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  setNavActive(name);

  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }

  if (name === 'dashboard') loadResumenVentas();
  if (name === 'pedidos') loadPedidos();
  if (name === 'conversaciones') schedulePoll();
  if (name === 'configuracion') loadConfig();
  if (name === 'test') focusTestInput();
}

async function pollTick() {
  if (polling) return;
  polling = true;
  try {
    await Promise.all([loadConversaciones(), refreshConversacionAbierta()]);
  } catch (e) {
    /* El siguiente ciclo reintenta. */
  }
  polling = false;
  pollTimer = setTimeout(pollTick, 10000);
}

function schedulePoll() {
  loadConversaciones();
  refreshConversacionAbierta();
  pollTimer = setTimeout(pollTick, 10000);
}

navItems.forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- Dashboard: métricas ---------- */
async function loadResumenVentas() {
  if (!hasKey()) return;
  const ids = ['resIngresos', 'resUnidades', 'resNumVentas', 'resMostrador', 'resWhatsApp'];
  ids.forEach((id) => document.getElementById(id).classList.add('skeleton'));
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
  } finally {
    ids.forEach((id) => document.getElementById(id).classList.remove('skeleton'));
  }
}

/* ---------- Productos ---------- */
let productos = [];
let pedidos = [];

async function loadProductos() {
  const tbody = document.getElementById('tablaProductos');
  const count = document.getElementById('productosCount');
  if (!hasKey()) {
    tbody.innerHTML = '<tr><td colspan="4">Introduce la clave API.</td></tr>';
    if (count) count.textContent = '';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
  try {
    const { productos: data } = await api('/api/productos?all=true');
    productos = data || [];
    filtroProductos();
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
  const count = document.getElementById('productosCount');
  const btnClear = document.getElementById('btnLimpiarProd');

  let lista = productos.filter((p) => filaCoincide(p, term));
  const chkSolo = document.getElementById('soloAgotados');
  if (chkSolo && chkSolo.checked) lista = lista.filter((p) => Number(p.stock) === 0);

  if (count) count.textContent = productos.length ? `${lista.length} de ${productos.length} productos` : '';
  if (btnClear) btnClear.hidden = !term;

  if (!productos.length) {
    tbody.innerHTML = '<tr><td colspan="4">Sin productos registrados.</td></tr>';
    return;
  }
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4">Sin coincidencias.</td></tr>';
    return;
  }

  const resaltar = (texto) => {
    const s = String(texto ?? '');
    if (!term) return esc(s);
    const i = s.toLowerCase().indexOf(term);
    if (i === -1) return esc(s);
    return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + term.length)) + '</mark>' + esc(s.slice(i + term.length));
  };
  const stockCls = (stock) => Number(stock) === 0 ? 'stock-0' : (Number(stock) <= 5 ? 'stock-bajo' : '');

  tbody.innerHTML = lista
    .map(
      (p) => `<tr>
        <td>${resaltar(p.nombre)}</td>
        <td>${formatPrecio(p)}</td>
        <td class="${stockCls(p.stock)}">${esc(p.stock)}</td>
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
      (c) => `<div class="ped-item" role="button" tabindex="0" data-id="${esc(c.id)}">
        <div class="ped-item-head">
          <div class="avatar-sm">${initials(c.nombre || c.telefono)}</div>
          <div class="ped-item-meta">
            <strong>${esc(c.nombre || 'Cliente')}</strong>
            <span>${esc(c.telefono)}</span>
          </div>
          <span class="badge ped-${ESTADO_CLASS[c.estado] || 'ped-activo'}">${ESTADO_LABEL[c.estado] || esc(c.estado)}</span>
        </div>
        <div class="ped-item-foot">
          <span>${esc(c.num_items)} art.</span>
          <strong>${formatCurrency(c.total)}</strong>
          <span>${formatTime(c.actualizado_en)}</span>
          <button type="button" class="lineas-toggle" data-lineas="${esc(c.id)}" aria-expanded="false" title="Ver líneas">⌄</button>
        </div>
        <div class="ped-item-lineas">
          ${(c.lineas || [])
            .map((l) => `<div><span>${esc(l.nombre)} × ${esc(l.cantidad)}</span><span>${formatCurrency(l.subtotal)}</span></div>`)
            .join('')}
        </div>
      </div>`
    )
    .join('');
  container.querySelectorAll('.ped-item').forEach((el) => {
    const abrir = () => {
      container.querySelectorAll('.ped-item').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      abrirPedido(el.dataset.id);
    };
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
        e.preventDefault();
        abrir();
      }
    });
  });
  container.querySelectorAll('[data-lineas]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.ped-item');
      const on = item.classList.toggle('lineas-on');
      btn.setAttribute('aria-expanded', String(on));
      btn.textContent = on ? '⌃' : '⌄';
    });
  });
  if (!document.querySelector('.ped-item.active')) abrirPedido(pedidos[0].id);
}

let pedidoAbierto = null;

async function abrirPedido(id) {
  pedidoAbierto = id;
  desarmarPago();
  document.querySelectorAll('.ped-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  const detail = document.getElementById('pedidoDetail');
  const actual = pedidos.find((c) => c.id === id);
  if (!actual) {
    detail.innerHTML = '<div class="detail-empty">Pedido no encontrado.</div>';
    return;
  }
  detail.innerHTML = `
    <div class="ped-detail-head">
      <div>
        <h3>${esc(actual.nombre || 'Cliente')}</h3>
        <p class="hint" style="margin:0">${esc(actual.telefono)}</p>
      </div>
      <span class="badge ped-${ESTADO_CLASS[actual.estado] || 'ped-activo'}">${ESTADO_LABEL[actual.estado] || esc(actual.estado)}</span>
    </div>
    <div class="ped-detail-meta">
      <span>Actualizado ${formatDate(actual.actualizado_en)}</span>
      <span>${esc(actual.num_items)} artículos</span>
    </div>
    <ul class="ped-lista">
      ${(actual.lineas || [])
        .map(
          (l) => `<li>
            <div>
              <strong>${esc(l.nombre)}</strong>
              <span>${esc(l.cantidad)} × ${formatCurrency(l.precio_unitario)}</span>
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
      <button type="button" class="primary" data-pagar="${esc(actual.id)}">Marcar como pagado</button>
    </div>
    <p id="pedidoStatus" class="status" hidden></p>`;
  const pagarBtn = detail.querySelector('[data-pagar]');
  if (pagarBtn) pagarBtn.addEventListener('click', () => confirmarPagar(actual.id, pagarBtn));
}

let pagarArmed = false;
let pagarArmTimer = null;

function desarmarPago() {
  pagarArmed = false;
  if (pagarArmTimer) clearTimeout(pagarArmTimer);
  pagarArmTimer = null;
}

function confirmarPagar(id, btn) {
  if (!pagarArmed) {
    const originalLabel = btn.textContent;
    pagarArmed = true;
    btn.textContent = '¿Confirmar pago? Clic de nuevo';
    btn.classList.add('confirming');
    pagarArmTimer = setTimeout(() => {
      pagarArmed = false;
      btn.textContent = originalLabel;
      btn.classList.remove('confirming');
    }, 4000);
    return;
  }
  desarmarPago();
  btn.classList.remove('confirming');
  btn.textContent = 'Procesando…';
  pagarPedido(id, btn);
}

async function pagarPedido(id, btn) {
  const status = document.getElementById('pedidoStatus');
  if (status) status.hidden = true;
  try {
    const res = await api(`/api/carritos/${id}/pagar`, { method: 'POST' });
    setStatus('pedidoStatus', true, `${res.mensaje} — ${res.num_lineas} líneas, ${formatCurrency(res.total)}`);
    setTimeout(() => {
      pedidoAbierto = null;
      desarmarPago();
      loadPedidos();
      loadResumenVentas();
      loadProductos();
    }, 1200);
  } catch (err) {
    if (btn) {
      btn.classList.remove('confirming');
      btn.textContent = 'Marcar como pagado';
    }
    setStatus('pedidoStatus', false, err.message);
  }
}

/* ---------- Gestiones: consultar / registrar cliente ---------- */
let perfilIdentidadTelefono = null;

function renderPerfil(cliente) {
  const perfil = document.getElementById('perfilCliente');
  document.getElementById('perfilAvatar').textContent = initials(cliente.nombre);
  document.getElementById('perfilNombre').value = cliente.nombre || '';
  perfilIdentidadTelefono = cliente.telefono;
  const telInput = document.getElementById('perfilTelefono');
  telInput.value = cliente.telefono;
  const cedulaInput = document.getElementById('perfilCedula');
  cedulaInput.value = cliente.cedula || '';
  cedulaInput.disabled = Boolean(cliente.cedula);
  document.getElementById('perfilEdad').value = cliente.edad ?? '';

  const fecha = cliente.fecha_registro
    ? new Date(cliente.fecha_registro).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  document.getElementById('perfilFecha').textContent = fecha;
  document.getElementById('perfilHabitos').textContent = cliente.habitos_consumo || '—';

  const estado = Array.isArray(cliente.estado_chat) ? cliente.estado_chat[0] : cliente.estado_chat;
  const select = document.getElementById('perfilEstado');
  const est = estado?.estado || 'bot_activo';
  select.value = ['bot_activo', 'esperando_operador', 'humano_activo'].includes(est) ? est : 'bot_activo';

  const tipo = cliente.tipo === 'cliente' ? 'cliente' : 'lead';
  const badge = document.getElementById('perfilTipo');
  badge.textContent = tipo === 'cliente' ? 'Cliente' : 'Lead';
  badge.className = `perfil-tipo ${tipo}`;

  perfil.hidden = false;
  cargarRecomendaciones(cliente);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

async function cargarRecomendaciones(cliente) {
  const box = document.getElementById('recomendacionesBox');
  const lista = document.getElementById('recomendacionesLista');
  const status = document.getElementById('recomendacionesStatus');
  if (!box) return;
  try {
    const ident = String(cliente.cedula || cliente.telefono || '').trim();
    if (!ident) {
      box.hidden = true;
      return;
    }
    lista.innerHTML = '<li class="reco-item">Cargando recomendaciones…</li>';
    box.hidden = false;
    const { recomendaciones } = await api(`/api/clientes/${encodeURIComponent(ident)}/recomendaciones`);
    if (!Array.isArray(recomendaciones) || !recomendaciones.length) {
      lista.innerHTML = '<li class="reco-item">Todavía no hay recomendaciones para este cliente.</li>';
      status.hidden = true;
      return;
    }
    lista.innerHTML = recomendaciones
      .map(
        (r) => `<li class="reco-item">
          <span class="reco-etiqueta">${esc(r.etiqueta)}</span>
          <strong>${esc(r.nombre)}</strong>
          <span class="reco-precio">${formatCurrency(r.precio)}</span>
          <span class="reco-motivo">${esc(r.motivo || '')}</span>
        </li>`
      )
      .join('');
    status.hidden = true;
  } catch (err) {
    lista.innerHTML = '';
    status.hidden = false;
    status.className = 'status';
    status.textContent = err.message;
  }
}

async function guardarPerfil() {
  const status = document.getElementById('perfilStatus');
  status.hidden = false;
  status.className = 'status';
  status.textContent = 'Guardando…';
  try {
    const telefonoNuevo = document.getElementById('perfilTelefono').value.trim();
    const telefonoFinal = telefonoNuevo || perfilIdentidadTelefono;
    const edadRaw = document.getElementById('perfilEdad').value.trim();
    const cedulaRaw = document.getElementById('perfilCedula').value.trim();
    await api('/api/clientes', {
      method: 'PUT',
      body: JSON.stringify({
        telefono: perfilIdentidadTelefono,
        ...(telefonoNuevo && telefonoNuevo !== perfilIdentidadTelefono ? { telefono_nuevo: telefonoNuevo } : {}),
        nombre: document.getElementById('perfilNombre').value.trim(),
        edad: edadRaw === '' ? null : Number(edadRaw),
        ...(cedulaRaw ? { cedula: cedulaRaw } : {}),
      }),
    });
    await api(`/api/estado-chat/${encodeURIComponent(telefonoFinal)}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: document.getElementById('perfilEstado').value }),
    });
    setStatus('perfilStatus', true, 'Perfil actualizado.');
    const exact = await api(`/api/clientes/${encodeURIComponent(telefonoFinal)}`);
    renderPerfil(exact.cliente);
  } catch (err) {
    setStatus('perfilStatus', false, err.message);
  }
}

document.getElementById('btnGuardarPerfil').addEventListener('click', guardarPerfil);

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
    setStatus('consultaStatus', false, 'Introduce un teléfono, cédula o nombre.');
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
  const sugerencias = document.getElementById('consultaSugerencias');
  if (sugerencias) sugerencias.hidden = true;
  buscarCliente(document.getElementById('consultaCliente').value);
});

/* ---------- Sugerencias de búsqueda de cliente ---------- */
const inputConsulta = document.getElementById('consultaCliente');
const sugerenciasBox = document.getElementById('consultaSugerencias');
let sugerenciasTimer = null;

if (inputConsulta && sugerenciasBox) {
  inputConsulta.addEventListener('input', () => {
    clearTimeout(sugerenciasTimer);
    const term = inputConsulta.value.trim();
    if (term.length < 2 || !hasKey()) { sugerenciasBox.hidden = true; return; }
    sugerenciasTimer = setTimeout(() => loadSugerencias(term), 250);
  });
  inputConsulta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sugerenciasBox.hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (sugerenciasBox.hidden) return;
    if (!sugerenciasBox.contains(e.target) && e.target !== inputConsulta) sugerenciasBox.hidden = true;
  });
}

async function loadSugerencias(term) {
  try {
    const { clientes } = await api(`/api/clientes?q=${encodeURIComponent(term)}`);
    const lista = (clientes || []).slice(0, 6);
    if (!lista.length) { sugerenciasBox.hidden = true; return; }
    sugerenciasBox.innerHTML = lista
      .map(
        (c) => `<button type="button" class="sug-item" data-nombre="${esc(c.nombre || '')}" data-tel="${esc(c.telefono || '')}">
          <strong>${esc(c.nombre || 'Sin nombre')}</strong>
          <span>${esc(c.telefono || '')}</span>
        </button>`
      )
      .join('');
    sugerenciasBox.hidden = false;
    sugerenciasBox.querySelectorAll('.sug-item').forEach((b) => {
      b.addEventListener('click', () => {
        inputConsulta.value = b.dataset.nombre || b.dataset.tel;
        sugerenciasBox.hidden = true;
        buscarCliente(b.dataset.tel || b.dataset.nombre);
      });
    });
  } catch (err) {
    sugerenciasBox.hidden = true;
  }
}

/* ---------- Conversaciones ---------- */
let conversaciones = [];
let conversacionCategoria = 'abierta';
const CAT_LABEL = { bot_activo: 'IA', esperando_operador: 'Transferida', humano_activo: 'Atendida' };

async function loadConversaciones() {
  const container = document.getElementById('listaConversaciones');
  if (!hasKey()) {
    container.innerHTML = '<div class="empty">Introduce la clave API para cargar.</div>';
    return;
  }
  if (!conversaciones.length) {
    container.innerHTML = '<div class="empty">Cargando…</div>';
  }
  try {
    const data = await api('/api/bot/conversaciones');
    conversaciones = data.conversaciones || [];
    renderConversaciones('');
  } catch (err) {
    if (!conversaciones.length) {
      container.innerHTML = `<div class="empty">${err.message}</div>`;
    }
  }
}

function renderConversaciones(filter) {
  const container = document.getElementById('listaConversaciones');
  const f = (filter || '').toLowerCase();

  const cntA = document.getElementById('cntAbiertas');
  const cntC = document.getElementById('cntCerradas');
  if (cntA) cntA.textContent = conversaciones.filter((c) => c.categoria !== 'cerrada').length;
  if (cntC) cntC.textContent = conversaciones.filter((c) => c.categoria === 'cerrada').length;

  const badge = document.getElementById('navHandoff');
  if (badge) {
    const pendientes = conversaciones.filter((c) => c.estado === 'esperando_operador').length;
    badge.hidden = pendientes === 0;
    badge.textContent = pendientes;
  }

  const items = conversaciones.filter((c) => {
    if (c.categoria !== conversacionCategoria) return false;
    return String(c.nombre || '').toLowerCase().includes(f) || String(c.telefono || '').includes(f);
  });

  let html;
  if (!items.length) {
    const msg = conversaciones.length
      ? (conversacionCategoria === 'cerrada'
        ? 'Sin conversaciones cerradas'
        : (f ? 'Sin resultados' : 'Sin conversaciones abiertas'))
      : 'Introduce la clave API para cargar.';
    html = '<div class="empty">' + msg + '</div>';
  } else {
    html = items.map((c) => {
      const sel = conversacionAbierta && conversacionAbierta.telefono === c.telefono ? ' selected' : '';
      return '<div class="conv-item' + sel + '" role="button" tabindex="0" data-tel="' + esc(c.telefono) + '">'
        + '<div class="avatar">' + initials(c.nombre) + '</div>'
        + '<div class="conv-info">'
        + '<div class="conv-top">'
        + '<span class="conv-name">' + esc(c.nombre) + '</span>'
        + '<span class="conv-time">' + formatTime(c.ultima_actualizacion) + '</span>'
        + '</div>'
        + '<div class="conv-msg">' + esc(c.ultimo_mensaje || '').replace(/\n/g, ' ') + '</div>'
        + '<div class="conv-badges"><span class="tag tag-' + esc(c.estado) + '">' + (CAT_LABEL[c.estado] || esc(c.estado)) + '</span></div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  if (container.innerHTML === html) return;

  container.innerHTML = html;

  container.querySelectorAll('.conv-item').forEach((el) => {
    const abrir = () => {
      container.querySelectorAll('.conv-item').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      const conv = conversaciones.find((c) => c.telefono === el.dataset.tel);
      if (conv) abrirConversacion(conv);
    };
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  });
}

let conversacionAbierta = null;

function buildMensajesHtml(mensajes) {
  if (!mensajes || !mensajes.length) return '<div class="empty">Sin mensajes</div>';
  return mensajes
    .map((m) => {
      const autor = m.rol === 'operador' ? 'Operador' : m.rol === 'usuario' ? 'Cliente' : 'IA';
      const rolClass = m.rol === 'usuario' ? 'usuario' : m.rol === 'operador' ? 'operador' : 'asistente';
      return `<div class="msg-row ${rolClass}">
        <div>
          <div class="bubble">${esc(m.contenido).replace(/\n/g, '<br/>')}</div>
          <div class="msg-meta">${autor} · ${esc(m.canal)} · ${formatDate(m.created_at)}</div>
        </div>
      </div>`;
    })
    .join('');
}

function buildAccionesArea(conv) {
  const estado = conv.estado || 'bot_activo';
  const motivo = conv.motivo_handoff ? `<p class="hint">Motivo: ${esc(conv.motivo_handoff)}</p>` : '';
  if (estado === 'humano_activo') {
    return `
      <div class="handoff-bar">
        <p class="hint">💬 Estás atendiendo este chat. El bot está en pausa: tú respondes al cliente.</p>
        <button class="ghost" data-reanudar="${conv.telefono}">Devolver al bot</button>
      </div>`;
  }
  if (estado === 'esperando_operador') {
    return `
      <div class="handoff-bar">
        <p class="hint">⏳ Handoff activo — este chat necesita atención humana.</p>
        ${motivo}
        <button class="primary" data-tomar="${conv.telefono}">Atender</button>
      </div>`;
  }
  return `
    <div class="handoff-bar">
      <p class="hint">🤖 Bot activo — puedes tomar el chat cuando quieras para responder tú.</p>
      <button class="primary" data-tomar="${conv.telefono}">Atender (pausar bot)</button>
    </div>`;
}

function bindConversacionActions(detail, conv) {
  const tomarBtn = detail.querySelector('[data-tomar]');
  if (tomarBtn) tomarBtn.addEventListener('click', () => cambiarEstado(conv.telefono, 'humano_activo'));
  const reanudarBtn = detail.querySelector('[data-reanudar]');
  if (reanudarBtn) reanudarBtn.addEventListener('click', () => cambiarEstado(conv.telefono, 'bot_activo'));
  const sendBtn = detail.querySelector('#operatorSendBtn');
  const input = detail.querySelector('#operatorMsgInput');
  if (sendBtn && input) {
    const enviar = () => enviarOperador(conv.telefono, input, conv);
    sendBtn.addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
  }
}

async function abrirConversacion(conv) {
  const detail = document.getElementById('conversacionDetail');
  conversacionAbierta = { telefono: conv.telefono };

  const estadoLabel = {
    bot_activo: 'Bot activo',
    esperando_operador: 'Esperando operador',
    humano_activo: 'Operador activo',
  };

  detail.innerHTML = `
    <div class="detail-head">
      <div class="chat-avatar">${initials(conv.nombre)}</div>
      <div class="detail-head-info">
        <div class="detail-title">${esc(conv.nombre)}</div>
        <div class="detail-sub" id="detEstadoSub">${estadoLabel[conv.estado] || esc(conv.estado)}</div>
      </div>
      <span class="tag tag-${esc(conv.estado)}" id="detEstadoTag">${CAT_LABEL[conv.estado] || esc(conv.estado)}</span>
    </div>
    <div class="chat-wall" id="chatMensajes"></div>
    <div id="accionesArea">${buildAccionesArea(conv)}</div>
    <div class="operator-bar">
      <input id="operatorMsgInput" type="text" placeholder="Escribe una respuesta al cliente…" autocomplete="off" />
      <button class="primary" id="operatorSendBtn">Enviar</button>
    </div>
    <p id="convStatus" class="status" hidden></p>`;

  const chatEl = detail.querySelector('#chatMensajes');
  chatEl.innerHTML = buildMensajesHtml(conv.mensajes);
  chatEl.scrollTop = chatEl.scrollHeight;

  bindConversacionActions(detail, conv);
}

function refrescarAccionesYEstado(detail, data) {
  const estadoLabel = {
    bot_activo: 'Bot activo',
    esperando_operador: 'Esperando operador',
    humano_activo: 'Operador activo',
  };
  const tag = detail.querySelector('#detEstadoTag');
  if (tag) {
    const lbl = estadoLabel[data.estado] || data.estado;
    if (tag.textContent !== (CAT_LABEL[data.estado] || data.estado)) tag.textContent = CAT_LABEL[data.estado] || data.estado;
    tag.className = 'tag tag-' + data.estado;
  }
  const sub = detail.querySelector('#detEstadoSub');
  if (sub) sub.textContent = estadoLabel[data.estado] || data.estado;
  const acciones = detail.querySelector('#accionesArea');
  if (acciones) {
    const html = buildAccionesArea(data);
    if (acciones.innerHTML !== html) {
      acciones.innerHTML = html;
      bindConversacionActions(detail, data);
    }
  }
}

async function refreshConversacionAbierta() {
  if (!conversacionAbierta) return;
  const telefono = conversacionAbierta.telefono;
  try {
    const data = await api(`/api/bot/conversaciones/${encodeURIComponent(telefono)}`);
    const listConv = conversaciones.find((c) => c.telefono === data.telefono);
    if (listConv) {
      listConv.estado = data.estado;
      listConv.motivo_handoff = data.motivo_handoff;
      const ultimo = data.mensajes && data.mensajes.length ? data.mensajes[data.mensajes.length - 1] : null;
      if (ultimo) {
        listConv.ultimo_mensaje = ultimo.contenido;
        listConv.ultimo_rol = ultimo.rol;
        listConv.ultima_actualizacion = ultimo.created_at;
      }
    }
    renderConversaciones(document.getElementById('buscarConv')?.value || '');

    const detail = document.getElementById('conversacionDetail');
    const chatEl = detail.querySelector('#chatMensajes');
    if (chatEl) {
      const html = buildMensajesHtml(data.mensajes);
      if (chatEl.innerHTML !== html) {
        const cercaDeAbajo = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
        chatEl.innerHTML = html;
        if (cercaDeAbajo) chatEl.scrollTop = chatEl.scrollHeight;
      }
    }
    refrescarAccionesYEstado(detail, data);
  } catch (err) {
    // Ignorar fallos de refresco: el próximo poll reintentará.
  }
}

async function cambiarEstado(telefono, estado) {
  try {
    await api(`/api/bot/estado-chat/${encodeURIComponent(telefono)}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    });
    const conv = conversaciones.find((c) => c.telefono === telefono);
    if (conv) {
      conv.estado = estado;
      conv.motivo_handoff = estado === 'bot_activo' ? null : conv.motivo_handoff;
      abrirConversacion(conv);
    }
    renderConversaciones(document.getElementById('buscarConv')?.value || '');
  } catch (err) {
    setStatus('convStatus', false, err.message);
  }
}

async function enviarOperador(telefono, input, conv) {
  const texto = input.value.trim();
  if (!texto) return;
  input.disabled = true;
  try {
    const res = await api('/api/bot/mensajes', {
      method: 'POST',
      body: JSON.stringify({ telefono, texto }),
    });
    conv.mensajes.push({ rol: 'operador', contenido: texto, canal: 'whatsapp', created_at: new Date().toISOString() });
    conv.estado = res.estado || 'humano_activo';
    conv.motivo_handoff = null;
    input.value = '';
    const detail = document.getElementById('conversacionDetail');
    const chatEl = detail.querySelector('#chatMensajes');
    if (chatEl) {
      chatEl.innerHTML = buildMensajesHtml(conv.mensajes);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    refrescarAccionesYEstado(detail, conv);
    renderConversaciones(document.getElementById('buscarConv')?.value || '');
  } catch (err) {
    setStatus('convStatus', false, err.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

document.getElementById('buscarConv').addEventListener('input', (e) => {
  renderConversaciones(e.target.value);
});

document.querySelectorAll('.conv-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    conversacionCategoria = tab.dataset.cat === 'cerrada' ? 'cerrada' : 'abierta';
    document.querySelectorAll('.conv-tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderConversaciones(document.getElementById('buscarConv')?.value || '');
  });
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

function nowHHMM() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function appendChat(rol, text) {
  const hist = document.getElementById('chatHistory');
  const div = document.createElement('div');
  div.className = rol === 'usuario' ? 'chat-user' : 'chat-bot';
  const body = document.createElement('div');
  body.textContent = text;
  div.appendChild(body);
  const time = document.createElement('span');
  time.className = 'chat-time';
  time.textContent = nowHHMM();
  div.appendChild(time);
  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
}

function appendTyping() {
  const hist = document.getElementById('chatHistory');
  const div = document.createElement('div');
  div.className = 'chat-bot typing';
  div.setAttribute('aria-label', 'FarmaBot está escribiendo…');
  div.innerHTML = '<span></span><span></span><span></span>';
  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
  return div;
}

function focusTestInput() {
  const input = document.querySelector('#formTest [name="texto"]');
  if (input) input.focus();
}

const btnReiniciarTest = document.getElementById('btnReiniciarTest');
if (btnReiniciarTest) {
  btnReiniciarTest.addEventListener('click', () => {
    document.getElementById('chatHistory').innerHTML =
      '<div class="chat-bot"><div>¡Hola! Soy FarmaBot, tu farmacéutico virtual. ¿En qué puedo ayudarte? 🌿</div></div>';
    document.getElementById('testStatus').hidden = true;
    focusTestInput();
  });
}

document.getElementById('formTest').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.querySelector('[name="texto"]');
  const telefonoInput = document.getElementById('testTelefono');
  const telefono = telefonoInput ? telefonoInput.value.trim() : '+34900000000';
  const texto = input.value.trim();
  if (!texto) return;

  input.value = '';
  appendChat('usuario', texto);
  const typing = appendTyping();

  try {
    const res = await api('/api/bot/test', {
      method: 'POST',
      body: JSON.stringify({ telefono, texto }),
    });
    typing.remove();
    appendChat('asistente', res.respuesta);
    document.getElementById('testStatus').hidden = true;
  } catch (err) {
    typing.remove();
    document.getElementById('testStatus').hidden = false;
    setStatus('testStatus', false, err.message);
  } finally {
    focusTestInput();
  }
});

/* ---------- Configuración ---------- */
const formConfigEl = document.getElementById('formConfig');
const promptTextarea = document.getElementById('systemPrompt');
const promptCount = document.getElementById('promptCount');

if (promptTextarea && promptCount) {
  const actualizarPromptCount = () => { promptCount.textContent = `${promptTextarea.value.length} caracteres`; };
  promptTextarea.addEventListener('input', actualizarPromptCount);
  actualizarPromptCount();
}

if (formConfigEl) {
  formConfigEl.querySelectorAll('input, textarea').forEach((el) => {
    el.addEventListener('input', () => {
      configDirty = true;
      const statusEl = formConfigEl.querySelector('#configStatus');
      if (statusEl) statusEl.hidden = true;
    });
  });
  formConfigEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const adminKey = fd.get('admin_key')?.toString().trim() || '';
    try {
      if (!adminKey) throw new Error('Escribe tu clave de administrador para guardar.');
      const { config } = await api('/api/bot/config', {
        method: 'PUT',
        headers: { 'x-admin-key': adminKey },
        body: JSON.stringify({
          bot_nombre: fd.get('bot_nombre'),
          temperatura: fd.get('temperatura'),
          system_prompt: fd.get('system_prompt'),
        }),
      });
      configDirty = false;
      formConfigEl.querySelector('[name="admin_key"]').value = '';
      setStatus('configStatus', true, `Configuración de "${esc(config.bot_nombre)}" guardada ✓`);
    } catch (err) {
      setStatus('configStatus', false, err.message);
    }
  });
}

/* ---------- Formularios Dashboard ---------- */
document.querySelector('#formCliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const { cliente } = await api('/api/clientes', {
      method: 'PUT',
      body: JSON.stringify({
        telefono: fd.get('telefono'),
        cedula: fd.get('cedula') || undefined,
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

const btnLimpiarProd = document.getElementById('btnLimpiarProd');
if (btnLimpiarProd) btnLimpiarProd.addEventListener('click', () => {
  document.getElementById('buscarProducto').value = '';
  filtroProductos();
  document.getElementById('buscarProducto').focus();
});

const chkSoloAgotados = document.getElementById('soloAgotados');
if (chkSoloAgotados) chkSoloAgotados.addEventListener('change', filtroProductos);

/* ---------- Atajos de teclado ---------- */
let pendingG = false;

document.addEventListener('keydown', (e) => {
  const act = document.activeElement;
  const tag = act ? act.tagName : '';
  const escribiendo = tag === 'INPUT' || tag === 'TEXTAREA' || (act && act.isContentEditable);

  if (e.key === '/' && !escribiendo) {
    e.preventDefault();
    const visible = document.querySelector('.view:not(.hidden)');
    const objetivo = visible ? visible.querySelector('.search-box input, .row-search input') : null;
    if (objetivo) objetivo.focus();
    return;
  }

  if (e.key.toLowerCase() === 'g' && !escribiendo) {
    pendingG = true;
    return;
  }

  if (pendingG && !escribiendo && e.key !== 'Shift' && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Alt') {
    const mapa = { d: 'dashboard', p: 'pedidos', c: 'conversaciones', t: 'test', s: 'configuracion' };
    const destino = mapa[e.key.toLowerCase()];
    pendingG = false;
    if (destino) showView(destino);
    return;
  }

  if (e.key === 'Escape') {
    pendingG = false;
    const sug = document.getElementById('consultaSugerencias');
    if (sug) sug.hidden = true;
  }
});
