-- =====================================================================
-- #V57a · Búsqueda de productos en UNA sola RPC — CRM DFD
-- =====================================================================
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE (o por apply_migration). Idempotente.
--
-- QUÉ HACE
--   · Consolida en una única función `buscar_productos_bot` lo que antes
--     hacían 3-4 round-trips desde Node (SELECT candidatos + leer rotación +
--     puntuar/ordenar en JS + upsert de rotación): candidatos, puntuación,
--     ORDEN TOTAL y rotación en 1 llamada.
--   · Los helpers `_v57_norm_tokens` / `_v57_match_token` / `_v57_unidad`
--     replican EXACTAMENTE el tokenizador y el matching de `src/lib/busqueda.js`
--     (mismas unidades canónicas, mismos stopwords, mismo orden). La paridad se
--     verifica en `scripts/test-busqueda-parity.js` (JS vs esta RPC).
--   · El modelo de scoring y el desempate son idénticos al buscador JS:
--       coinciden DESC · marca DESC · [esBarato] precio ASC · veces ASC ·
--       stock DESC · venc ASC (NULLS LAST) · precio DESC · nombre ASC
--     El desempate por `nombre` usa COLLATE "C" para igualar la comparación de
--     strings de JS (`<`, code-unit order), mientras que la selección de
--     candidatos respeta el collation por defecto de la BD (igual que PostgREST
--     con `.order('nombre')`).
--   · Con `p_telefono` NULL no se toca la rotación: la RPC es de solo lectura
--     (lo usa el test de paridad).
--
-- SEGURIDAD (patrón del proyecto): SECURITY DEFINER + search_path fijo;
-- REVOKE anon/authenticated/PUBLIC; GRANT solo a service_role.
-- =====================================================================

-- Normaliza un token de unidad a su forma canónica (mismo mapa que JS).
CREATE OR REPLACE FUNCTION public._v57_unidad(p_tok text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_tok
    WHEN 'g' THEN 'gramo' WHEN 'gr' THEN 'gramo' WHEN 'gramo' THEN 'gramo' WHEN 'gramos' THEN 'gramo'
    WHEN 'mg' THEN 'miligramo' WHEN 'miligramo' THEN 'miligramo' WHEN 'miligramos' THEN 'miligramo'
    WHEN 'ml' THEN 'mililitro' WHEN 'mililitro' THEN 'mililitro' WHEN 'mililitros' THEN 'mililitro'
    WHEN 'l' THEN 'litro' WHEN 'litro' THEN 'litro' WHEN 'litros' THEN 'litro'
    WHEN 'mcg' THEN 'microgramo' WHEN 'ug' THEN 'microgramo' WHEN 'microgramo' THEN 'microgramo' WHEN 'microgramos' THEN 'microgramo'
    WHEN 'ui' THEN 'ui' WHEN 'iu' THEN 'ui' WHEN 'unidades' THEN 'ui'
    WHEN 'comprimidos' THEN 'comprimidos' WHEN 'comprimido' THEN 'comprimidos' WHEN 'comp' THEN 'comprimidos'
    WHEN 'capsulas' THEN 'capsulas' WHEN 'capsula' THEN 'capsulas' WHEN 'caps' THEN 'capsulas'
    WHEN 'monodosis' THEN 'monodosis' WHEN 'dosis' THEN 'monodosis'
    ELSE p_tok
  END;
$$;

-- Tokeniza un texto igual que `normalizarTokens` de JS: minúsculas, sin
-- acentos (translate + strip de marcas combinantes), separa dígitos de letras,
-- signos de puntuación -> espacio, y mapea unidades a su forma canónica.
-- Devuelve los tokens en orden (SIN filtrar stopwords: los nombres de producto
-- los conservan, igual que el lado JS).
CREATE OR REPLACE FUNCTION public._v57_norm_tokens(p_texto text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(public._v57_unidad(tok) ORDER BY ord), ARRAY[]::text[])
  FROM (
    SELECT tok, ord
    FROM unnest(
      regexp_split_to_array(
        btrim(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  translate(
                    lower(COALESCE(p_texto, '')),
                    'áàäâãéèëêíìïîóòöôõúùüûñç',
                    'aaaaaeeeeiiiiooooouuuunc'
                  ),
                  E'[\u0300-\u036f]', '', 'g'
                ),
                '([0-9])([a-z])', '\1 \2', 'g'
              ),
              '([a-z])([0-9])', '\1 \2', 'g'
            ),
            '[.,;:()]', ' ', 'g'
          )
        ),
        '\s+'
      )
    ) WITH ORDINALITY AS t(tok, ord)
    WHERE tok <> ''
  ) s;
