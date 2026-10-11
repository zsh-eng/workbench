import { FormTextareaImageUpload } from "@/components/form/form-textarea-image-upload";
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
import { Book } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
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
      try {
        await onSubmit(data);
        navigator?.vibrate?.(VibrationPattern.successConfirm);

        // Explicitly reset to empty instead of the default values (because they were fetched from localStorage)
        form.reset({ front: "", back: "" });
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
        await form.handleSubmit(handleSubmit)(event);
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
        form.setFocus("front");
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
  }, [form, submit]);

  return (
    <Form {...form}>
      <form
        ref={formRef}
        onSubmit={submit}
        className="flex flex-col gap-4 bg-background rounded-xl p-4 h-full justify-center"
      >
        <fieldset disabled={form.formState.isSubmitting} className="contents">
          <div className="grow">
            <FormTextareaImageUpload
              onUploadImage={onImageUpload}
              className="text-sm border-none shadow-none h-32"
              form={form}
              name="front"
              placeholder="Enter the question"
            />
          </div>

          <div className="grow">
            <FormTextareaImageUpload
              onUploadImage={onImageUpload}
              className="text-sm border-none shadow-none h-32"
              form={form}
              name="back"
              placeholder="Enter the answer"
            />
          </div>

          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
          <div className="flex justify-start">
            {numDecks !== undefined && (
              <div className="flex gap-1 text-muted-foreground justify-center items-center font-semibold ml-2">
                <Book className="w-5 h-5" />
                <span className="text-sm">
                  {numDecks} {numDecks === 1 ? "deck" : "decks"} selected
                </span>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="ml-auto self-end rounded-lg [&_svg]:size-3"
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
