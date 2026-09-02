'use strict';

function loadDriver(tipo) {
  switch (String(tipo || '').toLowerCase()) {
    case 'sqlite':
      return require('./drivers/sqlite');
    case 'mssql':
    case 'sqlserver':
      return require('./drivers/mssql');
    case 'mysql':
    case 'mariadb':
      return require('./drivers/mysql');
    case 'postgres':
    case 'pg':
      return require('./drivers/postgres');
    default:
      throw new Error(
        `Driver de base de datos no soportado: "${tipo}". ` +
          'Usa: sqlite | mssql | mysql | postgres'
      );
  }
}

module.exports = { loadDriver };
