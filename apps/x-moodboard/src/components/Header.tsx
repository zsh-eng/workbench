import { forwardRef, type KeyboardEvent } from "react";
import { count } from "../lib/format";
import type { Density } from "../lib/layout";
import { CloseIcon, Contrast, Filters, GridDense, GridLoose, Mark, Moon, SearchIcon, Sun } from "./Icons";

export type Theme = "auto" | "light" | "dark";

interface HeaderProps {
  q: string;
  total: number;
  density: Density;
  theme: Theme;
  activeFilters: number;
  filtersOpen: boolean;
  onQ: (q: string) => void;
  onSearchKey: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDensity: (density: Density) => void;
  onTheme: (theme: Theme) => void;
  onHome: () => void;
  onFilters: () => void;
}

const NEXT_THEME: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const THEME_LABEL: Record<Theme, string> = { auto: "Theme follows the system", light: "Light theme", dark: "Dark theme" };

/** Density and theme controls; the header holds them on wide screens, the filter sheet on narrow ones. */
export function DisplayPrefs(props: { density: Density; theme: Theme; onDensity: (d: Density) => void; onTheme: (t: Theme) => void }) {
  const { density, theme } = props;
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Grid density">
        <button
          type="button"
          role="radio"
          aria-checked={density === "comfortable"}
          aria-label="Comfortable grid with captions"
          title="Comfortable"
          onClick={() => props.onDensity("comfortable")}
        >
          <GridLoose size={18} />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={density === "compact"}
          aria-label="Compact grid, images only"
          title="Compact"
          onClick={() => props.onDensity("compact")}
        >
          <GridDense size={18} />
        </button>
      </div>
      <button
        type="button"
        className="icon-button theme-button"
        onClick={() => props.onTheme(NEXT_THEME[theme])}
        aria-label={`${THEME_LABEL[theme]}. Change theme`}
        title={THEME_LABEL[theme]}
      >
        {theme === "auto" ? <Contrast size={18} /> : theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </>
  );
}

export const Header = forwardRef<HTMLInputElement, HeaderProps>(function Header(props, searchRef) {
  const { q, total, density, theme } = props;
  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          props.onHome();
        }}
        aria-label="Cuttings, all saved posts"
      >
        <Mark />
        <span className="brand-name">Cuttings</span>
      </a>

      <div className="search" role="search">
        <SearchIcon size={18} className="search-icon" />
        <input
          ref={searchRef}
          type="search"
          className="search-input"
          aria-label="Search saved posts by text, author or topic"
          placeholder={total ? `Search ${count(total)} saved posts` : "Search"}
          value={q}
          onChange={(e) => props.onQ(e.target.value)}
          onKeyDown={props.onSearchKey}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-keyshortcuts="/ Control+K Meta+K"
        />
        {q ? (
          <button type="button" className="search-clear" onClick={() => props.onQ("")} aria-label="Clear search">
            <CloseIcon size={16} />
          </button>
        ) : (
          <kbd className="search-key" aria-hidden="true">
            /
          </kbd>
        )}
      </div>

      <div className="topbar-tools">
        <button
          type="button"
          className="filters-button"
          onClick={props.onFilters}
          aria-expanded={props.filtersOpen}
          aria-haspopup="dialog"
          aria-label={props.activeFilters ? `Filters, ${props.activeFilters} active` : "Filters"}
        >
          <Filters size={18} />
          <span>Filters</span>
          {props.activeFilters ? <span className="filters-count">{props.activeFilters}</span> : null}
        </button>
        <DisplayPrefs density={density} theme={theme} onDensity={props.onDensity} onTheme={props.onTheme} />
      </div>
    </header>
  );
});
