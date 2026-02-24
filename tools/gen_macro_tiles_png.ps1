# Macro tile PNG generator (preview + main game use)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\tools\gen_macro_tiles_png.ps1
#
# Outputs (128x128):
#   assets/tiles/macro/ground_gray.png
#   assets/tiles/macro/mountain_gray.png
#   assets/tiles/macro/overlay_plant.png
#   assets/tiles/macro/mask_territory.png

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function New-Bitmap([int]$W, [int]$H) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $bmp.SetResolution(96, 96)
  return $bmp
}

function Hex-ToColor([string]$Hex, [int]$Alpha = 255) {
  $h = $Hex.Trim().TrimStart("#")
  if ($h.Length -ne 6) { throw "Invalid hex: $Hex" }
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb($Alpha, $r, $g, $b)
}

function With-Graphics([System.Drawing.Bitmap]$bmp, [scriptblock]$fn) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    & $fn $g
  } finally {
    $g.Dispose()
  }
}

function Draw-GroundGray([string]$OutPath) {
  $W = 128
  $H = 128
  $seed = [Math]::Abs(("ground_gray").GetHashCode())
  $rand = New-Object System.Random $seed

  $bmp = New-Bitmap $W $H
  try {
    With-Graphics $bmp {
      param($g)

      $rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
      $c0 = Hex-ToColor "#c6c6c6"
      $c1 = Hex-ToColor "#b4b4b4"
      $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c0, $c1, 45.0)
      try {
        $g.FillRectangle($brush, $rect)
      } finally {
        $brush.Dispose()
      }

      # soft vignette
      $edge = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 0, 0, 0))
      try {
        $g.FillRectangle($edge, 0, 0, $W, 6)
        $g.FillRectangle($edge, 0, 0, 6, $H)
        $g.FillRectangle($edge, 0, $H - 6, $W, 6)
        $g.FillRectangle($edge, $W - 6, 0, 6, $H)
      } finally {
        $edge.Dispose()
      }

      # grain speckles (dark + light)
      for ($i = 0; $i -lt 2600; $i++) {
        $x = [float]($rand.NextDouble() * $W)
        $y = [float]($rand.NextDouble() * $H)
        $r = [float](0.6 + $rand.NextDouble() * 2.2)
        $isDark = ($rand.Next(0, 2) -eq 0)
        if ($isDark) {
          $a = $rand.Next(8, 22)
          $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 0, 0, 0))
        } else {
          $a = $rand.Next(6, 16)
          $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 255, 255, 255))
        }
        try {
          $g.FillEllipse($b, $x, $y, $r, $r)
        } finally {
          $b.Dispose()
        }
      }

      # a few larger watercolor blotches
      for ($i = 0; $i -lt 36; $i++) {
        $x = [float]($rand.NextDouble() * $W)
        $y = [float]($rand.NextDouble() * $H)
        $rw = [float](18 + $rand.NextDouble() * 42)
        $rh = [float](14 + $rand.NextDouble() * 40)
        $a = $rand.Next(8, 18)
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 0, 0, 0))
        try {
          $g.FillEllipse($b, $x - $rw * 0.5, $y - $rh * 0.5, $rw, $rh)
        } finally {
          $b.Dispose()
        }
      }

      # subtle scratchy strokes
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(18, 0, 0, 0)), 2
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      try {
        for ($i = 0; $i -lt 28; $i++) {
          $x0 = [float]($rand.NextDouble() * $W)
          $y0 = [float]($rand.NextDouble() * $H)
          $x1 = [float]($x0 + ($rand.NextDouble() * 38 - 19))
          $y1 = [float]($y0 + ($rand.NextDouble() * 22 - 11))
          $g.DrawLine($pen, $x0, $y0, $x1, $y1)
        }
      } finally {
        $pen.Dispose()
      }
    }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bmp.Dispose()
  }
}

