import {
  AccountSection,
  AccountSignOut,
} from "@/components/profile/account-section";
import { ImagesLinkButton } from "@/components/profile/images-link-button";
import { ConnectionNotice } from "@/components/profile/connection-notice";
import { StatsLinkButton } from "@/components/profile/stats-link-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { spacedSync } from "@/lib/sync/engine";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import { Link } from "react-router";

export default function ProfileRoute() {
  const connection = useSyncStatus(spacedSync, (status) => status.connection);

  return (
    <div className="flex flex-col h-full col-start-1 col-end-13 xl:col-start-3 xl:col-end-11 md:px-24 pb-6 gap-2">
      <h1 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        Profile
      </h1>

      <ConnectionNotice
        status={connection === "offline" ? "offline" : "online"}
      />
      <AccountSection />

      <div className="mt-4 flex flex-col gap-2">
        <ThemeToggle />
        <StatsLinkButton />
        <ImagesLinkButton />
      </div>

      <AccountSignOut />

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
