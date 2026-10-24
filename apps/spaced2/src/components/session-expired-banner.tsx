import { useSessionExpired } from "@/components/hooks/session-expired";
import { LoginFormDialogContent } from "@/components/profile/login-button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import SyncEngine from "@/lib/sync/engine";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

type SessionExpiredBackdropProps = {
  onClose: () => void;
  onAction: () => void;
};

export function SessionExpiredBackdrop({
  onClose,
  onAction,
}: SessionExpiredBackdropProps) {
  return createPortal(
    // An overlay: it covers the whole screen, the tab bar included.
    <div className="fixed inset-0 z-overlay">
      <div
        className="absolute inset-0 backdrop-blur-xs bg-muted/20"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute top-auto bottom-1/2 right-1/2 translate-x-1/2 bg-background rounded-xl w-80 py-4 pl-5 pr-5 shadow-sm flex gap-2 items-center justify-start",
          // 'sm:right-4 sm:translate-x-0 sm:top-4 sm:bottom-auto animate-fade-in'
        )}
      >
        <X
          className="size-3 cursor-pointer top-2 right-2 absolute text-muted-foreground"
          onClick={onClose}
        />

        <h1 className="text-xs">
          Your session has expired. Please sign in again to continue syncing
          your data.
        </h1>
        <button
          className="text-xs font-semibold px-3 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer active:scale-95 transition-all w-28"
          onClick={onAction}
        >
          Sign in
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function SessionExpiredBanner() {
  const hasSessionExpired = useSessionExpired();
  const [showBackdrop, setShowBackdrop] = useState(true);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  if (!hasSessionExpired) {
    return null;
  }

  return (
    <>
      {showBackdrop && (
        <SessionExpiredBackdrop
          onClose={() => setShowBackdrop(false)}
          onAction={() => {
            setShowBackdrop(false);
            setShowLoginDialog(true);
          }}
        />
      )}

      {showLoginDialog && (
        <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
          <DialogContent className="w-full h-max transition-all">
            <LoginFormDialogContent
              onSuccess={() => {
                setShowLoginDialog(false);
                // TODO: handle user possibly logging back with a different account
                // we should account for that an display a window helping the user deconflict this
                toast.promise(
                  SyncEngine.syncFromServer() || Promise.resolve(),
                  {
                    loading: "Syncing...",
                    success: "Synced!",
                    error: "Error syncing",
                  },
                );
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
