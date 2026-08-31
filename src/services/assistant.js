'use strict';

const { getOpenAI, responderConAsistente, DEFAULT_SYSTEM_PROMPT } = require('./ai');

module.exports = { SYSTEM_PROMPT: DEFAULT_SYSTEM_PROMPT, responderConAsistente, getOpenAI };
