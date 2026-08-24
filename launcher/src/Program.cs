using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("ProcureX Launcher")]
[assembly: AssemblyDescription("ProcureX Windows desktop launcher")]
[assembly: AssemblyCompany("RE DECOR & MORE")]
[assembly: AssemblyProduct("ProcureX")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]
[assembly: AssemblyInformationalVersion("0.3.0")]

namespace ProcureX.WindowsLauncher
{
    internal static class Program
    {
        private const string BrowserUrl = "http://localhost:3000";
        private const string FrontendHealthUrl = "http://127.0.0.1:3000";
        private const string BackendUrl = "http://127.0.0.1:8000/api/";
        private const string MutexName = @"Local\REDecor.ProcureX.Launcher";
        private const string StopEventName = @"Local\REDecor.ProcureX.Stop";
        private const long MaxLogBytes = 5L * 1024L * 1024L;

        private static readonly object LogLock = new object();
        private static string _root;
        private static string _logsDirectory;
        private static string _launcherLog;
        private static string _dataRoot;
        private static bool _installedMode;
        private static bool _noBrowser;
        private static bool _noDialog;
        private static int _startupTimeoutSeconds = 180;

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                Configure(args);
                if (HasArgument(args, "--stop")) return StopExistingSupervisor();
                if (HasArgument(args, "--install")) return InstallShortcuts();
                if (HasArgument(args, "--uninstall-shortcuts")) return UninstallShortcuts();
                if (HasArgument(args, "--self-test")) return SelfTest();
                return LaunchOrOpen();
            }
            catch (Exception exception)
            {
                Log("FATAL: " + exception);
                ShowStartupError(
                    exception is LauncherException
                        ? exception.Message
                        : "ProcureX encountered an unexpected startup error. Review the local logs and try again."
                );
                return 1;
            }
        }

        private static void Configure(string[] args)
        {
            string executableDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string configuredRoot = Environment.GetEnvironmentVariable("PROCUREX_ROOT");
            _root = string.IsNullOrWhiteSpace(configuredRoot)
                ? Path.GetFullPath(Path.Combine(executableDirectory, ".."))
                : Path.GetFullPath(configuredRoot);
            _installedMode = File.Exists(Path.Combine(_root, "runtime", "ProcureXDesktopHost.exe"))
                && File.Exists(Path.Combine(_root, "frontend", "index.html"));
            string configuredDataRoot = Environment.GetEnvironmentVariable("PROCUREX_DATA_ROOT");
            _dataRoot = !string.IsNullOrWhiteSpace(configuredDataRoot)
                ? Path.GetFullPath(Environment.ExpandEnvironmentVariables(configuredDataRoot.Trim(' ', '"')))
                : _installedMode
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ProcureX")
                    : _root;
            _logsDirectory = _installedMode ? Path.Combine(_dataRoot, "logs") : Path.Combine(_root, "logs");
            Directory.CreateDirectory(_logsDirectory);
            if (_installedMode)
            {
                Directory.CreateDirectory(Path.Combine(_dataRoot, "data"));
                Directory.CreateDirectory(Path.Combine(_dataRoot, "data", "attachments", "incoming_requests"));
                Directory.CreateDirectory(Path.Combine(_dataRoot, "data", "backups"));
            }
            _launcherLog = Path.Combine(_logsDirectory, "launcher.log");
            _noBrowser = HasArgument(args, "--no-browser")
                || Environment.GetEnvironmentVariable("PROCUREX_NO_BROWSER") == "1";
            _noDialog = HasArgument(args, "--no-dialog")
                || Environment.GetEnvironmentVariable("PROCUREX_NO_DIALOG") == "1";
            foreach (string argument in args)
            {
                const string prefix = "--timeout-seconds=";
                if (argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    int parsed;
                    if (int.TryParse(argument.Substring(prefix.Length), out parsed) && parsed >= 5)
                    {
                        _startupTimeoutSeconds = parsed;
                    }
                }
            }
        }

        private static int LaunchOrOpen()
        {
            bool createdNew;
            using (Mutex launcherMutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    Log("A launcher supervisor already exists; waiting for health and opening the browser only.");
                    bool duplicateStopRequested;
                    if (!WaitForBothHealthy(_startupTimeoutSeconds, null, null, null, out duplicateStopRequested))
                    {
                        throw new LauncherException(
                            "ProcureX is already starting, but both services did not become healthy. "
                            + "Check logs/launcher.log, logs/backend.log, and logs/frontend.log."
                        );
                    }
                    OpenBrowser();
                    return 0;
                }

                bool backendHealthy = IsBackendHealthy();
                bool frontendHealthy = IsFrontendHealthy();
                if (backendHealthy && frontendHealthy)
                {
                    Log("Both services were already healthy; opening the browser only.");
                    OpenBrowser();
                    return 0;
                }

                EnsurePortAvailableOrHealthy(8000, backendHealthy, "backend");
                EnsurePortAvailableOrHealthy(3000, frontendHealthy, "frontend");

                ServiceProcess backend = null;
                ServiceProcess frontend = null;
                using (WindowsJob job = new WindowsJob())
                using (EventWaitHandle stopEvent = new EventWaitHandle(
                    false, EventResetMode.ManualReset, StopEventName))
                {
                    try
                    {
                        Log("Starting ProcureX. Root: " + _root);
                        if (!backendHealthy)
                        {
                            backend = StartBackend();
                            job.Assign(backend.Process);
                        }
                        else
                        {
                            Log("Backend is already healthy; it will be reused and not owned by this launcher.");
                        }

                        if (!frontendHealthy)
                        {
                            frontend = StartFrontend();
                            job.Assign(frontend.Process);
                        }
                        else
                        {
                            Log("Frontend is already healthy; it will be reused and not owned by this launcher.");
                        }

                        WriteState(backend, frontend);
                        bool stopRequestedDuringStartup;
                        if (!WaitForBothHealthy(
                            _startupTimeoutSeconds, backend, frontend, stopEvent, out stopRequestedDuringStartup))
                        {
                            if (stopRequestedDuringStartup)
                            {
                                Log("Stop signal received during startup.");
                                StopOwnedServices(backend, frontend);
                                return 0;
                            }
                            throw BuildStartupFailure(backend, frontend);
                        }

                        Log("ProcureX is healthy. Opening " + BrowserUrl);
                        OpenBrowser();

                        if (backend == null && frontend == null) return 0;
                        MonitorUntilStop(stopEvent, backend, frontend);
                        return 0;
                    }
                    catch
                    {
                        StopOwnedServices(backend, frontend);
                        throw;
                    }
                    finally
                    {
                        DeleteState();
                        if (backend != null) backend.Dispose();
                        if (frontend != null) frontend.Dispose();
                    }
                }
            }
        }

        private static ServiceProcess StartBackend()
        {
            if (_installedMode)
            {
                string runtime = RequireExecutable(
                    Path.Combine(_root, "runtime", "ProcureXDesktopHost.exe"), "bundled ProcureX runtime");
                ProcessStartInfo installed = HiddenProcess(runtime, "--backend");
                installed.WorkingDirectory = _root;
                ConfigureInstalledEnvironment(installed);
                return ServiceProcess.Start("backend", installed, Path.Combine(_logsDirectory, "backend.log"));
            }

            string python = FindPython();
            string backendDirectory = Path.Combine(_root, "backend");
            string server = Path.Combine(backendDirectory, "server.py");
            if (!File.Exists(server)) throw new LauncherException("Missing backend/server.py.");
            ValidatePythonDependencies(python);

            ProcessStartInfo info = HiddenProcess(python, "-m uvicorn server:app --host 127.0.0.1 --port 8000");
            info.WorkingDirectory = backendDirectory;
            info.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
            info.EnvironmentVariables["APP_ENV"] = "development";
            info.EnvironmentVariables["APP_SURFACE"] = "full";
            return ServiceProcess.Start("backend", info, Path.Combine(_logsDirectory, "backend.log"));
        }

        private static ServiceProcess StartFrontend()
        {
            if (_installedMode)
            {
                string runtime = RequireExecutable(
                    Path.Combine(_root, "runtime", "ProcureXDesktopHost.exe"), "bundled ProcureX runtime");
                string installedFrontendDirectory = Path.Combine(_root, "frontend");
                ProcessStartInfo installed = HiddenProcess(
                    runtime, "--frontend " + Quote(installedFrontendDirectory));
                installed.WorkingDirectory = _root;
                ConfigureInstalledEnvironment(installed);
                return ServiceProcess.Start("frontend", installed, Path.Combine(_logsDirectory, "frontend.log"));
            }

            string node = FindNode();
            string frontendDirectory = Path.Combine(_root, "frontend");
            string craco = Path.Combine(frontendDirectory, "node_modules", "@craco", "craco", "dist", "bin", "craco.js");
            string reactScripts = Path.Combine(frontendDirectory, "node_modules", "react-scripts", "package.json");
            if (!File.Exists(craco) || !File.Exists(reactScripts))
            {
                throw new LauncherException(
                    "Frontend dependencies are missing. Run start_app.bat once or run npm install in the frontend folder."
                );
            }

            ProcessStartInfo info = HiddenProcess(node, Quote(craco) + " start");
            info.WorkingDirectory = frontendDirectory;
            info.EnvironmentVariables["BROWSER"] = "none";
            info.EnvironmentVariables["HOST"] = "127.0.0.1";
            info.EnvironmentVariables["PORT"] = "3000";
            info.EnvironmentVariables["FORCE_COLOR"] = "0";
            return ServiceProcess.Start("frontend", info, Path.Combine(_logsDirectory, "frontend.log"));
        }

        private static void ConfigureInstalledEnvironment(ProcessStartInfo info)
        {
            string database = Path.Combine(_dataRoot, "data", "procurement.db").Replace('\\', '/');
            string attachments = Path.Combine(_dataRoot, "data", "attachments", "incoming_requests");
            info.EnvironmentVariables["PROCUREX_DATA_ROOT"] = _dataRoot;
            info.EnvironmentVariables["DATABASE_URL"] = "sqlite:///" + database;
            info.EnvironmentVariables["INCOMING_REQUEST_UPLOAD_DIR"] = attachments;
            info.EnvironmentVariables["APP_ENV"] = "development";
            info.EnvironmentVariables["APP_SURFACE"] = "full";
            info.EnvironmentVariables["ATTACHMENT_STORAGE_BACKEND"] = "local";
            info.EnvironmentVariables["CORS_ORIGINS"] = "http://localhost:3000,http://127.0.0.1:3000";
            info.EnvironmentVariables["TRUSTED_HOSTS"] = "localhost,127.0.0.1";
            info.EnvironmentVariables["FORCE_HTTPS"] = "false";
            info.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
        }

        private static void MonitorUntilStop(EventWaitHandle stopEvent, ServiceProcess backend, ServiceProcess frontend)
        {
            Log("Launcher supervisor is active. Use the Stop ProcureX shortcut to shut down.");
            while (!stopEvent.WaitOne(1000))
            {
                if (backend != null && backend.Process.HasExited)
                {
                    Log("Backend exited unexpectedly with code " + SafeExitCode(backend.Process) + ".");
                    StopOwnedServices(null, frontend);
                    return;
                }
                if (frontend != null && frontend.Process.HasExited)
                {
                    Log("Frontend exited unexpectedly with code " + SafeExitCode(frontend.Process) + ".");
                    StopOwnedServices(backend, null);
                    return;
                }
            }
            Log("Stop signal received.");
            StopOwnedServices(backend, frontend);
            Log("ProcureX launcher-owned service processes stopped; releasing the process job.");
        }

        private static int StopExistingSupervisor()
        {
            Log("Stop requested.");
            Dictionary<string, string> state = ReadState();
            try
            {
                using (EventWaitHandle stopEvent = EventWaitHandle.OpenExisting(StopEventName))
                {
                    stopEvent.Set();
                }
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                if (!IsBackendHealthy() && !IsFrontendHealthy())
                {
                    DeleteState();
                    Log("No running ProcureX supervisor or healthy service was found.");
                    return 0;
                }
                throw new LauncherException(
                    "ProcureX services are running outside the Windows launcher. "
                    + "Close their original terminal windows or use their original stop method."
                );
            }

            DateTime deadline = DateTime.UtcNow.AddSeconds(20);
            bool waitForBackend = !state.ContainsKey("backend_pid") || state["backend_pid"] != "external";
            bool waitForFrontend = !state.ContainsKey("frontend_pid") || state["frontend_pid"] != "external";
            while (DateTime.UtcNow < deadline)
            {
                bool backendStopped = !waitForBackend || !IsBackendHealthy();
                bool frontendStopped = !waitForFrontend || !IsFrontendHealthy();
                if (backendStopped && frontendStopped) return 0;
                Thread.Sleep(500);
            }
            Log("Stop signal was delivered; at least one externally owned service remains healthy.");
            return 0;
        }

        private static void StopOwnedServices(ServiceProcess backend, ServiceProcess frontend)
        {
            if (frontend != null) frontend.Stop();
            if (backend != null) backend.Stop();
        }

        private static bool WaitForBothHealthy(int timeoutSeconds, ServiceProcess backend,
            ServiceProcess frontend, WaitHandle stopEvent, out bool stopRequested)
        {
            stopRequested = false;
            DateTime deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
            while (DateTime.UtcNow < deadline)
            {
                if (stopEvent != null && stopEvent.WaitOne(0))
                {
                    stopRequested = true;
                    return false;
                }
                if (backend != null && backend.Process.HasExited) return false;
                if (frontend != null && frontend.Process.HasExited) return false;
                if (IsBackendHealthy() && IsFrontendHealthy()) return true;
                Thread.Sleep(500);
            }
            return false;
        }

        private static LauncherException BuildStartupFailure(ServiceProcess backend, ServiceProcess frontend)
        {
            List<string> failures = new List<string>();
            if (!IsBackendHealthy())
            {
                failures.Add(backend != null && backend.Process.HasExited
                    ? "backend exited with code " + SafeExitCode(backend.Process)
                    : "backend health check timed out");
            }
            if (!IsFrontendHealthy())
            {
                failures.Add(frontend != null && frontend.Process.HasExited
                    ? "frontend exited with code " + SafeExitCode(frontend.Process)
                    : "frontend health check timed out");
            }
            return new LauncherException(
                "ProcureX startup failed: " + string.Join("; ", failures.ToArray())
                + ". Review the files in the logs folder."
            );
        }

        private static void EnsurePortAvailableOrHealthy(int port, bool healthy, string service)
        {
            if (!healthy && IsPortListening(port))
            {
                throw new LauncherException(
                    "Port " + port + " is already occupied by a service that is not the ProcureX " + service
                    + ". Close that application and try again."
                );
            }
        }

        private static bool IsBackendHealthy()
        {
            string body;
            return TryGet(BackendUrl, out body) && body.IndexOf("Procurement ERP API", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool IsFrontendHealthy()
        {
            string body;
            if (!TryGet(FrontendHealthUrl, out body)) return false;
            return body.IndexOf("id=\"root\"", StringComparison.OrdinalIgnoreCase) >= 0
                && body.IndexOf("RE DECOR & MORE", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool TryGet(string url, out string body)
        {
            body = string.Empty;
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Timeout = 1500;
                request.ReadWriteTimeout = 1500;
                request.Proxy = null;
                request.KeepAlive = false;
                request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                request.UserAgent = "ProcureXLauncher/1.0";
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool IsPortListening(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect(IPAddress.Loopback, port, null, null);
                    bool connected = result.AsyncWaitHandle.WaitOne(400);
                    if (connected) client.EndConnect(result);
                    return connected;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindPython()
        {
            string configured = Environment.GetEnvironmentVariable("PROCUREX_PYTHON");
            if (!string.IsNullOrWhiteSpace(configured)) return RequireExecutable(configured, "configured Python");
            string local = Path.Combine(_root, ".venv", "Scripts", "python.exe");
            if (File.Exists(local)) return local;
            string path = FindOnPath("py.exe") ?? FindOnPath("python.exe");
            if (path == null)
            {
                throw new LauncherException("Python was not found. Install Python 3.11+ or run start_app.bat once.");
            }
            return path;
        }

        private static string FindNode()
        {
            string configured = Environment.GetEnvironmentVariable("PROCUREX_NODE");
            if (!string.IsNullOrWhiteSpace(configured)) return RequireExecutable(configured, "configured Node.js");
            string path = FindOnPath("node.exe");
            if (path == null)
            {
                string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                string common = Path.Combine(programFiles, "nodejs", "node.exe");
                if (File.Exists(common)) path = common;
            }
            if (path == null) throw new LauncherException("Node.js was not found. Install Node.js 20 LTS and try again.");
            return path;
        }

        private static string RequireExecutable(string path, string label)
        {
            string expanded = Environment.ExpandEnvironmentVariables(path.Trim(' ', '"'));
            if (!File.Exists(expanded)) throw new LauncherException("The " + label + " executable does not exist: " + expanded);
            return Path.GetFullPath(expanded);
        }

        private static string FindOnPath(string fileName)
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (string directory in path.Split(Path.PathSeparator))
            {
                try
                {
                    string candidate = Path.Combine(directory.Trim(' ', '"'), fileName);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }

        private static void ValidatePythonDependencies(string python)
        {
            ProcessStartInfo check = HiddenProcess(
                python,
                "-c \"import fastapi,uvicorn,sqlalchemy,dotenv,multipart,openpyxl\""
            );
            check.WorkingDirectory = _root;
            string output;
            int exitCode = RunCheck(check, 20, out output);
            if (exitCode != 0)
            {
                throw new LauncherException(
                    "Backend Python dependencies are missing. Run start_app.bat once. Details: " + output.Trim()
                );
            }
        }

        private static int RunCheck(ProcessStartInfo info, int timeoutSeconds, out string output)
        {
            using (Process process = Process.Start(info))
            {
                string stdout = process.StandardOutput.ReadToEnd();
                string stderr = process.StandardError.ReadToEnd();
                if (!process.WaitForExit(timeoutSeconds * 1000))
                {
                    process.Kill();
                    output = "Dependency check timed out.";
                    return -1;
                }
                output = stdout + stderr;
                return process.ExitCode;
            }
        }

        private static ProcessStartInfo HiddenProcess(string fileName, string arguments)
        {
            return new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = false
            };
        }

        private static void OpenBrowser()
        {
            if (_noBrowser)
            {
                Log("Browser opening suppressed by test option.");
                return;
            }
            Process.Start(new ProcessStartInfo(BrowserUrl) { UseShellExecute = true });
        }

        private static void WriteState(ServiceProcess backend, ServiceProcess frontend)
        {
            string path = Path.Combine(_logsDirectory, "launcher.state");
            File.WriteAllLines(path, new[]
            {
                "launcher_pid=" + Process.GetCurrentProcess().Id,
                "backend_pid=" + (backend == null ? "external" : backend.Process.Id.ToString(CultureInfo.InvariantCulture)),
                "frontend_pid=" + (frontend == null ? "external" : frontend.Process.Id.ToString(CultureInfo.InvariantCulture)),
                "started_utc=" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            });
        }

        private static void DeleteState()
        {
            string path = Path.Combine(_logsDirectory, "launcher.state");
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception exception) { Log("Could not remove stale launcher state: " + exception.Message); }
        }

        private static Dictionary<string, string> ReadState()
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string path = Path.Combine(_logsDirectory, "launcher.state");
            try
            {
                if (!File.Exists(path)) return values;
                foreach (string line in File.ReadAllLines(path))
                {
                    int separator = line.IndexOf('=');
                    if (separator > 0) values[line.Substring(0, separator)] = line.Substring(separator + 1);
                }
            }
            catch (Exception exception)
            {
                Log("Could not read launcher state: " + exception.Message);
            }
            return values;
        }

        private static int InstallShortcuts()
        {
            string executable = Assembly.GetExecutingAssembly().Location;
            string icon = Path.Combine(Path.GetDirectoryName(executable), "assets", "ProcureX.ico");
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ProcureX");
            Directory.CreateDirectory(startMenu);
            CreateShortcut(Path.Combine(desktop, "ProcureX.lnk"), executable, string.Empty, _root, icon,
                "Start ProcureX silently");
            CreateShortcut(Path.Combine(desktop, "Stop ProcureX.lnk"), executable, "--stop", _root, icon,
                "Stop ProcureX services");
            CreateShortcut(Path.Combine(startMenu, "ProcureX.lnk"), executable, string.Empty, _root, icon,
                "Start ProcureX silently");
            CreateShortcut(Path.Combine(startMenu, "Stop ProcureX.lnk"), executable, "--stop", _root, icon,
                "Stop ProcureX services");
            Log("Desktop and Start Menu shortcuts installed.");
            return 0;
        }

        private static int UninstallShortcuts()
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ProcureX");
            DeleteExactShortcut(Path.Combine(desktop, "ProcureX.lnk"));
            DeleteExactShortcut(Path.Combine(desktop, "Stop ProcureX.lnk"));
            DeleteExactShortcut(Path.Combine(startMenu, "ProcureX.lnk"));
            DeleteExactShortcut(Path.Combine(startMenu, "Stop ProcureX.lnk"));
            if (Directory.Exists(startMenu) && Directory.GetFileSystemEntries(startMenu).Length == 0)
            {
                Directory.Delete(startMenu);
            }
            Log("ProcureX shortcuts removed.");
            return 0;
        }

        private static void CreateShortcut(string shortcutPath, string target, string arguments,
            string workingDirectory, string icon, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new LauncherException("Windows Script Host is unavailable; shortcuts could not be created.");
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                    null, shell, new object[] { shortcutPath });
                Type shortcutType = shortcut.GetType();
                shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
                shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
                shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut,
                    new object[] { File.Exists(icon) ? icon + ",0" : target + ",0" });
                shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                Marshal.FinalReleaseComObject(shortcut);
            }
            finally
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }

        private static void DeleteExactShortcut(string path)
        {
            if (File.Exists(path)) File.Delete(path);
        }

        private static int SelfTest()
        {
            List<string> failures = new List<string>();
            if (Quote("C:\\A B\\x.exe") != "\"C:\\A B\\x.exe\"") failures.Add("argument quoting");
            if (!Path.IsPathRooted(_root)) failures.Add("root resolution");
            if (string.IsNullOrEmpty(_launcherLog)) failures.Add("log resolution");
            if (_installedMode && _dataRoot.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
                failures.Add("installed writable data must be outside Program Files");
            if (failures.Count > 0) throw new LauncherException("Self-test failed: " + string.Join(", ", failures.ToArray()));
            Log("Launcher self-test passed.");
            return 0;
        }

        private static void ShowStartupError(string message)
        {
            if (_noDialog) return;
            MessageBox.Show(
                message + Environment.NewLine + Environment.NewLine
                + "Logs: " + _logsDirectory,
                "ProcureX could not start",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }

        private static void Log(string message)
        {
            try
            {
                lock (LogLock)
                {
                    if (string.IsNullOrEmpty(_launcherLog)) return;
                    Directory.CreateDirectory(Path.GetDirectoryName(_launcherLog));
                    RotateLogIfNeeded(_launcherLog);
                    File.AppendAllText(
                        _launcherLog,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture)
                        + " [launcher] " + message + Environment.NewLine,
                        new UTF8Encoding(false)
                    );
                }
            }
            catch { }
        }

        private static void RotateLogIfNeeded(string path)
        {
            if (!File.Exists(path) || new FileInfo(path).Length < MaxLogBytes) return;
            string archive = path + ".1";
            if (File.Exists(archive)) File.Delete(archive);
            File.Move(path, archive);
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static bool HasArgument(string[] args, string expected)
        {
            foreach (string argument in args)
            {
                if (string.Equals(argument, expected, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static int SafeExitCode(Process process)
        {
            try { return process.ExitCode; }
            catch { return -1; }
        }

        private sealed class LauncherException : Exception
        {
            internal LauncherException(string message) : base(message) { }
        }

        private sealed class ServiceProcess : IDisposable
        {
            private readonly string _name;
            private readonly string _logPath;
            private readonly object _writeLock = new object();
            internal Process Process { get; private set; }

            private ServiceProcess(string name, Process process, string logPath)
            {
                _name = name;
                Process = process;
                _logPath = logPath;
            }

            internal static ServiceProcess Start(string name, ProcessStartInfo info, string logPath)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(logPath));
                ServiceProcess service = new ServiceProcess(name, new Process { StartInfo = info }, logPath);
                service.Process.OutputDataReceived += service.OnOutput;
                service.Process.ErrorDataReceived += service.OnError;
                if (!service.Process.Start()) throw new LauncherException("Could not start the ProcureX " + name + ".");
                service.Append("launcher", "Started PID " + service.Process.Id + ".");
                service.Process.BeginOutputReadLine();
                service.Process.BeginErrorReadLine();
                return service;
            }

            private void OnOutput(object sender, DataReceivedEventArgs args)
            {
                if (args.Data != null) Append("stdout", args.Data);
            }

            private void OnError(object sender, DataReceivedEventArgs args)
            {
                if (args.Data != null) Append("stderr", args.Data);
            }

            private void Append(string stream, string text)
            {
                lock (_writeLock)
                {
                    RotateLogIfNeeded(_logPath);
                    File.AppendAllText(
                        _logPath,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture)
                        + " [" + _name + ":" + stream + "] " + text + Environment.NewLine,
                        new UTF8Encoding(false)
                    );
                }
            }

            internal void Stop()
            {
                try
                {
                    if (Process == null || Process.HasExited) return;
                    Append("launcher", "Stopping PID " + Process.Id + ".");
                    if (Process.CloseMainWindow() && Process.WaitForExit(3000)) return;
                    Process.Kill();
                    Process.WaitForExit(10000);
                }
                catch (Exception exception)
                {
                    Append("launcher", "Stop warning: " + exception.Message);
                }
            }

            public void Dispose()
            {
                if (Process == null) return;
                Process.OutputDataReceived -= OnOutput;
                Process.ErrorDataReceived -= OnError;
                Process.Dispose();
                Process = null;
            }
        }

        private sealed class WindowsJob : IDisposable
        {
            private IntPtr _handle;

            internal WindowsJob()
            {
                _handle = NativeMethods.CreateJobObject(IntPtr.Zero, null);
                if (_handle == IntPtr.Zero) throw new LauncherException("Windows could not create the ProcureX process job.");
                NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION information =
                    new NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                information.BasicLimitInformation.LimitFlags = NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                int length = Marshal.SizeOf(typeof(NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr pointer = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(information, pointer, false);
                    if (!NativeMethods.SetInformationJobObject(_handle, 9, pointer, (uint)length))
                    {
                        throw new LauncherException("Windows could not configure the ProcureX process job.");
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(pointer);
                }
            }

            internal void Assign(Process process)
            {
                if (!NativeMethods.AssignProcessToJobObject(_handle, process.Handle))
                {
                    throw new LauncherException("Windows could not supervise the ProcureX " + process.Id + " process.");
                }
            }

            public void Dispose()
            {
                if (_handle != IntPtr.Zero)
                {
                    NativeMethods.CloseHandle(_handle);
                    _handle = IntPtr.Zero;
                }
            }
        }

        private static class NativeMethods
        {
            internal const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

            [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
            internal static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

            [DllImport("kernel32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool SetInformationJobObject(IntPtr job, int informationClass,
                IntPtr information, uint informationLength);

            [DllImport("kernel32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

            [DllImport("kernel32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool CloseHandle(IntPtr handle);

            [StructLayout(LayoutKind.Sequential)]
            internal struct JOBOBJECT_BASIC_LIMIT_INFORMATION
            {
                internal long PerProcessUserTimeLimit;
                internal long PerJobUserTimeLimit;
                internal uint LimitFlags;
                internal UIntPtr MinimumWorkingSetSize;
                internal UIntPtr MaximumWorkingSetSize;
                internal uint ActiveProcessLimit;
                internal UIntPtr Affinity;
                internal uint PriorityClass;
                internal uint SchedulingClass;
            }

            [StructLayout(LayoutKind.Sequential)]
            internal struct IO_COUNTERS
            {
                internal ulong ReadOperationCount;
                internal ulong WriteOperationCount;
                internal ulong OtherOperationCount;
                internal ulong ReadTransferCount;
                internal ulong WriteTransferCount;
                internal ulong OtherTransferCount;
            }

            [StructLayout(LayoutKind.Sequential)]
            internal struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
                internal IO_COUNTERS IoInfo;
                internal UIntPtr ProcessMemoryLimit;
                internal UIntPtr JobMemoryLimit;
                internal UIntPtr PeakProcessMemoryUsed;
                internal UIntPtr PeakJobMemoryUsed;
            }
        }
    }
}
