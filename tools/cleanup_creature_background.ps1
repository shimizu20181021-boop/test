# Cleanup creature PNG backgrounds (storybook assets).
#
# Use cases:
# - Some split sprites (e.g., boar/mouse) come with an opaque dark rectangle background.
# - Some sprites (e.g., pig) are already transparent but may include a faint bright halo.
#
# This script:
# - For opaque images: removes edge-connected background similar to the 4 corner colors
#   (color-distance flood fill), plus removes edge-connected very bright/low-chroma haze.
# - For images that already have transparency: removes only bright low-alpha "halo" pixels
#   (keeps the soft shadow which is typically darker).
#
# Usage examples:
#   powershell -ExecutionPolicy Bypass -File .\tools\cleanup_creature_background.ps1 `
#     -InputDir ".\assets\storybook\creatures_png\omn_mouse" -InPlace -Backup
#
#   powershell -ExecutionPolicy Bypass -File .\tools\cleanup_creature_background.ps1 `
#     -InputDir ".\assets\storybook\creatures_png\herb_pig" -InPlace -Backup

param(
  [Parameter(Mandatory = $true)][string]$InputDir,
  [switch]$InPlace,
  [switch]$Backup,

  # Perimeter-seed flood fill threshold (Manhattan distance in RGB; max 765).
  [ValidateRange(0, 765)][int]$SeedDistThr = 45,

  # Perimeter seed sampling (reduce seed count for performance).
  [ValidateRange(1, 256)][int]$SeedStep = 6,
  [ValidateRange(1, 64)][int]$SeedQuant = 8,

  # Which perimeter colors are considered "background-like" seeds.
  # (Exclude saturated greens/yellows like grass by default.)
  [ValidateRange(0, 255)][int]$SeedChromaMax = 70,
  [ValidateRange(0, 255)][int]$SeedDarkMax = 190,
  [ValidateRange(0, 255)][int]$SeedBrightMin = 220,

  # "Bright/low-chroma" edge haze removal (for light background patches).
  [ValidateRange(0, 255)][int]$BrightMin = 220,
  [ValidateRange(0, 255)][int]$BrightChroma = 70,

  # Low-alpha bright halo cleanup (for already-transparent sprites).
  [ValidateRange(0, 255)][int]$HazeAlphaMax = 28,
  [ValidateRange(0, 255)][int]$HazeBrightMin = 200
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Path $Path | Out-Null }
}

function Read-BitmapBytes32([System.Drawing.Bitmap]$Bmp) {
  $w = $Bmp.Width
  $h = $Bmp.Height
  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb

  # Ensure a stable 32bpp surface.
  $tmp = New-Object System.Drawing.Bitmap $w, $h, $fmt
  try {
    $g = [System.Drawing.Graphics]::FromImage($tmp)
    try { $g.DrawImage($Bmp, 0, 0, $w, $h) } finally { $g.Dispose() }

    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $data = $tmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $fmt)
    try {
      $stride = $data.Stride
      $bytes = New-Object byte[] ($stride * $h)
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
      return [PSCustomObject]@{ Bytes = $bytes; Stride = $stride; Width = $w; Height = $h }
    } finally {
      $tmp.UnlockBits($data)
    }
  } finally {
    $tmp.Dispose()
  }
}

function Write-PngBytes32([byte[]]$Bytes, [int]$Stride, [int]$W, [int]$H, [string]$OutPath) {
  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $bmp = New-Object System.Drawing.Bitmap $W, $H, $fmt
  try {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $fmt)
    try {
      $dstStride = $data.Stride
      if ($dstStride -ne $Stride) {
        # Repack rows if stride differs.
        $packed = New-Object byte[] ($dstStride * $H)
        for ($y = 0; $y -lt $H; $y++) {
          [Array]::Copy($Bytes, $y * $Stride, $packed, $y * $dstStride, [Math]::Min($Stride, $dstStride))
        }
        [System.Runtime.InteropServices.Marshal]::Copy($packed, 0, $data.Scan0, $packed.Length)
      } else {
        [System.Runtime.InteropServices.Marshal]::Copy($Bytes, 0, $data.Scan0, $Bytes.Length)
      }
    } finally {
      $bmp.UnlockBits($data)
    }
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bmp.Dispose()
  }
}

