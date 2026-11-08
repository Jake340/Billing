$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $projectRoot

$username = (Read-Host "Billing admin username").Trim()
$email = (Read-Host "Billing admin email").Trim()
$password = Read-Host "Billing admin password (at least 12 characters)" -AsSecureString
$passwordAgain = Read-Host "Confirm billing admin password" -AsSecureString

$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordAgain)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)

    if ($plainPassword.Length -lt 12) {
        throw "The password must contain at least 12 characters."
    }
    if ($plainPassword -cne $confirmation) {
        throw "The passwords do not match."
    }
    if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($email)) {
        throw "Username and email are required."
    }

    $env:ADMIN_USERNAME = $username
    $env:ADMIN_EMAIL = $email
    $env:ADMIN_PASSWORD = $plainPassword
    node scripts/create-admin.js
    if ($LASTEXITCODE -ne 0) {
        throw "Administrator creation failed. Check the database connection and try again."
    }
}
finally {
    Remove-Item Env:ADMIN_USERNAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $plainPassword = $null
    $confirmation = $null
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    if ($confirmationPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
    }
    if ($password) { $password.Dispose() }
    if ($passwordAgain) { $passwordAgain.Dispose() }
}
