using System.Diagnostics;
using System.Drawing;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace VrplikeSignerTrayHost;

internal static class Program
{
  [STAThread]
  private static void Main(string[] args)
  {
    var parsed = Args.Parse(args);

    var pipeName = string.IsNullOrWhiteSpace(parsed.PipeName)
      ? DefaultPipeNameForCurrentUser()
      : parsed.PipeName!;

    // Single-instance per-user: lock on a per-user SID-based mutex.
    // If another instance exists, we exit immediately and let the agent talk to the existing tray host.
    var sid = WindowsIdentity.GetCurrent()?.User?.Value ?? "unknown";
    var mutexName = @"Local\vrplike-signer-tray-host-" + sid;
    using var mutex = new Mutex(initiallyOwned: true, name: mutexName, createdNew: out var createdNew);
    if (!createdNew)
    {
      // If tray-host is already running and we were invoked by a deeplink,
      // just (re)start the agent with that deeplink and exit.
      if (!string.IsNullOrWhiteSpace(parsed.DeeplinkUrl))
      {
        TryStartAgent(deeplinkUrl: parsed.DeeplinkUrl);
      }
      return;
    }

    ApplicationConfiguration.Initialize();
    using var ctx = new TrayAppContext(new TrayAppContextArgs
    {
      PipeName = pipeName,
      AppData = parsed.AppData,
      ParentPid = parsed.ParentPid,
      InitialDeeplinkUrl = parsed.DeeplinkUrl
    });
    Application.Run(ctx);
  }

  private static string DefaultPipeNameForCurrentUser()
  {
    var sid = WindowsIdentity.GetCurrent()?.User?.Value ?? "unknown";
    // Named pipes accept a broad charset, but keep it conservative.
    var safeSid = new string(sid.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '_').ToArray());
    return "vrplike-signer-tray-" + (string.IsNullOrWhiteSpace(safeSid) ? "unknown" : safeSid);
  }

  internal static void TryStartAgent(string? deeplinkUrl)
  {
    try
    {
      var exe = Path.Combine(AppContext.BaseDirectory, "vrplike-signer.exe");
      if (!File.Exists(exe)) return;

      var args = new List<string> { "--installed" };
      if (!string.IsNullOrWhiteSpace(deeplinkUrl)) args.Add(deeplinkUrl!.Trim());

      var psi = new ProcessStartInfo
      {
        FileName = exe,
        Arguments = string.Join(" ", args.Select(QuoteArg)),
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden,
        WorkingDirectory = AppContext.BaseDirectory
      };
      Process.Start(psi);
    }
    catch
    {
      // ignore (best-effort)
    }
  }

  private static string QuoteArg(string a)
  {
    if (string.IsNullOrEmpty(a)) return "\"\"";
    if (!a.Contains('\"') && !a.Contains(' ') && !a.Contains('\t')) return a;
    return "\"" + a.Replace("\"", "\\\"") + "\"";
  }
}

internal sealed class Args
{
  public string? PipeName { get; init; }
  public string? AppData { get; init; }
  public int? ParentPid { get; init; }
  public string? DeeplinkUrl { get; init; }

  public static Args Parse(string[] argv)
  {
    string? pipe = null;
    string? appData = null;
    int? parentPid = null;
    string? deeplinkUrl = null;

    for (var i = 0; i < argv.Length; i++)
    {
      var a = argv[i] ?? "";
      if (!a.StartsWith("--", StringComparison.Ordinal))
      {
        if (a.StartsWith("vrplike-signer://", StringComparison.OrdinalIgnoreCase))
        {
          deeplinkUrl = a.Trim();
        }
        continue;
      }
      var key = a.TrimStart('-').Trim().ToLowerInvariant();

      string? next = null;
      if (i + 1 < argv.Length) next = argv[i + 1];

      if (key == "pipe" && !string.IsNullOrWhiteSpace(next))
      {
        pipe = next;
        i++;
        continue;
      }
      if (key == "appdata" && !string.IsNullOrWhiteSpace(next))
      {
        appData = next;
        i++;
        continue;
      }
      if (key == "parentpid" && !string.IsNullOrWhiteSpace(next) && int.TryParse(next, out var pid))
      {
        parentPid = pid;
        i++;
        continue;
      }
    }

    return new Args { PipeName = pipe, AppData = appData, ParentPid = parentPid, DeeplinkUrl = deeplinkUrl };
  }
}

