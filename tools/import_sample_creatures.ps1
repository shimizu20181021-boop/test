# Import sample creature stage sheets from assets/sample into assets/storybook/creatures_png.
#
# Each input PNG is expected to be a 4-stage horizontal sheet (baby/child/young/adult).
# One sheet per sex is expected (male/female). Filenames are Japanese; to keep this script
# encoding-robust, we detect species/sex by Unicode codepoints.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\tools\import_sample_creatures.ps1
#
# Output paths follow the storybook_preview convention:
#   assets/storybook/creatures_png/<designId>/<sex>_<stage>.png

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$sampleDir = Join-Path $root "assets\\sample"
$outRoot = Join-Path $root "assets\\storybook\\creatures_png"
$split = Join-Path $PSScriptRoot "split_stage_sheet.ps1"

if (-not (Test-Path $sampleDir)) { throw "sampleDir not found: $sampleDir" }
if (-not (Test-Path $split)) { throw "split script not found: $split" }

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Path $Path | Out-Null }
}

Ensure-Dir $outRoot

# Unicode characters (avoid embedding non-ASCII literals in the file).
$CH_ARAI = [char]0x30A2
$CH_INO = [char]0x30A4
$CH_OO = [char]0x30AA
$CH_KUMA = [char]0x30AF
$CH_SHI = [char]0x30B7
$CH_RA = [char]0x30E9
$CH_NEKO = [char]0x732B
$CH_UMA = [char]0x99AC
$CH_NEZU = [char]0x306D

$CH_MALE = [char]0x96C4
$CH_FEMALE = [char]0x96CC

function Design-FromFileName([string]$name) {
  if (-not $name) { return $null }
  $first = $name[0]
  if ($first -eq $CH_ARAI) { return "pred_raccoon" }
  if ($first -eq $CH_INO) { return "omn_boar" }
  if ($first -eq $CH_OO) { return "pred_wolf" }
  if ($first -eq $CH_KUMA) { return "omn_bear" }
  if ($first -eq $CH_SHI) { return "herb_zebra" }
  if ($first -eq $CH_RA) { return "pred_lion" }
  if ($first -eq $CH_NEKO) { return "pred_cat" }
  if ($first -eq $CH_UMA) { return "herb_horse" }
  if ($first -eq $CH_NEZU) { return "omn_mouse" }
  return $null
}

function Sex-FromFileName([string]$name) {
  if (-not $name) { return $null }
  if ($name.IndexOf($CH_MALE) -ge 0) { return "male" }
  if ($name.IndexOf($CH_FEMALE) -ge 0) { return "female" }
  return $null
}

$files = Get-ChildItem -LiteralPath $sampleDir -Filter "*.png" -Recurse
foreach ($f in $files) {
  $design = Design-FromFileName $f.Name
  $sex = Sex-FromFileName $f.Name

  if (-not $design -or -not $sex) {
    Write-Host ("Skip (unrecognized): {0}" -f $f.Name)
    continue
  }

  $outDir = Join-Path $outRoot $design
  Ensure-Dir $outDir

  Write-Host ("Import: {0} -> {1} ({2})" -f $f.Name, $design, $sex)

  & powershell -ExecutionPolicy Bypass -File $split `
    -InputPng $f.FullName `
    -OutputDir $outDir `
    -Sex $sex `
    -SplitMode "equal" `
    -AlphaThreshold 8 `
    -PaddingPct 0.18 `
    -TargetSize 512 | Out-Null
}

Write-Host "Import complete: $outRoot"
