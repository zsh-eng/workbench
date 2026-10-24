import { useLoggedInStatus } from "@/components/hooks/logged-in-status";
import { useOnlineStatus } from "@/components/hooks/online-status";
import { ImagesLinkButton } from "@/components/profile/images-link-button";
import { LoginButton } from "@/components/profile/login-button";
import { LogoutButton } from "@/components/profile/logout-button";
import { ConnectionNotice } from "@/components/profile/connection-notice";
import { StatsLinkButton } from "@/components/profile/stats-link-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { Link } from "react-router";

export default function ProfileRoute() {
  const online = useOnlineStatus();
  const loggedIn = useLoggedInStatus();

  return (
    <div className="flex flex-col h-full col-start-1 col-end-13 xl:col-start-3 xl:col-end-11 md:px-24 pb-6 gap-2">
      <h1 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        Profile
      </h1>

      <ConnectionNotice status={online ? "online" : "offline"} />
      <ThemeToggle />
      <StatsLinkButton />
      <ImagesLinkButton />

      {loggedIn.isLoggedIn ? <LogoutButton /> : <LoginButton />}

      <Link
        to="https://github.com/zsh-eng"
        className="mx-auto mt-24"
        target="_blank"
      >
        <div className="group flex text-muted-foreground gap-2">
          <SiGithub className="" />
          <span className="group-hover:text-primary transition-all ease-out">
            made by zsh-eng
          </span>
        </div>
      </Link>
    </div>
  );
}
