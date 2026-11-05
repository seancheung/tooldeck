Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $message = '{0}, {1}!' -f $env:TOOLDECK_SETTING_PREFIX, $env:TOOLDECK_PARAM_NAME
    if (($env:TOOLDECK_SETTING_UPPERCASE -eq 'true')) { $message = $message.ToUpperInvariant() }
    [Console]::WriteLine($message)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
