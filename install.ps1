# ZFX Emperor — 安装到本机 DSH
# 用法：在 zfx-emperor 目录下执行 pwsh -File install.ps1
# profile 默认自动探测：唯一带 package.json 的 profile 直接用；
# 多个时优先 desktop，其次 web。也可显式传 -ProfileName。

param(
  [string]$ProfileName = "",
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }),
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$pluginName = "zfx-emperor"
$target = Join-Path $DshHome "plugins\$pluginName"

if (-not $ProfileName) {
  $profilesRoot = Join-Path $DshHome "profiles"
  $cands = @()
  if (Test-Path $profilesRoot) {
    $cands = @(Get-ChildItem $profilesRoot -Directory |
      Where-Object { Test-Path (Join-Path $_.FullName "package.json") } |
      Select-Object -ExpandProperty Name)
  }
  if ($cands.Count -eq 1) {
    $ProfileName = $cands[0]
  } elseif ($cands -contains "desktop") {
    $ProfileName = "desktop"
  } elseif ($cands -contains "web") {
    $ProfileName = "web"
  } elseif ($cands.Count -gt 1) {
    Write-Host "检测到多个 profile：$($cands -join ', ')" -ForegroundColor Yellow
    Write-Host "请用 -ProfileName 指定其中一个。"
    exit 1
  } else {
    Write-Host "未找到任何 profile，请先启动一次宿主让它生成 profile。" -ForegroundColor Red
    exit 1
  }
}

$profileJson = Join-Path $DshHome "profiles\$ProfileName\package.json"

if (-not (Test-Path $profileJson)) {
  Write-Host "找不到 profile：$profileJson" -ForegroundColor Red
  Write-Host "先启动一次该宿主让它生成 profile，再重跑本脚本。"
  exit 1
}

Write-Host "DSH_HOME : $DshHome"
Write-Host "Profile  : $ProfileName"
Write-Host "Plugin   : $pluginName"
if ($DryRun) { Write-Host "[DryRun] 只演示，不写盘" -ForegroundColor Yellow }

# 1. 复制插件到 plugins 目录
if ($DryRun) {
  Write-Host "[1/3] [DryRun] 将复制到 $target"
} else {
  $targetParent = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  }

  # 关键：脚本所在目录可能「就是」目标目录。
  # 若在 ~/.dsh/plugins/zfx-emperor 内直接运行 install.ps1，
  # 原来的「先删后拷」会把脚本自身删掉，复制随即失败，
  # 插件目录被清空 —— 宿主随后读不到 package.json 而报 ENOENT。
  $samePath = $false
  try {
    $hereFull = (Resolve-Path -LiteralPath $here).Path
    if (Test-Path -LiteralPath $target) {
      $targetFull = (Resolve-Path -LiteralPath $target).Path
      $samePath = ($hereFull -eq $targetFull)
      if (-not $samePath) {
        $hSep = $hereFull.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        $tSep = $targetFull.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        $samePath = $hSep.StartsWith($tSep, [StringComparison]::OrdinalIgnoreCase) -or
                    $tSep.StartsWith($hSep, [StringComparison]::OrdinalIgnoreCase)
      }
    }
  } catch { $samePath = $false }

  if ($samePath) {
    Write-Host "[1/3] 插件已在目标位置，跳过复制：$target" -ForegroundColor Yellow
    Write-Host "      （脚本正是在该目录内运行，先删后拷会删掉脚本自身）" -ForegroundColor DarkGray
  } else {
    if (Test-Path -LiteralPath $target) { Remove-Item -Recurse -Force -LiteralPath $target }
    Copy-Item -Recurse -Force $here $target
    Write-Host "[1/3] 插件已复制到 $target"
  }
  Remove-Item -Recurse -Force (Join-Path $target "node_modules") -ErrorAction SilentlyContinue
}

# 2. 备份并改 profile package.json
$bak = "$profileJson.bak"
if (-not $DryRun) {
  if (-not (Test-Path $bak)) { Copy-Item $profileJson $bak }
  $pkg = Get-Content $profileJson -Raw | ConvertFrom-Json -AsHashtable
} else {
  $pkg = Get-Content $profileJson -Raw | ConvertFrom-Json -AsHashtable
}

if (-not $pkg.dependencies) { $pkg.dependencies = @{} }
if ($pkg.dependencies.ContainsKey($pluginName)) {
  Write-Host "      dependencies 已有 $pluginName，跳过" -ForegroundColor Yellow
} else {
  $pkg.dependencies[$pluginName] = "link:$target"
}

$bundles = $pkg.dsh.profile.bundles
if ($bundles -contains $pluginName) {
  Write-Host "      bundles 已有 $pluginName，跳过" -ForegroundColor Yellow
} else {
  $bundles += $pluginName
}

if (-not $DryRun) {
  $pkg | ConvertTo-Json -Depth 10 | Set-Content $profileJson -Encoding UTF8
}
Write-Host "[2/3] profile package.json 已更新（备份：$bak）"

# 3. pnpm install
$profileDir = Join-Path $DshHome "profiles\$ProfileName"
if ($DryRun) {
  Write-Host "[3/3] [DryRun] 跳过 pnpm install"
} else {
  Write-Host "[3/3] 执行 pnpm install ..."
  Push-Location $profileDir
  try {
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（exit $LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "完成。下一步：" -ForegroundColor Green
Write-Host "  1. 完全退出 dsh web（或对应宿主）"
Write-Host "  2. 重新打开，新开一轮对话，正方形 frame 即进入系统提示"
Write-Host "  卸载：pwsh -File uninstall.ps1 -ProfileName $ProfileName"