internal sealed class TrayAppContextArgs
{
  public required string PipeName { get; init; }
  public string? AppData { get; init; }
  public int? ParentPid { get; init; }
  public string? InitialDeeplinkUrl { get; init; }
}

internal sealed class TrayAppContext : ApplicationContext, IDisposable
{
  private readonly NotifyIcon _notifyIcon;
  private readonly ToolStripMenuItem _statusItem;
  private readonly ToolStripMenuItem _reconnectItem;
  private readonly ToolStripMenuItem _openLogsItem;
  private readonly ToolStripMenuItem _quitItem;

  private readonly CancellationTokenSource _cts = new();
  private readonly object _ioLock = new();

  private StreamWriter? _writer;
  private readonly SynchronizationContext _ui;
  private readonly string _pipeName;
  private readonly string? _initialDeeplinkUrl;

  private readonly System.Windows.Forms.Timer _parentWatchdog;
  private readonly int? _parentPid;

  private string _status = "RECONNECTING";
  private string _tooltip = "vrplike Signer — переподключение";

  public TrayAppContext(TrayAppContextArgs args)
  {
    _ui = SynchronizationContext.Current ?? new SynchronizationContext();
    _pipeName = args.PipeName;
    _parentPid = args.ParentPid;
    _initialDeeplinkUrl = args.InitialDeeplinkUrl;

    _statusItem = new ToolStripMenuItem("Status") { Enabled = false };
    _reconnectItem = new ToolStripMenuItem("Reconnect");
    _openLogsItem = new ToolStripMenuItem("Open logs");
    _quitItem = new ToolStripMenuItem("Quit");

    _reconnectItem.Click += (_, _) => SendMenuClick("RECONNECT");
    _openLogsItem.Click += (_, _) => SendMenuClick("OPEN_LOGS");
    _quitItem.Click += (_, _) => OnQuitClicked();

    var menu = new ContextMenuStrip();
    menu.Items.AddRange(new ToolStripItem[]
    {
      _statusItem,
      _reconnectItem,
      _openLogsItem,
      _quitItem
    });

    _notifyIcon = new NotifyIcon
    {
      Visible = true,
      Text = TruncateTooltip(_tooltip),
      ContextMenuStrip = menu
    };
    TryApplyTrayIcon();

    // Best-effort: show context menu on left click too.
    _notifyIcon.MouseUp += (_, e) =>
    {
      if (e.Button != MouseButtons.Left) return;
      try
      {
        menu.Show(Cursor.Position);
      }
      catch
      {
        // ignore
      }
    };

    // Start IPC server loop.
    _ = Task.Run(() => PipeServerLoop(_cts.Token));

    // Parent PID watchdog (tray-host should die if agent dies).
    _parentWatchdog = new System.Windows.Forms.Timer { Interval = 2000 };
    _parentWatchdog.Tick += (_, _) =>
    {
      if (_parentPid == null) return;
      if (!IsProcessAlive(_parentPid.Value))
      {
        RequestExit();
      }
    };
    _parentWatchdog.Start();

    ApplyStatusUi();

    // Installed UX invariant:
    // - tray-host is the main entrypoint (autorun + deeplink)
    // - agent should be running (background, no console)
    Program.TryStartAgent(_initialDeeplinkUrl);
  }

  private void TryApplyTrayIcon()
  {
    try
    {
      var ico = Path.Combine(AppContext.BaseDirectory, "tray.ico");
      if (!File.Exists(ico)) return;
      _notifyIcon.Icon = new Icon(ico);
    }
    catch
    {
      // ignore (best-effort)
    }
  }

  private static bool IsProcessAlive(int pid)
  {
    try
    {
      var p = Process.GetProcessById(pid);
      return !p.HasExited;
    }
    catch
    {
      return false;
    }
  }

  private void OnQuitClicked()
  {
    // Tell agent first; then exit after a timeout if agent doesn't respond.
    SendMenuClick("QUIT");
    _statusItem.Text = "Status: quitting…";
    _quitItem.Enabled = false;

    _ = Task.Run(async () =>
    {
      try
      {
        await Task.Delay(8000, _cts.Token);
      }
      catch
      {
        // ignore
      }
      RequestExit();
    });
  }

  private void SendMenuClick(string id)
  {
    SendEvent(new { type = "MENU_CLICK", id });
  }

  private void SendTrayReady()
  {
    SendEvent(new { type = "TRAY_READY" });
  }

