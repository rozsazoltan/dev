param([Parameter(Mandatory = $true)][string] $Path)

$ErrorActionPreference = 'Stop'
$image = Get-DiskImage -ImagePath $Path -ErrorAction SilentlyContinue
if ($null -eq $image) { 'false' } else { $image.Attached.ToString().ToLowerInvariant() }
