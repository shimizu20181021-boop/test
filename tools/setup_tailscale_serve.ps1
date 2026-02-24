param(
  [int]$Port = 5500,
  [string]$LocalBaseUrl = $null,
  [switch]$SkipLocalCheck,
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

if (-not $LocalBaseUrl) {
  $LocalBaseUrl = "http://127.0.0.1:$Port"
}

function Resolve-TailscaleExe {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles "Tailscale\\tailscale.exe"),
    (Join-Path $env:ProgramFiles "Tailscale IPN\\tailscale.exe"),
    (Join-Path $env:LOCALAPPDATA "Tailscale\\tailscale.exe")
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
  $probeUrl = "${LocalBaseUrl}/index.html"
  Write-Host "Probe local server: $probeUrl"
  try {
    $resp = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 4
    Write-Host "OK: HTTP $($resp.StatusCode)"
  } catch {
    Write-Warning "Local server not reachable. Start VS Code Live Server so that $LocalBaseUrl works, then retry."
    throw
  }
}

Write-Host ""
Write-Host "tailscale status:"
& $tailscaleExe status

Write-Host ""
Write-Host "tailscale serve reset:"
& $tailscaleExe serve reset

Write-Host ""
Write-Host "tailscale serve -> $LocalBaseUrl"

$outFile = Join-Path $PSScriptRoot "_tailscale_serve_last_out.txt"
$errFile = Join-Path $PSScriptRoot "_tailscale_serve_last_err.txt"
Remove-Item -Force $outFile, $errFile -ErrorAction SilentlyContinue

$args = @("serve")
if (-not $Foreground) { $args += "--bg" }
$args += @("--yes", $LocalBaseUrl)

Write-Host ("Running: {0} {1}" -f $tailscaleExe, ($args -join " "))
$proc = Start-Process -FilePath $tailscaleExe -ArgumentList $args -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru
Start-Sleep -Seconds 2

if (Test-Path -LiteralPath $outFile) {
  $outText = (Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue)
  if ($outText) { Write-Host $outText.TrimEnd() }
  if ($outText -match "Serve is not enabled on your tailnet") {
    Write-Host ""
    Write-Host "Serve が tailnet 側で無効になっています。上のURLを開いて有効化してから、もう一度このスクリプトを実行してください。"
    exit 2
  }
}
if (Test-Path -LiteralPath $errFile) {
  $errText = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
  if ($errText) { Write-Host $errText.TrimEnd() }
}

Write-Host ""
Write-Host "tailscale serve status:"
& $tailscaleExe serve status
