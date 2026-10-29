# 0010: A look is data (tokens + named variants), never a fork of a part

Status: accepted (2026-10-26); the looks now live in app-ui ([0011](0011-ui-kit-served-from-app-ui.md)).

Decision: `@core/theme`'s looks (A tinted glass, B colour band, C dense and quiet) are one file each in
`app/public/theme/looks/`: a set of custom-property tokens plus five named variants (header, menu, glass, tick, tab
bar) shown as `data-*` marks on `<html>`. Every `@core/ui` part styles from those tokens and marks; no part has a copy
per look. A look that seems to need its own copy of a part gets a new variant value instead, after asking the owner.
How to add one: app-ui's [docs/ui-kit.md](https://github.com/flamingbeing/app-ui/blob/main/docs/ui-kit.md#adding-a-look).

The settings are look × theme × density, per device. Density (comfortable, regular, compact: 60 / 50 / 44 px rows)
replaces v0's layout; a stored `compact` reads as compact. With nothing picked, a device gets the app's look
(`applyTheme({ look })`), else A, and regular density.

Glass stays on floating chrome only (at most three layers, two blur tiers). A glass guard turns it to Solid on a
device with little memory (`deviceMemory` ≤ 4) or slow frames (median over 20 ms on the first scroll), kept per device;
the person's Solid always wins and "Glass, even here" overrides the guard.