function Rgba-At([byte[]]$Bytes, [int]$Stride, [int]$x, [int]$y) {
  $off = $y * $Stride + $x * 4
  # Format32bppArgb bytes are BGRA.
  $b = [int]$Bytes[$off]
  $g = [int]$Bytes[$off + 1]
  $r = [int]$Bytes[$off + 2]
  $a = [int]$Bytes[$off + 3]
  return @($r, $g, $b, $a)
}

function Flood-EdgeMask-BySeedColor(
  [byte[]]$Bytes,
  [int]$Stride,
  [int]$W,
  [int]$H,
  [int]$SeedR,
  [int]$SeedG,
  [int]$SeedB,
  [int]$DistThr
) {
  $n = $W * $H
  $seen = New-Object byte[] $n
  $mask = New-Object byte[] $n
  $q = New-Object "System.Collections.Generic.Queue[int]"

  function Is-Candidate([int]$idx) {
    $x = $idx % $W
    $y = [int][Math]::Floor($idx / $W)
    $off = $y * $Stride + $x * 4
    $a = [int]$Bytes[$off + 3]
    if ($a -le 0) { return $false }
    $b = [int]$Bytes[$off]
    $g = [int]$Bytes[$off + 1]
    $r = [int]$Bytes[$off + 2]
    $d = [Math]::Abs($r - $SeedR) + [Math]::Abs($g - $SeedG) + [Math]::Abs($b - $SeedB)
    return ($d -le $DistThr)
  }

  function Push-If([int]$idx) {
    if ($idx -lt 0 -or $idx -ge $n) { return }
    if ($seen[$idx]) { return }
    if (-not (Is-Candidate $idx)) { return }
    $seen[$idx] = 1
    $mask[$idx] = 1
    $q.Enqueue($idx)
  }

  # Seed: perimeter pixels only
  for ($x = 0; $x -lt $W; $x++) {
    Push-If $x
    Push-If (($H - 1) * $W + $x)
  }
  for ($y = 1; $y -lt $H - 1; $y++) {
    Push-If ($y * $W)
    Push-If ($y * $W + ($W - 1))
  }

  while ($q.Count -gt 0) {
    $p = $q.Dequeue()
    $x = $p % $W
    $y = [int][Math]::Floor($p / $W)
    if ($x -gt 0) { Push-If ($p - 1) }
    if ($x -lt ($W - 1)) { Push-If ($p + 1) }
    if ($y -gt 0) { Push-If ($p - $W) }
    if ($y -lt ($H - 1)) { Push-If ($p + $W) }
  }

  return $mask
}

function Flood-EdgeMask-BrightLowChroma(
  [byte[]]$Bytes,
  [int]$Stride,
  [int]$W,
  [int]$H,
  [int]$BrightMin,
  [int]$ChromaMax
) {
  $n = $W * $H
  $seen = New-Object byte[] $n
  $mask = New-Object byte[] $n
  $q = New-Object "System.Collections.Generic.Queue[int]"

  function Is-Candidate([int]$idx) {
    $x = $idx % $W
    $y = [int][Math]::Floor($idx / $W)
    $off = $y * $Stride + $x * 4
    $a = [int]$Bytes[$off + 3]
    if ($a -le 0) { return $false }
    $b = [int]$Bytes[$off]
    $g = [int]$Bytes[$off + 1]
    $r = [int]$Bytes[$off + 2]
    $max = $r; if ($g -gt $max) { $max = $g }; if ($b -gt $max) { $max = $b }
    if ($max -lt $BrightMin) { return $false }
    $min = $r; if ($g -lt $min) { $min = $g }; if ($b -lt $min) { $min = $b }
    $chroma = $max - $min
    return ($chroma -le $ChromaMax)
  }

  function Push-If([int]$idx) {
    if ($idx -lt 0 -or $idx -ge $n) { return }
    if ($seen[$idx]) { return }
    if (-not (Is-Candidate $idx)) { return }
    $seen[$idx] = 1
    $mask[$idx] = 1
    $q.Enqueue($idx)
  }

  # Seed: perimeter pixels only
  for ($x = 0; $x -lt $W; $x++) {
    Push-If $x
    Push-If (($H - 1) * $W + $x)
  }
  for ($y = 1; $y -lt $H - 1; $y++) {
    Push-If ($y * $W)
    Push-If ($y * $W + ($W - 1))
  }

  while ($q.Count -gt 0) {
    $p = $q.Dequeue()
    $x = $p % $W
    $y = [int][Math]::Floor($p / $W)
    if ($x -gt 0) { Push-If ($p - 1) }
    if ($x -lt ($W - 1)) { Push-If ($p + 1) }
    if ($y -gt 0) { Push-If ($p - $W) }
    if ($y -lt ($H - 1)) { Push-If ($p + $W) }
  }

  return $mask
}