$$;

-- ¿Coincide el token del nombre (nt) con el token del query (tk)?
-- Unidades: exacto. Resto: subcadena (tolerante a plurales/raíces). Igual que `matchToken`.
CREATE OR REPLACE FUNCTION public._v57_match_token(nt text, tk text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN tk = ANY(ARRAY['gramo','miligramo','mililitro','litro','microgramo','ui','comprimidos','capsulas','monodosis'])
      THEN nt = tk
    ELSE strpos(nt, tk) > 0 OR strpos(tk, nt) > 0
  END;
$$;

-- RPC principal: candidatos + puntuación + orden total + rotación en 1 llamada.
CREATE OR REPLACE FUNCTION public.buscar_productos_bot(
  p_query      text,
  p_telefono   text  DEFAULT NULL,
  p_es_barato  boolean DEFAULT false,
  p_top        int   DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stop        text[] := ARRAY['de','del','el','la','los','las','un','una','unos','unas','quiero','quieres','que','cuanto','cual','precio','tiene','tengo','hay','me','su','en','y','a','al','se','por','para','con','ver','mi','tu','es'];
  v_raw         text := btrim(COALESCE(p_query, ''));
  v_tokens      text[];
  v_rawtokens   text[];
  v_medular     text;
  v_patron      text;
  v_ctx         jsonb;
  v_prods       jsonb;
  v_ahora       bigint;
  v_veces       int;
  v_rec         record;
BEGIN
  IF v_raw = '' OR length(v_raw) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Indica un nombre de producto más concreto.');
  END IF;

  v_tokens := ARRAY(
    SELECT t
    FROM unnest(public._v57_norm_tokens(v_raw)) AS t
    WHERE length(t) > 1 AND NOT (t = ANY(v_stop))
  );
  IF array_length(v_tokens, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Indica un nombre de producto más concreto.');
  END IF;

  v_rawtokens := ARRAY(SELECT rt FROM regexp_split_to_table(lower(v_raw), '\s+') AS rt);

  SELECT t INTO v_medular
  FROM unnest(v_tokens) WITH ORDINALITY AS u(t, ord)
  ORDER BY length(t) DESC, ord ASC
  LIMIT 1;

  SELECT rt INTO v_patron
  FROM unnest(v_rawtokens) WITH ORDINALITY AS u(rt, ord)
  WHERE length(rt) > 1 AND NOT (rt = ANY(v_stop))
  ORDER BY length(rt) DESC, ord ASC
  LIMIT 1;
  IF v_patron IS NULL THEN
    v_patron := v_medular;
  END IF;

  IF p_telefono IS NOT NULL AND p_telefono <> '' THEN
    SELECT COALESCE(last_tool_context, '{}'::jsonb) INTO v_ctx
    FROM public.estado_chat
    WHERE telefono_cliente = p_telefono;
  END IF;
  v_ctx := COALESCE(v_ctx, '{}'::jsonb);

  WITH base AS (
    SELECT p.id, p.nombre, p.descripcion, p.precio, p.precio_usd, p.stock,
           p.fecha_vencimiento, lower(p.nombre) AS nl
      FROM public.productos p
     WHERE p.activo IS TRUE
       AND (p.fecha_vencimiento IS NULL OR p.fecha_vencimiento >= CURRENT_DATE)
       AND p.nombre ILIKE '%' || replace(v_patron, '%', '') || '%'
     ORDER BY p.nombre
     LIMIT 30
  ),
  alt AS (
    SELECT p.id, p.nombre, p.descripcion, p.precio, p.precio_usd, p.stock,
           p.fecha_vencimiento, lower(p.nombre) AS nl
      FROM public.productos p
     WHERE NOT EXISTS (SELECT 1 FROM base)
       AND p.activo IS TRUE
       AND (p.fecha_vencimiento IS NULL OR p.fecha_vencimiento >= CURRENT_DATE)
       AND p.nombre ILIKE '%' || replace(v_medular, '%', '') || '%'
     ORDER BY p.nombre
     LIMIT 30
  ),
  chosen AS (
    SELECT * FROM base
    UNION ALL
    SELECT * FROM alt
  ),
  scored AS (
    SELECT c.id, c.nombre, c.descripcion, c.precio, c.precio_usd, c.stock,
      (SELECT count(*)
         FROM unnest(v_tokens) AS tk
        WHERE EXISTS (
          SELECT 1
          FROM unnest(public._v57_norm_tokens(c.nombre)) AS nt
          WHERE public._v57_match_token(nt, tk)
        )) AS coinciden,
      (CASE WHEN EXISTS (
          SELECT 1
          FROM unnest(v_rawtokens) AS rt
          WHERE length(rt) > 3 AND strpos(c.nl, rt) > 0 AND c.nl <> rt
        ) THEN 1 ELSE 0 END) AS marca,
      COALESCE((v_ctx -> c.id::text ->> 'veces')::int, 0) AS veces,
      CASE WHEN c.fecha_vencimiento IS NULL THEN NULL
           ELSE (extract(epoch FROM c.fecha_vencimiento) * 1000)::bigint END AS venc
    FROM chosen c
  ),
  ranked AS (
    SELECT s.id, s.nombre, s.descripcion, s.precio, s.precio_usd, s.stock,
      row_number() OVER (
        ORDER BY s.coinciden DESC, s.marca DESC,
                 (CASE WHEN p_es_barato THEN s.precio END) ASC,
                 s.veces ASC, s.stock DESC, s.venc ASC,
                 s.precio DESC, s.nombre COLLATE "C" ASC
      ) AS rn
    FROM scored s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'nombre', r.nombre, 'descripcion', r.descripcion,
      'precio', r.precio, 'precio_usd', COALESCE(r.precio_usd, 0),
      'stock', r.stock, 'disponible', r.stock > 0
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_prods
  FROM ranked r
  WHERE r.rn <= p_top;

  IF v_prods = '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'No hay coincidencias en el inventario para esa búsqueda.');
  END IF;

  IF p_telefono IS NOT NULL AND p_telefono <> '' THEN
    v_ahora := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    FOR v_rec IN
      SELECT x.id, x.nombre FROM jsonb_to_recordset(v_prods) AS x(id uuid, nombre text)
    LOOP
      v_veces := COALESCE((v_ctx -> v_rec.id::text ->> 'veces')::int, 0) + 1;
      v_ctx := jsonb_set(
        v_ctx,
        ARRAY[v_rec.id::text],
        jsonb_build_object('veces', v_veces, 'ultima', v_ahora, 'nombre', v_rec.nombre, 'id', v_rec.id::text),
        true
      );
    END LOOP;
    INSERT INTO public.clientes (telefono) VALUES (p_telefono)
      ON CONFLICT (telefono) DO NOTHING;
    INSERT INTO public.estado_chat (telefono_cliente, last_tool_context)
      VALUES (p_telefono, v_ctx)
      ON CONFLICT (telefono_cliente) DO UPDATE SET last_tool_context = EXCLUDED.last_tool_context;
  END IF;

  RETURN jsonb_build_object('ok', true, 'max_ofertas', 3, 'productos', v_prods);
END;
$$;

REVOKE ALL ON FUNCTION public._v57_unidad(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._v57_norm_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._v57_match_token(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buscar_productos_bot(text, text, boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_productos_bot(text, text, boolean, int) TO service_role;

-- =====================================================================
-- FIN. Verificar (lectura, sin rotación):
--   SELECT public.buscar_productos_bot('paracetamol 500 mg', NULL, false, 3);
--   SELECT public._v57_norm_tokens('1 Gramo de Amoxicilina 500mg');
-- =====================================================================
