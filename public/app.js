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

function updateKeyHint() {
  const hint = document.getElementById('noKeyHint');
  if (!hint) return;
  hint.hidden = apiKeyInput.value.trim() !== '';
  if (!hint.hidden) {
    hint.textContent = 'Introduce la clave API (MOSTRADOR_API_KEY) para cargar los datos del panel.';
  }
}

apiKeyInput.addEventListener('input', updateKeyHint);
updateKeyHint();

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
  if (!el) return;
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

function avatarClass(name) {
  const s = String(name || '').trim();
  if (!s) return 'avatar-bg-1';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'avatar-bg-' + (h % 6 + 1);
}

function toast(msg, tipo = 'ok', opts = {}) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  const texto = document.createElement('span');
  texto.className = 'toast-msg';
  texto.textContent = msg;
  el.appendChild(texto);

  /* Deshacer: el botón vive mientras el toast (5 s en vez de 3,5 s) y ejecuta
     la acción inversa. Desactiva sus propios timers antes de correr, para que
     el deshacer no dispare otro toast encima. */
  let timer = null;
  const cerrar = () => {
    if (timer) clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  };
  if (opts.deshacer) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo';
    btn.textContent = 'Deshacer';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      cerrar();
      try {
        const r = opts.deshacer();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (e) {}
    });
    el.appendChild(btn);
  }

  wrap.appendChild(el);
  timer = setTimeout(cerrar, opts.deshacer ? 5000 : 3500);
}

function setSync(ok, texto) {
  const pill = document.getElementById('syncStatus');
  if (!pill) return;
  pill.classList.toggle('ok', ok);
  pill.classList.toggle('err', !ok);
  const t = document.getElementById('syncText');
  if (t) t.textContent = texto;
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

/* ---------- #V24: estado de vista en la URL ---------- */
function hashVista() {
  const m = /^#\/([\w-]+)(?:\/(.+))?$/.exec(location.hash || '');
  if (!m) return { vista: null, id: null };
  return { vista: m[1], id: m[2] ? decodeURIComponent(m[2]) : null };
}

/* Último hash escrito por la propia app: distingue nuestra escritura
   (replaceState no dispara hashchange, pero el back/forward sí) de la del usuario. */
let hashPropio = location.hash;

function escribirHash(vista, id) {
  const destino = id ? `#/${vista}/${encodeURIComponent(id)}` : `#/${vista}`;
  if (location.hash === destino) return;
  history.replaceState(null, '', destino);
  hashPropio = destino;
}

/* Solo deja la URL sincronizada si esa vista es la visible: así la carga
   inicial (que abre el primer pedido en segundo plano) no pisa el hash. */
function escribirHashSiVisible(vista, id) {
  const v = document.getElementById(`view-${vista}`);
  if (v && !v.classList.contains('hidden')) escribirHash(vista, id);
}

function showView(name, opciones) {
  const soloHash = opciones && opciones.soloHash;
  if (name === 'configuracion' && configDirty &&
      !window.confirm('Tienes cambios sin guardar en Configuración. ¿Descargar la configuración guardada de todos modos?')) {
    return;
  }
  for (const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  setNavActive(name);
  if (!soloHash) escribirHash(name);

  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }

  if (name === 'dashboard') loadResumenVentas();
  if (name === 'pedidos') loadPedidos();
  if (name === 'conversaciones') schedulePoll();
  if (name === 'configuracion') loadConfig();
  if (name === 'fidelizacion') loadFidelizacion();
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
const CANAL_COLOR = { mostrador: '#e06b45', whatsapp: '#00a884', otros: '#8b5cf6' };

function abbrIngresos(n) {
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' Bs';
}

function dibujarDonut(porCanal) {
  const segG = document.getElementById('donutSegments');
  const leg = document.getElementById('donutLegend');
  const total = document.getElementById('donutTotal');
  if (!segG || !leg || !total) return;
  const canales = Object.entries(porCanal || {}).filter(([, v]) => Number(v?.ingresos) > 0);
  if (!canales.length) {
    leg.innerHTML = '<li>Sin datos</li>';
    total.textContent = '—';
    return;
  }
  const suma = canales.reduce((a, [, v]) => a + Number(v.ingresos), 0);
  const C = 2 * Math.PI * 15.9;
  const NOMBRES = { mostrador: 'Mostrador', whatsapp: 'WhatsApp' };
  let offset = 0;
  segG.innerHTML = '';
  leg.innerHTML = '';
  canales.forEach(([k, v]) => {
    const frac = Number(v.ingresos) / suma;
    const color = CANAL_COLOR[k] || CANAL_COLOR.otros;
    const seg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    seg.setAttribute('cx', 21);
    seg.setAttribute('cy', 21);
    seg.setAttribute('r', 15.9);
    seg.setAttribute('class', 'donut-seg');
    seg.setAttribute('stroke', color);
    seg.setAttribute('stroke-dasharray', `${frac * C} ${C}`);
    seg.setAttribute('stroke-dashoffset', String(-offset));
    seg.setAttribute('transform', 'rotate(-90 21 21)');
    segG.appendChild(seg);
    offset += frac * C;
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${NOMBRES[k] || k}</span><span class="lg-val">${formatCurrency(v.ingresos)}</span>`;
    leg.appendChild(li);
  });
  total.textContent = abbrIngresos(suma);
}

async function dibujarSparkline() {
  const svg = document.getElementById('sparkSvg');
  if (!svg) return;
  try {
    const { ventas } = await api('/api/ventas?limite=200');
    const lista = Array.isArray(ventas) ? ventas : [];
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    const inicio = new Date(hoy.getTime() - 6 * 86400000);
    inicio.setHours(0, 0, 0, 0);
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      dias.push({ d, total: 0 });
    }
    lista.forEach((v) => {
      const t = new Date(v.created_at || v.creada_en);
      if (isNaN(t) || t < inicio || t > hoy) return;
      const idx = Math.floor((t - inicio) / 86400000);
      if (dias[idx]) dias[idx].total += Number(v.total || 0);
    });
    const max = Math.max(...dias.map((d) => d.total), 1);
    const W = 220, H = 48, pad = 4;
    const pts = dias.map((d, i) => {
      const x = pad + (i / (dias.length - 1 || 1)) * (W - pad * 2);
      const y = H - pad - (d.total / max) * (H - pad * 2);
      return [x, y];
    });
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = 'M' + pts[0][0].toFixed(1) + ' ' + (H - pad) + ' L' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pad) + ' Z';
    svg.innerHTML = `<path class="spark-area" d="${area}"></path><path class="spark-line" d="${line}"></path>`;
  } catch (e) {
    /* Mini-gráfica sin datos: se queda vacía. */
  }
}

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
    dibujarDonut(data.por_canal);
    dibujarSparkline();
    setSync(true, 'Conectado · ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
  } catch (err) {
    document.getElementById('resIngresos').textContent = 'Error';
    setSync(false, 'Sin conexión');
  } finally {
    ids.forEach((id) => document.getElementById(id).classList.remove('skeleton'));
  }
}

/* ---------- Productos ---------- */
let productos = [];
let pedidos = [];

const PROD_PAGE = 50;
let prodMostrados = PROD_PAGE;

async function loadProductos() {
  const tbody = document.getElementById('tablaProductos');
  const count = document.getElementById('productosCount');
  if (!hasKey()) {
    tbody.innerHTML = '<tr><td colspan="5">Introduce la clave API.</td></tr>';
    if (count) count.textContent = '';
    return;
  }
  const skelFila = '<tr class="skel-row"><td><span class="sk-shimmer"></span></td><td><span class="sk-shimmer"></span></td><td><span class="sk-shimmer"></span></td><td><span class="sk-shimmer"></span></td><td></td></tr>';
  tbody.innerHTML = skelFila.repeat(3);
  try {
    const { productos: data } = await api('/api/productos?all=true');
    productos = data || [];
    prodMostrados = PROD_PAGE;
    filtroProductos();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">${err.message}</td></tr>`;
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
  const more = document.getElementById('prodMore');
  const moreInfo = document.getElementById('prodMoreInfo');

  let lista = productos.filter((p) => filaCoincide(p, term));
  const chkSolo = document.getElementById('soloAgotados');
  if (chkSolo && chkSolo.checked) lista = lista.filter((p) => Number(p.stock) === 0);

  if (count) count.textContent = productos.length ? `${lista.length} de ${productos.length} productos` : '';
  if (btnClear) btnClear.hidden = !term;

  const ocultarMas = () => {
    if (more) more.hidden = true;
    if (moreInfo) moreInfo.textContent = '';
  };

  if (!productos.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin productos registrados.</td></tr>';
    ocultarMas();
    return;
  }
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin coincidencias.</td></tr>';
    ocultarMas();
    return;
  }

  const visibles = lista.slice(0, prodMostrados);
  const faltan = lista.length - visibles.length;
  if (more) more.hidden = faltan <= 0;
  if (moreInfo) moreInfo.textContent = faltan > 0 ? `Mostrando ${visibles.length} de ${lista.length}` : '';

  const resaltar = (texto) => {
    const s = String(texto ?? '');
    if (!term) return esc(s);
    const i = s.toLowerCase().indexOf(term);
    if (i === -1) return esc(s);
    return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + term.length)) + '</mark>' + esc(s.slice(i + term.length));
  };
  const stockCls = (stock) => Number(stock) === 0 ? 'stock-0' : (Number(stock) <= 5 ? 'stock-bajo' : '');

  tbody.innerHTML = visibles
    .map(
      (p) => `<tr>
        <td>${resaltar(p.nombre)}</td>
        <td>${formatPrecio(p)}</td>
        <td class="${stockCls(p.stock)}">${esc(p.stock)}</td>
        <td><span class="badge badge-${p.activo ? 'mostrador' : 'inactivo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <div class="prod-acciones">
            <button type="button" class="minibtn" data-copiar="${esc(p.nombre)}" title="Copiar precio">Copiar</button>
            <button type="button" class="minibtn" data-cotizar="${esc(p.nombre)}" title="Copiar cita para WhatsApp">Cotizar</button>
          </div>
        </td>
      </tr>`
    )
    .join('');
}

function precioPlano(p) {
  const partes = [formatCurrency(Number(p.precio || 0))];
  if (p.precio_usd != null) partes.push(`$${Number(p.precio_usd).toFixed(2)}`);
  return partes.join(' / ');
}

function lineaCotizacion(p) {
  return `${p.nombre} — ${precioPlano(p)}. ¿Te lo dejamos reservado?`;
}

const btnMasProd = document.getElementById('btnMasProd');
if (btnMasProd) btnMasProd.addEventListener('click', () => {
  prodMostrados += PROD_PAGE;
  filtroProductos();
});

document.getElementById('tablaProductos').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-copiar], button[data-cotizar]');
  if (!btn) return;
  const nombre = btn.dataset.copiar || btn.dataset.cotizar;
  const prod = productos.find((p) => p.nombre === nombre);
  if (!prod) return;
  const texto = btn.dataset.cotizar ? lineaCotizacion(prod) : `${prod.nombre}: ${precioPlano(prod)}`;
  const ok = await copiarTexto(texto);
  if (ok) toast(btn.dataset.cotizar ? 'Cita copiada' : 'Precio copiado', 'ok');
  else toast('No se pudo copiar. Cópialo manualmente.', 'err');
});

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

