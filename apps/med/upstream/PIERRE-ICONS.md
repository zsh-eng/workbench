# Pierre icons

Source: https://github.com/pierrecomputer/icons, `svg/`, at commit
1c93d61bb031bdafae0c4c5c2bd9911734994ac5. Apache License 2.0; see
PIERRE-ICONS-LICENSE. Copyright Pierre Computer Company.

Med's icons in `src/web/components/Icon.tsx` are this set's, the icons of
Diffs and Trees. `scripts/pierre-icons.ts` copies each one Med uses, as its
shapes, into `src/web/components/pierre-icons.ts`, so Med has no icon package
at runtime. The script names the Pierre icon behind each Med name.

Changes: the shapes draw in `currentColor` instead of black, and some turn
to face another way (Arrow as up and down, ArrowsUpDown as left and right).
Med draws the icons that the set does not have (Command, pull request,
flask, play, pause, and arrows that point inward) on the same 16-pixel grid.
