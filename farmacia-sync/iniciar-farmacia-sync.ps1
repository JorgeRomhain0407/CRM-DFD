# FarmaciaSync: arranca servidor + consumidor en segundo plano.
Set-Location 'C:\farmacia-sync'

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'src\\(servidor|consumidor)\\index\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Process node -ArgumentList 'src\servidor\index.js' -WorkingDirectory 'C:\farmacia-sync' -RedirectStandardOutput 'C:\farmacia-sync\server.out.log' -RedirectStandardError 'C:\farmacia-sync\server.err.log' -WindowStyle Hidden
Start-Sleep -Seconds 3
Start-Process node -ArgumentList 'src\consumidor\index.js' -WorkingDirectory 'C:\farmacia-sync' -RedirectStandardOutput 'C:\farmacia-sync\consumidor.out.log' -RedirectStandardError 'C:\farmacia-sync\consumidor.err.log' -WindowStyle Hidden
