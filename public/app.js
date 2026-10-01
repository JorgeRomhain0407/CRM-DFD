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

function toast(msg, tipo = 'ok') {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, 3500);
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
  escribirHashSiVisible('pedidos', id);
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
    toast(res.mensaje, 'ok');
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
    toast(err.message, 'err');
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
    toast('Estado actualizado', 'ok');
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
