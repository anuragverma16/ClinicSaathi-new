# Resets the local MySQL 8.0 root password to "root" (matches server/.env).
# Use when the old root password is lost. Run in PowerShell **as Administrator**:
#
#   powershell -ExecutionPolicy Bypass -File database\reset-mysql-root.ps1
#
# It stops the MySQL80 service, starts MySQL once with a one-line init file that
# sets the password, shuts it down, and starts the service again. No data is touched.

$ErrorActionPreference = 'Stop'
$NewPassword = 'root'
$Bin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin'
$Ini = 'C:\ProgramData\MySQL\MySQL Server 8.0\my.ini'
$Init = Join-Path $env:SystemDrive 'mysql-reset-root.sql'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Please run this script as Administrator (right-click PowerShell > Run as administrator).' -ForegroundColor Red; exit 1 }

Write-Host 'Stopping MySQL80 service...'
Stop-Service MYSQL80 -Force
Start-Sleep -Seconds 3

"ALTER USER 'root'@'localhost' IDENTIFIED BY '$NewPassword';" | Set-Content -Encoding ascii $Init

Write-Host 'Starting MySQL once to apply the new password...'
$proc = Start-Process -FilePath "$Bin\mysqld.exe" -ArgumentList "--defaults-file=`"$Ini`"", "--init-file=`"$Init`"" -PassThru -WindowStyle Hidden

# Wait until it accepts the new password, then shut it down cleanly.
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  & "$Bin\mysqladmin.exe" -uroot "-p$NewPassword" ping 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
}
if ($ok) { & "$Bin\mysqladmin.exe" -uroot "-p$NewPassword" shutdown 2>$null | Out-Null } else { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Remove-Item $Init -Force -ErrorAction SilentlyContinue

Write-Host 'Starting MySQL80 service...'
Start-Service MYSQL80
Start-Sleep -Seconds 3

& "$Bin\mysql.exe" -uroot "-p$NewPassword" -e "SELECT 'Password reset OK' AS status;" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Done. MySQL root password is now: $NewPassword" -ForegroundColor Green
} else {
  Write-Host 'The service is running again, but the new password did not work. See C:\ProgramData\MySQL\MySQL Server 8.0\Data\*.err for details.' -ForegroundColor Yellow
}
