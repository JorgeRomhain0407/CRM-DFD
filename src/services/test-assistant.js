'use strict';

const { getOpenAI, responderConAsistente } = require('./ai');

async function testearAsistente({ telefono, texto }) {
  const respuesta = await responderConAsistente({ telefono, texto });
  return respuesta;
}

module.exports = { testearAsistente, getOpenAI };