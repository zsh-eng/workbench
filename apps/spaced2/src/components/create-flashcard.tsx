import { CardMarkdown } from "@/components/flashcard-content";
import { FormTextareaImageUpload } from "@/components/form/form-textarea-image-upload";
import CachedImagesContainer from "@/components/images/cached-images-container";
import { renderCard } from "@/lib/markdown/cards";
import CmdEnterIcon from "@/components/keyboard/CmdEnterIcon";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  cardContentFormSchema,
  CardContentFormValues,
} from "@/lib/form-schema";
import { isEventTargetInput } from "@/lib/utils";
import VibrationPattern from "@/lib/vibrate";
import { zodResolver } from "@hookform/resolvers/zod";
import { Book, Eye } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

type CreateUpdateFlashcardFormProps = {
  onSubmit: (values: CardContentFormValues) => void | Promise<void>;
  form?: UseFormReturn<CardContentFormValues>;
  submitLock?: MutableRefObject<boolean>;
  numDecks?: number;
  initialFront?: string;
  initialBack?: string;
  onImageUpload?: (image: File) => Promise<void>;
};

const FOCUS_QUESTION_KEY = " ";

/**
 * One side as the review screen shows it. A tap on it, outside its links
 * and buttons, goes back to its text; the Preview button does the same
 * from the keyboard.
 */
function SidePreview({
  form,
  name,
  onEdit,
}: {
  form: UseFormReturn<CardContentFormValues>;
  name: "front" | "back";
  onEdit(): void;
}) {
  const content = useWatch({ control: form.control, name });
  const label = name === "front" ? "Question" : "Answer";
  return (
    <CachedImagesContainer
      renderItem={(ref) => (
        <section
          ref={ref}
          aria-label={`${label} preview`}
          onClick={(event) => {
            if (!(event.target as Element).closest("a, button")) onEdit();
          }}
          className="card-preview grow min-h-32 max-h-[45dvh] overflow-y-auto rounded-lg bg-muted/40 px-3 py-2 cursor-text focus-visible:outline-2 focus-visible:outline-ring"
        >
          {content.trim() ? (
            <CardMarkdown
              content={content}
              keepPrevious
              className="prose prose-sm dark:prose-invert max-w-none flex flex-col prose-img:rounded-lg"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No {label.toLowerCase()} yet</p>
          )}
        </section>
      )}
    />
  );
}
/** The Create page keeps its unsaved card here. */
export const LOCALSTORAGE_KEY = "create-flashcard-draft";

const saveDraft = (values: CardContentFormValues) => {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(values));
  } catch (e) {
    console.error("Failed to save draft:", e);
  }
};