function Has-Transparency([byte[]]$Bytes) {
  for ($i = 3; $i -lt $Bytes.Length; $i += 4) {
    if ($Bytes[$i] -lt 255) { return $true }
  }
  return $false
}

function Apply-AlphaMask([byte[]]$Bytes, [int]$Stride, [int]$W, [int]$H, [byte[]]$Mask) {
  $n = $W * $H
  $removed = 0
  for ($i = 0; $i -lt $n; $i++) {
    if (-not $Mask[$i]) { continue }
    $x = $i % $W
    $y = [int][Math]::Floor($i / $W)
    $off = $y * $Stride + $x * 4 + 3
    if ($Bytes[$off] -ne 0) { $Bytes[$off] = 0; $removed++ }
  }
  return $removed
}

function Cleanup-File([string]$Path, [string]$OutPath) {
  $bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Path))
  try {
    $img = Read-BitmapBytes32 $bmp
  } finally {
    $bmp.Dispose()
  }

  $bytes = $img.Bytes
  $stride = [int]$img.Stride
  $w = [int]$img.Width
  $h = [int]$img.Height

  $hadTransparency = Has-Transparency $bytes

  # Background removal (safe even if already transparent; it won't cross alpha=0).
  $union = New-Object byte[] ($w * $h)

  $seedKeys = New-Object "System.Collections.Generic.HashSet[string]"
  function Add-SeedKey([int]$r, [int]$g, [int]$b) {
    $rq = [int]([Math]::Round($r / [double]$SeedQuant) * $SeedQuant)
    $gq = [int]([Math]::Round($g / [double]$SeedQuant) * $SeedQuant)
    $bq = [int]([Math]::Round($b / [double]$SeedQuant) * $SeedQuant)
    $rq = [Math]::Max(0, [Math]::Min(255, $rq))
    $gq = [Math]::Max(0, [Math]::Min(255, $gq))
    $bq = [Math]::Max(0, [Math]::Min(255, $bq))
    $k = "{0},{1},{2}" -f $rq, $gq, $bq
    [void]$seedKeys.Add($k)
  }

  # Sample perimeter colors as background seeds (low-chroma only).
  for ($x = 0; $x -lt $w; $x += $SeedStep) {
    foreach ($y in @(0, ($h - 1))) {
      $c = Rgba-At $bytes $stride $x $y
      if ($c[3] -le 0) { continue }
      $r = [int]$c[0]; $g = [int]$c[1]; $b = [int]$c[2]
      $max = $r; if ($g -gt $max) { $max = $g }; if ($b -gt $max) { $max = $b }
      $min = $r; if ($g -lt $min) { $min = $g }; if ($b -lt $min) { $min = $b }
      $chroma = $max - $min
      if ($chroma -gt $SeedChromaMax) { continue }
      if ($max -gt $SeedDarkMax -and $max -lt $SeedBrightMin) { continue }
      Add-SeedKey $r $g $b
    }
  }
  for ($y = 0; $y -lt $h; $y += $SeedStep) {
    foreach ($x in @(0, ($w - 1))) {
      $c = Rgba-At $bytes $stride $x $y
      if ($c[3] -le 0) { continue }
      $r = [int]$c[0]; $g = [int]$c[1]; $b = [int]$c[2]
      $max = $r; if ($g -gt $max) { $max = $g }; if ($b -gt $max) { $max = $b }
      $min = $r; if ($g -lt $min) { $min = $g }; if ($b -lt $min) { $min = $b }
      $chroma = $max - $min
      if ($chroma -gt $SeedChromaMax) { continue }
      if ($max -gt $SeedDarkMax -and $max -lt $SeedBrightMin) { continue }
      Add-SeedKey $r $g $b
    }
  }

  foreach ($k in $seedKeys) {
    $parts = $k.Split(",")
    $sr = [int]$parts[0]; $sg = [int]$parts[1]; $sb = [int]$parts[2]
    $m = Flood-EdgeMask-BySeedColor $bytes $stride $w $h $sr $sg $sb $SeedDistThr
    for ($i = 0; $i -lt $union.Length; $i++) { if ($m[$i]) { $union[$i] = 1 } }
  }

  # Extra: remove very bright low-chroma haze regions (if any).
  $m2 = Flood-EdgeMask-BrightLowChroma $bytes $stride $w $h $BrightMin $BrightChroma
  for ($i = 0; $i -lt $union.Length; $i++) { if ($m2[$i]) { $union[$i] = 1 } }

  $removedBg = Apply-AlphaMask $bytes $stride $w $h $union

  # Low-alpha bright halo cleanup (useful for already-transparent sprites).
  $removedHaze = 0
  $n = $w * $h
  for ($i = 0; $i -lt $n; $i++) {
    $x = $i % $w
    $y = [int][Math]::Floor($i / $w)
    $off = $y * $stride + $x * 4
    $a = [int]$bytes[$off + 3]
    if ($a -le 0 -or $a -gt $HazeAlphaMax) { continue }
    $b = [int]$bytes[$off]
    $g = [int]$bytes[$off + 1]
    $r = [int]$bytes[$off + 2]
    $max = $r; if ($g -gt $max) { $max = $g }; if ($b -gt $max) { $max = $b }
    if ($max -lt $HazeBrightMin) { continue }
    $bytes[$off + 3] = 0
    $removedHaze++
  }

  Write-PngBytes32 $bytes $stride $w $h $OutPath
  return [PSCustomObject]@{
    RemovedBg = $removedBg
    RemovedHaze = $removedHaze
    RemovedTotal = ($removedBg + $removedHaze)
    HadTransparency = $hadTransparency
    Width = $w
    Height = $h
    SeedCount = $seedKeys.Count
  }
}

