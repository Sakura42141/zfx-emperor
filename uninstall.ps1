# ZFX Emperor — 卸载
# 用法：pwsh -File uninstall.ps1 -ProfileName web

param(
  [string]$ProfileName = "web",
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" })
)

$ErrorActionPreference = "Stop"
$pluginName = "zfx-emperor"
$target = Join-Path $DshHome "plugins\$pluginName"
$profileJson = Join-Path $DshHome "profiles\$ProfileName\package.json"

# 1. 还原 profile package.json
if (Test-Path $profileJson) {
  $bak = "$profileJson.bak"
  if (Test-Path $bak) {
    Copy-Item $bak $profileJson -Force
    Write-Host "profile package.json 已从备份还原"
  } else {
    $pkg = Get-Content $profileJson -Raw | ConvertFrom-Json -AsHashtable
    $pkg.dependencies.Remove($pluginName) | Out-Null
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne $pluginName })
    $pkg | ConvertTo-Json -Depth 10 | Set-Content $profileJson -Encoding UTF8
    Write-Host "profile package.json 已移除 $pluginName（无备份，手工清理）"
  }
  Push-Location (Join-Path $DshHome "profiles\$ProfileName")
  try { pnpm install } finally { Pop-Location }
}

# 2. 还原引擎补丁：从 .zfx.bak 恢复审批门
$approvalFile = Join-Path $DshHome "node_modules\@deepseek-ai\dsh-user-approval\lib\index.js"
$approvalBak = "$approvalFile.zfx.bak"
if (Test-Path $approvalBak) {
  Copy-Item $approvalBak $approvalFile -Force
  Write-Host "审批门已从备份还原: $approvalFile"
}

# 也检查 npm 全局路径
$npmGlobal = Join-Path ($env:APPDATA ?? "") "npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-user-approval\lib\index.js"
$npmBak = "$npmGlobal.zfx.bak"
if (Test-Path $npmBak) {
  Copy-Item $npmBak $npmGlobal -Force
  Write-Host "审批门已从备份还原 (npm 全局): $npmGlobal"
}

# 3. 还原身份剥离：从 .zfx-identity.bak 恢复 preset 文件
Get-ChildItem $DshHome -Recurse -Filter "*.zfx-identity.bak" -ErrorAction SilentlyContinue | ForEach-Object {
  $original = $_.FullName -replace '\.square-identity\.bak$', ''
  Copy-Item $_.FullName $original -Force
  Write-Host "身份剥离已还原: $original"
}

# 4. 删插件目录
if (Test-Path $target) {
  Remove-Item -Recurse -Force $target
  Write-Host "插件目录已删除: $target"
}

Write-Host ""
Write-Host "卸载完成。重启宿主后正方形 frame 不再注入。" -ForegroundColor Green
