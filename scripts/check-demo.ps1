$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$runId = [guid]::NewGuid().ToString('N')
$stdoutPath = Join-Path $repo ('.demo-check-' + $runId + '.stdout.log')
$stderrPath = Join-Path $repo ('.demo-check-' + $runId + '.stderr.log')
$child = $null
try {
  $node = (Get-Command node -CommandType Application).Source
  $child = Start-Process -FilePath $node -ArgumentList @('bin/chatbridge.js', '--demo', '--port', '0') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $baseUrl = $null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($child.HasExited) { throw ('CLI exited: ' + (Get-Content -LiteralPath $stderrPath -Raw)) }
    if (Test-Path -LiteralPath $stdoutPath) {
      $output = Get-Content -LiteralPath $stdoutPath -Raw
      if ($output -match 'Panel:s+(http://127.0.0.1:d+)/panel') { $baseUrl = $Matches[1]; break }
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $baseUrl) { throw 'No startup URLs within 8 seconds' }
  $output = Get-Content -LiteralPath $stdoutPath -Raw
  if ($output -notmatch '/overlay?for=A' -or $output -notmatch '/overlay?for=B') { throw 'Missing overlay URL' }
  Write-Output $output.Trim()
  & $node scripts/check-demo.mjs $baseUrl
  if ($LASTEXITCODE -ne 0) { throw 'Demo acceptance failed' }
} finally {
  if ($child) {
    if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force }
    $child.WaitForExit()
    Write-Output 'DEMO CHECK: child stopped; no server left running'
    $child.Dispose()
  }
  foreach ($path in @($stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
  }
}