/* #V26 · Fase B: transición de estados del carrito. `completado` NO se alcanza
   con PATCH sino con /pagar (crea la venta), así que solo se "avanza" hasta
   `pedido`. */
const ORDEN_ESTADOS_PEDIDO = ['activo', 'pendiente_confirmacion', 'pedido'];

function siguienteEstadoPedido(estado) {
  const i = ORDEN_ESTADOS_PEDIDO.indexOf(estado);
  return i >= 0 && i < ORDEN_ESTADOS_PEDIDO.length - 1 ? ORDEN_ESTADOS_PEDIDO[i + 1] : null;
}

function esEstadoTerminalPedido(estado) {
  return estado === 'completado' || estado === 'cancelado';
}

function botonesRapidosHtml(c) {
  if (esEstadoTerminalPedido(c.estado)) return '';
  const sig = siguienteEstadoPedido(c.estado);
  const id = esc(c.id);
  return `<div class="ped-quick">
    ${sig ? `<button type="button" class="qbtn" data-qa="avanzar" data-next="${esc(sig)}" data-id="${id}">${ESTADO_LABEL[sig]}</button>` : ''}
    <button type="button" class="qbtn" data-qa="pagar" data-id="${id}">Pagado</button>
    <button type="button" class="qbtn qbtn-danger" data-qa="cancelar" data-id="${id}">Cancelar</button>
  </div>`;
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
          <div class="avatar-sm ${avatarClass(c.nombre || c.telefono)}">${initials(c.nombre || c.telefono)}</div>
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
        ${botonesRapidosHtml(c)}
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
  container.querySelectorAll('[data-qa]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      accionRapidaPedido(btn);
    });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
  });

  /* Repinta sin arrastrar la selección al primer pedido (antes, cualquier
     re-render saltaba a pedidos[0] y perdías el que estabas viendo). */
  const activo = pedidoAbierto && container.querySelector(`.ped-item[data-id="${CSS.escape(pedidoAbierto)}"]`);
  if (activo) {
    container.querySelectorAll('.ped-item').forEach((el) => el.classList.toggle('active', el === activo));
  } else if (!container.querySelector('.ped-item.active')) {
    abrirPedido(pedidos[0].id);
  }
}

let pedidoAbierto = null;

