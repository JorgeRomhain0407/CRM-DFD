module.exports = {
  apps: [
    {
      name: 'farmacia-sync',
      script: 'src/servidor/index.js',
      cwd: './farmacia-sync',
      env: {
        NODE_ENV: 'production',
      },
      log_file: './farmacia-sync/logs/servidor.log',
      out_file: './farmacia-sync/logs/servidor.out.log',
      error_file: './farmacia-sync/logs/servidor.err.log',
      autorestart: true,
      max_memory_restart: '500M',
    },
    {
      name: 'farmacia-consumidor',
      script: 'src/consumidor/index.js',
      cwd: './farmacia-sync',
      env: {
        NODE_ENV: 'production',
      },
      log_file: './farmacia-sync/logs/consumidor.log',
      out_file: './farmacia-sync/logs/consumidor.out.log',
      error_file: './farmacia-sync/logs/consumidor.err.log',
      autorestart: true,
    },
  ],
};