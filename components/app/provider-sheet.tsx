"use client";

import { ExternalLink, X } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ProviderSheet({
  open,
  onOpenChange,
  title,
  badge,
  testData,
  externalUrl,
  onOpenExternal,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  badge?: string;
  testData?: React.ReactNode;
  externalUrl?: string;
  onOpenExternal?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="mx-auto w-full max-w-md overflow-hidden border-0 bg-white p-0 text-slate-950 dark:bg-white dark:text-slate-950"
        style={{ height: "calc(100dvh - 1rem)", maxHeight: "calc(100dvh - 1rem)" }}
      >
        <div className="flex h-full min-h-0 flex-col bg-white text-slate-950 dark:bg-white dark:text-slate-950">
          <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <DrawerTitle className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-950">
              {title}
            </DrawerTitle>
            {badge ? <Badge variant="secondary" className="shrink-0">{badge}</Badge> : null}
            {externalUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1 px-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                aria-label="Открыть в новой вкладке"
                onClick={() => {
                  window.open(externalUrl, "_blank", "noopener,noreferrer");
                  onOpenExternal?.();
                }}
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                В новой вкладке
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              aria-label="Закрыть"
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          {testData ? (
            <details className="shrink-0 border-b px-4 py-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-800">Тестовые данные</summary>
              <div className="pb-1 pt-2 leading-5">{testData}</div>
            </details>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-xl bg-white">
            {children}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
