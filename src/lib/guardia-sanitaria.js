'use strict';

// #V46 · Guardia sanitaria determinista server-side (defensa en profundidad).
//
// Objetivo: que el handoff clínico a un operador humano NO dependa de que el
// modelo decida llamar a solicitar_asistencia_humana. El webhook consulta
// detectarGuardia(texto) ANTES del LLM; si activa, el chat pasa a
// esperando_operador y el cliente recibe un acuse breve en español.
//
// Regla innegociable del proyecto: el bot NUNCA orienta dosis, posología,
// interacciones ni diagnósticos. En duda, derivar de MÁS, nunca de MENOS.
//
// Mantenimiento: la lista es conservadora (minimiza falsos positivos que
// interrumpirían ventas normales). Ampliar solo con evidencia de QA (D03).

const ACUSE_URGENCIA =
  'Esto puede ser serio. Te paso ahora mismo con una persona de la farmacia por este mismo chat. Si es urgente, llama ya a tus servicios de emergencia.';

const ACUSE_CLINICO =
  'Por tu seguridad, esta consulta la atiende una persona de la farmacia. Te escribe por este mismo chat en unos minutos. Mientras, no cambies tu tratamiento por este medio.';

const CATEGORIAS = [
  {
    id: 'urgencia',
    acuse: ACUSE_URGENCIA,
    motivo: 'Posible urgencia médica detectada en el texto del cliente.',
    patrones: [
      /dolor(?:es)?\s+(?:de|en)?\s*(?:el\s+)?pecho/i,
      /dificultad\s+para\s+respirar/i,
      /me\s+falta\s+el\s+aire|respir(?:o|ando)\s+(?:mal|con\s+dificultad)/i,
      /convulsion/i,
      /inconscienc(?:ia|te)|inconscient/i,
      /desmay(?:o|ad[oa]|arse)/i,
      /sangra(?:do|je)\s+(?:abundante|intenso)/i,
      /intoxica/i,
      /sobredosis/i,
    ],
  },
  {
    id: 'posologia',
    acuse: ACUSE_CLINICO,
    motivo: 'Consulta sobre dosis/posología: el bot no debe resolverla.',
    patrones: [
      /\bdosis\b/i,
      /\bposolog/i,
      /cu[áa]n(?:tos|ta)\s+(?:mg|miligramos?)\b/i,
      /cu[áa]n(?:tas|tos)\s+(?:pastillas|c[áa]psulas|comprimidos|gotas)\b/i,
      /cu[áa]ntas?\s+veces\s+al\s+d[íi]a/i,
      /cu[áa]ntos?\s+d[íi]as\s+(?:debo|tengo\s+que|me\s+toca)?\s*(?:tomar|seguir)/i,
      /cu[áa]nd[oo]\s+(?:tomar|tomo)/i,
    ],
  },
  {
    id: 'interaccion',
    acuse: ACUSE_CLINICO,
    motivo: 'Posible consulta de interacción de medicamentos.',
    patrones: [
      /\binteracci[óo]n\b/i,
      /puedo\s+tomar\s+.+\s+con\s+/i,
      /junto\s+con\s+(?:mi|otro|el|los)\s+(?:medicamento|medicina|tratamiento)/i,
    ],
  },
  {
    id: 'clinico',
    acuse: ACUSE_CLINICO,
    motivo: 'Consulta clínica sensible (embarazo/lactancia/reacción adversa/receta).',
    patrones: [
      /embarazad[oa]\b/i,
      /\bembarazo\b/i,
      /\blactancia\b/i,
      /amamant/i,
      /reacci[óo]n\s+adversa/i,
      /efectos?\s+secundari(?:os|o)/i,
      /\breceta\b/i,
      /me\s+recet(?:aron|[óo])/i,
    ],
  },
];

function detectarGuardia(texto) {
  const t = String(texto || '');
  if (!t) return null;
  for (const cat of CATEGORIAS) {
    for (const patron of cat.patrones) {
      if (patron.test(t)) {
        return { categoria: cat.id, acuse: cat.acuse, motivo: cat.motivo };
      }
    }
  }
  return null;
}

module.exports = { detectarGuardia, ACUSE_URGENCIA, ACUSE_CLINICO };
