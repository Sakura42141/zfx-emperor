# ZFX Emperor 二改版 — 一键推送 / 建仓
#
# 用法：
#   $env:GH_TOKEN = "github_pat_你的token"     # 只放当前会话环境变量，不落盘
#   pwsh -File push-mod.ps1                    # 默认建【私有】仓库
#   pwsh -File push-mod.ps1 -Public            # 建公开仓库
#   pwsh -File push-mod.ps1 -FixHosts          # 先修复 hosts 劫持（需管理员）
#
# token 生成：GitHub → Settings → Developer settings → Personal access tokens
#            → Fine-grained tokens，勾 repo 读写即可。用完立刻在 GitHub 删掉。
#
# 注意：本机 hosts 把 github.com / api.github.com / raw.githubusercontent.com
#       全段劫持到了 127.0.0.1，会同时打断 API 与 git push。
#       不修的话请用 -FixHosts，或先自行清掉 hosts 里那批 github 映射。

param(
  [string]$RepoName = "zfx-emperor",
  [switch]$Public,
  [switch]$FixHosts,
  [string]$Description = "ZFX Emperor 二改版 — DSH 原生破甲插件（原作者：正方形）"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
$gitCfg = "$env:USERPROFILE\.gitconfig"

# ---------- 0. 可选：修复 hosts 劫持 ----------
if ($FixHosts) {
  $bak = "$hosts.bak-zfx-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $hosts $bak -Force
  $lines = Get-Content $hosts
  $out = $lines | ForEach-Object {
    if ($_ -match '^\s*127\.0\.0\.1\s+.*(github\.com|githubusercontent\.com|github\.io|githubapp\.com|githubassets\.com|github\.dev)') {
      "# [zfx-mod 已注释] $_"
    } else { $_ }
  }
  try {
    Set-Content -Path $hosts -Value $out -Encoding ASCII -ErrorAction Stop
    ipconfig /flushdns | Out-Null
    Write-Host "[0] hosts 已修复（备份：$(Split-Path $bak -Leaf)）" -ForegroundColor Green
  } catch {
    Write-Host "[0] 写入 hosts 失败（需要管理员权限）。备份在 $bak" -ForegroundColor Red
    throw
  }
}

# ---------- 1. 取 token ----------
$token = $env:GH_TOKEN
if (-not $token) {
  Write-Host "没有 GH_TOKEN。先执行：`$env:GH_TOKEN = `"github_pat_xxx`"" -ForegroundColor Red
  exit 1
}

$headers = @{
  Authorization            = "Bearer $token"
  Accept                   = "application/vnd.github+json"
  "X-GitHub-Api-Version"   = "2022-11-28"
}

# ---------- 2. 认领账号 ----------
$me = Invoke-RestMethod -Method Get -Uri "https://api.github.com/user" -Headers $headers
$owner = $me.login
Write-Host "[1] 已认证：$owner"

# ---------- 3. 建仓（已存在则复用） ----------
$exists = $false
try {
  $r = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$owner/$RepoName" -Headers $headers
  $exists = $true
  Write-Host "[2] 仓库已存在：$($r.full_name)"
} catch {
  $vis = if ($Public) { $false } else { $true }
  $body = @{ name = $RepoName; private = $vis; description = $Description } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "https://api.github.com/user/repos" -Headers $headers -Body $body -ContentType "application/json"
  Write-Host "[2] 已创建仓库：$($r.full_name)（$(if($Public){'公开'}else{'私有'})）"
}

# ---------- 4. 临时代管 git insteadOf（本机把 github.com 重写到了 ghfast.top 镜像） ----------
#    镜像只读，直接 push 会失败（403）。这里暂存全局配置、去掉重写、推完恢复。
$cfgBackup = $null
if (Test-Path $gitCfg) { $cfgBackup = Get-Content $gitCfg -Raw }
$insteadOfKeys = @()
try {
  $insteadOfKeys = @(& git config --global --get-regexp '^url\..*\.insteadof$' 2>$null | ForEach-Object { ($_ -split '\s+')[0] })
  foreach ($k in $insteadOfKeys) {
    if ($k -match 'github\.com') { & git config --global --unset-all $k 2>$null | Out-Null }
  }
  if ($insteadOfKeys.Count -gt 0) { Write-Host "[3] 已暂停 github.com URL 重写（$($insteadOfKeys.Count) 条）" }

  # ---------- 5. 初始化本地仓库并提交 ----------
  if (-not (Test-Path (Join-Path $here ".git"))) {
    & git -C $here init -b main | Out-Null
    Write-Host "[4] 已初始化本地仓库（main）"
  }
  & git -C $here add -A
  & git -C $here -c user.name="zfx-emperor mod" -c user.email="mod@localhost" `
      commit -m "二改版 0.2.0-mod.1：修复 DSH 0.2.0-rc.2 下的安装与加载问题

原作者：正方形 (ZFXing-lite)，上游 8237621。
见 MOD-NOTES.md / CHANGELOG.md。" 2>$null | Out-Null

  # ---------- 6. 推送（token 走 extraHeader，不写进 remote / config） ----------
  & git -C $here remote remove origin 2>$null | Out-Null
  & git -C $here remote add origin "https://github.com/$owner/$RepoName.git"
  & git -C $here -c http.extraheader="AUTHORIZATION: Bearer $token" push -u origin HEAD:main
  if ($LASTEXITCODE -ne 0) { throw "git push 失败（exit $LASTEXITCODE）" }
  Write-Host "[5] 推送完成：https://github.com/$owner/$RepoName" -ForegroundColor Green
}
finally {
  # ---------- 7. 收尾：恢复 git 配置，清掉 remote 凭据痕迹 ----------
  if ($null -ne $cfgBackup) { Set-Content -Path $gitCfg -Value $cfgBackup -Encoding UTF8 -NoNewline }
  & git -C $here remote remove origin 2>$null | Out-Null
}

Write-Host ""
Write-Host "完成。token 只在环境变量里，没落盘；remote 已清空。" -ForegroundColor Green
Write-Host "用完记得去 GitHub 删掉这个 token。" -ForegroundColor Yellow
