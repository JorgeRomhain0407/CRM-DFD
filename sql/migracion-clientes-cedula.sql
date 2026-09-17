-- Migración: cédula de identidad en clientes
--  - UNIQUE nullable (solo la registran los agentes del mostrador físico)
--  - Formato normalizado: prefijo V/E opcional + 5-9 dígitos (ej: V12345678)
--  - Una vez fijada, no se puede modificar (se valida en la API)
-- Aplica en el SQL Editor de Supabase.

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS cedula TEXT;

ALTER TABLE public.clientes
  DROP CONSTRAINT IF EXISTS clientes_cedula_formato;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_cedula_formato
  CHECK (
    cedula IS NULL
    OR (cedula = upper(btrim(cedula)) AND cedula ~ '^[A-Z]?[0-9]{5,9}$')
  );

DROP INDEX IF EXISTS public.clientes_cedula_unico;
CREATE UNIQUE INDEX clientes_cedula_unico
  ON public.clientes (cedula)
  WHERE cedula IS NOT NULL;

-- Verificación: la FK ventas.teléfono debe permitir modificar el teléfono
-- (ON UPDATE CASCADE). Si el resultado sale vacío, avísame.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.ventas'::regclass
  AND contype = 'f'
  AND pg_get_constraintdef(oid) LIKE '%clientes(telefono)%';