import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

type Platform = "macos" | "linux" | "windows";
type Shell = "powershell" | "cmd" | "wsl";

const SH_CMD = "curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash";
const PS_CMD = "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
];

const SHELLS: { id: Shell; label: string }[] = [
  { id: "powershell", label: "PowerShell" },
  { id: "cmd", label: "CMD" },
  { id: "wsl", label: "WSL" },
];

function detectPlatform(): Platform | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || nav.platform || "").toLowerCase();
  const combined = `${platform} ${nav.userAgent ?? ""}`.toLowerCase();
  if (/android|iphone|ipad|ipod|cros/.test(combined)) return undefined;
  if (nav.maxTouchPoints > 1 && /mac/.test(platform)) return undefined;
  if (/win/.test(platform) || /windows/.test(combined)) return "windows";
  if (/mac/.test(platform)) return "macos";
  if (/linux|x11/.test(platform)) return "linux";
  return undefined;
}

export function InstallPicker() {
  const [platform, setPlatform] = useState<Platform>("linux");
  const [shell, setShell] = useState<Shell>("powershell");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = detectPlatform();
    if (d) setPlatform(d);
  }, []);


  const command = platform === "windows" ? (shell === "wsl" ? SH_CMD : PS_CMD) : SH_CMD;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="overflow-hidden rounded-md border border-border">
        {/* Tab / header row */}
        <div
          role="tablist"
          aria-label="Choose your operating system"
          className="relative flex h-9 items-stretch bg-container-header-bg"
        >
          {PLATFORMS.map((p) => {
            const selected = p.id === platform;
            return (
              <div key={p.id} className="flex items-stretch">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setPlatform(p.id)}
                  className={`inline-flex items-center gap-2 px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                    selected
                      ? "bg-container-workspace-bg text-text-default"
                      : "border-b border-border text-text-muted hover:text-text-strong"
                  }`}
                >
                  {p.label}
                </button>
                <span
                  aria-hidden
                  className={`w-px bg-border ${selected ? "" : "border-b border-border"}`}
                />
              </div>
            );
          })}
          <div
            className={`flex min-w-0 flex-1 items-center border-b border-border ${
              platform === "windows" ? "px-2" : ""
            }`}
          >
            {platform === "windows" && (
              <div
                role="tablist"
                aria-label="Choose your Windows shell"
                className="hidden items-stretch gap-1 rounded-sm sm:flex"
              >

                {SHELLS.map((s) => {
                  const on = s.id === shell;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => setShell(s.id)}
                      className={`rounded-sm px-2 py-0.5 text-xs leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                        on
                          ? "bg-control-bg-hovered text-text-default"
                          : "text-text-muted hover:bg-control-bg hover:text-text-strong"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

            )}
          </div>
        </div>

        {/* Windows shell switcher — own row on mobile */}
        {platform === "windows" && (
          <div
            role="tablist"
            aria-label="Choose your Windows shell"
            className="flex items-stretch gap-1 border-b border-border bg-container-header-bg px-2 py-1.5 sm:hidden"
          >
            {SHELLS.map((s) => {
              const on = s.id === shell;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setShell(s.id)}
                  className={`rounded-sm px-2 py-1 text-xs leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                    on
                      ? "bg-control-bg-hovered text-text-default"
                      : "text-text-muted hover:bg-control-bg hover:text-text-strong"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}



        {/* Command row */}
        <div className="group flex h-[45px] items-stretch bg-container-workspace-bg">
          <code className="font-mono flex min-w-0 flex-1 items-center overflow-x-auto px-3 text-xs whitespace-nowrap text-primary [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {command}
          </code>
          <span aria-hidden className="block w-px flex-none bg-border sm:hidden sm:group-hover:block sm:group-focus-within:block" />
          <button
            type="button"
            onClick={copy}
            aria-label="Copy install command"
            className="flex w-[45px] flex-none items-center justify-center sm:hidden text-text-muted transition-colors sm:group-hover:flex sm:group-focus-within:flex hover:bg-control-bg-hovered hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            {copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
          </button>
        </div>

      </div>
    </div>
  );
}
