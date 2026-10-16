"use client";

import type { ReactElement, ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { focusRing } from "./primitives";

/** ⓘ button that reveals secondary explanation on hover or keyboard focus. */
export function InfoTip({ children, label = "More information", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={label}
        className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground", focusRing, className)}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-5">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Wraps any focusable element (button, link) with a tooltip label. */
export function WithTip({ tip, children }: { tip: ReactNode; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export const iconButton =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-background text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 " +
  focusRing;

/** Collapsed-by-default section with a chevron trigger (aria-expanded handled by Base UI). */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className,
  triggerClassName,
  contentClassName,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      <CollapsibleTrigger
        className={cn(
          "group/disc inline-flex items-center gap-1 rounded-full py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
          focusRing,
          triggerClassName,
        )}
      >
        {title}
        <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]/disc:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
    </Collapsible>
  );
}
