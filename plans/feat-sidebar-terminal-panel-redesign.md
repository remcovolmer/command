# feat: Redesign sidebar terminal panel with tabs, project-linking, and persistent header

## Overview

De huidige sidecar terminal in de rechter sidebar heeft meerdere UX-problemen: terminals kunnen naar het hoofdgebied "springen", er is maar 1 terminal tegelijk, terminals zijn niet gekoppeld aan het actieve project/worktree, en bij inklappen verdwijnt de terminal volledig. Dit plan lost al deze problemen op met een herontwerp van het terminal-paneel in de sidebar.

## Problem Statement

1. **Terminal springt naar main area** - Sidecar terminal kan soms naar het tab-gedeelte van het hoofdgebied verplaatsen
2. **Geen multi-terminal support** - Slechts 1 sidecar terminal per project mogelijk
3. **Geen project/worktree-koppeling** - Terminals wisselen niet mee bij project/worktree switch
4. **Inklappen = verdwijnen** - Bij collapse verdwijnt de terminal volledig, niet meer te openen
5. **Onnodige terminal-knop** - Terminal-knop in FileExplorerTabBar is overbodig als header altijd zichtbaar is

## Proposed Solution

### 1. Altijd-zichtbare terminal header onderaan sidebar

De terminal-sectie krijgt een **vaste header** die altijd zichtbaar is onderaan de rechter sidebar (FileExplorer). Deze header toont:
- Terminal-icoon + label "Terminal"
- `+` knop om nieuwe terminal toe te voegen
- Chevron om in/uit te klappen

**Wanneer er geen terminals zijn:** Alleen de header is zichtbaar (collapsed state).
**Wanneer er terminals zijn maar ingeklapt:** Header + tab-balk zichtbaar, terminal content verborgen.
**Wanneer expanded:** Header + tabs + actieve terminal content.

### 2. Tab-systeem voor meerdere terminals

Een mini tab-bar direct onder de terminal-header, vergelijkbaar met `TerminalTabBar.tsx` maar compacter:
- Elke tab toont de terminal-naam + state-indicator dot + close (X) button
- Actieve tab is highlighted
- `+` tab/knop om nieuwe terminal aan te maken
- Tabs scrollen horizontaal als er veel zijn

### 3. Terminals gekoppeld aan actief project/worktree

- Per project/worktree een aparte set sidecar terminals bijhouden
- Bij wisseling van project of worktree: toon de terminals van dat project/worktree
- Store structuur wijzigen van `sidecarTerminals: Record<string, string | null>` (1 per project) naar `sidecarTerminals: Record<string, string[]>` (meerdere per project/worktree context)

### 4. Terminals blijven strikt in sidebar

- Sidecar terminals nooit tonen in het hoofdgebied (TerminalArea)
- Bestaande filter in `getProjectTerminals()` die sidecar terminals uitsluit behouden en versterken

## Technical Approach

### Bestanden die gewijzigd worden

#### `src/stores/projectStore.ts`
- **Wijzig** `sidecarTerminals: Record<string, string | null>` naar `sidecarTerminals: Record<string, string[]>` (context key = `worktreeId ?? projectId` -> array van terminalIds)
- **Wijzig** `sidecarTerminalCollapsed` behouden (global collapsed state)
- **Voeg toe** `activeSidecarTerminalId: string | null` - welke sidecar terminal is actief
- **Wijzig** `createSidecarTerminal` - push naar array i.p.v. single set
- **Wijzig** `closeSidecarTerminal` - verwijder uit array, selecteer volgende als actieve was
- **Voeg toe** `setActiveSidecarTerminal(terminalId: string)` action
- **Voeg toe** helper `getSidecarTerminals(contextId: string): TerminalSession[]`

#### `src/components/FileExplorer/FileExplorer.tsx`
- **Verwijder** `onOpenTerminal` prop doorgave aan `FileExplorerTabBar` (terminal-knop niet meer nodig)
- **Wijzig** terminal panel: altijd renderen (niet conditioneel op `sidecarTerminalId`)
- **Wijzig** collapsed logica: header altijd zichtbaar, content conditioneel
- Context key berekenen: `activeWorktreeId ?? activeProjectId`
- Lijst van sidecar terminals ophalen voor huidige context

