Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $message = '{0}, {1}!' -f $env:TOOLDECK_SETTING_PREFIX, $env:TOOLDECK_PARAM_NAME
    if (($env:TOOLDECK_SETTING_UPPERCASE -eq 'true')) { $message = $message.ToUpperInvariant() }
    if (-not [System.IO.Path]::IsPathFullyQualified($env:TOOLDECK_PARAM_DESTINATION)) {
        throw 'destination must be an absolute path'
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($message + "`n")
    $stream = [System.IO.File]::Open(
        $env:TOOLDECK_PARAM_DESTINATION,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    try { $stream.Write($bytes, 0, $bytes.Length) }
    finally { $stream.Dispose() }
    [Console]::WriteLine('Saved: ' + $env:TOOLDECK_PARAM_DESTINATION)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
