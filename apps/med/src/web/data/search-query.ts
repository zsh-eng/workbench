/** A query of the search page: `repo:` filters, and the text to find as written. */
export interface SearchQuery {
  repos: string[];
  text: string;
}

/** A `repo:` filter: a name, or a quoted one with spaces. */
const FILTER = /(^|\s)repo:(?:"([^"]*)"?|(\S*))/g;

export function parseSearchQuery(query: string): SearchQuery {
  const repos: string[] = [];
  const text = query
    .replace(FILTER, (_, lead: string, quoted?: string, plain?: string) => {
      const value = (quoted ?? plain ?? "").trim();
      if (value) repos.push(value);
      return lead;
    })
    .trim();
  return { repos, text };
}

/** The `repo:` filter for a repository's name. */
export const repoFilter = (name: string) =>
  `repo:${/\s/.test(name) ? `"${name.replaceAll('"', "")}"` : name}`;

/** The repositories that the filters name, in their own order: a filter
 * picks the repositories with that exact name, or else the ones whose name
 * or path contains it. No filter picks every repository. */
export function matchRepositories<T extends { name: string; path: string }>(
  repositories: readonly T[],
  filters: readonly string[],
): T[] {
  if (!filters.length) return [...repositories];
  const picked = new Set<T>();
  for (const filter of filters) {
    const wanted = filter.toLowerCase();
    const exact = repositories.filter((repository) => repository.name.toLowerCase() === wanted);
    const found = exact.length
      ? exact
      : repositories.filter(
          (repository) =>
            repository.name.toLowerCase().includes(wanted) ||
            repository.path.toLowerCase().includes(wanted),
        );
    for (const repository of found) picked.add(repository);
  }
  return repositories.filter((repository) => picked.has(repository));
}
