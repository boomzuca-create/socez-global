export type ModelRunTime = "11:00" | "18:00";

function bangkokClock(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour"), minute: value("minute") };
}

export function nextModelRun(now = new Date()): ModelRunTime {
  const { hour, minute } = bangkokClock(now);
  const currentMinute = hour * 60 + minute;
  if (currentMinute < 11 * 60) return "11:00";
  if (currentMinute < 18 * 60) return "18:00";
  return "11:00";
}
