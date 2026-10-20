# Coding standards

Judgement calls for code review. Formatting, lint rules (`.oxlintrc.json`) and types are enforced by `npm test`; these rules cover what tooling cannot see. Each rule names what to look for in a diff.

## One source per rule value

Colony rules and the building table own every radius, limit and threshold. Code reads the value from there, and player-facing text interpolates it. Look for a literal that restates a rule ("within 6 tiles", a hard-coded output limit): it drifts when the rule changes.

## Glossary names

Names and player-facing text use the terms in `GLOSSARY.md`. Look for a name built on a term the glossary lists under _Avoid_, such as `food` for an edible good.

## Previews share the action's computation

A quote, preview or placement check and the action it predicts call the same function, so the player sees what will happen. Look for an action that re-derives a decision its quote or preview already made.

## Types and guards agree

A runtime guard checks only states its type allows. Look for a check of a value the type says is always present: either the type is too strict or the guard is dead, and the fix goes into one of them.

## Missing values are explicit

Possibly-missing values are typed as such and handled where they are used. A non-null assertion, or a cast that removes `null`, carries a comment saying why the value is always present.