  private void SendEvent(object payload)
  {
    string line;
    try
    {
      line = JsonSerializer.Serialize(payload);
    }
    catch
    {
      return;
    }

    lock (_ioLock)
    {
      try
      {
        _writer?.WriteLine(line);
        _writer?.Flush();
      }
      catch
      {
        // ignore (agent may be gone)
      }
    }
  }

  private async Task PipeServerLoop(CancellationToken ct)
  {
    // One client at a time; when disconnected, accept a new client.
    while (!ct.IsCancellationRequested)
    {
      try
      {
        using var server = new NamedPipeServerStream(
          _pipeName,
          PipeDirection.InOut,
          maxNumberOfServerInstances: 1,
          PipeTransmissionMode.Byte,
          PipeOptions.Asynchronous);

        await server.WaitForConnectionAsync(ct);

        using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 16 * 1024, leaveOpen: true);
        using var writer = new StreamWriter(server, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)) { AutoFlush = true };

        lock (_ioLock) _writer = writer;
        SendTrayReady();

        while (!ct.IsCancellationRequested && server.IsConnected)
        {
          var line = await reader.ReadLineAsync();
          if (line == null) break;
          HandleAgentLine(line);
        }
      }
      catch (OperationCanceledException)
      {
        return;
      }
      catch
      {
        // Backoff on transient failures.
        try
        {
          await Task.Delay(250, ct);
        }
        catch
        {
          return;
        }
      }
      finally
      {
        lock (_ioLock) _writer = null;
      }
    }
  }

  private void HandleAgentLine(string line)
  {
    try
    {
      using var doc = JsonDocument.Parse(line);
      var root = doc.RootElement;
      if (!root.TryGetProperty("type", out var tProp)) return;
      var type = tProp.GetString() ?? "";

      if (string.Equals(type, "PING", StringComparison.OrdinalIgnoreCase))
      {
        // no-op
        return;
      }

      if (string.Equals(type, "EXIT", StringComparison.OrdinalIgnoreCase))
      {
        RequestExit();
        return;
      }

      if (string.Equals(type, "SET_STATUS", StringComparison.OrdinalIgnoreCase))
      {
        var status = root.TryGetProperty("status", out var sProp) ? (sProp.GetString() ?? "") : "";
        var tooltip = root.TryGetProperty("tooltip", out var ttProp) ? (ttProp.GetString() ?? "") : "";

        if (!string.IsNullOrWhiteSpace(status)) _status = status.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(tooltip)) _tooltip = tooltip.Trim();
        else _tooltip = DefaultTooltipForStatus(_status);

        _ui.Post(_ => ApplyStatusUi(), null);
        return;
      }
    }
    catch
    {
      // ignore invalid JSON
    }
  }

  private static string DefaultTooltipForStatus(string status)
  {
    return status switch
    {
      "CONNECTED" => "vrplike Signer — подключён",
      "ERROR" => "vrplike Signer — ошибка",
      _ => "vrplike Signer — переподключение"
    };
  }

  private void ApplyStatusUi()
  {
    try
    {
      _statusItem.Text = _status switch
      {
        "CONNECTED" => "Status: connected",
        "ERROR" => "Status: error",
        _ => "Status: reconnecting"
      };
      _notifyIcon.Text = TruncateTooltip(_tooltip);
    }
    catch
    {
      // ignore (tooltip length / disposed race)
    }
  }

  private static string TruncateTooltip(string s)
  {
    // NotifyIcon.Text is limited (63 chars) on many Windows versions; longer throws.
    var text = string.IsNullOrWhiteSpace(s) ? "vrplike Signer" : s.Trim();
    return text.Length <= 63 ? text : text.Substring(0, 63);
  }

  private void RequestExit()
  {
    try
    {
      _ui.Post(_ =>
      {
        try
        {
          _notifyIcon.Visible = false;
        }
        catch { }
        try
        {
          _notifyIcon.Dispose();
        }
        catch { }
        try
        {
          ExitThread();
        }
        catch { }
      }, null);
    }
    catch
    {
      // ignore
    }
  }

  protected override void Dispose(bool disposing)
  {
    if (disposing)
    {
      try { _cts.Cancel(); } catch { }
      try { _parentWatchdog.Stop(); } catch { }
      try { _parentWatchdog.Dispose(); } catch { }
      try { _notifyIcon.Visible = false; } catch { }
      try { _notifyIcon.Dispose(); } catch { }
      try { _cts.Dispose(); } catch { }
    }
    base.Dispose(disposing);
  }
}

