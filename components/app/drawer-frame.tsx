"use client";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export function DrawerFrame({
  open,
  onOpenChange,
  title,
  description,
  fullHeight = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fullHeight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={`mx-auto w-full max-w-md ${fullHeight ? "h-[calc(100dvh-6rem)]" : ""}`}>
        <DrawerHeader className="px-5 pb-3 text-left">
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 pb-5 ${fullHeight ? "flex flex-col" : ""}`}>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