function Draw-MountainGray([string]$OutPath) {
  $W = 128
  $H = 128
  $seed = [Math]::Abs(("mountain_gray").GetHashCode())
  $rand = New-Object System.Random $seed

  $bmp = New-Bitmap $W $H
  try {
    With-Graphics $bmp {
      param($g)

      $rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
      $c0 = Hex-ToColor "#b2b2b2"
      $c1 = Hex-ToColor "#8c8c8c"
      $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c0, $c1, 55.0)
      try {
        $g.FillRectangle($brush, $rect)
      } finally {
        $brush.Dispose()
      }

      # stronger vignette (stone edge)
      $edge = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(34, 0, 0, 0))
      try {
        $g.FillRectangle($edge, 0, 0, $W, 7)
        $g.FillRectangle($edge, 0, 0, 7, $H)
        $g.FillRectangle($edge, 0, $H - 7, $W, 7)
        $g.FillRectangle($edge, $W - 7, 0, 7, $H)
      } finally {
        $edge.Dispose()
      }

      # grain speckles (more contrast than ground)
      for ($i = 0; $i -lt 3200; $i++) {
        $x = [float]($rand.NextDouble() * $W)
        $y = [float]($rand.NextDouble() * $H)
        $r = [float](0.6 + $rand.NextDouble() * 2.4)
        $isDark = ($rand.Next(0, 3) -ne 0)
        if ($isDark) {
          $a = $rand.Next(10, 30)
          $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 0, 0, 0))
        } else {
          $a = $rand.Next(6, 18)
          $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 255, 255, 255))
        }
        try {
          $g.FillEllipse($b, $x, $y, $r, $r)
        } finally {
          $b.Dispose()
        }
      }

      # rock "slabs" (soft blobs with slight tone variation)
      for ($i = 0; $i -lt 28; $i++) {
        $cx = [float]($rand.NextDouble() * $W)
        $cy = [float]($rand.NextDouble() * $H)
        $rw = [float](18 + $rand.NextDouble() * 52)
        $rh = [float](14 + $rand.NextDouble() * 44)
        $a = $rand.Next(14, 30)
        $tone = $rand.Next(120, 210)
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, $tone, $tone, $tone))
        try {
          $g.FillEllipse($b, $cx - $rw * 0.5, $cy - $rh * 0.5, $rw, $rh)
        } finally {
          $b.Dispose()
        }
      }

      # cracks (thin, sketchy lines)
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(56, 30, 30, 30)), 2
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
      try {
        for ($i = 0; $i -lt 20; $i++) {
          $x0 = [float]($rand.NextDouble() * $W)
          $y0 = [float]($rand.NextDouble() * $H)
          $seg = $rand.Next(2, 5)
          $x = $x0
          $y = $y0
          for ($s = 0; $s -lt $seg; $s++) {
            $dx = [float](($rand.NextDouble() * 2 - 1) * (10 + $rand.NextDouble() * 22))
            $dy = [float](($rand.NextDouble() * 2 - 1) * (10 + $rand.NextDouble() * 18))
            $x1 = [float]([Math]::Max(0, [Math]::Min($W, $x + $dx)))
            $y1 = [float]([Math]::Max(0, [Math]::Min($H, $y + $dy)))
            $g.DrawLine($pen, $x, $y, $x1, $y1)
            $x = $x1
            $y = $y1
          }
        }
      } finally {
        $pen.Dispose()
      }

      # subtle highlight wash (top-left)
      $hlRect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
      $hlBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($hlRect,
        [System.Drawing.Color]::FromArgb(26, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
        135.0
      )
      try {
        $g.FillRectangle($hlBrush, $hlRect)
      } finally {
        $hlBrush.Dispose()
      }
    }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bmp.Dispose()
  }
}

