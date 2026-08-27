const apiKeyInput = document.querySelector('#apiKey');
apiKeyInput.value = sessionStorage.getItem('mostrador_api_key') || '';
apiKeyInput.addEventListener('change', () => {
  sessionStorage.setItem('mostrador_api_key', apiKeyInput.value.trim());
  loadProductos();
  loadClientes();
  loadVentas();
  loadResumenVentas();
});

function apiKey() {
  return apiKeyInput.value.trim();
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

async function api(path, options = {}) {
  const headers = { 'x-api-key': apiKey(), ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadProductos() {
  const select = document.querySelector('#formVenta [name="producto_id"]');
  if (!apiKey()) {
    select.innerHTML = '<option value="">Introduce la clave API</option>';
    return;
  }
  try {
    const { productos } = await api('/api/productos');
    select.innerHTML = productos
      .map(
        (p) =>
          `<option value="${p.id}">${p.nombre} — ${formatCurrency(p.precio)} (stock ${p.stock})</option>`
      )
      .join('');
    if (!productos.length) select.innerHTML = '<option value="">Sin productos</option>';
  } catch (err) {
    select.innerHTML = `<option value="">${err.message}</option>`;
  }
}

async function loadClientes(q = '') {
  const tbody = document.querySelector('#tablaClientes');
  if (!apiKey()) return;
  try {
    const { clientes } = await api(`/api/clientes?q=${encodeURIComponent(q)}`);
    if (!clientes.length) {
      tbody.innerHTML = '<tr><td colspan="5">Sin resultados</td></tr>';
      return;
    }
    tbody.innerHTML = clientes
      .map((c) => {
        const estado = c.estado_chat?.estado || '—';
        return `<tr>
          <td>${c.telefono}</td>
          <td>${c.nombre || '—'}</td>
          <td>${c.edad ?? '—'}</td>
          <td>${c.habitos_consumo || '—'}</td>
          <td>${estado}</td>
        </tr>`;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">${err.message}</td></tr>`;
  }
}

async function loadVentas() {
  const tbody = document.querySelector('#tablaVentas');
  if (!apiKey()) return;
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
  if (!apiKey()) return;
  try {
    const data = await api('/api/ventas/resumen');
    document.getElementById('resIngresos').textContent = formatCurrency(data.total_ingresos);
    document.getElementById('resUnidades').textContent = data.total_unidades;
    document.getElementById('resNumVentas').textContent = data.total_ventas;
    document.getElementById('resMostrador').textContent =
      data.por_canal?.mostrador ? `${data.por_canal.mostrador.ventas} ventas` : '0 ventas';
    document.getElementById('resWhatsApp').textContent =
      data.por_canal?.whatsapp ? `${data.por_canal.whatsapp.ventas} ventas` : '0 ventas';
  } catch (err) {
    document.getElementById('resIngresos').textContent = 'Error';
  }
}

async function loadCarrito(telefono) {
  const content = document.getElementById('carritoContent');
  const statusEl = document.getElementById('carritoStatus');
  statusEl.hidden = true;

  if (!telefono) {
    content.hidden = true;
    return;
  }

  try {
    const data = await api(`/api/carrito/${encodeURIComponent(telefono)}`);
    if (!data.lineas.length) {
      content.hidden = true;
      setStatus('carritoStatus', true, 'El carrito está vacío.');
      return;
    }

    content.hidden = false;
    document.getElementById('carritoCount').textContent =
      `${data.lineas.length} artículo${data.lineas.length > 1 ? 's' : ''}`;
    document.getElementById('carritoTotal').textContent = formatCurrency(data.total);

    const lineasEl = document.getElementById('carritoLineas');
    lineasEl.innerHTML = data.lineas
      .map(
        (l) => `<div class="carrito-linea">
          <div class="carrito-linea-info">
            <span class="carrito-linea-nombre">${l.nombre}</span>
            <span class="carrito-linea-detalle">${l.cantidad} × ${formatCurrency(l.precio_unitario)} = ${formatCurrency(l.subtotal)}</span>
          </div>
          <button class="btn-quitar" data-id="${l.id}" title="Eliminar del carrito">✕</button>
        </div>`
      )
      .join('');

    lineasEl.querySelectorAll('.btn-quitar').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/carrito/${encodeURIComponent(telefono)}/${btn.dataset.id}`, { method: 'DELETE' });
          loadCarrito(telefono);
        } catch (err) {
          setStatus('carritoStatus', false, err.message);
        }
      });
    });
  } catch (err) {
    content.hidden = true;
    setStatus('carritoStatus', false, err.message);
  }
}

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
    loadClientes();
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
    loadClientes();
  } catch (err) {
    setStatus('estadoStatus', false, err.message);
  }
});

document.querySelector('#formCarrito').addEventListener('submit', (e) => {
  e.preventDefault();
  const tel = e.target.querySelector('[name="telefono"]').value.trim();
  loadCarrito(tel);
});

loadProductos();
loadClientes();
loadVentas();
loadResumenVentas();
