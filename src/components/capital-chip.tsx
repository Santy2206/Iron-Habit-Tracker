import { CAPITALS, type CapitalCategory } from "@/lib/capitals";
import { cn } from "@/lib/utils";

export function CapitalChip({
  category,
  className,
}: {
  category: CapitalCategory | null | undefined;
  className?: string;
}) {
  if (!category) return null;
  const c = CAPITALS[category];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white",
        className,
      )}
      style={{ backgroundColor: c.color }}
    >
      {c.short}
    </span>
  );
}
