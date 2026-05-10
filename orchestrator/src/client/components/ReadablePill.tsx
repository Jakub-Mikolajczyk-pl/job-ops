import type React from "react";
import { cn } from "@/lib/utils";

type ReadablePillProps = {
  children: React.ReactNode;
  className?: string;
};

export const ReadablePill: React.FC<ReadablePillProps> = ({
  children,
  className,
}) => (
  <span
    className={cn(
      "inline-flex max-w-full items-center whitespace-nowrap rounded-lg bg-muted/50 px-2 py-1 text-foreground",
      className,
    )}
  >
    <span className="truncate">{children}</span>
  </span>
);
