import { useEffect } from "react";
import { themeController } from "../../../themes";
import { AskInSession, AskInWorkspace } from "./AskPrototype";

/** The prototypes, by the last part of their path: /screens/prototype/<id>. */
export const prototypes = {
  "ask-in-session": AskInSession,
  "ask-in-workspace": AskInWorkspace,
} as const;

/**
 * One prototype as a whole window, for a frame of the Screens page: a design
 * that Med does not have yet, built from its real parts on invented data.
 */
export default function Prototype() {
  const id = location.pathname.split("/").at(-1) as keyof typeof prototypes;
  const theme = new URLSearchParams(location.search).get("theme");
  useEffect(() => {
    if (theme) themeController.preview(theme);
    document.title = "Prototype · Med";
  }, [theme]);
  const Screen = prototypes[id];
  return Screen ? <Screen /> : <p>No prototype {id}.</p>;
}
