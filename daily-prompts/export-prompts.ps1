<#
.SYNOPSIS
    Export Copilot chat prompts into the dated running log (chat-prompts.txt).

.EXAMPLE
    ./export-prompts.ps1                 # today's prompts
    ./export-prompts.ps1 -Date 2026-07-11
    ./export-prompts.ps1 -Days 3         # last 3 days
#>
param(
    [string]$Date,
    [int]$Days = 1
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "export_prompts.py"

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $python) { throw "Python not found. Install Python 3 or run export_prompts.py manually." }

$args = @($script, "--days", $Days)
if ($Date) { $args += @("--date", $Date) }

& $python @args
