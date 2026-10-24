import { Button } from "@/components/ui/button";
import { cn, debounce } from "@/lib/utils";
import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ReturnToTop() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = debounce(() => {
      setIsVisible(window.scrollY > 100);
    }, 150);

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return createPortal(
    <div
      // Make the surrounding hit area slighlty bigger
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-sticky py-4 px-8",
        !isVisible && "pointer-events-none",
      )}
      aria-hidden={!isVisible}
      onClick={() => {
        if (isVisible) {
          document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
    >
      <Button
        className={cn(
          "rounded-full shadow-sm opacity-100 transition-all scale-100",
          !isVisible && "opacity-0 scale-90",
        )}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>,
    document.body,
  );
}
