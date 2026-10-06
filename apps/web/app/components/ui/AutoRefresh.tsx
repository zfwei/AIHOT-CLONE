import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigation, useRevalidator } from "react-router";
import { startAutoRefresh } from "../../lib/auto-refresh";

export function AutoRefresh({ intervalMs = 60_000, pauseWhileReading = false }: { intervalMs?: number; pauseWhileReading?: boolean }) {
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const current = useRef({ navigation, revalidator });
  current.current = { navigation, revalidator };
  const controller = useRef<ReturnType<typeof startAutoRefresh> | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCheckedAt(new Date());
    setFailed(false);
    const refresh = startAutoRefresh({
      intervalMs,
      pauseWhileReading,
      available: () => current.current.navigation.state === "idle" && current.current.revalidator.state === "idle",
      refresh: () => current.current.revalidator.revalidate(),
      checked: (at) => { setCheckedAt(at); setFailed(false); },
      failed: () => setFailed(true),
    });
    controller.current = refresh;
    return () => { refresh.stop(); controller.current = null; };
  }, [location.key, intervalMs, pauseWhileReading]);
  const checking = revalidator.state !== "idle";
  const time = checkedAt?.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-3">
    <span>每 {intervalMs / 1000} 秒自动检查{pauseWhileReading ? " · 阅读时暂停，回到顶部后更新" : " · 切回页面时检查"}</span>
    <div className="flex items-center gap-3"><span role="status">{failed ? "检查失败，稍后重试" : checking ? "正在检查…" : time ? `最近检查 ${time}（北京时间）` : "等待检查"}</span><button type="button" className="min-h-11 text-accent underline underline-offset-4 disabled:opacity-50" disabled={checking || navigation.state !== "idle"} onClick={() => void controller.current?.refresh()}>立即刷新</button></div>
  </div>;
}