function Draw-PlantOverlay([string]$OutPath) {
  $W = 128
  $H = 128
  $seed = [Math]::Abs(("overlay_plant").GetHashCode())
  $rand = New-Object System.Random $seed

  $bmp = New-Bitmap $W $H
  try {
    With-Graphics $bmp {
      param($g)

      # transparent green wash
      $wash = New-Object System.Drawing.SolidBrush (Hex-ToColor "#43a047" 54) # ~0.21
      try {
        $g.FillRectangle($wash, 0, 0, $W, $H)
      } finally {
        $wash.Dispose()
      }

      # leafy speckles
      for ($i = 0; $i -lt 1800; $i++) {
        $x = [float]($rand.NextDouble() * $W)
        $y = [float]($rand.NextDouble() * $H)
        $r = [float](0.7 + $rand.NextDouble() * 2.4)
        $a = $rand.Next(18, 44)
        $col = [System.Drawing.Color]::FromArgb($a, 28, 110, 36)
        $b = New-Object System.Drawing.SolidBrush $col
        try {
          $g.FillEllipse($b, $x, $y, $r, $r)
        } finally {
          $b.Dispose()
        }
      }

      # a handful of soft leaf strokes
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(34, 25, 105, 32)), 5
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      try {
        for ($i = 0; $i -lt 14; $i++) {
          $x0 = [float]($rand.NextDouble() * $W)
          $y0 = [float]($rand.NextDouble() * $H)
          $x1 = [float]($x0 + ($rand.NextDouble() * 44 - 22))
          $y1 = [float]($y0 + ($rand.NextDouble() * 28 - 14))
          $g.DrawLine($pen, $x0, $y0, $x1, $y1)
        }
      } finally {
        $pen.Dispose()
      }
    }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bmp.Dispose()
  }
}

function Draw-TerritoryMask([string]$OutPath) {
  $W = 128
  $H = 128
  $seed = [Math]::Abs(("mask_territory").GetHashCode())
  $rand = New-Object System.Random $seed

  $bmp = New-Bitmap $W $H
  try {
    With-Graphics $bmp {
      param($g)

      # watercolor-ish blobs (alpha only, white)
      for ($i = 0; $i -lt 24; $i++) {
        $x = [float]($rand.NextDouble() * $W)
        $y = [float]($rand.NextDouble() * $H)
        $rw = [float](22 + $rand.NextDouble() * 54)
        $rh = [float](20 + $rand.NextDouble() * 48)
        $a = $rand.Next(26, 62)
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 255, 255, 255))
        try {
          $g.FillEllipse($b, $x - $rw * 0.5, $y - $rh * 0.5, $rw, $rh)
        } finally {
          $b.Dispose()
        }
      }

      # brush strokes
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)), 10
      $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      try {
        for ($i = 0; $i -lt 14; $i++) {
          $x0 = [float]($rand.NextDouble() * $W)
          $y0 = [float]($rand.NextDouble() * $H)
          $x1 = [float]($x0 + ($rand.NextDouble() * 84 - 42))
          $y1 = [float]($y0 + ($rand.NextDouble() * 46 - 23))
          $g.DrawLine($pen, $x0, $y0, $x1, $y1)
        }
      } finally {
        $pen.Dispose()
      }

      # fine grain
      for ($i = 0; $i -lt 2000; $i++) {
        $x = [float]($rand.NextDouble() * $W)
        $y = [float]($rand.NextDouble() * $H)
        $r = [float](0.8 + $rand.NextDouble() * 2.4)
        $a = $rand.Next(10, 28)
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 255, 255, 255))
        try {
          $g.FillEllipse($b, $x, $y, $r, $r)
        } finally {
          $b.Dispose()
        }
      }
    }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bmp.Dispose()
  }
}

$outDir = Join-Path $PSScriptRoot "..\\assets\\tiles\\macro"
Ensure-Dir $outDir
$outDir = (Resolve-Path $outDir).Path

Draw-GroundGray (Join-Path $outDir "ground_gray.png")
Draw-MountainGray (Join-Path $outDir "mountain_gray.png")
Draw-PlantOverlay (Join-Path $outDir "overlay_plant.png")
Draw-TerritoryMask (Join-Path $outDir "mask_territory.png")

Write-Host "Generated macro tile PNGs under: $outDir"
