import EditFlashcardDialog from "@/components/card-actions/edit-flashcard-dialog";
import EditFlashcardDrawer from "@/components/card-actions/edit-flashcard-drawer";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  cardContentFormSchema,
  CardContentFormValues,
} from "@/lib/form-schema";
import { CardWithMetadata } from "@/lib/types";
import { useCompactWindow } from "@/components/hooks/use-compact-window";

export type EditFlashcardActions = {
  bookmarked: boolean;
  onBookmark: (bookmarked: boolean) => void;
  onDelete: () => void;
  onBury: () => void;
  suspended?: Date;
  onUnsuspend?: () => void;
};

type EditFlashcardResponsiveProps = {
  card: CardWithMetadata;
  onEdit: (values: CardContentFormValues) => void | Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: EditFlashcardActions;
};

export default function EditFlashcardResponsive(
  props: EditFlashcardResponsiveProps,
) {
  return props.open ? (
    <EditFlashcardSession key={props.card.id} {...props} />
  ) : null;
}

function EditFlashcardSession({
  card,
  onEdit,
  open,
  onOpenChange,
  actions,
}: EditFlashcardResponsiveProps) {
  const submitLock = useRef(false);
  const form = useForm<CardContentFormValues>({
    resolver: zodResolver(cardContentFormSchema),
    defaultValues: { front: card.front, back: card.back },
  });
  const isMobile = useCompactWindow();

  const beforeAction = (action: string) => {
    if (submitLock.current) return false;
    const values = form.getValues();
    const hasUnsavedText =
      values.front !== form.formState.defaultValues?.front ||
      values.back !== form.formState.defaultValues?.back;
    return (
      !hasUnsavedText ||
      window.confirm(
        `${action}? Unsaved changes to the question and answer will be discarded. This action does not save your text. Cancel to keep editing.`,
      )
    );
  };

  return isMobile ? (
    <EditFlashcardDrawer
      form={form}
      submitLock={submitLock}
      beforeAction={beforeAction}
      card={card}
      open={open}
      onOpenChange={(value) => {
        if (!submitLock.current) onOpenChange(value);
      }}
      onEdit={onEdit}
      actions={actions}
    />
  ) : (
    <EditFlashcardDialog
      form={form}
      submitLock={submitLock}
      beforeAction={beforeAction}
      card={card}
      open={open}
      onOpenChange={(value) => {
        if (!submitLock.current) onOpenChange(value);
      }}
      onEdit={onEdit}
      actions={actions}
    />
  );
}