const loadDraft = (): CardContentFormValues | null => {
  try {
    const saved = localStorage.getItem(LOCALSTORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.error("Failed to load draft:", e);
    return null;
  }
};

const clearDraft = () => {
  try {
    localStorage.removeItem(LOCALSTORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear draft:", e);
  }
};

export function CreateUpdateFlashcardForm({
  onSubmit,
  numDecks,
  initialFront,
  initialBack,
  onImageUpload,
  form: sharedForm,
  submitLock,
}: CreateUpdateFlashcardFormProps) {
  const isUpdateMode = Boolean(
    initialFront !== undefined || initialBack !== undefined,
  );

  const defaultValues = useMemo(() => {
    if (isUpdateMode) {
      return {
        front: initialFront || "",
        back: initialBack || "",
      };
    }

    const draft = loadDraft();
    return {
      front: draft?.front || "",
      back: draft?.back || "",
    };
  }, [isUpdateMode, initialFront, initialBack]);

  const localForm = useForm<CardContentFormValues>({
    resolver: zodResolver(cardContentFormSchema),
    defaultValues,
  });
  const form = sharedForm ?? localForm;
  const formRef = useRef<HTMLFormElement>(null);
  const localSubmitLock = useRef(false);
  const submitting = submitLock ?? localSubmitLock;
  const submitError = form.formState.errors.root?.save?.message;
  const [preview, setPreview] = useState(false);
  const edit = useCallback(
    (name: "front" | "back") => {
      setPreview(false);
      // After the text area shows again.
      requestAnimationFrame(() => form.setFocus(name));
    },
    [form],
  );

  useEffect(() => {
    if (isUpdateMode) return;

    const subscription = form.watch((values) => {
      saveDraft(values as CardContentFormValues);
    });

    return () => subscription.unsubscribe();
  }, [form, isUpdateMode]);

  const handleSubmit = useCallback(
    async (data: CardContentFormValues) => {
      form.clearErrors("root.save");
      // An edited review card then shows its new text without an empty frame.
      void renderCard(data.front);
      void renderCard(data.back);
      try {
        await onSubmit(data);
        navigator?.vibrate?.(VibrationPattern.successConfirm);

        // Explicitly reset to empty instead of the default values (because they were fetched from localStorage)
        form.reset({ front: "", back: "" });
        setPreview(false);
        // TODO: fix the focus not returning to the front input
        form.setFocus("front");

        if (isUpdateMode) {
          const hasChanged =
            initialFront !== data.front || initialBack !== data.back;
          if (hasChanged) {
            toast.success("Flashcard updated");
          }
        } else {
          clearDraft();
          toast.success("Flashcard created");
        }
      } catch (error) {
        console.error(error);
        form.setError("root.save", {
          message:
            "Could not save the flashcard. Your text is kept. Try again.",
        });
      }
    },
    [form, isUpdateMode, initialFront, initialBack, onSubmit],
  );

  const submit = useCallback(
    async (event?: React.BaseSyntheticEvent) => {
      event?.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      try {
        // A field's error shows beside its text, so Preview gives way.
        await form.handleSubmit(handleSubmit, () => setPreview(false))(event);
      } finally {
        submitting.current = false;
      }
    },
    [form, handleSubmit, submitting],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !document.querySelector('[role="dialog"]') &&
        !isEventTargetInput(event) &&
        event.key === FOCUS_QUESTION_KEY
      ) {
        if (preview) edit("front");
        else form.setFocus("front");
        event.preventDefault();
        return;
      }

      if (
        event.target instanceof Node &&
        formRef.current?.contains(event.target) &&
        event.metaKey &&
        event.key === "Enter"
      ) {
        void submit();
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [form, submit, preview, edit]);

  return (
    <Form {...form}>
      <form
        ref={formRef}
        onSubmit={submit}
        className="flex flex-col gap-4 bg-background rounded-xl p-4 h-full justify-center"
      >
        <fieldset disabled={form.formState.isSubmitting} className="contents">
          {(["front", "back"] as const).map((name) => (
            <div key={name} className="grow flex flex-col">
              {/* The text area stays mounted, so the form keeps its field. */}
              <div className={preview ? "hidden" : "grow"}>
                <FormTextareaImageUpload
                  onUploadImage={onImageUpload}
                  className="text-sm border-none shadow-none h-32"
                  form={form}
                  name={name}
                  placeholder={
                    name === "front" ? "Enter the question" : "Enter the answer"
                  }
                />
              </div>
              {preview && (
                <SidePreview form={form} name={name} onEdit={() => edit(name)} />
              )}
            </div>
          ))}

          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
          <div className="flex justify-start">
            {numDecks !== undefined && (
              <div className="flex gap-1 text-muted-foreground justify-center items-center font-semibold ml-2 whitespace-nowrap">
                <Book className="w-5 h-5" />
                <span className="text-sm">
                  {numDecks} {numDecks === 1 ? "deck" : "decks"} selected
                </span>
              </div>
            )}

            <Button
              type="button"
              variant="ghost"
              size="lg"
              aria-pressed={preview}
              title="Show the card as review shows it"
              className="ml-auto self-end rounded-lg px-3 gap-1.5 text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
              onClick={() => (preview ? edit("front") : setPreview(true))}
            >
              <Eye />
              {/* Only the icon on a phone, where the deck count needs the room. */}
              <span className="sr-only sm:not-sr-only">Preview</span>
            </Button>
            <Button
              type="submit"
              size="lg"
              className="ml-2 self-end rounded-lg [&_svg]:size-3"
            >
              {isUpdateMode ? "Update" : "Create"}
              <CmdEnterIcon />
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
