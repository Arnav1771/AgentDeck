/**
 * Cross-platform desktop notification. Best-effort: tries the native tool for
 * the platform and silently no-ops if none is available.
 *   - Linux / WSL: `notify-send` (WSL forwards to Windows via WSLg on Win11).
 *   - Windows fallback: PowerShell toast via BurntToast-free balloon.
 *   - macOS: osascript.
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";

export async function desktopNotify(title: string, body: string): Promise<void> {
  const p = platform();
  try {
    if (p === "linux") {
      // WSLg + most desktops ship notify-send.
      execFile("notify-send", ["-a", "AgentDeck", "-u", "critical", title, body], noop);
      return;
    }
    if (p === "darwin") {
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(
        title,
      )}`;
      execFile("osascript", ["-e", script], noop);
      return;
    }
    if (p === "win32") {
      const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
        $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
        $t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode(${JSON.stringify(title)})) > $null;
        $t.GetElementsByTagName('text')[1].AppendChild($t.CreateTextNode(${JSON.stringify(body)})) > $null;
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AgentDeck').Show([Windows.UI.Notifications.ToastNotification]::new($t));`;
      execFile("powershell.exe", ["-NoProfile", "-Command", ps], noop);
      return;
    }
  } catch {
    /* best-effort */
  }
}

function noop() {
  /* swallow errors — notifications are best-effort */
}
