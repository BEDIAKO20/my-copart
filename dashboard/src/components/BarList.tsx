import { formatNumber } from "../format.ts";

export interface BarItem {
    key: string;
    label: string;
    sublabel?: string | null;
    count: number;
}

/** Ranked horizontal bars with the value at each bar's tip. */
export function BarList({ items, onSelect }: { items: BarItem[]; onSelect?: (item: BarItem) => void }) {
    if (items.length === 0) {
        return <p className="text-sm text-stone-500">No data yet.</p>;
    }
    const max = Math.max(...items.map((i) => i.count), 1);

    return (
        <ul className="space-y-3">
            {items.map((item) => (
                <li key={item.key}>
                    <button
                        type="button"
                        disabled={!onSelect}
                        onClick={() => onSelect?.(item)}
                        className="group w-full text-left enabled:cursor-pointer"
                        title={onSelect ? `Show ${item.label} in the table` : undefined}
                    >
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate text-stone-700 group-enabled:group-hover:underline dark:text-stone-300">
                                {item.label}
                                {item.sublabel && <span className="text-stone-400"> · {item.sublabel}</span>}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="h-3 flex-1">
                                <div
                                    className="h-full rounded-r-[4px] bg-chart"
                                    style={{ width: `${(item.count / max) * 100}%`, minWidth: 2 }}
                                />
                            </div>
                            <span className="w-14 text-right text-sm font-medium tabular-nums">
                                {formatNumber(item.count)}
                            </span>
                        </div>
                    </button>
                </li>
            ))}
        </ul>
    );
}
