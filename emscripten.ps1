[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter()] [string] $Image = "libass/jso",

    # Extra args forwarded to `docker run` after the image name.
    # You can pass these either via -DockerRunArgs or as trailing args.
    [Parameter()] [string[]] $DockerRunArgs,
    [Parameter(ValueFromRemainingArguments = $true)] [string[]] $RemainingArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked([string] $Command, [string[]] $Arguments) {
    Write-Verbose ("$Command {0}" -f ($Arguments -join ' '))
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

function Resolve-FullPath([string] $Path) {
    return (Resolve-Path -LiteralPath $Path).Path
}

function Ensure-Tool([string] $Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required tool not found in PATH: $Name"
    }
}

$repoRoot = (Get-Location).Path

Ensure-Tool git
Ensure-Tool docker

Write-Host "Syncing & updating submodules..."
Invoke-Checked git @("submodule", "sync")
Invoke-Checked git @("submodule", "update", "--init", "--recursive", "--force")

Write-Host "Building Docker image $Image ..."
Invoke-Checked docker @("build", "-t", $Image, ".")

# Workflow equivalent:
# docker run --rm -v "${PWD}":/code libass/jso:latest
$mountPath = Resolve-FullPath $repoRoot

$dockerArgs = @(
    "run",
    "--rm",
    "-v", "${mountPath}:/code",
    "${Image}:latest"
)
if ($DockerRunArgs) { $dockerArgs += $DockerRunArgs }
if ($RemainingArgs) { $dockerArgs += $RemainingArgs }

Write-Host "Running build container..."
Invoke-Checked docker $dockerArgs


