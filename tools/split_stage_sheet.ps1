# Split a horizontal sprite sheet into stage PNGs (baby/child/young/adult).
#
# Example:
#   powershell -ExecutionPolicy Bypass -File .\tools\split_stage_sheet.ps1 `
#     -InputPng ".\assets\sample\豚の雄(成長4段階).png" `
#     -OutputDir ".\assets\storybook\creatures_png\herb_pig" `
#     -Sex "male" `
#     -DuplicateToFemale
#
# Notes:
# - Assumes 4 stages laid out left-to-right.
# - Default SplitMode=auto finds 3 cut lines near 1/4, 2/4, 3/4 by looking for
#   "low-alpha columns", so unevenly spaced sheets still work.
# - By default, outputs square PNGs (TargetSize=512) with alpha-trim + padding so
#   previews don't clip the creature.

param(
  [Parameter(Mandatory = $true)][string]$InputPng,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [ValidateSet("male", "female")][string]$Sex = "male",
  [switch]$DuplicateToFemale,

  # If set, treats the sheet as 2 rows: top sex + bottom sex (the other).
  [switch]$TwoRowSexSheet,
  [ValidateSet("female", "male")][string]$TopRowSex = "female",

  # Output square size (0 = keep original cropped size)
  [ValidateRange(0, 4096)][int]$TargetSize = 512,
  # Alpha threshold for detecting "content"
  [ValidateRange(0, 255)][int]$AlphaThreshold = 8,
  # Padding added around detected content (relative to detected max dimension)
  [ValidateRange(0.0, 0.5)][double]$PaddingPct = 0.10,
  # Cut search radius (pixels) used by SplitMode=auto
  [ValidateRange(1, 4096)][int]$SearchRadiusPx = 260,
  # Split mode: auto (valley search) or equal (simple 1/4 splits)
  [ValidateSet("auto", "equal")][string]$SplitMode = "auto"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

$Transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

$stages = @("baby", "child", "young", "adult")

$SampleStepY = 2
$SmoothRadius = 2

# Component detection (for avoiding "neighbor stage" bleed)
# - We downsample the bitmap into a grid and run BFS to find connected components.
# - Later we refine bounds on the original bitmap.
$ComponentStep = 4
$ComponentMinCount = 25
$ComponentJoinRadiusPx = 32

function Clamp-Int([int]$v, [int]$min, [int]$max) {
  if ($v -lt $min) { return $min }
  if ($v -gt $max) { return $max }
  return $v
}

function Get-ColumnCounts([System.Drawing.Bitmap]$Bmp, [int]$alphaThr, [int]$stepY) {
  $w = $Bmp.Width
  $h = $Bmp.Height
  $counts = New-Object int[] $w
  for ($x = 0; $x -lt $w; $x++) {
    $c = 0
    for ($y = 0; $y -lt $h; $y += $stepY) {
      if ($Bmp.GetPixel($x, $y).A -gt $alphaThr) { $c++ }
    }
    $counts[$x] = $c
  }
  return $counts
}

function Get-SmoothedCounts([int[]]$Counts, [int]$radius) {
  $w = $Counts.Length
  $s = New-Object int[] $w
  for ($x = 0; $x -lt $w; $x++) {
    $sum = 0
    $start = [Math]::Max(0, $x - $radius)
    $end = [Math]::Min($w - 1, $x + $radius)
    for ($i = $start; $i -le $end; $i++) { $sum += $Counts[$i] }
    $s[$x] = $sum
  }
  return $s
}

function Find-MinIndexInRange([int[]]$Values, [int]$start, [int]$end) {
  $best = $start
  $min = [int]::MaxValue
  for ($x = $start; $x -le $end; $x++) {
    $v = $Values[$x]
    if ($v -lt $min) {
      $min = $v
      $best = $x
    }
  }
  return $best
}

function Find-BestValleyIndexInRange([int[]]$Values, [int]$start, [int]$end, [int]$center) {
  # Prefer a local minimum (valley) near the expected center, so "empty margins"
  # at the range edges don't win over the true gap between sprites.
  $best = -1
  $bestV = [int]::MaxValue
  $bestDist = [int]::MaxValue

  if (($end - $start) -ge 2) {
    for ($x = $start + 1; $x -le $end - 1; $x++) {
      $v = $Values[$x]
      if ($v -le $Values[$x - 1] -and $v -le $Values[$x + 1]) {
        $dist = [int][Math]::Abs($x - $center)
        if ($v -lt $bestV -or ($v -eq $bestV -and $dist -lt $bestDist)) {
          $best = $x
          $bestV = $v
          $bestDist = $dist
        }
      }
    }
  }

  if ($best -ge 0) { return $best }
  return Find-MinIndexInRange $Values $start $end
}

function Get-CutXs([System.Drawing.Bitmap]$Bmp, [string]$mode, [int]$alphaThr, [int]$radiusPx) {
  $w = $Bmp.Width
  if ($mode -eq "equal") {
    $segW = [int]($w / $stages.Count)
    # cuts are inclusive end indices for each segment (except the last)
    $c1 = ($segW * 1) - 1
    $c2 = ($segW * 2) - 1
    $c3 = ($segW * 3) - 1
    return @($c1, $c2, $c3)
  }

  $counts = Get-ColumnCounts $Bmp $alphaThr $SampleStepY
  $smooth = Get-SmoothedCounts $counts $SmoothRadius

  $centers = @([int]($w * 0.25), [int]($w * 0.50), [int]($w * 0.75))
  $cuts = @()
  $prev = 0
  for ($i = 0; $i -lt $centers.Count; $i++) {
    $c = $centers[$i]
    $start = Clamp-Int ($c - $radiusPx) ($prev + 10) ($w - 2)
    $end = Clamp-Int ($c + $radiusPx) ($start + 10) ($w - 2)
    $cut = Find-BestValleyIndexInRange $smooth $start $end $c
    $cuts += $cut
    $prev = $cut
  }

  # Ensure strictly increasing and within bounds.
  $cuts[0] = Clamp-Int $cuts[0] 5 ($w - 10)
  $cuts[1] = Clamp-Int $cuts[1] ($cuts[0] + 10) ($w - 10)
  $cuts[2] = Clamp-Int $cuts[2] ($cuts[1] + 10) ($w - 6)
  return $cuts
}

function Find-AlphaBounds(
  [System.Drawing.Bitmap]$Bmp,
  [int]$x0,
  [int]$x1,
  [int]$alphaThr,
  [int]$stepY
) {
  $h = $Bmp.Height
  $minX = [int]::MaxValue
  $minY = [int]::MaxValue
  $maxX = -1
  $maxY = -1

  for ($x = $x0; $x -le $x1; $x++) {
    for ($y = 0; $y -lt $h; $y += $stepY) {
      if ($Bmp.GetPixel($x, $y).A -gt $alphaThr) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0) {
    return $null
  }

  return [PSCustomObject]@{
    MinX = $minX
    MinY = $minY
    MaxX = $maxX
    MaxY = $maxY
    W    = ($maxX - $minX + 1)
    H    = ($maxY - $minY + 1)
  }
}

function Find-SeedIndexInAlphaMask(
  [bool[]]$AlphaMask,
  [int]$w,
  [int]$h,
  [int]$prefX,
  [int]$prefY
) {
  $px = Clamp-Int $prefX 0 ($w - 1)
  $py = Clamp-Int $prefY 0 ($h - 1)
  $baseIdx = ($py * $w + $px)
  if ($AlphaMask[$baseIdx]) { return $baseIdx }

  $maxR = [Math]::Max($w, $h)
  for ($r = 1; $r -le $maxR; $r++) {
    $minX = $px - $r
    $maxX = $px + $r
    $minY = $py - $r
    $maxY = $py + $r

    # top & bottom edges
    for ($x = $minX; $x -le $maxX; $x++) {
      if ($x -ge 0 -and $x -lt $w) {
        if ($minY -ge 0 -and $minY -lt $h) {
          $i = $minY * $w + $x
          if ($AlphaMask[$i]) { return $i }
        }
        if ($maxY -ge 0 -and $maxY -lt $h) {
          $i = $maxY * $w + $x
          if ($AlphaMask[$i]) { return $i }
        }
      }
    }

    # left & right edges (excluding corners already checked)
    for ($y = $minY + 1; $y -le $maxY - 1; $y++) {
      if ($y -ge 0 -and $y -lt $h) {
        if ($minX -ge 0 -and $minX -lt $w) {
          $i = $y * $w + $minX
          if ($AlphaMask[$i]) { return $i }
        }
        if ($maxX -ge 0 -and $maxX -lt $w) {
          $i = $y * $w + $maxX
          if ($AlphaMask[$i]) { return $i }
        }
      }
    }
  }

  return -1
}

function Read-BitmapBytes32([System.Drawing.Bitmap]$Bmp) {
  $w = $Bmp.Width
  $h = $Bmp.Height
  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb

  # Ensure a stable 32bpp surface
  $tmp = New-Object System.Drawing.Bitmap $w, $h, $fmt
  try {
    $g = [System.Drawing.Graphics]::FromImage($tmp)
    try {
      $g.DrawImage($Bmp, 0, 0, $w, $h)
    } finally {
      $g.Dispose()
    }

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

function Extract-MaskedComponentBitmap(
  [byte[]]$SrcBytes,
  [int]$SrcStride,
  [int]$SrcW,
  [int]$SrcH,
  $Comp,
  [int]$alphaThr,
  [int]$roiPad
) {
  $x0 = Clamp-Int ([int]($Comp.MinX - $roiPad)) 0 ($SrcW - 1)
  $x1 = Clamp-Int ([int]($Comp.MaxX + $roiPad)) 0 ($SrcW - 1)
  $y0 = Clamp-Int ([int]($Comp.MinY - $roiPad)) 0 ($SrcH - 1)
  $y1 = Clamp-Int ([int]($Comp.MaxY + $roiPad)) 0 ($SrcH - 1)

  $roiW = [int]($x1 - $x0 + 1)
  $roiH = [int]($y1 - $y0 + 1)
  if ($roiW -le 0 -or $roiH -le 0) { return $null }

  $n = $roiW * $roiH
  $alpha = New-Object bool[] $n

  for ($y = 0; $y -lt $roiH; $y++) {
    $srcRow = ($y0 + $y) * $SrcStride
    $rowBase = $y * $roiW
    for ($x = 0; $x -lt $roiW; $x++) {
      $srcOff = $srcRow + ($x0 + $x) * 4 + 3
      if ($SrcBytes[$srcOff] -gt $alphaThr) { $alpha[$rowBase + $x] = $true }
    }
  }

  $prefX = Clamp-Int ([int][Math]::Round($Comp.Cx) - $x0) 0 ($roiW - 1)
  $prefY = Clamp-Int ([int][Math]::Round($Comp.Cy) - $y0) 0 ($roiH - 1)
  $seed = Find-SeedIndexInAlphaMask $alpha $roiW $roiH $prefX $prefY
  if ($seed -lt 0) { return $null }

  $vis = New-Object bool[] $n
  $mask = New-Object bool[] $n
  $q = New-Object "System.Collections.Generic.Queue[int]"

  $vis[$seed] = $true
  $q.Enqueue($seed)

  $minX = $roiW; $minY = $roiH; $maxX = -1; $maxY = -1
  $count = 0

  while ($q.Count -gt 0) {
    $i = $q.Dequeue()
    if (-not $alpha[$i]) { continue }
    if ($mask[$i]) { continue }

    $mask[$i] = $true
    $count++

    $x = $i % $roiW
    $y = [int][Math]::Floor($i / $roiW)

    if ($x -lt $minX) { $minX = $x }
    if ($x -gt $maxX) { $maxX = $x }
    if ($y -lt $minY) { $minY = $y }
    if ($y -gt $maxY) { $maxY = $y }

    if ($x -gt 0) {
      $ni = $i - 1
      if (-not $vis[$ni]) { $vis[$ni] = $true; if ($alpha[$ni]) { $q.Enqueue($ni) } }
    }
    if ($x -lt ($roiW - 1)) {
      $ni = $i + 1
      if (-not $vis[$ni]) { $vis[$ni] = $true; if ($alpha[$ni]) { $q.Enqueue($ni) } }
    }
    if ($y -gt 0) {
      $ni = $i - $roiW
      if (-not $vis[$ni]) { $vis[$ni] = $true; if ($alpha[$ni]) { $q.Enqueue($ni) } }
    }
    if ($y -lt ($roiH - 1)) {
      $ni = $i + $roiW
      if (-not $vis[$ni]) { $vis[$ni] = $true; if ($alpha[$ni]) { $q.Enqueue($ni) } }
    }
  }

  if ($count -le 0 -or $maxX -lt $minX -or $maxY -lt $minY) { return $null }

  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $dstBmp = New-Object System.Drawing.Bitmap $roiW, $roiH, $fmt
  try {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $roiW, $roiH
    $data = $dstBmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $fmt)
    try {
      $dstStride = $data.Stride
      $dstBytes = New-Object byte[] ($dstStride * $roiH)

      for ($y = 0; $y -lt $roiH; $y++) {
        $srcRow = ($y0 + $y) * $SrcStride
        $dstRow = $y * $dstStride
        $rowBase = $y * $roiW
        for ($x = 0; $x -lt $roiW; $x++) {
          $mi = $rowBase + $x
          if (-not $mask[$mi]) { continue }
          $srcOff = $srcRow + ($x0 + $x) * 4
          $dstOff = $dstRow + $x * 4
          $dstBytes[$dstOff] = $SrcBytes[$srcOff]
          $dstBytes[$dstOff + 1] = $SrcBytes[$srcOff + 1]
          $dstBytes[$dstOff + 2] = $SrcBytes[$srcOff + 2]
          $dstBytes[$dstOff + 3] = $SrcBytes[$srcOff + 3]
        }
      }

      [System.Runtime.InteropServices.Marshal]::Copy($dstBytes, 0, $data.Scan0, $dstBytes.Length)
    } finally {
      $dstBmp.UnlockBits($data)
    }

    return [PSCustomObject]@{
      Bmp  = $dstBmp
      MinX = $minX
      MinY = $minY
      MaxX = $maxX
      MaxY = $maxY
      Count = $count
    }
  } catch {
    $dstBmp.Dispose()
    throw
  }
}

function Find-AlphaBoundsRect(
  [System.Drawing.Bitmap]$Bmp,
  [int]$x0,
  [int]$x1,
  [int]$y0,
  [int]$y1,
  [int]$alphaThr,
  [int]$step
) {
  $w = $Bmp.Width
  $h = $Bmp.Height

  $x0i = Clamp-Int $x0 0 ($w - 1)
  $x1i = Clamp-Int $x1 0 ($w - 1)
  $y0i = Clamp-Int $y0 0 ($h - 1)
  $y1i = Clamp-Int $y1 0 ($h - 1)
  if ($x1i -lt $x0i -or $y1i -lt $y0i) { return $null }

  $minX = [int]::MaxValue
  $minY = [int]::MaxValue
  $maxX = -1
  $maxY = -1

  for ($x = $x0i; $x -le $x1i; $x += $step) {
    for ($y = $y0i; $y -le $y1i; $y += $step) {
      if ($Bmp.GetPixel($x, $y).A -gt $alphaThr) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0) { return $null }
  return [PSCustomObject]@{
    MinX = $minX
    MinY = $minY
    MaxX = $maxX
    MaxY = $maxY
    W    = ($maxX - $minX + 1)
    H    = ($maxY - $minY + 1)
  }
}

function Find-AlphaComponents(
  [System.Drawing.Bitmap]$Bmp,
  [int]$alphaThr,
  [int]$step
) {
  $w = $Bmp.Width
  $h = $Bmp.Height
  $gridW = [int][Math]::Floor(($w - 1) / $step) + 1
  $gridH = [int][Math]::Floor(($h - 1) / $step) + 1

  $n = $gridW * $gridH
  $occ = New-Object bool[] $n
  $vis = New-Object bool[] $n

  function GIdx([int]$gx, [int]$gy) { return $gy * $gridW + $gx }

  for ($gy = 0; $gy -lt $gridH; $gy++) {
    $py = $gy * $step
    for ($gx = 0; $gx -lt $gridW; $gx++) {
      $px = $gx * $step
      $i = GIdx $gx $gy
      if ($Bmp.GetPixel($px, $py).A -gt $alphaThr) { $occ[$i] = $true }
    }
  }

  $dirs = @(
    @(-1, 0), @(1, 0), @(0, -1), @(0, 1),
    @(-1, -1), @(-1, 1), @(1, -1), @(1, 1)
  )

  $q = New-Object "System.Collections.Generic.Queue[int]"
  $components = @()
  $id = 0

  for ($gy = 0; $gy -lt $gridH; $gy++) {
    for ($gx = 0; $gx -lt $gridW; $gx++) {
      $i = GIdx $gx $gy
      if ($vis[$i] -or -not $occ[$i]) { continue }

      $vis[$i] = $true
      $q.Clear()
      $q.Enqueue($i)

      $count = 0
      $minGX = $gx; $maxGX = $gx; $minGY = $gy; $maxGY = $gy

      while ($q.Count -gt 0) {
        $ci = $q.Dequeue()
        $cgx = $ci % $gridW
        $cgy = [int][Math]::Floor($ci / $gridW)
        $count++

        if ($cgx -lt $minGX) { $minGX = $cgx }
        if ($cgx -gt $maxGX) { $maxGX = $cgx }
        if ($cgy -lt $minGY) { $minGY = $cgy }
        if ($cgy -gt $maxGY) { $maxGY = $cgy }

        foreach ($d in $dirs) {
          $ngx = $cgx + $d[0]
          $ngy = $cgy + $d[1]
          if ($ngx -lt 0 -or $ngx -ge $gridW -or $ngy -lt 0 -or $ngy -ge $gridH) { continue }
          $ni = GIdx $ngx $ngy
          if ($vis[$ni] -or -not $occ[$ni]) { continue }
          $vis[$ni] = $true
          $q.Enqueue($ni)
        }
      }

      if ($count -lt $ComponentMinCount) { continue }

      $minX = $minGX * $step
      $maxX = $maxGX * $step
      $minY = $minGY * $step
      $maxY = $maxGY * $step

      # Expand to compensate sampling.
      $minX = Clamp-Int ($minX - $step) 0 ($w - 1)
      $maxX = Clamp-Int ($maxX + $step) 0 ($w - 1)
      $minY = Clamp-Int ($minY - $step) 0 ($h - 1)
      $maxY = Clamp-Int ($maxY + $step) 0 ($h - 1)

      $components += [PSCustomObject]@{
        Id   = $id
        Count = $count
        MinX = $minX
        MinY = $minY
        MaxX = $maxX
        MaxY = $maxY
        Cx   = (($minX + $maxX) / 2.0)
        Cy   = (($minY + $maxY) / 2.0)
      }
      $id++
    }
  }

  return $components
}

function Rect-Distance(
  [int]$aMinX, [int]$aMinY, [int]$aMaxX, [int]$aMaxY,
  [int]$bMinX, [int]$bMinY, [int]$bMaxX, [int]$bMaxY
) {
  $dx = 0
  if ($aMaxX -lt $bMinX) { $dx = $bMinX - $aMaxX }
  elseif ($bMaxX -lt $aMinX) { $dx = $aMinX - $bMaxX }

  $dy = 0
  if ($aMaxY -lt $bMinY) { $dy = $bMinY - $aMaxY }
  elseif ($bMaxY -lt $aMinY) { $dy = $aMinY - $bMaxY }

  return [Math]::Sqrt(($dx * $dx) + ($dy * $dy))
}

function Find-LargestComponentBounds(
  [System.Drawing.Bitmap]$Bmp,
  [int]$x0,
  [int]$x1,
  [int]$alphaThr,
  [int]$step
) {
  $h = $Bmp.Height
  $x0i = [Math]::Max(0, $x0)
  $x1i = [Math]::Min(($Bmp.Width - 1), $x1)
  if ($x1i -lt $x0i) { return $null }

  $gridW = [int][Math]::Floor(($x1i - $x0i) / $step) + 1
  $gridH = [int][Math]::Floor(($h - 1) / $step) + 1

  $n = $gridW * $gridH
  $occ = New-Object bool[] $n
  $vis = New-Object bool[] $n

  function GIdx([int]$gx, [int]$gy) { return $gy * $gridW + $gx }

  # occupancy
  for ($gy = 0; $gy -lt $gridH; $gy++) {
    $py = $gy * $step
    for ($gx = 0; $gx -lt $gridW; $gx++) {
      $px = $x0i + $gx * $step
      $i = GIdx $gx $gy
      if ($Bmp.GetPixel($px, $py).A -gt $alphaThr) { $occ[$i] = $true }
    }
  }

  $bestCount = 0
  $bestMinX = 0
  $bestMaxX = -1
  $bestMinY = 0
  $bestMaxY = -1

  $q = New-Object "System.Collections.Generic.Queue[int]"

  for ($gy = 0; $gy -lt $gridH; $gy++) {
    for ($gx = 0; $gx -lt $gridW; $gx++) {
      $i = GIdx $gx $gy
      if ($vis[$i] -or -not $occ[$i]) { continue }

      $vis[$i] = $true
      $q.Clear()
      $q.Enqueue($i)

      $count = 0
      $minGX = $gx; $maxGX = $gx; $minGY = $gy; $maxGY = $gy

      while ($q.Count -gt 0) {
        $ci = $q.Dequeue()
        $cgx = $ci % $gridW
        $cgy = [int][Math]::Floor($ci / $gridW)
        $count++

        if ($cgx -lt $minGX) { $minGX = $cgx }
        if ($cgx -gt $maxGX) { $maxGX = $cgx }
        if ($cgy -lt $minGY) { $minGY = $cgy }
        if ($cgy -gt $maxGY) { $maxGY = $cgy }

        foreach ($d in @(@(-1, 0), @(1, 0), @(0, -1), @(0, 1))) {
          $ngx = $cgx + $d[0]
          $ngy = $cgy + $d[1]
          if ($ngx -lt 0 -or $ngx -ge $gridW -or $ngy -lt 0 -or $ngy -ge $gridH) { continue }
          $ni = GIdx $ngx $ngy
          if ($vis[$ni] -or -not $occ[$ni]) { continue }
          $vis[$ni] = $true
          $q.Enqueue($ni)
        }
      }

      if ($count -gt $bestCount) {
        $bestCount = $count
        $bestMinX = $x0i + $minGX * $step
        $bestMaxX = $x0i + $maxGX * $step
        $bestMinY = $minGY * $step
        $bestMaxY = $maxGY * $step
      }
    }
  }

  if ($bestCount -le 0 -or $bestMaxX -lt $bestMinX -or $bestMaxY -lt $bestMinY) {
    return $null
  }

  # Expand a tiny bit to compensate downsampling.
  $bestMinX = Clamp-Int ($bestMinX - $step) $x0i $x1i
  $bestMaxX = Clamp-Int ($bestMaxX + $step) $x0i $x1i
  $bestMinY = Clamp-Int ($bestMinY - $step) 0 ($h - 1)
  $bestMaxY = Clamp-Int ($bestMaxY + $step) 0 ($h - 1)

  return [PSCustomObject]@{
    MinX = $bestMinX
    MinY = $bestMinY
    MaxX = $bestMaxX
    MaxY = $bestMaxY
    W    = ($bestMaxX - $bestMinX + 1)
    H    = ($bestMaxY - $bestMinY + 1)
  }
}

function Save-CroppedStage(
  [System.Drawing.Bitmap]$Src,
  [string]$OutPath,
  [int]$cropX,
  [int]$cropY,
  [int]$cropW,
  [int]$cropH,
  [int]$targetSize
) {
  if ($targetSize -le 0) {
    $cloneRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropW, $cropH
    $dst = $Src.Clone($cloneRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $dst.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $dst.Dispose()
    }
    return
  }

  $dst = New-Object System.Drawing.Bitmap $targetSize, $targetSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.Clear($Transparent)
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

      $srcRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropW, $cropH

      # Small outer margin to avoid touching edges (independent from content padding).
      $outerPad = [int][Math]::Round($targetSize * 0.04)
      $availW = [Math]::Max(1, $targetSize - 2 * $outerPad)
      $availH = [Math]::Max(1, $targetSize - 2 * $outerPad)

      $scale = [Math]::Min(($availW / $cropW), ($availH / $cropH))
      if ($scale -le 0) { $scale = 1.0 }

      $dw = [int][Math]::Round($cropW * $scale)
      $dh = [int][Math]::Round($cropH * $scale)
      $dx = [int][Math]::Round(($targetSize - $dw) / 2)
      $dy = [int][Math]::Round(($targetSize - $dh) / 2)

      $dstRect = New-Object System.Drawing.Rectangle $dx, $dy, $dw, $dh
      $g.DrawImage($Src, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $g.Dispose()
    }

    $dst.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $dst.Dispose()
  }
}

function Process-Sheet(
  [System.Drawing.Bitmap]$Bmp,
  [string]$OutDir,
  [string]$OutSex
) {
  $w = $Bmp.Width
  $h = $Bmp.Height

  if ($SplitMode -eq "equal" -and (($w % $stages.Count) -ne 0)) {
    throw "SplitMode=equal requires width ($w) divisible by stage count ($($stages.Count))."
  }

  $cuts = Get-CutXs $Bmp $SplitMode $AlphaThreshold $SearchRadiusPx
  $ranges = @(
    @{ X0 = 0;            X1 = $cuts[0] },
    @{ X0 = $cuts[0] + 1; X1 = $cuts[1] },
    @{ X0 = $cuts[1] + 1; X1 = $cuts[2] },
    @{ X0 = $cuts[2] + 1; X1 = $w - 1 }
  )

  $components = Find-AlphaComponents $Bmp $AlphaThreshold $ComponentStep
  $useComponents = ($null -ne $components -and $components.Count -ge $stages.Count)

  $stageCenters = @()
  for ($i = 0; $i -lt $stages.Count; $i++) {
    $stageCenters += (($i + 0.5) * $w / $stages.Count)
  }

  $mainByStage = @()
  for ($i = 0; $i -lt $stages.Count; $i++) { $mainByStage += $null }

  if ($useComponents) {
    $byStage = @{}
    for ($i = 0; $i -lt $stages.Count; $i++) { $byStage[$i] = @() }

    foreach ($c in $components) {
      $bestStage = 0
      $bestDist = [Math]::Abs($c.Cx - $stageCenters[0])
      for ($i = 1; $i -lt $stages.Count; $i++) {
        $d = [Math]::Abs($c.Cx - $stageCenters[$i])
        if ($d -lt $bestDist) { $bestDist = $d; $bestStage = $i }
      }
      $byStage[$bestStage] += $c
    }

    for ($i = 0; $i -lt $stages.Count; $i++) {
      $cands = $byStage[$i]
      if ($null -eq $cands -or $cands.Count -eq 0) { continue }
      $center = $stageCenters[$i]
      $mainByStage[$i] =
        $cands |
        Sort-Object @{ Expression = "Count"; Descending = $true }, @{ Expression = { [Math]::Abs($_.Cx - $center) } } |
        Select-Object -First 1
    }

    # If any stage is missing, try a simple left-to-right assignment.
    if (($mainByStage | Where-Object { $null -eq $_ }).Count -gt 0) {
      $sorted = $components | Sort-Object Cx
      if ($sorted.Count -ge $stages.Count) {
        for ($i = 0; $i -lt $stages.Count; $i++) { $mainByStage[$i] = $sorted[$i] }
      }
    }
  }

  $src = Read-BitmapBytes32 $Bmp
  $roiPad = [int][Math]::Max(64, $ComponentJoinRadiusPx)

  for ($i = 0; $i -lt $stages.Count; $i++) {
    $stage = $stages[$i]
    $outPath = Join-Path $OutDir ("{0}_{1}.png" -f $OutSex, $stage)

    $comp = $mainByStage[$i]
    if ($null -ne $comp) {
      $ex = Extract-MaskedComponentBitmap $src.Bytes $src.Stride $src.Width $src.Height $comp $AlphaThreshold $roiPad
      if ($null -ne $ex -and $null -ne $ex.Bmp) {
        $masked = $ex.Bmp
        try {
          $bw = [int]($ex.MaxX - $ex.MinX + 1)
          $bh = [int]($ex.MaxY - $ex.MinY + 1)
          $pad = [int][Math]::Round([Math]::Max($bw, $bh) * $PaddingPct)

          $cropX0 = Clamp-Int ($ex.MinX - $pad) 0 ($masked.Width - 1)
          $cropY0 = Clamp-Int ($ex.MinY - $pad) 0 ($masked.Height - 1)
          $cropX1 = Clamp-Int ($ex.MaxX + $pad) 0 ($masked.Width - 1)
          $cropY1 = Clamp-Int ($ex.MaxY + $pad) 0 ($masked.Height - 1)
          $cropW = [int]($cropX1 - $cropX0 + 1)
          $cropH = [int]($cropY1 - $cropY0 + 1)

          Save-CroppedStage $masked $outPath $cropX0 $cropY0 $cropW $cropH $TargetSize
          continue
        } finally {
          $masked.Dispose()
        }
      }
    }

    # Legacy fallback for edge cases (e.g., components couldn't be detected).
    $x0 = [int]$ranges[$i].X0
    $x1 = [int]$ranges[$i].X1
    $b = Find-AlphaBounds $Bmp $x0 $x1 $AlphaThreshold $SampleStepY
    if ($null -eq $b) {
      $b = [PSCustomObject]@{ MinX = $x0; MinY = 0; MaxX = $x1; MaxY = ($h - 1); W = ($x1 - $x0 + 1); H = $h }
    }

    $pad = [int][Math]::Round([Math]::Max($b.W, $b.H) * $PaddingPct)
    # Clamp X to the stage range to avoid pulling in neighbor-stage pixels via padding.
    $cropX0 = Clamp-Int ($b.MinX - $pad) $x0 $x1
    $cropY0 = Clamp-Int ($b.MinY - $pad) 0 ($h - 1)
    $cropX1 = Clamp-Int ($b.MaxX + $pad) $x0 $x1
    $cropY1 = Clamp-Int ($b.MaxY + $pad) 0 ($h - 1)
    $cropW = [int]($cropX1 - $cropX0 + 1)
    $cropH = [int]($cropY1 - $cropY0 + 1)
    Save-CroppedStage $Bmp $outPath $cropX0 $cropY0 $cropW $cropH $TargetSize
  }
}

$inPath = (Resolve-Path $InputPng).Path
Ensure-Dir $OutputDir
$outDir = (Resolve-Path $OutputDir).Path

$src = [System.Drawing.Bitmap]::FromFile($inPath)
try {
  if ($TwoRowSexSheet) {
    $w = $src.Width
    $h = $src.Height
    if (($h % 2) -ne 0) { throw "TwoRowSexSheet requires even height. height=$h" }

    $rowH = [int]($h / 2)
    $topSex = $TopRowSex
    $bottomSex = if ($topSex -eq "female") { "male" } else { "female" }

    $topRect = New-Object System.Drawing.Rectangle 0, 0, $w, $rowH
    $botRect = New-Object System.Drawing.Rectangle 0, $rowH, $w, $rowH

    $topBmp = $src.Clone($topRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      Process-Sheet $topBmp $outDir $topSex
    } finally {
      $topBmp.Dispose()
    }

    $botBmp = $src.Clone($botRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      Process-Sheet $botBmp $outDir $bottomSex
    } finally {
      $botBmp.Dispose()
    }
  } else {
    Process-Sheet $src $outDir $Sex
  }
} finally {
  $src.Dispose()
}

if (-not $TwoRowSexSheet -and $DuplicateToFemale -and $Sex -eq "male") {
  foreach ($stage in $stages) {
    Copy-Item -Force (Join-Path $outDir ("male_{0}.png" -f $stage)) (Join-Path $outDir ("female_{0}.png" -f $stage))
  }
}

Write-Host "Split complete: $inPath -> $outDir"
