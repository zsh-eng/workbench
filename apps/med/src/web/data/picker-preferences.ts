import { useViewSetting, viewSettings } from "./view-settings";

// Whether Find file shows the selected file beside the results. Off keeps the
// picker a narrow list. Every picker and window shares the choice
// (view-settings.ts).

export function setFilePreviewShown(on: boolean) {
  viewSettings.filePreview.set(on ? "on" : "off");
}

export function useFilePreviewShown() {
  return useViewSetting(viewSettings.filePreview) === "on";
}