async function abrirPedido(id) {
  pedidoAbierto = id;
  escribirHashSiVisible('pedidos', id);
  desarmarConfirmacion();
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
      ${esEstadoTerminalPedido(actual.estado)
        ? `<p class="hint" style="margin:0">Este pedido ya está cerrado (${esc(ESTADO_LABEL[actual.estado] || actual.estado)}).</p>`
        : `<button type="button" class="primary" data-pagar="${esc(actual.id)}">Marcar como pagado</button>`}
    </div>
    <p id="pedidoStatus" class="status" hidden></p>`;
  const pagarBtn = detail.querySelector('[data-pagar]');
  if (pagarBtn) {
    pagarBtn.addEventListener('click', () => {
      pedirConfirmacion(pagarBtn, '¿Confirmar pago? Clic de nuevo', () => {
        pagarBtn.textContent = 'Procesando…';
        pagarPedido(actual.id, pagarBtn);
      });
    });
  }
}

/* Solo un botón "armado" a la vez: el segundo clic ejecuta. Se reutiliza tanto
   en "Marcar como pagado" del detalle como en los botones por fila. */
let btnConfirmado = null;
let btnConfirmTimer = null;

function desarmarConfirmacion() {
  if (btnConfirmTimer) clearTimeout(btnConfirmTimer);
  btnConfirmTimer = null;
  if (btnConfirmado) {
    btnConfirmado.classList.remove('confirming');
    const original = btnConfirmado.dataset.labelOriginal;
    if (original) btnConfirmado.textContent = original;
  }
  btnConfirmado = null;
}

function pedirConfirmacion(btn, textoConfirm, ejecutar) {
  if (btnConfirmado === btn) {
    desarmarConfirmacion();
    ejecutar();
    return;
  }
  desarmarConfirmacion();
  btn.dataset.labelOriginal = btn.textContent;
  btnConfirmado = btn;
  btn.textContent = textoConfirm;
  btn.classList.add('confirming');
  btnConfirmTimer = setTimeout(desarmarConfirmacion, 4000);
}

async function pagarPedido(id, btn) {
  const status = document.getElementById('pedidoStatus');
  if (status) status.hidden = true;
  try {
    const res = await api(`/api/carritos/${id}/pagar`, { method: 'POST' });
    if (status) setStatus('pedidoStatus', true, `${res.mensaje} — ${res.num_lineas} líneas, ${formatCurrency(res.total)}`);
    toast(res.mensaje, 'ok');
    invalidarPedidosFicha();
    setTimeout(() => {
      pedidoAbierto = null;
      desarmarConfirmacion();
      loadPedidos();
      loadResumenVentas();
      loadProductos();
    }, 1200);
  } catch (err) {
    if (btn) {
      btn.classList.remove('confirming');
      btn.textContent = btn.dataset.labelOriginal || btn.textContent;
    }
    if (status) setStatus('pedidoStatus', false, err.message);
    toast(err.message, 'err');
  }
}

/* #V26 · Fase B: cambia el estado desde la lista (sin abrir el detalle) y deja
   el toast con "Deshacer" durante 5 s. El deshacer no ofrece el suyo. */
async function cambiarEstadoPedido(id, estado, conDeshacer = true) {
  const pedido = pedidos.find((c) => c.id === id);
  const previo = pedido ? pedido.estado : null;
  if (pedido && previo === estado) return;
  await api(`/api/carritos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  });
  if (pedido) pedido.estado = estado;
  invalidarPedidosFicha();
  renderPedidos();
  if (pedidoAbierto === id) abrirPedido(id);

  const etiqueta = ESTADO_LABEL[estado] || estado;
  if (conDeshacer && previo && previo !== estado) {
    toast(`Pedido ${etiqueta}`, 'ok', {
      deshacer: () => cambiarEstadoPedido(id, previo, false),
    });
  } else {
    toast(`Pedido ${etiqueta}`, 'ok');
  }
}

