#Requires -Version 7.0
# Internal process helper. Paths/key material arrive on stdin, never CLI arguments.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 if(-not $IsWindows){throw 'Windows required.'}
 $taskInput=[Console]::In.ReadToEnd()|ConvertFrom-Json
 $taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 if($taskInput.action -in @('seal','verify')){
  $taskPath=[IO.Path]::GetFullPath($taskInput.path);$taskItem=Get-Item -LiteralPath $taskPath -Force
  if(-not $taskItem.PSIsContainer -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Regular directory required.'}
  if($taskInput.action -eq 'seal'){
   if(@(Get-ChildItem -LiteralPath $taskPath -Force).Count -ne 0){throw 'Only a new empty directory may be sealed.'}
   $taskAcl=[Security.AccessControl.DirectorySecurity]::new();$taskAcl.SetOwner($taskSid);$taskAcl.SetAccessRuleProtection($true,$false)
   foreach($taskIdentity in @($taskSid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $taskRule=[Security.AccessControl.FileSystemAccessRule]::new($taskIdentity,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    $taskAcl.AddAccessRule($taskRule)
   }
   Set-Acl -LiteralPath $taskPath -AclObject $taskAcl
  }
  $taskActual=Get-Acl -LiteralPath $taskPath
  if(-not $taskActual.AreAccessRulesProtected -or $taskActual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $taskSid.Value){throw 'Private owner/protected ACL required.'}
  $taskOwnerAllowed=$false
  foreach($taskRule in $taskActual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   if($taskRule.AccessControlType -eq 'Allow'){
    if($taskRule.IdentityReference.Value -notin @($taskSid.Value,'S-1-5-18')){throw 'Broad filesystem ACL rejected.'}
    if($taskRule.IdentityReference.Value -eq $taskSid.Value -and ($taskRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl){$taskOwnerAllowed=$true}
   }
  }
  if(-not $taskOwnerAllowed){throw 'Owner access required.'}
  [Console]::Out.Write('{"ok":true}');exit 0
 }
 if($taskInput.action -notin @('protect','unprotect') -or $taskInput.id -notmatch '^k_[0-9a-f]{32}$'){throw 'Invalid key protection request.'}
 Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
 $taskBytes=[Convert]::FromBase64String($taskInput.bytes)
 if($taskBytes.Length -gt 16384 -or $taskBytes.Length -lt 1){throw 'Invalid key material size.'}
 $taskEntropy=[Text.Encoding]::UTF8.GetBytes('GatePass|QRKEY|1|'+$taskInput.id)
 if($taskInput.action -eq 'protect'){
  if($taskBytes.Length -ne 32){throw '256-bit key required.'}
  $taskResult=[Security.Cryptography.ProtectedData]::Protect($taskBytes,$taskEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 }else{$taskResult=[Security.Cryptography.ProtectedData]::Unprotect($taskBytes,$taskEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
 try{[Console]::Out.Write((@{ok=$true;bytes=[Convert]::ToBase64String($taskResult)}|ConvertTo-Json -Compress))}
 finally{[Array]::Clear($taskBytes);[Array]::Clear($taskResult)}
}catch{[Console]::Out.Write('{"ok":false}');exit 1}
