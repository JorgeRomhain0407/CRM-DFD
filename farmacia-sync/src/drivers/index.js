'use strict';

function loadDriver(tipo) {
  switch (String(tipo || '').toLowerCase()) {
    case 'sqlite':
      return require('./sqlite');
    case 'mssql':
    case 'sqlserver':
      return require('./mssql');
    case 'mysql':
    case 'mariadb':
      return require('./mysql');
    case 'postgres':
    case 'pg':
      return require('./postgres');
    default:
      throw new Error(
        `Driver de base de datos no soportado: "${tipo}". ` +
          'Usa: sqlite | mssql | mysql | postgres'
      );
  }
}

module.exports = { loadDriver };