function accionRapidaPedido(btn) {
  const id = btn.dataset.id;
  const accion = btn.dataset.qa;
  const pedido = pedidos.find((c) => c.id === id);
  if (!pedido) return;

  if (accion === 'avanzar') {
    const sig = btn.dataset.next || siguienteEstadoPedido(pedido.estado);
    if (sig) cambiarEstadoPedido(id, sig).catch((err) => toast(err.message, 'err'));
    return;
  }
  if (accion === 'cancelar') {
    cambiarEstadoPedido(id, 'cancelado').catch((err) => toast(err.message, 'err'));
    return;
  }
  if (accion === 'pagar') {
    pedirConfirmacion(btn, '¿Confirmar pago?', () => {
      btn.textContent = 'Procesando…';
      pagarPedido(id, btn);
    });
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

/* ---------- #V24: helpers rápidos ---------- */
/* Puntuación 0..1 de un texto frente a una consulta. Admite varias palabras:
   todas deben coincidir en algún sitio ("crema facial") y el resultado es el
   más débil de los términos. */
function fuzzyScore(text, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 1;
  const t = String(text || '').toLowerCase();
  if (!t) return 0;

  let peor = 1;
  for (const termino of q.split(/\s+/).filter(Boolean)) {
    const s = fuzzyTermino(t, termino);
    if (s === 0) return 0;
    if (s < peor) peor = s;
  }
  return peor;
}

function fuzzyTermino(t, q) {
  const directo = t.indexOf(q);
  if (directo !== -1) {
    const pos = 1 - Math.min(directo / t.length, 0.5);
    return Math.min(1, 0.75 + pos * 0.25);
  }

  let ti = 0, qi = 0, runs = 0;
  while (qi < q.length && ti < t.length) {
    if (t[ti] === q[qi]) {
      if (ti === 0 || t[ti - 1] !== q[qi - 1]) runs++;
      qi++;
    }
    ti++;
  }
  if (qi !== q.length) return 0;

  /* Densidad: caracteres de la consulta sobre longitud del texto, con suelo
     del 18 % para que los nombres largos de catálogo no absorban la lista. */
  const densidad = q.length / t.length;
  if (densidad < 0.18) return 0;
  const premio = Math.min(1, runs / 2) * 0.15;
  return Math.min(0.74, densidad * 2.2 + premio);
}

async function copiarTexto(text) {
  const val = String(text ?? '').trim();
  if (!val) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try { await navigator.clipboard.writeText(val); return true; } catch (e) {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = val;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

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
    toast('Perfil actualizado', 'ok');
    const exact = await api(`/api/clientes/${encodeURIComponent(telefonoFinal)}`);
    renderPerfil(exact.cliente);
  } catch (err) {
    setStatus('perfilStatus', false, err.message);
    toast(err.message, 'err');
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
        + '<div class="avatar ' + avatarClass(c.nombre) + '">' + initials(c.nombre) + '</div>'
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
  /* Guard por nodo: refrescarAccionesYEstado se llama en cada poll y al
     cambiar de estado, y sin este flag el botón "Enviar" acumulaba un listener
     por cada refresco (mensaje duplicado). */
  const tomarBtn = detail.querySelector('[data-tomar]');
  if (tomarBtn && tomarBtn.dataset.bind !== '1') {
    tomarBtn.dataset.bind = '1';
    tomarBtn.addEventListener('click', () => cambiarEstado(conv.telefono, 'humano_activo'));
  }
  const reanudarBtn = detail.querySelector('[data-reanudar]');
  if (reanudarBtn && reanudarBtn.dataset.bind !== '1') {
    reanudarBtn.dataset.bind = '1';
    reanudarBtn.addEventListener('click', () => cambiarEstado(conv.telefono, 'bot_activo'));
  }
  const sendBtn = detail.querySelector('#operatorSendBtn');
  const input = detail.querySelector('#operatorMsgInput');
  if (sendBtn && input && sendBtn.dataset.bind !== '1') {
    sendBtn.dataset.bind = '1';
    const enviar = () => enviarOperador(conv.telefono, input, conv);
    sendBtn.addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
  }
}

async function abrirConversacion(conv) {
  const detail = document.getElementById('conversacionDetail');
  conversacionAbierta = { telefono: conv.telefono };
  escribirHashSiVisible('conversaciones', conv.telefono);

  const estadoLabel = {
    bot_activo: 'Bot activo',
    esperando_operador: 'Esperando operador',
    humano_activo: 'Operador activo',
  };

  detail.innerHTML = `
    <div class="detail-head">
      <div class="chat-avatar ${avatarClass(conv.nombre)}">${initials(conv.nombre)}</div>
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
  pintarFichaCliente(conv);
}

/* ============================================================
   #V26 · Fase B: ficha del cliente (3ª columna del inbox)
   ============================================================ */
let fichaToken = 0;
const fichaClientes = new Map(); // telefono -> cliente | 'sin-ficha'
let fichaCarritos = { ts: 0, datos: null };

function mismaPersona(a, b) {
  const x = String(a || '').replace(/\D/g, '');
  const y = String(b || '').replace(/\D/g, '');
  if (!x || !y) return false;
  return x === y || x.slice(-10) === y.slice(-10);
}

function invalidarPedidosFicha() {
  fichaCarritos = { ts: 0, datos: null };
}

/* Un solo viaje a /carritos para toda la sesión (60 s): la lista pesa N+1
   consultas en el servidor y cambiar de chat no debe volver a pagarlo. */
async function carritosFicha() {
  if (!fichaCarritos.datos || Date.now() - fichaCarritos.ts > 60000) {
    const data = await api('/api/carritos?cerrados=true');
    fichaCarritos = { ts: Date.now(), datos: (data && data.carritos) || [] };
  }
  return fichaCarritos.datos;
}

function fichaEstadoInternaHtml(conv) {
  const estado = conv.estado || 'bot_activo';
  return `<span class="tag tag-${esc(estado)}">${CAT_LABEL[estado] || esc(estado)}</span>
    ${conv.motivo_handoff ? `<p class="hint ficha-motivo">Motivo: ${esc(conv.motivo_handoff)}</p>` : ''}`;
}

function fichaAccionesInternaHtml(conv) {
  const estado = conv.estado || 'bot_activo';
  if (estado === 'humano_activo') {
    return '<button type="button" class="ghost" data-ficha="bot">Devolver al bot</button>';
  }
  if (estado === 'esperando_operador') {
    return '<button type="button" class="primary" data-ficha="atender">Atender</button>';
  }
  return '<button type="button" class="primary" data-ficha="atender">Atender (pausar bot)</button>';
}

function fichaPedidosInternaHtml(pedidos) {
  if (pedidos === null) return '<p class="ficha-vacio">No se pudieron cargar los pedidos.</p>';
  if (pedidos === undefined) return '<p class="ficha-vacio">Cargando pedidos…</p>';
  if (!pedidos.length) return '<p class="ficha-vacio">Sin pedidos registrados.</p>';
  return `<ul class="ficha-pedidos">${pedidos
    .map(
      (p) => `<li>
        <div class="fp-top">
          <span class="badge ped-${ESTADO_CLASS[p.estado] || 'ped-activo'}">${ESTADO_LABEL[p.estado] || esc(p.estado)}</span>
          <strong>${formatCurrency(p.total)}</strong>
        </div>
        <div class="fp-sub">${esc(p.num_items)} art. · ${formatDate(p.actualizado_en)}</div>
      </li>`
    )
    .join('')}</ul>`;
}

function fichaDatosInternaHtml(cliente) {
  if (!cliente) {
    return '<p class="ficha-vacio">Sin ficha registrada todavía.</p>';
  }
  const fecha = cliente.fecha_registro
    ? new Date(cliente.fecha_registro).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const filas = [
    ['Cédula', cliente.cedula || '—'],
    ['Edad', cliente.edad ?? '—'],
    ['Alta', fecha],
    ['Hábitos', cliente.habitos_consumo || '—'],
  ];
  return `<dl class="ficha-datos">${filas
    .map(([k, v]) => `<div class="fd-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join('')}</dl>`;
}

function fichaHtml(conv, cliente, pedidos, cargando) {
  const nombre = (cliente && cliente.nombre) || conv.nombre || 'Cliente';
  const tipo = cliente ? (cliente.tipo === 'cliente' ? 'cliente' : 'lead') : null;
  const pedidosBloque = pedidos === undefined
    ? (cargando ? undefined : null)
    : pedidos;
  return `
    <div class="ficha-scroll">
      <div class="ficha-head">
        <div class="avatar-lg ${avatarClass(nombre)}">${initials(nombre)}</div>
        <div class="ficha-nombre">${esc(nombre)}</div>
        <div class="ficha-tel">${esc(conv.telefono)}</div>
        ${tipo ? `<span class="perfil-tipo ${tipo}">${tipo === 'cliente' ? 'Cliente' : 'Lead'}</span>` : ''}
      </div>
      <div class="ficha-bloque">
        <h4 class="ficha-h">Estado</h4>
        <div id="fichaEstado" class="ficha-estado">${fichaEstadoInternaHtml(conv)}</div>
        <div id="fichaAcciones" class="ficha-acciones">${fichaAccionesInternaHtml(conv)}</div>
      </div>
      <div class="ficha-bloque">
        <h4 class="ficha-h">Datos</h4>
        ${cargando ? '<p class="ficha-vacio">Cargando…</p>' : fichaDatosInternaHtml(cliente)}
      </div>
      <div class="ficha-bloque">
        <h4 class="ficha-h">Pedidos recientes</h4>
        ${fichaPedidosInternaHtml(pedidosBloque)}
      </div>
    </div>`;
}

function bindFichaAcciones(ficha, conv) {
  ficha.querySelectorAll('[data-ficha]').forEach((btn) => {
    if (btn.dataset.bind === '1') return;
    btn.dataset.bind = '1';
    btn.addEventListener('click', () => {
      cambiarEstado(conv.telefono, btn.dataset.ficha === 'bot' ? 'bot_activo' : 'humano_activo').catch(() => {});
    });
  });
}

async function pintarFichaCliente(conv) {
  const ficha = document.getElementById('convFicha');
  if (!ficha) return;

  if (!conv) {
    ficha.dataset.tel = '';
    ficha.innerHTML = '<div class="detail-empty">Selecciona una conversación<br/><span class="sub">Aquí verás sus datos y pedidos</span></div>';
    return;
  }

  const token = ++fichaToken;
  ficha.dataset.tel = conv.telefono;

  const cacheado = fichaClientes.get(conv.telefono);
  const clienteCache = cacheado && cacheado !== 'sin-ficha' ? cacheado : null;
  ficha.innerHTML = fichaHtml(conv, clienteCache, undefined, true);
  bindFichaAcciones(ficha, conv);

  let cliente = cacheado;
  if (cliente === undefined) {
    try {
      const data = await api(`/api/clientes/${encodeURIComponent(conv.telefono)}`);
      cliente = data.cliente || 'sin-ficha';
    } catch (e) {
      cliente = 'sin-ficha';
    }
    fichaClientes.set(conv.telefono, cliente);
  }
  const clienteOk = cliente && cliente !== 'sin-ficha' ? cliente : null;

  let pedidos = null;
  try {
    const todos = await carritosFicha();
    pedidos = todos.filter((c) => mismaPersona(c.telefono, conv.telefono)).slice(0, 5);
  } catch (e) {
    pedidos = null;
  }

  if (token !== fichaToken) return; // el operador ya abrió otro chat
  ficha.innerHTML = fichaHtml(conv, clienteOk, pedidos, false);
  bindFichaAcciones(ficha, conv);
}

function refrescarFichaEstado(conv) {
  const ficha = document.getElementById('convFicha');
  if (!ficha || ficha.dataset.tel !== conv.telefono) return;
  const estado = ficha.querySelector('#fichaEstado');
  if (estado) estado.innerHTML = fichaEstadoInternaHtml(conv);
  const acciones = ficha.querySelector('#fichaAcciones');
  if (acciones) {
    acciones.innerHTML = fichaAccionesInternaHtml(conv);
    bindFichaAcciones(ficha, conv);
  }
}

function refrescarAccionesYEstado(detail, data) {
  if (!detail) return;
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
  refrescarFichaEstado(data);
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

const ETIQUETA_ESTADO_CHAT = {
  bot_activo: 'Bot activo',
  esperando_operador: 'Esperando operador',
  humano_activo: 'Operador activo',
};

async function cambiarEstado(telefono, estado, conDeshacer = true) {
  try {
    await api(`/api/bot/estado-chat/${encodeURIComponent(telefono)}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    });
    const conv = conversaciones.find((c) => c.telefono === telefono);
    const previo = conv ? conv.estado : null;
    if (conv) {
      conv.estado = estado;
      if (estado === 'bot_activo') conv.motivo_handoff = null;
    }

    /* Pinta solo lo que cambia: el scroll del chat y el foco del input
       se conservan (antes se reabría la conversación entera). */
    if (conv && conversacionAbierta && conversacionAbierta.telefono === telefono) {
      refrescarAccionesYEstado(document.getElementById('conversacionDetail'), conv);
    }
    if (conv) refrescarFichaEstado(conv);
    renderConversaciones(document.getElementById('buscarConv')?.value || '');

    const etiqueta = ETIQUETA_ESTADO_CHAT[estado] || 'Estado actualizado';
    if (conDeshacer && previo && previo !== estado) {
      toast(etiqueta, 'ok', { deshacer: () => cambiarEstado(telefono, previo, false) });
    } else {
      toast(etiqueta, 'ok');
    }
  } catch (err) {
    setStatus('convStatus', false, err.message);
    toast(err.message, 'err');
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
    toast('Mensaje enviado', 'ok');
  } catch (err) {
    setStatus('convStatus', false, err.message);
    toast(err.message, 'err');
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
      toast('Configuración guardada', 'ok');
    } catch (err) {
      setStatus('configStatus', false, err.message);
      toast(err.message, 'err');
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
    toast(`Perfil guardado: ${cliente.telefono}`, 'ok');
  } catch (err) {
    setStatus('clienteStatus', false, err.message);
    toast(err.message, 'err');
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

/* ---------- #V24: restaurar vista desde la URL ---------- */
function abrirDesdeHash() {
  const { vista, id } = hashVista();
  if (!vista || !document.getElementById(`view-${vista}`)) {
    escribirHash('dashboard');
    showView('dashboard');
    return;
  }
  if (document.getElementById(`view-${vista}`).classList.contains('hidden')) {
    showView(vista, { soloHash: true });
  }
  if (!id) return;
  const restaurar = () => {
    if (vista === 'pedidos' && pedidos.some((p) => String(p.id) === String(id))) {
      abrirPedido(id);
      return true;
    }
    if (vista === 'conversaciones' && conversaciones.some((c) => c.telefono === id)) {
      abrirConversacion(conversaciones.find((c) => c.telefono === id));
      return true;
    }
    return false;
  };
  if (!restaurar()) {
    let intentos = 0;
    const timer = setInterval(() => {
      intentos++;
      if (restaurar() || intentos > 20) clearInterval(timer);
    }, 250);
  }
}

abrirDesdeHash();

/* Botón atrás/adelante o edición manual del hash: la vista sigue a la URL. */
window.addEventListener('hashchange', () => {
  if (location.hash === hashPropio) return;
  hashPropio = location.hash;
  abrirDesdeHash();
});

document.getElementById('buscarProducto').addEventListener('input', filtroProductos);

const btnLimpiarProd = document.getElementById('btnLimpiarProd');
if (btnLimpiarProd) btnLimpiarProd.addEventListener('click', () => {
  document.getElementById('buscarProducto').value = '';
  filtroProductos();
  document.getElementById('buscarProducto').focus();
});

const chkSoloAgotados = document.getElementById('soloAgotados');
if (chkSoloAgotados) chkSoloAgotados.addEventListener('change', filtroProductos);

/* ---------- #V23: tema claro/oscuro ---------- */
(function initTema() {
  const btn = document.getElementById('btnTema');
  if (!btn) return;
  const almacenado = localStorage.getItem('panel_tema');
  const preferido = almacenado || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = preferido;
  const actualizarBtn = () => {
    const oscuro = document.documentElement.dataset.theme === 'dark';
    btn.textContent = oscuro ? 'Claro' : 'Oscuro';
    btn.setAttribute('aria-pressed', String(oscuro));
  };
  actualizarBtn();
  btn.addEventListener('click', () => {
    const siguiente = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = siguiente;
    localStorage.setItem('panel_tema', siguiente);
    actualizarBtn();
  });
})();

/* ---------- #V24: buscador rápido (Ctrl+K) ---------- */
const paletteEl = document.getElementById('palette');
const paletteInput = document.getElementById('paletteInput');
const paletteBody = document.getElementById('paletteBody');
const helpSheet = document.getElementById('helpSheet');
const PAL_RECENTES = 'panel_pal_recientes';
let palItems = [];
let palActivo = 0;
let palClientesTimer = null;

const VISTAS_PAL = [
  { label: 'Dashboard', sub: 'Ventas y productos', run: () => showView('dashboard') },
  { label: 'Pedidos', sub: 'Carritos por conversación', run: () => showView('pedidos') },
  { label: 'Conversaciones', sub: 'WhatsApp y handoffs', run: () => showView('conversaciones') },
  { label: 'Test del bot', sub: 'Probar respuestas', run: () => showView('test') },
  { label: 'Fidelización', sub: 'Puntos y recompensas', run: () => showView('fidelizacion') },
  { label: 'Configuración', sub: 'Prompt y temperatura', run: () => showView('configuracion') },
];

function leerRecentes() {
  try {
    const raw = JSON.parse(localStorage.getItem(PAL_RECENTES) || '[]');
    return Array.isArray(raw) ? raw.slice(0, 6) : [];
  } catch (e) { return []; }
}

function guardarRecente(entry) {
  try {
    const lista = leerRecentes().filter((r) => r.clave !== entry.clave);
    lista.unshift(entry);
    localStorage.setItem(PAL_RECENTES, JSON.stringify(lista.slice(0, 6)));
  } catch (e) { /* Sin persistencia disponible. */ }
}

/* Rehidrata un reciente guardado: reconstruye su acción a partir de tipo + ref. */
function recentComoItem(r) {
  const base = { label: r.label, sub: r.sub, clave: r.clave, tipo: r.tipo, ref: r.ref, key: 'reciente' };
  if (r.tipo === 'vista') {
    const v = VISTAS_PAL.find((x) => x.label === r.ref);
    return v ? { ...base, label: v.label, sub: v.sub, run: v.run } : null;
  }
  if (r.tipo === 'conversacion') {
    return { ...base, run: () => { showView('conversaciones'); const c = conversaciones.find((x) => x.telefono === r.ref); if (c) abrirConversacion(c); } };
  }
  if (r.tipo === 'pedido') {
    return { ...base, run: () => { showView('pedidos'); if (pedidos.some((p) => String(p.id) === String(r.ref))) abrirPedido(r.ref); } };
  }
  if (r.tipo === 'producto') {
    return { ...base, run: () => { showView('dashboard'); const input = document.getElementById('buscarProducto'); input.value = r.ref; filtroProductos(); document.getElementById('productosCount').scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  }
  if (r.tipo === 'cliente') {
    return { ...base, run: () => { showView('dashboard'); const input = document.getElementById('consultaCliente'); input.value = r.ref; buscarCliente(r.ref); } };
  }
  return null;
}

function abrirPalette() {
  paletteEl.classList.remove('hidden');
  paletteInput.value = '';
  paletteInput.focus();
  pintarPalette('');
}

function cerrarPalette() {
  paletteEl.classList.add('hidden');
  paletteInput.value = '';
  palItems = [];
}

function abrirAyuda() {
  helpSheet.classList.remove('hidden');
}

function cerrarAyuda() {
  helpSheet.classList.add('hidden');
}

function envolverMark(texto, term) {
  const s = String(texto ?? '');
  if (!term) return esc(s);
  const i = s.toLowerCase().indexOf(term);
  if (i === -1) return esc(s);
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + term.length)) + '</mark>' + esc(s.slice(i + term.length));
}

function pintarPalette(term) {
  const q = String(term || '').trim().toLowerCase();
  const grupos = [];

  const vistas = VISTAS_PAL
    .map((v) => ({ ...v, score: Math.max(fuzzyScore(v.label, q), q ? fuzzyScore(v.sub, q) * 0.8 : 0) }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((v) => ({ ...v, clave: `vista:${v.label}`, tipo: 'vista', ref: v.label }));
  if (vistas.length) grupos.push({ titulo: 'Vistas', items: vistas });

  if (!q) {
    const recientes = leerRecentes().map(recentComoItem).filter(Boolean);
    if (recientes.length) grupos.push({ titulo: 'Recientes', items: recientes });
  }

  if (q) {
    const prods = productos
      .map((p) => ({ p, score: fuzzyScore(p.nombre, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (prods.length) {
      grupos.push({
        titulo: 'Productos',
        items: prods.map(({ p }) => ({
          label: p.nombre,
          sub: precioPlano(p),
          key: 'producto',
          clave: `producto:${p.nombre}`,
          tipo: 'producto',
          ref: p.nombre,
          run: () => {
            showView('dashboard');
            const input = document.getElementById('buscarProducto');
            input.value = p.nombre;
            filtroProductos();
            document.getElementById('productosCount').scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        })),
      });
    }

    const convs = conversaciones
      .map((c) => ({ c, score: Math.max(fuzzyScore(c.nombre, q), fuzzyScore(c.telefono, q)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (convs.length) {
      grupos.push({
        titulo: 'Conversaciones',
        items: convs.map(({ c }) => ({
          label: c.nombre || c.telefono,
          sub: c.telefono,
          key: 'conversacion',
          clave: `conversacion:${c.telefono}`,
          tipo: 'conversacion',
          ref: c.telefono,
          run: () => {
            showView('conversaciones');
            abrirConversacion(c);
          },
        })),
      });
    }

    const peds = pedidos
      .map((p) => ({ p, score: Math.max(fuzzyScore(p.nombre, q), fuzzyScore(p.telefono, q)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (peds.length) {
      grupos.push({
        titulo: 'Pedidos',
        items: peds.map(({ p }) => ({
          label: p.nombre || p.telefono,
          sub: `${formatCurrency(p.total)} · ${ESTADO_LABEL[p.estado] || p.estado}`,
          key: 'pedido',
          clave: `pedido:${p.id}`,
          tipo: 'pedido',
          ref: p.id,
          run: () => {
            showView('pedidos');
            abrirPedido(p.id);
          },
        })),
      });
    }

    if (q.length >= 2 && hasKey()) {
      grupos.push({ titulo: 'Clientes', items: [], cargando: true, id: 'palClientes' });
      pintarClientesPalette(q);
    }
  }

  palItems = [];
  let html = '';
  grupos.forEach((g) => {
    html += `<div class="pal-group">${esc(g.titulo)}</div>`;
    if (g.cargando) html += '<div class="pal-empty" id="palClientes">Buscando clientes…</div>';
    g.items.forEach((it) => {
      palItems.push(it);
      const idx = palItems.length - 1;
      html += `<div class="pal-item${idx === palActivo ? ' active' : ''}" data-idx="${idx}">
        <div class="pal-main">
          <span class="pal-label">${envolverMark(it.label, q)}</span>
          ${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ''}
        </div>
        ${it.key ? `<span class="pal-key">${it.key}</span>` : ''}
      </div>`;
    });
  });
  if (!palItems.length && !grupos.length) {
    html = '<div class="pal-empty">Sin resultados. Prueba con un cliente, chat, pedido o producto.</div>';
  }
  paletteBody.innerHTML = html;
  const act0 = paletteBody.querySelector('.pal-item.active');
  if (act0) act0.scrollIntoView({ block: 'nearest' });
}

async function pintarClientesPalette(q) {
  clearTimeout(palClientesTimer);
  palClientesTimer = setTimeout(async () => {
    if (!paletteEl.classList.contains('hidden') || paletteInput.value.trim().toLowerCase() !== q) return;
    try {
      const { clientes } = await api(`/api/clientes?q=${encodeURIComponent(q)}`);
      const box = document.getElementById('palClientes');
      if (!box) return;
      const lista = (clientes || []).slice(0, 6);
      if (!lista.length) { box.innerHTML = '<div class="pal-empty">Sin clientes.</div>'; return; }
      box.outerHTML = lista
        .map((c) => `<div class="pal-item" data-pal-cliente="${esc(c.telefono)}" data-pal-nombre="${esc(c.nombre || c.telefono)}">
          <div class="pal-main">
            <span class="pal-label">${envolverMark(c.nombre || c.telefono, q)}</span>
            <span class="pal-sub">${esc(c.telefono)}</span>
          </div>
          <span class="pal-key">cliente</span>
        </div>`)
        .join('');
    } catch (e) {
      const box = document.getElementById('palClientes');
      if (box) box.innerHTML = '<div class="pal-empty">No se pudo buscar clientes.</div>';
    }
  }, 220);
}

function ejecutarPalActivo() {
  const it = palItems[palActivo];
  if (!it) return;
  cerrarPalette();
  if (it.clave) {
    guardarRecente({ clave: it.clave, label: it.label, sub: it.sub, tipo: it.tipo, ref: it.ref });
  }
  it.run();
}

paletteInput.addEventListener('input', () => {
  palActivo = 0;
  pintarPalette(paletteInput.value);
});

paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    if (!palItems.length) return;
    palActivo = (palActivo + 1) % palItems.length;
    marcarPalActivo();
  } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault();
    if (!palItems.length) return;
    palActivo = (palActivo - 1 + palItems.length) % palItems.length;
    marcarPalActivo();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    ejecutarPalActivo();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cerrarPalette();
  }
});

function marcarPalActivo() {
  paletteBody.querySelectorAll('.pal-item').forEach((el) => {
    const on = Number(el.dataset.idx) === palActivo;
    el.classList.toggle('active', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

paletteBody.addEventListener('click', (e) => {
  const item = e.target.closest('.pal-item');
  if (!item) return;
  if (item.dataset.palCliente) {
    const tel = item.dataset.palCliente;
    const nom = item.dataset.palNombre;
      cerrarPalette();
      guardarRecente({ clave: `cliente:${tel}`, label: nom, sub: tel, tipo: 'cliente', ref: tel });
    showView('dashboard');
    const input = document.getElementById('consultaCliente');
    input.value = tel;
    buscarCliente(tel);
    return;
  }
  const idx = Number(item.dataset.idx);
  if (!Number.isNaN(idx)) {
    palActivo = idx;
    ejecutarPalActivo();
  }
});

paletteEl.addEventListener('click', (e) => {
  if (e.target === paletteEl) cerrarPalette();
});

helpSheet.addEventListener('click', (e) => {
  if (e.target === helpSheet) cerrarAyuda();
});

document.getElementById('btnAbrePalette').addEventListener('click', abrirPalette);
document.getElementById('btnAbrePalette').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPalette(); }
});

/* ---------- Atajos de teclado ---------- */
let pendingG = false;

document.addEventListener('keydown', (e) => {
  const act = document.activeElement;
  const tag = act ? act.tagName : '';
  const escribiendo = tag === 'INPUT' || tag === 'TEXTAREA' || (act && act.isContentEditable);

  if (e.key === 'Escape') {
    if (!paletteEl.classList.contains('hidden')) { cerrarPalette(); return; }
    if (!helpSheet.classList.contains('hidden')) { cerrarAyuda(); return; }
  }

  /* Ctrl+K funciona aunque estés escribiendo: es el lanzador global. */
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletteEl.classList.contains('hidden') ? abrirPalette() : cerrarPalette();
    return;
  }

  if (e.key === '?' && e.shiftKey && !escribiendo) {
    e.preventDefault();
    helpSheet.classList.contains('hidden') ? abrirAyuda() : cerrarAyuda();
    return;
  }

  if (e.key === 'Enter' && escribiendo && act.id === 'buscarConv') {
    e.preventDefault();
    const first = document.querySelector('#listaConversaciones .conv-item');
    if (first) first.click();
    return;
  }

  if ((e.key === 'j' || e.key === 'k') && !escribiendo) {
    const vistaConversaciones = !document.getElementById('view-conversaciones').classList.contains('hidden');
    const items = [...document.querySelectorAll('#listaConversaciones .conv-item')];
    if (!items.length || (!vistaConversaciones && !e.ctrlKey)) return;
    e.preventDefault();
    const dir = e.key === 'j' ? 1 : -1;
    const cur = items.findIndex((el) => el.classList.contains('selected'));
    const next = (cur + dir + items.length) % items.length;
    items[next].click();
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }

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
    const mapa = { d: 'dashboard', p: 'pedidos', c: 'conversaciones', t: 'test', s: 'configuracion', f: 'fidelizacion' };
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

/* =============================================================
   #V36 · Vista Fidelización
   ============================================================= */
let fidRecompensas = [];
let fidCategorias = [];

const UNIDAD_FID = { bs: 'Bs', porcentaje: '% del pedido', puntos: 'puntos' };

function fidForm(id) {
  return document.getElementById(id);
}

function fidSetVal(el, valor) {
  if (el) el.value = valor == null ? '' : valor;
}

async function loadFidelizacion() {
  const banner = document.getElementById('fidEstadoBanner');
  try {
    const data = await api('/api/fidelizacion-config');
    const cfg = data.config || {};
    fidRecompensas = data.recompensas || [];
    fidCategorias = data.categorias || [];

    if (!data.config) {
      banner.textContent = 'La migración de fidelización aún no está aplicada en la base de datos.';
      banner.className = 'fid-banner fid-banner-off';
    } else if (cfg.activo) {
      banner.textContent = `Programa activo · ${cfg.puntos_por_usd} pts por USD · canje desde ${cfg.canje_minimo_puntos} pts`;
      banner.className = 'fid-banner fid-banner-on';
    } else {
      banner.textContent = 'Programa inactivo: las compras no acumulan puntos hasta que lo actives.';
      banner.className = 'fid-banner fid-banner-off';
    }

    const f = fidForm('formFidConfig');
    if (f) {
      f.activo.value = cfg.activo ? 'true' : 'false';
      fidSetVal(f.puntos_por_usd, cfg.puntos_por_usd);
      fidSetVal(f.bonificacion_categoria, cfg.bonificacion_categoria);
      fidSetVal(f.canje_minimo_puntos, cfg.canje_minimo_puntos);
      fidSetVal(f.canje_max_porcentaje, cfg.canje_max_porcentaje);
      fidSetVal(f.vigencia_dias, cfg.vigencia_dias);
      fidSetVal(f.nota, cfg.nota);
    }

    renderFidRecompensas();
  } catch (e) {
    if (banner) {
      banner.textContent = `No se pudo cargar: ${e.message}`;
      banner.className = 'fid-banner fid-banner-off';
    }
  }
}

function renderFidRecompensas() {
  const body = document.getElementById('fidRecompensasBody');
  if (!body) return;
  if (!fidRecompensas.length) {
    body.innerHTML = '<tr><td colspan="7" class="fid-empty">Todavía no hay recompensas. Crea la primera arriba.</td></tr>';
    return;
  }
  body.innerHTML = fidRecompensas
    .map((r) => {
      const valor = r.unidad === 'porcentaje'
        ? `${r.valor}%`
        : `${r.valor} ${UNIDAD_FID[r.unidad] || r.unidad}`;
      const limite = r.limite ? `Máx. ${r.limite}` : 'Sin límite';
      return `<tr>
        <td>${esc(r.nombre)}${r.descripcion ? `<div class="fid-sub">${esc(r.descripcion)}</div>` : ''}</td>
        <td>${esc(r.tipo)}</td>
        <td><strong>${esc(r.puntos_costo)}</strong> pts</td>
        <td>${esc(valor)}</td>
        <td>${esc(limite)}</td>
        <td>${r.activa ? '<span class="badge badge-mostrador">Activa</span>' : '<span class="badge badge-inactivo">Inactiva</span>'}</td>
        <td class="fid-row-acciones">
          <button type="button" class="ghost fid-mini" data-fid-edit="${esc(r.id)}">Editar</button>
          <button type="button" class="ghost fid-mini fid-danger" data-fid-del="${esc(r.id)}">Borrar</button>
        </td>
      </tr>`;
    })
    .join('');
}

function fidLimpiarFormRecompensa() {
  const f = fidForm('formFidRecompensa');
  if (!f) return;
  f.reset();
  f.id.value = '';
  f.activa.checked = true;
  const btn = document.getElementById('fidRecCancelar');
  if (btn) btn.hidden = true;
}

function fidEditarRecompensa(id) {
  const r = fidRecompensas.find((x) => x.id === id);
  const f = fidForm('formFidRecompensa');
  if (!r || !f) return;
  f.id.value = r.id;
  f.nombre.value = r.nombre;
  f.descripcion.value = r.descripcion || '';
  f.tipo.value = r.tipo;
  f.puntos_costo.value = r.puntos_costo;
  f.valor.value = r.valor;
  f.unidad.value = r.unidad;
  f.limite.value = r.limite || '';
  f.orden.value = r.orden || 0;
  f.activa.checked = !!r.activa;
  const btn = document.getElementById('fidRecCancelar');
  if (btn) btn.hidden = false;
  f.nombre.focus();
}

async function fidGuardarConfig(e) {
  e.preventDefault();
  const f = e.target;
  const body = {
    activo: f.activo.value === 'true',
    puntos_por_usd: Number(f.puntos_por_usd.value),
    bonificacion_categoria: Number(f.bonificacion_categoria.value),
    canje_minimo_puntos: Number(f.canje_minimo_puntos.value),
    canje_max_porcentaje: Number(f.canje_max_porcentaje.value),
    vigencia_dias: Number(f.vigencia_dias.value),
    nota: f.nota.value,
  };
  try {
    await api('/api/fidelizacion-config', { method: 'PUT', body: JSON.stringify(body) });
    toast('Reglas guardadas');
    loadFidelizacion();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function fidGuardarRecompensa(e) {
  e.preventDefault();
  const f = e.target;
  const body = {
    id: f.id.value || undefined,
    nombre: f.nombre.value.trim(),
    descripcion: f.descripcion.value.trim(),
    tipo: f.tipo.value,
    puntos_costo: Number(f.puntos_costo.value),
    valor: Number(f.valor.value || 0),
    unidad: f.unidad.value,
    limite: f.limite.value ? Number(f.limite.value) : null,
    activa: f.activa.checked,
    orden: Number(f.orden.value || 0),
  };
  if (!body.nombre) return toast('Ponle un nombre a la recompensa', 'err');
  if (!Number.isInteger(body.puntos_costo) || body.puntos_costo <= 0) {
    return toast('Los puntos que cuesta deben ser un número entero mayor que 0', 'err');
  }
  try {
    await api('/api/fidelizacion-recompensas', { method: 'POST', body: JSON.stringify(body) });
    toast(body.id ? 'Recompensa actualizada' : 'Recompensa creada');
    fidLimpiarFormRecompensa();
    loadFidelizacion();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function fidBorrarRecompensa(id) {
  const r = fidRecompensas.find((x) => x.id === id);
  if (!r) return;
  if (!window.confirm(`¿Borrar la recompensa "${r.nombre}"?\n\nLos canjes ya hechos no se borran, pero dejará de ofrecerse.`)) return;
  try {
    await api(`/api/fidelizacion-recompensas/${id}`, { method: 'DELETE' });
    toast('Recompensa borrada');
    loadFidelizacion();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function fidConsultarCliente(e) {
  e.preventDefault();
  const tel = e.target.telefono.value.trim();
  const box = document.getElementById('fidClienteBox');
  if (!tel) return;
  box.innerHTML = '<p class="fid-sub">Consultando…</p>';
  try {
    const d = await api(`/api/fidelizacion/${encodeURIComponent(tel)}`);
    if (d.error) {
      box.innerHTML = `<p class="fid-vacio">No hay datos de fidelización para ${esc(tel)} todavía.</p>`;
      return;
    }
    const movs = Array.isArray(d.movimientos) ? d.movimientos : [];
    const recs = Array.isArray(d.recompensas) ? d.recompensas : [];
    box.innerHTML = `
      <div class="fid-saldo">
        <div>
          <span class="fid-saldo-n">${esc(d.saldo_canjeable ?? d.saldo ?? 0)}</span>
          <span class="fid-saldo-l">puntos disponibles</span>
        </div>
        <div class="fid-meta">
          <div>Total: <strong>${esc(d.saldo ?? 0)}</strong></div>
          <div>Mínimo de canje: <strong>${esc(d.canje_minimo ?? 0)}</strong></div>
          <div>Caducados: <strong>${esc(d.caducados ?? 0)}</strong></div>
        </div>
      </div>
      ${recs.length ? `<h3>Recompensas</h3>
        <div class="fid-recs">
          ${recs.map((r) => `<div class="fid-rec">
            <div class="fid-rec-info">
              <strong>${esc(r.nombre)}</strong>
              ${r.descripcion ? `<div class="fid-sub">${esc(r.descripcion)}</div>` : ''}
              <div class="fid-sub">${esc(r.puntos_costo)} pts · ${esc(r.unidad === 'porcentaje' ? `${r.valor}%` : `${r.valor} ${UNIDAD_FID[r.unidad] || r.unidad}`)}</div>
            </div>
            ${r.alcanzable
              ? `<button type="button" class="primary fid-mini" data-fid-canje="${esc(r.id)}">Canjear</button>`
              : '<span class="badge badge-inactivo">Faltan puntos</span>'}
          </div>`).join('')}
        </div>` : '<p class="fid-vacio">No hay recompensas activas.</p>'}
      <h3>Últimos movimientos</h3>
      ${movs.length ? `<div class="table-wrap"><table class="fid-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Puntos</th><th>Motivo</th></tr></thead>
        <tbody>${movs.map((m) => `<tr>
          <td>${esc(new Date(m.created_at).toLocaleString('es'))}</td>
          <td>${esc(m.tipo)}${m.caducado ? ' <span class="badge badge-inactivo">caducado</span>' : ''}</td>
          <td class="${Number(m.puntos) >= 0 ? 'fid-plus' : 'fid-minus'}">${Number(m.puntos) >= 0 ? '+' : ''}${esc(m.puntos)}</td>
          <td>${esc(m.motivo || '—')}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="fid-vacio">Sin movimientos todavía.</p>'}
      <form id="formFidAjuste" class="fid-form fid-form-inline fid-ajuste">
        <label>Ajuste manual
          <input name="puntos" type="number" step="1" placeholder="+50 o -20" />
        </label>
        <label>Motivo
          <input name="motivo" placeholder="Cortesía por demora" />
        </label>
        <button type="submit" class="ghost">Aplicar ajuste</button>
      </form>
      <div id="fidCanjeBox"></div>`;

    const boxAjuste = document.getElementById('formFidAjuste');
    if (boxAjuste) {
      boxAjuste.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const puntos = Number(ev.target.puntos.value);
        if (!Number.isInteger(puntos) || puntos === 0) return toast('Indica cuántos puntos sumar o restar', 'err');
        try {
          const r = await api('/api/fidelizacion/ajustar', {
            method: 'POST',
            body: JSON.stringify({ telefono: tel, puntos, motivo: ev.target.motivo.value }),
          });
          toast(`Saldo ahora: ${r.saldo} puntos`);
          fidConsultarCliente({ target: { telefono: { value: tel } }, preventDefault() {} });
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    }
  } catch (err) {
    box.innerHTML = `<p class="fid-vacio">Error: ${esc(err.message)}</p>`;
  }
}

async function fidCanjear(recId, tel, montoPedido) {
  const box = document.getElementById('fidCanjeBox');
  const r = fidRecompensas.find((x) => x.id === recId);
  let monto = 0;
  if (r && r.unidad === 'porcentaje') {
    const v = window.prompt('Monto del pedido en Bs (para calcular el %):', String(montoPedido || ''));
    if (v === null) return;
    monto = Number(v);
    if (!Number.isFinite(monto) || monto <= 0) return toast('Indica un monto válido', 'err');
  }
  try {
    const res = await api('/api/fidelizacion/canjear', {
      method: 'POST',
      body: JSON.stringify({ telefono: tel, recompensa_id: recId, monto_pedido: monto }),
    });
    const dcto = Number(res.descuento || 0);
    const texto = dcto > 0
      ? `Canjeado. Aplica ${dcto} Bs de descuento en el mostrador.`
      : `Canjeado: ${res.recompensa}. Entrégaselo al cliente (sin descuento monetario).`;
    toast(texto);
    if (box) box.innerHTML = `<div class="fid-ok">${esc(texto)}</div>`;
    fidConsultarCliente({ target: { telefono: { value: tel } }, preventDefault() {} });
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* Montaje de la vista */
document.addEventListener('DOMContentLoaded', () => {
  const formCfg = fidForm('formFidConfig');
  if (formCfg) formCfg.addEventListener('submit', fidGuardarConfig);
  const formRec = fidForm('formFidRecompensa');
  if (formRec) formRec.addEventListener('submit', fidGuardarRecompensa);
  const formCli = fidForm('formFidCliente');
  if (formCli) formCli.addEventListener('submit', fidConsultarCliente);
  const btnCancel = document.getElementById('fidRecCancelar');
  if (btnCancel) btnCancel.addEventListener('click', fidLimpiarFormRecompensa);

  // Delegación: editar / borrar recompensas y canjear.
  document.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-fid-edit]');
    if (edit) return fidEditarRecompensa(edit.dataset.fidEdit);
    const del = e.target.closest('[data-fid-del]');
    if (del) return fidBorrarRecompensa(del.dataset.fidDel);
    const canje = e.target.closest('[data-fid-canje]');
    if (canje) {
      const telInput = fidForm('formFidCliente');
      return fidCanjear(canje.dataset.fidCanje, telInput ? telInput.telefono.value.trim() : '');
    }
  });
});
