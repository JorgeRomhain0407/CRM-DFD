'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client;

function getSupabase() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    const err = new Error('Supabase no está configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    err.statusCode = 503;
    throw err;
  }
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

async function rpc(name, params) {
  const { data, error } = await getSupabase().rpc(name, params);
  if (error) throw error;
  return data;
}

module.exports = { getSupabase, rpc };
