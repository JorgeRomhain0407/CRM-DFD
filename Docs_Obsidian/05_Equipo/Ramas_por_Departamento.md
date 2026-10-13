---
tipo: equipo
creado: 2026-10-13
tags: [equipo, ramas, git, departamentos, workflow]
---

# Ramas por Departamento — aislamiento de trabajo

> **Objetivo:** que ningún agente escriba directamente en `main`. Cada departamento
> trabaja en su propia rama y Release Manager (D05) integra en `main` tras el gate.

## Rama de cada departamento

| Departamento | Sesión | Rama | Alcance (dueño de) |
|---|---|---|---|
| Project Manager | D00/PM | `dept/proyect-manager` | planificación, bóveda, priorización #V, coordinación |
| Backend | D01 | `dept/backend` | `src/`, `sql/`, rutas API, Supabase, FEFO, integraciones |
| Frontend | D02 | `dept/frontend` | `public/` (HTML, CSS, `app.js`), UX del panel |
| Tester / QA | D03 | `dept/tester` | `scripts/`, baterías de prueba, reportes de bug (no toca código) |
| Ciberseguridad | D04 | `dept/ciberseguridad` | `x-api-key`, validación, sanitización, auditoría de las demás |
| Flujos de IA | D06 | `dept/flujos-ia` | `src/prompts/`, `src/lib/openai-tools.json`, webhook/bot, grounding |
| Release Manager | D05 | *(sin rama)* | integra en `main`, merges, tags, changelog, deploy |

## Cómo asignar la rama a cada agente (lo importante)

Todas las sesiones comparten **el mismo repo**, así que **no pueden tener 6 ramas a la vez
en la misma carpeta**. Cada agente necesita su **propia carpeta de trabajo** con su rama.
La forma ligera y recomendada es **`git worktree`**: carpetas separadas que comparten el
mismo historial y `.git`.

### Opción A · git worktree (recomendada)

Desde la carpeta principal (`C:\Users\Aleja\Projects\CRM-DFD`), una vez:

```powershell
git worktree add ..\CRM-DFD-backend       dept/backend
git worktree add ..\CRM-DFD-frontend      dept/frontend
git worktree add ..\CRM-DFD-tester        dept/tester
git worktree add ..\CRM-DFD-ciberseguridad dept/ciberseguridad
git worktree add ..\CRM-DFD-flujos-ia     dept/flujos-ia
git worktree add ..\CRM-DFD-pm            dept/proyect-manager
```

Ahora cada agente arranca su sesión **en su carpeta** y ya está en su rama. En el prompt de
arranque de cada sesión, indica la rama y el alcance:

```text
Sesión D02 · Frontend. Trabaja SOLO en la rama dept/frontend
(carpeta ..\CRM-DFD-frontend). No toques main ni otras ramas.
Al terminar: commit con #V + git push origin dept/frontend.
```

### Opción B · rama en la misma carpeta (un agente a la vez)

Si no quieres carpetas separadas, cada sesión cambia de rama al empezar:

```powershell
git switch dept/frontend     # D02
git switch dept/backend      # D01
```

> ⚠️ En esta opción solo un agente puede trabajar simultáneamente: cambiar de rama mueve
> los archivos para todos. Para trabajo en paralelo real, usa la Opción A.

## Ciclo de trabajo de cada agente

```powershell
# 1) traer lo último de main a tu rama (antes de empezar)
git switch dept/frontend
git fetch origin
git merge origin/main          # o: git rebase origin/main

# 2) trabajar, y commitear con su #V
git add -A
git commit -m "feat(frontend): #V21 ... "

# 3) publicar tu rama
git push origin dept/frontend
```

## Integración (solo Release Manager D05)

1. Revisa el diff de la rama contra `main`.
2. Merge a `main` (fast-forward si es posible) y `git push origin main`.
3. Escribe el `#V` en [[Changelog_Versionado]] y actualiza la bóveda.
4. Ningún agente hace merge de su propia rama: propone, D05 integra.

## Reglas

- **Nunca** push directo a `main` desde un departamento.
- Cada rama toca **solo su área** (ver columna Alcance).
- Antes de pedir merge: `node --check` (si tocó JS) y su batería de pruebas en verde.
- Recomendado (manual en GitHub): proteger `main` — *Settings → Branches → Add rule*,
  "Require a pull request before merging". Requiere `gh auth login` o la web (la CLI no
  está autenticada en este equipo).
