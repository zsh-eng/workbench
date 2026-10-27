/** A word that the shell reads back as itself. */
export const shellWord = (word: string) =>
  /^[\w./@:+#=,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
