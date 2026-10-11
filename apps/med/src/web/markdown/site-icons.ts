/**
 * Icons for the web links in an agent's replies. Med sends nothing to any
 * server, so it does not fetch icons while it runs: `site-icons/` holds the
 * favicons of common developer sites, fetched once from each site. A link
 * matches by its host. A server that a company runs itself, such as
 * github.acme.dev or sourcegraph.corp, matches by a word in its name. Any
 * other site shows a globe.
 */

const FILES = import.meta.glob<string>("./site-icons/*.{png,svg}", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
});

export interface SiteIcon {
  id: string;
  src: string;
  /** A black icon, which dark themes show in white. */
  dark?: boolean;
}

/**
 * Each site: its icon's name, the hosts it serves (with their subdomains; a
 * path limits a host to the pages under it), and the words that name a server
 * of its own. The first match wins, so a narrower site comes first.
 */
const SITES: [string, string[], string[]?][] = [
  ["github", ["github.com", "github.io", "githubusercontent.com", "github.dev"], ["github", "ghe"]],
  ["gitlab", ["gitlab.com", "gitlab.io"], ["gitlab"]],
  ["bitbucket", ["bitbucket.org"], ["bitbucket"]],
  ["gitea", ["gitea.com", "gitea.io"], ["gitea"]],
  ["codeberg", ["codeberg.org"]],
  ["gerrit", ["gerritcodereview.com", "googlesource.com"], ["gerrit"]],
  ["sourcegraph", ["sourcegraph.com"], ["sourcegraph"]],
  ["jira", ["atlassian.net/browse", "atlassian.net/jira"], ["jira"]],
  ["confluence", ["atlassian.net/wiki"], ["confluence"]],
  ["atlassian", ["atlassian.com", "atlassian.net"]],
  ["sentry", ["sentry.io"], ["sentry"]],
  ["grafana", ["grafana.com", "grafana.net"], ["grafana"]],
  [
    "stackoverflow",
    ["stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com"],
  ],
  ["mdn", ["developer.mozilla.org"]],
  ["wikipedia", ["wikipedia.org"]],
  ["readthedocs", ["readthedocs.io", "readthedocs.org", "readthedocs.com"]],
  ["npm", ["npmjs.com", "npmjs.org"]],
  ["pypi", ["pypi.org"]],
  ["docsrs", ["docs.rs"]],
  ["crates", ["crates.io"]],
  ["rubygems", ["rubygems.org"]],
  ["docker", ["docker.com", "docker.io"]],
  ["python", ["python.org"]],
  ["go", ["go.dev", "golang.org"]],
  ["rust", ["rust-lang.org"]],
  [
    "java",
    [
      "dev.java",
      "openjdk.org",
      "openjdk.java.net",
      "java.com",
      "javadoc.io",
      "docs.oracle.com/javase",
      "docs.oracle.com/en/java",
    ],
  ],
  ["oracle", ["oracle.com"]],
  ["kotlin", ["kotlinlang.org"]],
  ["swift", ["swift.org"]],
  ["apple", ["apple.com"]],
  ["android", ["android.com"]],
  ["typescript", ["typescriptlang.org"]],
  ["nodejs", ["nodejs.org"]],
  ["bun", ["bun.sh", "bun.com"]],
  ["deno", ["deno.com", "deno.land"]],
  ["react", ["react.dev", "reactjs.org"]],
  ["nextjs", ["nextjs.org"]],
  ["vue", ["vuejs.org"]],
  ["svelte", ["svelte.dev"]],
  ["angular", ["angular.dev", "angular.io"]],
  ["vite", ["vite.dev", "vitejs.dev"]],
  ["vitest", ["vitest.dev"]],
  ["tailwind", ["tailwindcss.com"]],
  ["electron", ["electronjs.org"]],
  ["dart", ["dart.dev", "pub.dev"]],
  ["flutter", ["flutter.dev"]],
  ["ruby", ["ruby-lang.org", "ruby-doc.org"]],
  ["php", ["php.net"]],
  ["microsoft", ["microsoft.com", "dot.net"]],
  ["scala", ["scala-lang.org"]],
  ["haskell", ["haskell.org"]],
  ["elixir", ["elixir-lang.org"]],
  ["hexdocs", ["hexdocs.pm", "hex.pm"]],
  ["zig", ["ziglang.org"]],
  ["cmake", ["cmake.org"]],
  ["gnu", ["gnu.org"]],
  ["kubernetes", ["kubernetes.io"]],
  ["hashicorp", ["hashicorp.com", "terraform.io"]],
  ["postgresql", ["postgresql.org"]],
  ["redis", ["redis.io"]],
  ["mongodb", ["mongodb.com"]],
  ["graphql", ["graphql.org"]],
  ["aws", ["aws.amazon.com", "amazonaws.com"]],
  ["linear", ["linear.app"]],
  ["notion", ["notion.so", "notion.site", "notion.com"]],
  ["figma", ["figma.com"]],
  ["slack", ["slack.com"]],
  ["vercel", ["vercel.com", "vercel.app"]],
  ["cloudflare", ["cloudflare.com", "workers.dev", "pages.dev"]],
  ["googledev", ["developers.google.com", "web.dev", "developer.chrome.com"]],
  ["google", ["google.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["x", ["x.com", "twitter.com"]],
  ["reddit", ["reddit.com"]],
  ["hackernews", ["news.ycombinator.com"]],
  ["anthropic", ["anthropic.com"]],
  ["claude", ["claude.com", "claude.ai"]],
  ["openai", ["openai.com", "chatgpt.com"]],
];

/** Icons that are black, so a dark theme shows them in white. */
const DARK = new Set(["github", "docsrs", "readthedocs"]);

const icon = (id: string): SiteIcon => ({
  id,
  src: (FILES[`./site-icons/${id}.svg`] ?? FILES[`./site-icons/${id}.png`])!,
  ...(DARK.has(id) ? { dark: true } : {}),
});

/** The icon for a web link, or nothing for a link that is not to a web page. */
export function siteIcon(href: string): SiteIcon | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const serves = (site: string) => {
    const [name, ...path] = site.split("/");
    return (
      (host === name || host.endsWith(`.${name}`)) &&
      (!path.length || url.pathname.startsWith(`/${path.join("/")}`))
    );
  };
  const words = host.split(/[.-]/);
  const found =
    SITES.find(([, hosts]) => hosts.some(serves)) ??
    SITES.find(([, , names]) => names?.some((name) => words.includes(name)));
  return icon(found?.[0] ?? "web");
}

/** A link to each site that Med knows, for the Elements page. */
export const knownSites = () => SITES.map(([id, hosts]) => ({ id, href: `https://${hosts[0]}/` }));
