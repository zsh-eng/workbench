import NavButton from "@/components/nav/nav-button";
import { cn, isEventTargetInput } from "@/lib/utils";
import { Book, Bookmark, Home, Plus, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

export default function NavBar() {
  const path = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command + 1, 2, 3 ,4, 5
      if (!e.shiftKey) return;
      if (isEventTargetInput(e)) return;
      if (e.key == "!") {
        navigate("/decks");
        return;
      }
      if (e.key == "@") {
        navigate("/saved");
        return;
      }
      if (e.key == "#") {
        navigate("/");
        return;
      }
      if (e.key == "$") {
        navigate("/create");
        return;
      }
      if (e.key == "%") {
        navigate("/profile");
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed z-tabbar flex bg-muted dark:bg-background",
        // Phones: a bar across the bottom, above the home indicator.
        "left-0 right-0 bottom-0 box-content h-(--tabbar-height) items-center border-t pb-[env(safe-area-inset-bottom)]",
        // Desktops: a rail on the left.
        "md:right-auto md:left-2 md:top-0 md:h-full md:w-16 md:flex-col md:justify-center md:border-t-0 md:pb-0",
      )}
    >
      <NavButton
        label="Decks"
        icon={<Book />}
        href={"/decks"}
        focused={path.pathname === "/decks"}
      />

      {/* Bookmarks */}
      <NavButton
        label="Saved"
        icon={<Bookmark />}
        href={"/saved"}
        focused={path.pathname === "/saved"}
      />

      <NavButton
        label="Review"
        icon={<Home className={cn("scale-x-110")} strokeWidth={2.5} />}
        href={"/"}
        focused={path.pathname === "/"}
      />

      <NavButton
        label="Create"
        icon={<Plus strokeWidth={3} />}
        href={"/create"}
        focused={path.pathname === "/create"}
      />

      {/* Settings */}
      <NavButton
        label="Profile"
        icon={<UserRound />}
        href={"/profile"}
        focused={path.pathname === "/profile"}
      />
    </nav>
  );
}