#### `src/components/FileExplorer/FileExplorerTabBar.tsx`
- **Verwijder** `onOpenTerminal` prop en bijbehorende terminal-knop

#### `src/components/FileExplorer/SidecarTerminal.tsx`
- **Hernoem/refactor** naar `SidecarTerminalPanel.tsx` (bevat header + tabs + terminal)
- **Nieuwe structuur:**
  ```
  SidecarTerminalPanel
  ├── Header (altijd zichtbaar): icoon, "Terminal", +knop, chevron
  ├── TabBar (zichtbaar als terminals > 0, ook bij collapsed):
  │   └── Tab per terminal: naam, state dot, X
  └── Content (alleen zichtbaar als expanded):
      └── Actieve SidecarTerminal xterm instance
  ```
- Header en tabs vormen een "vaste footer" in de sidebar
- De xterm-container toont alleen de actieve terminal

#### `src/types/index.ts`
- Geen wijzigingen nodig (TerminalSession heeft al `type: 'claude' | 'normal'`)

### Collapse/Expand gedrag

```
State: geen terminals, collapsed
┌─────────────────────┐
│ ▶ Terminal           │  ← header alleen, + knop
└─────────────────────┘

State: terminals aanwezig, collapsed
┌─────────────────────┐
│ ▼ Terminal        +  │  ← header
│ [T1] [T2] [T3]      │  ← tabs zichtbaar
└─────────────────────┘

State: terminals aanwezig, expanded
┌─────────────────────┐
│ ▼ Terminal        +  │  ← header
│ [T1] [T2] [T3]      │  ← tabs
│                      │
│  $ terminal output   │  ← xterm content
│  ...                 │
│                      │
└─────────────────────┘
```

### Store data structure change

```typescript
// VOOR (huidig)
sidecarTerminals: Record<string, string | null>  // projectId -> single terminalId

// NA (nieuw)
sidecarTerminals: Record<string, string[]>  // contextKey -> terminalId[]
// contextKey = activeWorktreeId ?? activeProjectId
activeSidecarTerminalId: string | null
```

### Migration van bestaande data

De persist middleware slaat `sidecarTerminals` op. Bij laden:
- Als waarde een `string | null` is (oud formaat), converteren naar `string[]`
- Toevoegen aan `migrate` functie in persist config

## Acceptance Criteria

- [ ] Terminal header is altijd zichtbaar onderaan de rechter sidebar, ook zonder open terminals
- [ ] Meerdere terminals kunnen geopend worden via `+` knop in header
- [ ] Tabs tonen alle open terminals met state-indicator en close-knop
- [ ] Bij inklappen blijven header + tabs zichtbaar, alleen xterm-content verborgen
- [ ] Bij uitklappen verschijnt de actieve terminal weer
- [ ] Wisselen van project/worktree toont de terminals van dat project/worktree
- [ ] Sidecar terminals verschijnen nooit in het hoofdgebied (TerminalArea tabs)
- [ ] Terminal-knop verwijderd uit FileExplorerTabBar (niet meer nodig)
- [ ] Bestaande sidecar terminal data wordt correct gemigreerd
- [ ] `npm run build` slaagt zonder fouten

## References

- `src/stores/projectStore.ts:35-36` - huidige sidecar state
- `src/components/FileExplorer/FileExplorer.tsx:33-66` - huidige sidecar logica
- `src/components/FileExplorer/SidecarTerminal.tsx` - huidige terminal component
- `src/components/FileExplorer/FileExplorerTabBar.tsx:56-64` - terminal-knop om te verwijderen
- `src/components/Terminal/TerminalTabBar.tsx` - referentie voor tab-design
- `src/components/Layout/TerminalArea.tsx` - hoofdgebied dat sidecar terminals uitsluit
