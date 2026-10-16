-- ============================================================================
-- CRM DFD — #V65 · Hábitos de consumo = productos del catálogo
-- ============================================================================
-- Sustituye el texto libre `clientes.habitos_consumo` por un join cliente↔producto.
-- Aditivo respecto a lo que el código ya usaba; además elimina los vestigios
-- huérfanos `clientes_habitos` / `habitos_consumo` (sin uso en código, funciones
-- ni vistas; solo sus FKs internas). Idempotente.
-- Rollback al final.
-- ============================================================================

-- 1) Tabla de hábitos (producto del catálogo asociado a un cliente)
CREATE TABLE IF NOT EXISTS public.cliente_habitos (
  telefono_cliente TEXT NOT NULL
    REFERENCES public.clientes (telefono) ON UPDATE CASCADE ON DELETE CASCADE,
  producto_id      UUID NOT NULL
    REFERENCES public.productos (id) ON UPDATE CASCADE ON DELETE CASCADE,
  origen           TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'compra', 'legacy')),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telefono_cliente, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_cliente_habitos_producto
  ON public.cliente_habitos (producto_id);

-- 2) Limpieza de vestigios huérfanos (0 filas / 2 filas basura; sin código,
--    funciones ni vistas que las referencien).
DROP TABLE IF EXISTS public.clientes_habitos;
DROP TABLE IF EXISTS public.habitos_consumo;

-- 3) Migración best-effort del texto legacy (clientes.habitos_consumo) → join.
--    Separa por comas, quita el prefijo "Nx ", y busca el producto activo cuyo
--    nombre mejor coincide (exacto primero, luego el más corto).
INSERT INTO public.cliente_habitos (telefono_cliente, producto_id, origen)
SELECT c.telefono, p.id, 'legacy'
FROM public.clientes c
JOIN LATERAL (
  SELECT trim(regexp_replace(f, '^\s*\d+\s*x\s*', '', 'i')) AS nombre
  FROM unnest(string_to_array(coalesce(c.habitos_consumo, ''), ',')) AS f
) fr ON fr.nombre <> ''
JOIN LATERAL (
  SELECT id FROM public.productos
  WHERE activo AND nombre ILIKE '%' || fr.nombre || '%'
  ORDER BY (lower(nombre) = lower(fr.nombre)) DESC, length(nombre)
  LIMIT 1
) p ON true
WHERE coalesce(trim(c.habitos_consumo), '') <> ''
ON CONFLICT DO NOTHING;

-- 4) RLS + permisos (patrón del esquema: solo service_role)
ALTER TABLE public.cliente_habitos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cliente_habitos FROM anon, authenticated;
GRANT ALL ON public.cliente_habitos TO service_role;

COMMENT ON TABLE public.cliente_habitos IS
  '#V65 Hábitos de consumo: productos del catálogo asociados a un cliente. '
  'origen: manual (panel), compra (auto al pedido/venta), legacy (migración del texto). '
  'La columna clientes.habitos_consumo (TEXT) queda como legado de solo lectura.';

-- Rollback:
--   DROP TABLE IF EXISTS public.cliente_habitos;
