import type { ReactNode } from "react";

export function Card({ title, subtitle, children, className = "" }: {
    title?: string;
    subtitle?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={`rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 ${className}`}
        >
            {title && (
                <header className="mb-4">
                    <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{subtitle}</p>}
                </header>
            )}
            {children}
        </section>
    );
}

export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <Card>
            <p className="text-sm text-stone-500 dark:text-stone-400">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            {detail && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{detail}</p>}
        </Card>
    );
}
