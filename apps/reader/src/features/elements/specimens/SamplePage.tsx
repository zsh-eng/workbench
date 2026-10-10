import { useIsMobile } from "@/hooks/use-mobile";

/** Public-domain text: Lewis Carroll, "Alice's Adventures in Wonderland". */
export const SAMPLE_PARAGRAPHS = [
  "“Curiouser and curiouser!” cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English); “now I’m opening out like the largest telescope that ever was! Good-bye, feet!”",
  "For when she looked down at her feet, they seemed to be almost out of sight, they were getting so far off. “Oh, my poor little feet, I wonder who will put on your shoes and stockings for you now, dears? I’m sure I shan’t be able!”",
  "Just then her head struck against the roof of the hall: in fact she was now more than nine feet high, and she at once took up the little golden key and hurried off to the garden door.",
  "Poor Alice! It was as much as she could do, lying down on one side, to look through into the garden with one eye; but to get through was more hopeless than ever: she sat down and began to cry again.",
  "“You ought to be ashamed of yourself,” said Alice, “a great girl like you,” (she might well say this), “to go on crying in this way! Stop this moment, I tell you!” But she went on all the same, shedding gallons of tears, until there was a large pool all round her, about four inches deep and reaching half down the hall.",
  "After a time she heard a little pattering of feet in the distance, and she hastily dried her eyes to see what was coming. It was the White Rabbit returning, splendidly dressed, with a pair of white kid gloves in one hand and a large fan in the other.",
  "He came trotting along in a great hurry, muttering to himself as he came, “Oh! the Duchess, the Duchess! Oh! won’t she be savage if I’ve kept her waiting!”",
  "Alice felt so desperate that she was ready to ask help of any one; so, when the Rabbit came near her, she began, in a low, timid voice, “If you please, sir—” The Rabbit started violently, dropped the white kid gloves and the fan, and skurried away into the darkness as hard as he could go.",
];

export const SAMPLE_BOOK_TITLE = "Alice’s Adventures in Wonderland";

/** A still Reader page: one column on phones, a two-page spread on desktop.
 * It sits under the real chrome, as the book does in the Reader. */
export function SamplePage({ onTap }: { onTap?: () => void }) {
  const isMobile = useIsMobile();
  return (
    <div
      onClick={onTap}
      className="absolute inset-0 overflow-hidden px-6 font-serif text-[17px] leading-[1.6] text-foreground md:px-14"
      style={{ paddingTop: 56, paddingBottom: 56 }}
    >
      <div
        className={
          isMobile ? "h-full" : "mx-auto h-full max-w-[1272px] columns-2"
        }
        style={isMobile ? undefined : { columnGap: 72 }}
      >
        {SAMPLE_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="mb-4 indent-6">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
