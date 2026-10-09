import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useHotkey } from "@tanstack/react-hotkeys";
import { MoreHorizontal, PanelLeftIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
} from "react";
import { MOTION_MS } from "@/lib/motion";

const SIDEBAR_WIDTH = "18rem";
const SIDEBAR_ENTER_DURATION_MS = MOTION_MS.enter;
const SIDEBAR_EXIT_DURATION_MS = MOTION_MS.exit;

type SidebarTransitionMode = "animated" | "instant";

type RenderProp = Parameters<typeof useRender>[0]["render"];

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
  transitionMode: SidebarTransitionMode;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}

interface SidebarProviderProps extends ComponentProps<"div"> {
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Owns the shared desktop/mobile sidebar state and its global keyboard
 * shortcuts. The desktop state can be controlled by the route-aware app shell.
 */
export function SidebarProvider({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  style,
  ...props
}: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);
  const [transitionMode, setTransitionMode] =
    useState<SidebarTransitionMode>("animated");
  const keyboardResetFrame = useRef<number | null>(null);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) {
        onOpenChange(nextOpen);
        return;
      }
      setUncontrolledOpen(nextOpen);
    },
    [onOpenChange],
  );

  const applySidebarToggle = useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
      return;
    }
    setOpen(!open);
  }, [isMobile, open, setOpen]);

  const toggleSidebar = useCallback(() => {
    setTransitionMode("animated");
    applySidebarToggle();
  }, [applySidebarToggle]);

  const closeSidebarInstantly = useCallback(() => {
    if (isMobile) {
      if (!openMobile) return false;
      setTransitionMode("instant");
      setOpenMobile(false);
      return true;
    }

    if (!open) return false;
    setTransitionMode("instant");
    setOpen(false);
    return true;
  }, [isMobile, open, openMobile, setOpen]);

  const restoreAnimatedTransitions = useCallback(() => {
    if (keyboardResetFrame.current !== null) {
      window.cancelAnimationFrame(keyboardResetFrame.current);
    }
    keyboardResetFrame.current = window.requestAnimationFrame(() => {
      setTransitionMode("animated");
      keyboardResetFrame.current = null;
    });
  }, []);

  useHotkey("Mod+\\", toggleSidebar, {
    target: window,
    ignoreInputs: false,
    requireReset: true,
    stopPropagation: false,
    meta: {
      name: "Toggle sidebar",
      description: "Show or hide the application sidebar",
    },
  });

  useHotkey(
    "Escape",
    (event) => {
      if (event.defaultPrevented || !closeSidebarInstantly()) return;

      event.preventDefault();
      restoreAnimatedTransitions();
    },
    {
      target: window,
      ignoreInputs: false,
      preventDefault: false,
      requireReset: true,
      stopPropagation: false,
      meta: {
        name: "Close sidebar",
        description: "Close the application sidebar",
      },
    },
  );

  useEffect(() => {
    return () => {
      if (keyboardResetFrame.current !== null) {
        window.cancelAnimationFrame(keyboardResetFrame.current);
      }
    };
  }, []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
      transitionMode,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar, transitionMode],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        data-sidebar-open={open}
        data-transition-mode={transitionMode}
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            ...style,
          } as CSSProperties
        }
        className={cn("flex min-h-svh w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: ComponentProps<"aside">) {
  const { isMobile, open, openMobile, setOpen, setOpenMobile, transitionMode } =
    useSidebar();
  const isSidebarOpen = isMobile ? openMobile : open;
  const transitionDuration =
    transitionMode === "instant"
      ? 0
      : isSidebarOpen
        ? SIDEBAR_ENTER_DURATION_MS
        : SIDEBAR_EXIT_DURATION_MS;

  if (isMobile) {
    return (
      <Drawer direction="bottom" open={openMobile} onOpenChange={setOpenMobile}>
        <DrawerContent
          data-slot="sidebar"
          className="mx-auto h-[min(42rem,88dvh)]! w-full! max-w-3xl! gap-0 overflow-hidden rounded-t-[1.9rem]! border border-sidebar-border/80 bg-sidebar/96 p-0 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-[0_-24px_60px_color-mix(in_srgb,var(--foreground)_8%,transparent)] backdrop-blur-xl transition-transform ease-[cubic-bezier(0.23,1,0.32,1)]! data-[drawer-direction=bottom]:max-h-[88dvh]! [&>div:first-child]:mt-3 [&>div:first-child]:h-1 [&>div:first-child]:w-10 [&>div:first-child]:bg-sidebar-border/80"
          overlayClassName={cn(
            "bg-transparent ease-[cubic-bezier(0.23,1,0.32,1)]!",
            transitionMode === "instant"
              ? "duration-0!"
              : openMobile
                ? // Tailwind needs literal classes: MOTION_MS.enter and .exit.
                  "duration-[180ms]!"
                : "duration-[140ms]!",
          )}
          style={
            {
              transitionDuration: `${transitionDuration}ms`,
            } as CSSProperties
          }
        >
          <div className="sr-only">
            <DrawerTitle>Application navigation</DrawerTitle>
            <DrawerDescription>
              Navigate the reader and manage application actions.
            </DrawerDescription>
          </div>
          <div className="flex h-full min-h-0 flex-col">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <aside
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={cn(
        "pointer-events-none fixed inset-0 z-40 hidden text-sidebar-foreground md:block",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-label="Close sidebar"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-transparent",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "pointer-events-auto fixed inset-y-3 left-3 z-50 flex w-(--sidebar-width) transition-[opacity,transform,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none",
          open
            ? "[transform:translate3d(0,0,0)] opacity-100"
            : "pointer-events-none [transform:translate3d(-12px,0,0)] opacity-0",
        )}
        style={{ transitionDuration: `${transitionDuration}ms` }}
      >
        <div
          data-slot="sidebar-inner"
          className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-(--sidebar-panel-radius) border border-sidebar-border/80 bg-sidebar/96 text-sidebar-foreground backdrop-blur-xl"
        >
          {children}
        </div>
      </div>
    </aside>
  );
}

export function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-w-0 flex-1 flex-col bg-background",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "shrink-0 aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground",
        className,
      )}
      aria-label={isMobile ? "Open navigation" : "Toggle sidebar"}
      aria-expanded={isMobile ? openMobile : open}
      aria-pressed={isMobile ? undefined : open}
      title={
        isMobile
          ? "Open navigation"
          : "Toggle sidebar (Command or Control + Backslash)"
      }
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon className="hidden size-4 md:block" />
      <MoreHorizontal className="size-4 md:hidden" />
    </Button>
  );
}

