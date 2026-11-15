import { useState } from "react";
import { formatCompact, formatNumber } from "../format.ts";

/** Clean upper bound for the y-axis: 1, 2, 5 × 10^n. */
function niceMax(value: number): number {
    if (value <= 0) return 4;
    const exp = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 2, 5, 10]) {
        if (step * exp >= value) return step * exp;
    }
    return 10 * exp;
}

function dayLabel(day: string, long = false) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(long ? { weekday: "short" } : {}),
        timeZone: "UTC",
    });
}

/** Column chart, one column per day. Hover a column for its exact value. */
export function DailyChart({ data }: { data: { day: string; count: number }[] }) {
    const [hover, setHover] = useState<number | null>(null);
    const max = niceMax(Math.max(...data.map((d) => d.count), 0));
    const ticks = [max, max / 2, 0];
    const total = data.reduce((sum, d) => sum + d.count, 0);

    return (
        <div>
            <div className="flex gap-3">
                {/* y-axis ticks */}
                <div className="flex h-48 flex-col justify-between text-right text-[11px] tabular-nums text-stone-400">
                    {ticks.map((t) => (
                        <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
                            {formatCompact(t)}
                        </span>
                    ))}
                </div>

                <div className="relative h-48 flex-1">
                    {/* gridlines */}
                    {ticks.map((t) => (
                        <div
                            key={t}
                            className={`absolute inset-x-0 border-t ${
                                t === 0
                                    ? "border-stone-300 dark:border-stone-700"
                                    : "border-stone-200/70 dark:border-stone-800"
                            }`}
                            style={{ bottom: `${(t / max) * 100}%` }}
                        />
                    ))}

                    <div className="absolute inset-0 flex items-end">
                        {data.map((d, i) => (
                            <div
                                key={d.day}
                                className="relative flex h-full flex-1 items-end justify-center"
                                onMouseEnter={() => setHover(i)}
                                onMouseLeave={() => setHover(null)}
                            >
                                <div
                                    className={`w-full max-w-6 rounded-t-[4px] bg-chart transition-opacity ${
                                        hover !== null && hover !== i ? "opacity-40" : ""
                                    }`}
                                    style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0 }}
                                />
                                {hover === i && (
                                    <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
                                        <div className="font-medium">{dayLabel(d.day, true)}</div>
                                        <div>{formatNumber(d.count)} new listing{d.count === 1 ? "" : "s"}</div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* x-axis: first, middle and last day only */}
            <div className="ml-9 mt-2 flex justify-between text-[11px] text-stone-400">
                <span>{dayLabel(data[0]?.day ?? "")}</span>
                <span>{dayLabel(data[Math.floor(data.length / 2)]?.day ?? "")}</span>
                <span>Today</span>
            </div>
            <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                {formatNumber(total)} new listing{total === 1 ? "" : "s"} in the last 14 days
            </p>
        </div>
    );
}
