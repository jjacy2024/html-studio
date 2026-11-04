param(
  [switch]$InstallRuntime,
  [switch]$Check,
  [switch]$NoSystemNode,
  [string]$NodePath = '',
  [string]$CacheDir = '',
  [string]$ArchivePath = '',
  [switch]$NoOpen,
  [int]$Port = 43876,
  [string]$StateDir = '',
  [string]$ExportDir = ''
)
$ErrorActionPreference = 'Stop'
$editorDir = Split-Path -Parent $PSScriptRoot
if (!(Test-Path -LiteralPath (Join-Path $editorDir 'HTML Studio.html')) -or !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'connector.cjs'))) { throw '请完整解压安装包，并保留 connector 文件夹。' }
if (!$CacheDir) { $CacheDir = Join-Path $env:LOCALAPPDATA 'html-studio\runtime' }
if (![IO.Path]::IsPathRooted($CacheDir)) { throw '运行环境目录必须是绝对路径。' }
$runtimeNode = $null
$runtimeSource = ''
function Find-CompatibleNode([string]$candidate) {
  if (!$candidate -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
  try {
    $found = & $candidate -p "Number(process.versions.node.split('.')[0]) >= 24 ? process.execPath : ''" 2>$null
    if ($LASTEXITCODE -eq 0 -and $found -and (Test-Path -LiteralPath "$found" -PathType Leaf)) { return "$found" }
  } catch {}
  return $null
}
if ($NodePath) {
  $runtimeNode = Find-CompatibleNode $NodePath
  if (!$runtimeNode) { throw '指定的 Node.js 不可运行或版本低于 24。' }
  $runtimeSource = 'selected'
} elseif (!$NoSystemNode) {
  $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $candidates = @()
  if ($command) { $candidates += $command.Source }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
  if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE '.volta\bin\node.exe') }
  foreach ($candidate in $candidates) {
    $runtimeNode = Find-CompatibleNode $candidate
    if ($runtimeNode) { $runtimeSource = 'system'; break }
  }
}
$machineArch = $env:PROCESSOR_ARCHITEW6432
if (!$machineArch) { $machineArch = $env:PROCESSOR_ARCHITECTURE }
switch ($machineArch.ToUpperInvariant()) {
  'AMD64' { $variant = 'win-x64'; $sha = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2' }
  'ARM64' { $variant = 'win-arm64'; $sha = 'f47968c213105077f64c6510f007632c0ca2574802a0b5067c327c49abe1c468' }
  default { throw '暂不支持此 Windows 架构。' }
}
$version = 'v24.22.2'
$prefix = "node-$version-$variant"
$target = Join-Path $CacheDir $prefix
if (!$runtimeNode) {
  $runtimeNode = Find-CompatibleNode (Join-Path $target 'node.exe')
  if ($runtimeNode) { $runtimeSource = 'cached' }
}
if (!$runtimeNode) {
  if (!$InstallRuntime) { Write-Host '未找到兼容的 Node.js（需要 24 或更高）。请把 HTML 入口中的启动提示词发给 Agent；显式添加 -InstallRuntime 才会下载。'; exit 2 }
  [IO.Directory]::CreateDirectory($CacheDir) | Out-Null
  $lockFile = Join-Path $CacheDir "$prefix.install-lock"
  # CreateNew is atomic. A lock is removed only by the process that created it.
  try { $lockHandle = [IO.File]::Open($lockFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
  catch { throw '此运行环境正在安装，或上次安装未正常结束。请先确认，没有安装任务后再检查锁文件。' }
  $stage = Join-Path $CacheDir ('.download-' + [Guid]::NewGuid().ToString('N'))
  try {
    $runtimeNode = Find-CompatibleNode (Join-Path $target 'node.exe')
    if ($runtimeNode) { $runtimeSource = 'cached' }
    else {
      [IO.Directory]::CreateDirectory($stage) | Out-Null
      $archive = Join-Path $stage "$prefix.zip"
      if ($ArchivePath) { Copy-Item -LiteralPath $ArchivePath -Destination $archive }
      else {
        Write-Host '正在从 nodejs.org 下载本工具专用 Node.js。仅首次需要下载，安装包本身不会增大。'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$prefix.zip" -OutFile $archive -TimeoutSec 300
      }
      if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) { throw 'SHA-256 校验不匹配，已停止安装，不能执行此文件。' }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [IO.Compression.ZipFile]::OpenRead($archive)
      $ready = Join-Path $stage 'ready'
      [IO.Directory]::CreateDirectory($ready) | Out-Null
      try {
        foreach ($name in @('node.exe','LICENSE')) {
          $entry = $zip.GetEntry("$prefix/$name")
          if (!$entry) { throw '官方压缩包中缺少必要文件。' }
          [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $ready $name))
        }
      } finally { $zip.Dispose() }
      if (!(Find-CompatibleNode (Join-Path $ready 'node.exe'))) { throw '运行环境无法执行，请检查系统兼容性或设备策略。' }
      if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination ($target + '.invalid-' + [Guid]::NewGuid().ToString('N')) }
      Move-Item -LiteralPath $ready -Destination $target
      $runtimeNode = Join-Path $target 'node.exe'
      $runtimeSource = 'downloaded'
    }
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $lockHandle.Dispose()
    Remove-Item -LiteralPath $lockFile -Force
  }
}
if ($Check) {
  & $runtimeNode -p "JSON.stringify({node:process.execPath,version:process.version,source:process.argv[1]})" $runtimeSource
  exit $LASTEXITCODE
}
Write-Host "运行环境已就绪（$runtimeSource），正在启动编辑器。"
$connectorArgs = @((Join-Path $PSScriptRoot 'connector.cjs'), 'serve', '--root', $editorDir, '--port', "$Port")
if ($NoOpen) { $connectorArgs += '--no-open' }
if ($StateDir) { $connectorArgs += @('--state-dir', $StateDir) }
if ($ExportDir) { $connectorArgs += @('--export-dir', $ExportDir) }
& $runtimeNode @connectorArgs
exit $LASTEXITCODE
