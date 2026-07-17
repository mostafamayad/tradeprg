' ============================================================
'  TradePro ERP - Silent Background Launcher
'  يشغّل السيرفر في الخلفية ويفتح المتصفح تلقائياً
' ============================================================

Dim appPath, serverScript, logFile

' مسار تطبيق Node.js (نفس مجلد هذا الملف)
appPath    = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
serverScript = appPath & "\backend\server.js"
logFile    = appPath & "\backend\server_launcher.log"

' تحقق أن السيرفر مش شغال قبل ما نشغله
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
    ' شغّل node.js بشكل خفي تماماً (no window)
    Dim shell
    Set shell = CreateObject("WScript.Shell")
    shell.CurrentDirectory = appPath & "\backend"
    shell.Run "cmd /c node server.js > """ & logFile & """ 2>&1", 0, False
    
    ' انتظر 4 ثواني للسيرفر يشتغل
    WScript.Sleep 4000
End If

' افتح المتصفح الافتراضي
Dim wshShell
Set wshShell = CreateObject("WScript.Shell")
wshShell.Run "http://localhost:3000", 1, False
