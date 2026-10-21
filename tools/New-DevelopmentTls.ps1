#Requires -Version 7.0
$ErrorActionPreference='Stop'
if ($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy') { throw 'Development TLS requires explicit dummy mode.' }
$taskKey=[Security.Cryptography.RSA]::Create(2048)
try {
    $taskRequest=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$taskKey,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $taskSan=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new();$taskSan.AddDnsName('localhost');$taskRequest.CertificateExtensions.Add($taskSan.Build())
    $taskCertificate=$taskRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddHours(8))
    try { [Console]::Out.Write([Convert]::ToBase64String($taskCertificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,'local-dummy-only'))) }
    finally {$taskCertificate.Dispose()}
} finally {$taskKey.Dispose()}
