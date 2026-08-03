' ============================================================
'  TradePro ERP - Auto-Start Background Service & Tunnel
' ============================================================

Dim shell
Set shell = CreateObject("WScript.Shell")

' 1. Start Node.js Server
Dim appPath, serverScript, logFile
appPath    = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
logFile    = appPath & "\backend\autostart.log"

Dim http
Set http = CreateObject("MSXML2.XMLHTTP")
Dim isRunning
isRunning = False
On Error Resume Next
http.Open "GET", "http://localhost:3000", False
http.Send
If http.Status = 200 Or http.Status = 302 Or http.Status = 404 Then
    isRunning = True
End If
On Error GoTo 0

If Not isRunning Then
    shell.CurrentDirectory = appPath & "\backend"
    shell.Run "cmd /c node server.js > """ & logFile & """ 2>&1", 0, False
End If

' 2. Start Cloudflare Tunnel
Dim wmi, processes, isTunnelRunning
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processes = wmi.ExecQuery("Select * from Win32_Process Where Name = 'cloudflared.exe'")

isTunnelRunning = False
If processes.Count > 0 Then
    isTunnelRunning = True
End If

If Not isTunnelRunning Then
    shell.Run "cmd /c C:\cloudflared.exe tunnel --config C:\Users\ayad\.cloudflared\config.yml run > """ & appPath & "\backend\tunnel.log"" 2>&1", 0, False
End If
