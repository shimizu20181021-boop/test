param(
  [int]$Port = 5500,
  [string]$LocalBaseUrl = $null,
  [switch]$SkipLocalCheck,
  [int]$WaitSeconds = 3
)

$ErrorActionPreference = "Stop"

if (-not $LocalBaseUrl) {
  $LocalBaseUrl = "http://127.0.0.1:$Port"
}

function Resolve-TailscaleExe {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"),
    (Join-Path $env:ProgramFiles "Tailscale IPN\tailscale.exe"),
    (Join-Path $env:LOCALAPPDATA "Tailscale\tailscale.exe")
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

$tailscaleExe = Resolve-TailscaleExe
if (-not $tailscaleExe) {
  throw "tailscale.exe not found. Install Tailscale, sign in, then retry."
}

if (-not $SkipLocalCheck) {
  Write-Host ("Checking local server: {0}" -f $LocalBaseUrl)
  try {
    $uri = [Uri]("${LocalBaseUrl}/index.html")
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($uri.Host, $uri.Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(1500)) { throw "Timeout connecting to $($uri.Host):$($uri.Port)" }
    $client.EndConnect($iar)
    $client.Close()
    Write-Host "OK: TCP connection succeeded."
  } catch {
    Write-Warning "Local server is not reachable. Start VS Code Live Server first, or rerun with -SkipLocalCheck."
    throw
  }
}

Write-Host ""
Write-Host "tailscale status:"
& $tailscaleExe status

Write-Host ""
Write-Host "tailscale serve reset:"
& $tailscaleExe serve reset

$outFile = Join-Path $PSScriptRoot "_tailscale_serve_safe_out.txt"
$errFile = Join-Path $PSScriptRoot "_tailscale_serve_safe_err.txt"
Remove-Item -Force $outFile, $errFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("Starting tailscale serve (bg): {0}" -f $LocalBaseUrl)
$p = Start-Process -FilePath $tailscaleExe -ArgumentList @("serve", "--bg", "--yes", $LocalBaseUrl) -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru
Start-Sleep -Seconds ([Math]::Max(1, $WaitSeconds))

if (Test-Path -LiteralPath $outFile) {
  $outText = (Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue)
  if ($outText) {
    Write-Host ""
    Write-Host "--- serve output ---"
    Write-Host $outText.TrimEnd()
  }
  if ($outText -match "Serve is not enabled on your tailnet") {
    Write-Host ""
    Write-Host "Serve is disabled on the tailnet. Open the URL shown above to enable Serve, then rerun this script."
    exit 2
  }
}

if (Test-Path -LiteralPath $errFile) {
  $errText = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
  if ($errText) {
    Write-Host ""
    Write-Host "--- serve error ---"
    Write-Host $errText.TrimEnd()
  }
}

Write-Host ""
Write-Host "tailscale serve status:"
& $tailscaleExe serve status