$dir = Resolve-Path $InputDir
if (-not (Test-Path $dir)) { throw "InputDir not found: $InputDir" }

$pngs = Get-ChildItem -LiteralPath $dir -Filter "*.png" | Sort-Object Name
if (-not $pngs -or $pngs.Count -eq 0) { throw "No PNG files found in: $dir" }

$backupDir = $null
if ($InPlace -and $Backup) {
  $backupDir = Join-Path $dir ("_bg_backup_{0}" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
  Ensure-Dir $backupDir
}

foreach ($f in $pngs) {
  $inPath = $f.FullName
  $outPath = $null
  if ($InPlace) {
    if ($backupDir) { Copy-Item -LiteralPath $inPath -Destination (Join-Path $backupDir $f.Name) -Force }
    $outPath = $inPath
  } else {
    $outPath = Join-Path $dir ("{0}_clean{1}" -f $f.BaseName, $f.Extension)
  }

  $r = Cleanup-File $inPath $outPath
  $mode = "opaque"
  if ($r.HadTransparency) { $mode = "haze" }
  Write-Host ("Cleaned ({0}): {1}  removed={2} (bg={3}, haze={4}, seeds={5})  {6}x{7}" -f $mode, $f.Name, $r.RemovedTotal, $r.RemovedBg, $r.RemovedHaze, $r.SeedCount, $r.Width, $r.Height)
}

Write-Host "Done."