export function SidebarFloatingTrigger({ className }: { className?: string }) {
  const { isMobile, open, openMobile, transitionMode } = useSidebar();
  const isSidebarOpen = isMobile ? openMobile : open;

  return (
    <div
      aria-hidden={isSidebarOpen}
      className={cn(
        "fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-30 rounded-full bg-background transition-[opacity,transform,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none",
        isSidebarOpen
          ? "pointer-events-none invisible [transform:translate3d(0,-4px,0)] opacity-0"
          : "[transform:translate3d(0,0,0)] opacity-100",
        className,
      )}
      style={{
        transitionDuration: `${
          transitionMode === "instant" ? 0 : SIDEBAR_EXIT_DURATION_MS
        }ms`,
      }}
    >
      <SidebarTrigger
        tabIndex={isSidebarOpen ? -1 : 0}
        className="size-9 rounded-full border border-border/60 bg-background/75 text-muted-foreground shadow-sm backdrop-blur-xl hover:bg-background/95 hover:text-foreground"
      />
    </div>
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-auto p-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  );
}

interface SidebarMenuButtonProps extends ComponentProps<"button"> {
  isActive?: boolean;
  render?: RenderProp;
}

export function SidebarMenuButton({
  isActive = false,
  render,
  className,
  ...props
}: SidebarMenuButtonProps) {
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps(
      {
        "data-slot": "sidebar-menu-button",
        "data-active": isActive,
        type: "button",
        className: cn(
          "flex min-h-[38px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-normal outline-none transition-[background-color,color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.985] motion-reduce:active:scale-100 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
          className,
        ),
      },
      props,
    ),
  });
}

export function SidebarSeparator({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      className={cn("bg-sidebar-border", className)}
      {...props}
    />
  );
}
