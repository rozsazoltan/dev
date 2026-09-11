param(
    [Parameter(Mandatory = $true)]
    [string] $Path,
    [Parameter(Mandatory = $true)]
    [UInt64] $SizeBytes
)

$ErrorActionPreference = 'Stop'
New-VHD -Path $Path -SizeBytes $SizeBytes -Dynamic | Out-Null
