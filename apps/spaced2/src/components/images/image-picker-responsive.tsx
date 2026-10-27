import BlobImage from "./blob-image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { constructImageMarkdownLink } from "@/lib/files/upload";
import { CachedImage, listUsableCachedImages } from "@/lib/images/db";
import { useCompactWindow } from "@/components/hooks/use-compact-window";
import { useLiveQuery } from "dexie-react-hooks";
import { Image } from "lucide-react";
import { toast } from "sonner";

type ImagePickerResponsiveProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ImageGrid({
  onImageSelect,
}: {
  onImageSelect: (image: CachedImage) => void;
}) {
  const recentImages = useLiveQuery(
    async () =>
      (await listUsableCachedImages())
        .sort((a, b) => b.cachedAt - a.cachedAt)
        .slice(0, 20),
    [],
    [],
  );
  if (recentImages.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        No images available
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto p-0.5">
      {recentImages.map((image) => {
        return (
          <button
            key={image.url}
            type="button"
            aria-label={`Copy image link: ${image.altText || "cached image"}`}
            onClick={() => onImageSelect(image)}
          >
            <BlobImage
              blob={image.thumbnail}
              alt={image.altText || "cached image"}
              className="rounded-sm shadow-sm w-full h-full object-cover hover:outline hover:outline-ring transition-all duration-150 cursor-pointer aspect-square"
            />
          </button>
        );
      })}
    </div>
  );
}

export default function ImagePickerResponsive({
  open,
  onOpenChange,
}: ImagePickerResponsiveProps) {
  const isMobile = useCompactWindow();

  const handleImageSelect = async (image: CachedImage) => {
    // Extract the file key from the URL
    // URL format: {BACKEND_URL}/files/{fileKey}
    const urlParts = image.url.split("/files/");
    const fileKey = urlParts[1];

    if (!fileKey) {
      toast.error("Invalid image URL");
      return;
    }

    const imageMarkdown = constructImageMarkdownLink(fileKey, image.altText);
    try {
      await navigator.clipboard.writeText(imageMarkdown);
    } catch (error) {
      console.error(error);
      toast.error("Could not copy the image link. Try again.");
      return;
    }

    toast("Image URL copied to clipboard!", {
      icon: <Image className="w-4 h-4" />,
    });

    onOpenChange(false);
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <ImageGrid onImageSelect={handleImageSelect} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recent images</DialogTitle>
        </DialogHeader>
        <ImageGrid onImageSelect={handleImageSelect} />
      </DialogContent>
    </Dialog>
  );
}
