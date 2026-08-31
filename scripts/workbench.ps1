[CmdletBinding()]
param(
    [ValidateSet("status", "frontend", "backend", "start", "test", "help")]
    [string]$Action = "status",

    [int]$FrontendPort = 5500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Path $PSScriptRoot -Parent
$BackendDir = Join-Path $RepoRoot "backend"
$TestsDir = Join-Path $RepoRoot "tests"

function Write-Info([string]$Message) {
    Write-Host "[workbench] $Message"
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Path([string]$PathToCheck, [string]$Description) {
    if (-not (Test-Path -Path $PathToCheck)) {
        throw "Não foi possível localizar $Description em: $PathToCheck"
    }
}

function Show-Status {
    Write-Info "Raiz do projeto: $RepoRoot"
    Write-Info "Node disponível: $(Test-Command node)"
    Write-Info "npm disponível: $(Test-Command npm)"
    Write-Info "Python disponível: $(Test-Command python)"
    Write-Info "Maven disponível: $(Test-Command mvn)"
}

function Start-Frontend {
    Assert-Path $RepoRoot "a raiz do projeto"

    if (Test-Command python) {
        Write-Info "Iniciando frontend com Python na porta $FrontendPort..."
        Start-Process -FilePath "python" -ArgumentList "-m", "http.server", "$FrontendPort" -WorkingDirectory $RepoRoot | Out-Null
        Write-Info "Frontend disponível em: http://localhost:$FrontendPort"
        return
    }

    if (Test-Command npm) {
        Write-Info "Iniciando frontend com npx serve..."
        Start-Process -FilePath "npx" -ArgumentList "serve", ".", "-l", "$FrontendPort" -WorkingDirectory $RepoRoot | Out-Null
        Write-Info "Frontend disponível em: http://localhost:$FrontendPort"
        return
    }

    throw "Nem Python nem npm/npx estão disponíveis para subir o frontend."
}

function Start-Backend {
    Assert-Path $BackendDir "o diretório backend"
    if (-not (Test-Command mvn)) {
        throw "Maven (mvn) não encontrado."
    }

    Write-Info "Iniciando backend Spring Boot..."
    Start-Process -FilePath "mvn" -ArgumentList "spring-boot:run" -WorkingDirectory $BackendDir | Out-Null
    Write-Info "Backend iniciando em: http://localhost:8080"
}

function Invoke-Tests {
    Assert-Path $TestsDir "o diretório de testes"

    if (-not (Test-Command node)) {
        throw "Node.js (node) não encontrado."
    }
    if (-not (Test-Command mvn)) {
        throw "Maven (mvn) não encontrado."
    }

    $nodeTests = @(
        "firebase-sync.test.js",
        "budget-flow.test.js",
        "mercado-pago-badge.test.js",
        "performance-smoke.test.js",
        "plan-limits.test.js",
        "ads-api.test.js",
        "mercado-pago-transaction-check.test.js"
    )

    foreach ($testFile in $nodeTests) {
        $fullPath = Join-Path $TestsDir $testFile
        Assert-Path $fullPath "o teste $testFile"
        Write-Info "Executando teste Node: $testFile"
        & node $fullPath
    }

    Write-Info "Executando testes do backend (mvn test)..."
    & mvn -f (Join-Path $BackendDir "pom.xml") test

    Write-Info "Todos os testes concluídos."
}

function Show-Help {
    Write-Host @"
Uso:
  ./scripts/workbench.ps1 -Action status
  ./scripts/workbench.ps1 -Action frontend [-FrontendPort 5500]
  ./scripts/workbench.ps1 -Action backend
  ./scripts/workbench.ps1 -Action start
  ./scripts/workbench.ps1 -Action test

Ações:
  status    Mostra pré-requisitos disponíveis no ambiente.
  frontend  Inicia apenas o frontend local.
  backend   Inicia apenas o backend Spring Boot.
  start     Inicia frontend e backend.
  test      Executa testes Node (frontend) e Maven (backend).
  help      Exibe esta ajuda.
"@
}

switch ($Action) {
    "status" { Show-Status }
    "frontend" { Start-Frontend }
    "backend" { Start-Backend }
    "start" {
        Start-Frontend
        Start-Backend
    }
    "test" { Invoke-Tests }
    "help" { Show-Help }
    default { Show-Help }
}
