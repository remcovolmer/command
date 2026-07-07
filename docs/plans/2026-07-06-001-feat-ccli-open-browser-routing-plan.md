---
title: "ccli open — render HTML & URLs in de browser - Plan"
type: feat
date: 2026-07-06
topic: ccli-open-browser-routing
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
origin: docs/plans/2026-07-06-001-feat-ccli-open-browser-routing-plan.html
---

# ccli open — render HTML & URLs in de browser - Plan

## Goal Capsule

- **Objective:** Maak `ccli open <file-of-url>` Command's enige "open dit"-commando: HTML-bestanden en URL's renderen in de webview-browser, overige bestanden tonen broncode in de editor — altijd in het gesprek dat het commando aanriep. Verwijder `ccli diff`.
- **Product authority:** Remco Volmer (Riverwise).
- **Open blockers:** Geen.
- **Product Contract preservation:** Product Contract ongewijzigd (R1–R9 behouden). Planning ontdekte dat de bestand-routering (HTML → browser, overig → editor) al bestaat in `src/components/Sidebar/Sidebar.tsx` via `isHtmlFile`. Het net-nieuwe werk versmalt daardoor tot URL-ondersteuning, calling-chat-targeting en het verwijderen van `ccli diff`.

---

## Product Contract

### Summary

`ccli open <file-of-url>` wordt één commando dat routeert op doeltype: een URL (localhost of extern) en een `.html`/`.htm`-bestand openen gerenderd in de `<webview>`-browser (met live-reload), elk ander bestand opent als broncode in de code-editor. De tab verschijnt in het tab-gebied van de aanroepende chat, afgeleid uit het terminal-ID van de CLI. `ccli diff` vervalt; de diff-weergaven in de git-UI blijven ongewijzigd.

### Problem Frame

Claude Code draait in Command's terminals en genereert vaak web-renderbare output (een HTML-rapport, plan, dashboard) of start een dev-server op `localhost`. De bestand→HTML→browser-routering bestaat al voor bestanden, maar er is **geen pad naar een URL** — Claude kan een draaiende dev-server of externe pagina niet tonen. Daarnaast koppelen de store-acties de tab aan de chat die de gebruiker *toevallig gefocust* heeft (`activeTerminalId`); voor een CLI-aanroep uit een achtergrond-chat is dat verkeerd. Tot slot dupliceert `ccli diff` functionaliteit die de git-UI al biedt.

### Key Decisions

- **KD1. Eén `ccli open` dat routeert op doeltype, geen apart `browser`-commando.** Heft de open/browser-overlap op; één mentaal model. Hergebruikt de bestaande editor- én webview-paden.
- **KD2. HTML en URL's renderen; overige bestanden tonen broncode.** De webview rendert alleen zinvol web-content. De bestand-tak bestaat al (`isHtmlFile` in `Sidebar.tsx`); dit plan voegt de URL-tak toe.
- **KD3. De tab opent in de aanroepende chat, afgeleid uit het terminal-ID.** De server voegt `context.terminalId` toe aan de open-events; de store-acties krijgen een optionele `terminalId`-parameter die `activeTerminalId` overschrijft. UI-paden (klik in de file explorer, OSC8-link) laten de parameter weg en behouden `activeTerminalId`.
- **KD4. Disambiguatie in de CLI.** De CLI draait in de cwd van de terminal en heeft FS-toegang, dus daar wordt bepaald of het argument een URL of pad is; de server hervalideert het pad binnen de project/worktree-grens. Regel: expliciet `file://`/`http(s)://`-schema is doorslaggevend; anders een waarde die op schijf bestaat = pad; anders een host/URL-vorm = URL.
- **KD5. `ccli diff` verwijderd.** Diff-weergave zit al in de git-UI (`CommitDetail.tsx`, `GitStatusPanel.tsx` via `openDiffTab`/`openWorkingTreeDiffTab`); een ccli-pad is dubbelop. Het `editor:open-diff`-event wordt alleen door `/diff` verzonden, dus het bijbehorende listener-pad wordt mee opgeruimd.

### Requirements

**Unified open & routing**
- R1. `ccli open <target>` accepteert één positioneel argument dat óf een bestandspad óf een URL is.
- R2. Is het doel een URL (`http(s)://` of een kale host als `localhost:5173`), dan opent het als gerenderde pagina in de webview-browser.
- R3. Is het doel een `.html`/`.htm`-bestand, dan opent het gerenderd in de webview-browser, met live-reload. *(Bestaat al; behouden.)*
- R4. Is het doel een ander bestaand bestand, dan opent het als broncode in de editor; `--line <n>` scrollt naar die regel. *(Bestaat al; behouden.)*
- R5. Argument-disambiguatie: expliciet `file://`/`http(s)://`-schema is doorslaggevend; anders geldt een bestaand bestand op schijf als pad, en een URL/host-vorm als URL.

**Chat-targeting & tabs**
- R6. De geopende tab (browser of editor) verschijnt in het tab-gebied van de chat die `ccli open` aanriep, afgeleid uit het terminal-ID — niet in de gefocuste chat.
- R7. Hetzelfde doel opnieuw openen hergebruikt de bestaande tab (bestanden op pad, URL's op URL); een ander doel krijgt een eigen tab.

**Verwijderen van `ccli diff`**
- R8. Het subcommando `ccli diff` en zijn server-route worden verwijderd. De diff-weergaven in de git-UI blijven onaangetast.

**Skill-begeleiding**
- R9. De meegeleverde ccli-skill wordt bijgewerkt (routering van `ccli open`, `ccli diff` weg, suggestie om HTML-deliverables te tonen) en de skill-versie opgehoogd zodat de auto-install herinstalleert.

### Acceptance Examples

- AE1. `ccli open report.html` (bestaat) → gerenderde pagina in de webview, in de aanroepende chat. *(Covers R3, R6.)*
- AE2. `ccli open http://localhost:5173` → de dev-server gerenderd in de webview. *(Covers R2.)*
- AE3. `ccli open src/App.tsx` → broncode in de editor. *(Covers R4.)*
- AE4. `ccli open src/App.tsx --line 42` → editor, gescrolld naar regel 42. *(Covers R4.)*
- AE5. `ccli open notes.md` → broncode in de editor, niet gerenderd. *(Covers R4, KD2.)*
- AE6. `ccli open example.com` → `http://example.com` gerenderd in de webview. *(Covers R2, R5.)*
- AE7. Tweede `ccli open report.html` → hergebruikt de bestaande tab; daarna `ccli open localhost:5173` → nieuwe tab. *(Covers R7.)*
- AE8. `ccli open report.html --line 10` → gerenderd in de browser, `--line` genegeerd. *(Covers R3.)*
- AE9. `ccli open ontbreekt.md` (geen URL-vorm, bestaat niet) → foutmelding "not found". *(Covers R5.)*
- AE10. `ccli diff foo.ts` → foutmelding "Unknown command" (subcommando verwijderd). *(Covers R8.)*

### Scope Boundaries

- **Deferred for later:** override-argument om een ánder gesprek/project te targeten dan de aanroepende chat.
- **Outside this product's identity:** nieuwe keyboard shortcut (`Ctrl+Shift+B` dekt handmatig openen); URL allow/blocklist (steunt op `webviewSecurity.ts`); dev-servers automatisch starten of poorten detecteren.
- **Onaangetast:** diff-weergaven in de git-UI; bestanden wijzigen via bestaande tools.
- **Deferred to Follow-Up Work:** de `activeTerminalId`-koppeling zit ook in andere open-paden buiten `ccli open`; die worden hier niet aangeraakt.

### Dependencies & Assumptions

- Hergebruikt: `terminalId → projectId`-resolutie in CommandServer; de `<webview>` BrowserTab + live-reload; store-acties `openFileInBrowser`/`openBrowserTab`/`setBrowserTabUrl`/`openEditorTab`; `validateFilePath`-grenscontrole; `isHtmlFile` in `src/utils/editorLanguages.ts`.
- Aanname: bestandspad-validatie geldt voor bestand-doelen; URL's worden niet pad-gevalideerd; externe URL's zijn al gehard in `webviewSecurity.ts`.
- Aanname: `--line` geldt alleen voor de editor-route en wordt genegeerd voor browser-doelen.
- Gedragswijziging: bestaande `ccli open <html>`-aanroepen tonen al een gerenderde pagina (bestaand gedrag) — dit plan wijzigt dat niet, maar breidt naar URL's uit.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. CLI stuurt een gediscrimineerde payload.** `buildRoute` bepaalt URL vs pad en verstuurt `{ file: <abs-path>, line? }` óf `{ url: <string> }` naar `POST /open`. De server routeert op welk veld aanwezig is. Zo blijft cwd-relatieve padresolutie in de CLI (correct t.o.v. de terminal), en houdt de server de autoriteit over padvalidatie.
- **KTD2. Nieuw renderer-event `editor:open-browser` voor URL's.** Bestanden blijven via `editor:open-file` lopen (de bestaande HTML/editor-splitsing in `Sidebar.tsx` blijft intact). URL's krijgen een eigen event omdat er geen bestand/`fileName` is en geen live-reload-koppeling.
- **KTD3. `terminalId` in de event-payload; optionele store-parameter.** `context.terminalId` wordt toegevoegd aan `editor:open-file` en `editor:open-browser`. De store-acties krijgen `terminalId?` en gebruiken `terminalId ?? state.activeTerminalId`, zodat bestaande UI-callers ongewijzigd blijven.
- **KTD4. Diff-verwijdering is oppervlak-opruiming, geen feature-verlies.** Verwijder de CLI-`diff`-case, de `POST /diff`-route, de preload-`onOpenDiff`, de `terminalEvents.onEditorOpenDiff`-dispatcher en de Sidebar-listener. `openDiffTab`/`openWorkingTreeDiffTab` en hun git-UI-callers blijven.

### High-Level Technical Design

Routering van `ccli open <target>` (alle uitkomsten landen in de aanroepende chat via `terminalId`):

```
ccli open <target>              (CLI: electron/main/cli/ccli.cjs)
   │  disambigueer (KD4)
   ├── URL-vorm ───────────────► POST /open { url }
   │                                  │  (server: geen padvalidatie)
   │                                  └─► send editor:open-browser { url, projectId, terminalId }
   │                                          └─► store.openUrlInBrowser(url, projectId, terminalId)  → webview-tab
   │
   └── bestandspad ────────────► POST /open { file, line? }
                                      │  validateFilePath + accessSync
                                      └─► send editor:open-file { filePath, fileName, projectId, line, terminalId }
                                              └─► Sidebar: isHtmlFile(fileName)?
                                                     ├── ja  → store.openFileInBrowser(..., terminalId)  → webview-tab
                                                     └── nee → store.openEditorTab(..., terminalId)       → editor-tab
```

---

## Implementation Units

### U1. CLI: `ccli open` accepteert URL of pad; verwijder `ccli diff`

- **Goal:** `buildRoute` in de CLI onderscheidt URL van bestandspad en verstuurt de juiste payload; de `diff`-case en help-regel verdwijnen.
- **Requirements:** R1, R2, R5, R8.
- **Dependencies:** geen.
- **Files:**
  - Modify: `electron/main/cli/ccli.cjs` (`buildRoute` `open`- en `diff`-cases, `HELP_TEXT`)
  - Test: `test/ccli.test.ts`
- **Approach:**
  - In de `open`-case: neem `positional[1]` als target. Bepaal URL-vorm met een lokale helper: `true` als het met `http://`/`https://`/`file://` begint, óf als het geen padscheiding/`.`-pad is en op `host[:poort]` of een domein lijkt en niet als bestaand bestand resolvet. Bij URL → `{ method:'POST', path:'/open', body:{ url: target } }` (geen `path.resolve`). Anders → huidige gedrag: `{ file: path.resolve(target) }`, plus `line` uit `--line`.
  - Verwijder de volledige `diff`-case (valt daarna in de `default` "Unknown command").
  - Werk `HELP_TEXT` bij: `open <file|url> [--line <n>]` met korte uitleg; verwijder de `diff`-regel.
- **Patterns to follow:** bestaande `open`-case en `parseArgs`; `normalizeAddressBarInput` in `src/utils/browserUrls.ts` als referentie voor de host-heuristiek (herimplementeer beknopt in de CLI — geen import over de main/renderer-grens).
- **Test scenarios:**
  - `buildRoute(['open','report.html'])` → `POST /open` met `body.file` = geresolved absoluut pad, geen `url`.
  - `buildRoute(['open','http://localhost:5173'])` → `body.url` = de URL, geen `file`.
  - `buildRoute(['open','example.com'])` → `body.url` = `example.com` (server prefixt), geen `path.resolve`.
  - `buildRoute(['open','src/App.tsx','--line','42'])` → `body.file` absoluut, `body.line === 42`.
  - `buildRoute(['open'])` → error met usage-string.
  - `buildRoute(['diff','foo.ts'])` → Unknown-command error (case verwijderd). *(Covers AE10.)*
- **Verification:** de unit-tests dekken URL-, pad- en verwijderde-diff-gevallen; `ccli --help` toont geen `diff` meer.

### U2. Server: `/open` routeert URL vs bestand; `terminalId` in payload; verwijder `/diff`

- **Goal:** `POST /open` verwerkt zowel `{ url }` als `{ file }`, voegt `terminalId` toe aan beide events, en de `/diff`-route wordt verwijderd.
- **Requirements:** R2, R3, R4, R6, R8.
- **Dependencies:** U1.
- **Files:**
  - Modify: `electron/main/services/CommandServer.ts` (`registerFileRoutes`)
  - Test: `test/commandServer.file.test.ts`
- **Approach:**
  - In de `/open`-handler: als `body.url` een string is → valideer basaal (begint met `http://`/`https://`/`file://`, of prefixe `http://` op een kale host, spiegelend aan `normalizeAddressBarInput`), sla padvalidatie/`accessSync` over, en `webContents.send('editor:open-browser', { url, projectId, terminalId })`.
  - Anders (`body.file`): behoud `validateFilePath` + `accessSync`; voeg `terminalId: context.terminalId` toe aan de bestaande `editor:open-file`-payload.
  - `projectId` en `terminalId` komen uit de bestaande context-resolutie (zoals `/open` nu al `validation.projectId` bepaalt).
  - Verwijder de `route('POST','/diff', …)`-registratie volledig.
- **Patterns to follow:** de bestaande `/open`-handler (regels ~382–407) en `validateFilePath`; response-shape `{ ok, error? }`.
- **Test scenarios:**
  - `/open` met `{ url:'http://localhost:5173' }` → `editor:open-browser` verzonden met `url`, `projectId`, `terminalId`; geen file-not-found.
  - `/open` met `{ url:'example.com' }` → event-URL genormaliseerd naar `http://example.com`. *(Covers AE6.)*
  - `/open` met `{ file:<bestaand .html> }` → `editor:open-file` met `terminalId` aanwezig.
  - `/open` met `{ file:<niet-bestaand> }` → `{ ok:false, error:'File not found' }`. *(Covers AE9.)*
  - `/open` met een pad buiten de projectgrens → geweigerd (bestaand `validateFilePath`-gedrag).
  - `POST /diff` → 404/unknown route (registratie verwijderd).
- **Verification:** tests bevestigen beide takken en de aanwezigheid van `terminalId`; `/diff` bestaat niet meer.

### U3. Renderer: open in de aanroepende chat; URL-event; diff-listener weg

- **Goal:** URL's openen als browser-tab in de aanroepende chat; bestaande file/editor-opens respecteren het meegestuurde `terminalId`; het diff-luisterpad wordt opgeruimd.
- **Requirements:** R2, R6, R7, R8.
- **Dependencies:** U2.
- **Files:**
  - Modify: `electron/preload/index.ts` (whitelist + `editor.onOpenBrowser`; verwijder `onOpenDiff` + `editor:open-diff` uit whitelist)
  - Modify: `src/utils/terminalEvents.ts` (`onEditorOpenBrowser` toevoegen; `onEditorOpenDiff` + callbacks verwijderen)
  - Modify: `src/components/Sidebar/Sidebar.tsx` (`terminalId` doorgeven; browser-listener toevoegen; diff-listener verwijderen)
  - Modify: `src/stores/projectStore.ts` (`terminalId?`-param op `openFileInBrowser`/`openEditorTab`/`openBrowserTab`; nieuwe `openUrlInBrowser`)
  - Modify: `src/types/index.ts` (payload-types: `terminalId` op open-file, nieuw `editor:open-browser`; signatuur-updates)
  - Test: `test/projectStore.test.ts`
- **Approach:**
  - Preload: voeg `editor:open-browser` toe aan de events-whitelist en een `editor.onOpenBrowser`-subscription (payload `{ url, projectId, terminalId }`). Verwijder `onOpenDiff` en `editor:open-diff` uit de whitelist.
  - `terminalEvents.ts`: `onEditorOpenBrowser(callback)` naar analogie van `onEditorOpenFile`; verwijder `onEditorOpenDiff` en de `editorOpenDiffCallbacks`.
  - `Sidebar.tsx`: geef `data.terminalId` mee aan `openFileInBrowser`/`openEditorTab` in de bestaande `onEditorOpenFile`-handler; voeg een `onEditorOpenBrowser`-handler toe die `store.openUrlInBrowser(data.url, data.projectId, data.terminalId)` aanroept; verwijder de `onEditorOpenDiff`-handler en zijn unsubscribe.
  - `projectStore.ts`: voeg `terminalId?: string` toe aan `openFileInBrowser`, `openEditorTab`, `openBrowserTab`; vervang `const chatId = state.activeTerminalId ?? ''` door `const chatId = terminalId ?? state.activeTerminalId ?? ''`. Voeg `openUrlInBrowser(url, projectId, terminalId?)` toe: dedup op `url` binnen `editorTabs` (type `browser`), anders nieuwe `BrowserTab` zonder `filePath`, gekoppeld aan `chatId`.
  - `types/index.ts`: werk de `editor`-preload-types en store-action-signaturen bij.
- **Patterns to follow:** bestaande `onEditorOpenFile`-wiring en `openFileInBrowser`/`openBrowserTab` in de store; de per-chat `activeContentTabId[chatId]`-koppeling.
- **Test scenarios:**
  - `openFileInBrowser(path, name, projectId, 'term-A')` → tab krijgt `terminalId === 'term-A'` en `activeContentTabId['term-A']` wijst ernaar, ook als `activeTerminalId` een andere chat is. *(Covers R6.)*
  - `openEditorTab(path, name, projectId, 'term-A')` → idem voor editor-tabs.
  - `openFileInBrowser(...)` zonder `terminalId` → valt terug op `activeTerminalId` (bestaand gedrag ongewijzigd).
  - `openUrlInBrowser('http://localhost:5173', projectId, 'term-A')` → nieuwe browser-tab met die URL in chat A.
  - `openUrlInBrowser` tweemaal met dezelfde URL → hergebruikt dezelfde tab; met een andere URL → tweede tab. *(Covers AE7.)*
- **Verification:** store-tests bevestigen calling-chat-targeting en URL-dedup; app compileert zonder de verwijderde diff-symbolen (`tsc`).

### U4. Skill: `ccli-skill.md` bijwerken + versie ophogen

- **Goal:** de meegeleverde skill beschrijft de `ccli open`-routering en noemt `ccli diff` niet meer; de versie-bump triggert herinstallatie in bestaande projecten.
- **Requirements:** R9.
- **Dependencies:** U1 (CLI-oppervlak vastgesteld).
- **Files:**
  - Modify: `electron/main/templates/ccli-skill.md` (eerste-regel versie-comment + "Files & Diffs"-sectie)
  - Modify: `electron/main/services/SkillInstaller.ts` (`SKILL_VERSION`)
  - Test: `test/skillInstaller.test.ts`
- **Approach:**
  - Hernoem de "Files & Diffs"-sectie naar "Files & Browser": `ccli open <file>` rendert HTML/URL in de browser, andere bestanden in de editor; voorbeelden `ccli open report.html`, `ccli open http://localhost:5173`, `ccli open src/App.tsx --line 42`. Voeg een korte suggestie toe om gegenereerde HTML-deliverables met `ccli open` te tonen. Verwijder de `ccli diff`-regel.
  - Zet de eerste-regel-comment op `<!-- ccli-skill-v2 -->` en `SKILL_VERSION = 'ccli-skill-v2'`.
- **Patterns to follow:** bestaande skill-template-structuur; de versie-regex `ccli-skill-v\d+` in `SkillInstaller.getInstalledVersion`.
- **Test scenarios:**
  - Bestaand skill-bestand met `<!-- ccli-skill-v1 -->` → wordt herschreven naar v2.
  - Skill-bestand al op v2 → niet herschreven (idempotent).
  - Nieuw project zonder skill → skill wordt aangemaakt op v2.
- **Verification:** `skillInstaller.test.ts` bevestigt de versie-bump-herinstallatie; de template noemt `diff` niet meer.

---

## Verification Contract

- **Typecheck:** `npm run build` (of `tsc`) slaagt — geen dangling verwijzingen naar verwijderde diff-symbolen of gewijzigde signaturen.
- **Unit tests:** `npm run test` groen, inclusief de uitgebreide `test/ccli.test.ts`, `test/commandServer.file.test.ts`, `test/projectStore.test.ts`, `test/skillInstaller.test.ts`.
- **Gedragsproef (AE-dekking):** AE1–AE10 afgedekt door de test-scenario's in U1–U4. De belangrijkste nieuwe gedragingen: URL → browser-tab (AE2, AE6), calling-chat-targeting (AE1/R6), URL-dedup (AE7), `ccli diff` verwijderd (AE10).
- **Execution note:** begin U2 en U3 met een falende test op de URL-tak (`editor:open-browser`) vóór implementatie, zodat de nieuwe route bewezen wordt en niet alleen de bestaande bestand-tak.

## Definition of Done

- `ccli open <url>` opent de URL gerenderd in een webview-tab in de aanroepende chat; `ccli open report.html` rendert; `ccli open src/App.tsx` toont broncode.
- Browser- en editor-tabs uit `ccli open` landen in het aanroepende gesprek, niet in de gefocuste chat.
- `ccli diff` en de `/diff`-route bestaan niet meer; de git-UI diff-weergaven werken ongewijzigd.
- De ccli-skill is bijgewerkt en de versie-bump herinstalleert in bestaande projecten.
- `npm run test` en de typecheck zijn groen.

---

## Sources & Research

- `electron/main/cli/ccli.cjs` — `buildRoute` (`open`/`diff`-cases), `HELP_TEXT`, `parseArgs`.
- `electron/main/services/CommandServer.ts` — `registerFileRoutes` (`/open` ~382–407, `/diff` ~409–429), `validateFilePath`, `context.terminalId`.
- `src/components/Sidebar/Sidebar.tsx` — `onEditorOpenFile`/`onEditorOpenDiff`-handlers (~211–223); bestaande `isHtmlFile`-splitsing.
- `src/utils/terminalEvents.ts` — `onEditorOpenFile`/`onEditorOpenDiff`-dispatchers (~261–280).
- `electron/preload/index.ts` — events-whitelist (~66–67), `editor.onOpenFile`/`onOpenDiff` (~300–328).
- `src/stores/projectStore.ts` — `openEditorTab` (~496), `openFileInBrowser`/`openBrowserTab`/`setBrowserTabUrl` (~1167–1227).
- `src/utils/editorLanguages.ts` — `isHtmlFile` (~68).
- `src/utils/browserUrls.ts` — `pathToFileUrl`, `normalizeAddressBarInput` (URL/host-heuristiek).
- `src/components/FileExplorer/CommitDetail.tsx`, `src/components/FileExplorer/GitStatusPanel.tsx` — git-UI diff-ingangen (onaangetast door R8).
- `electron/main/services/SkillInstaller.ts` — `SKILL_VERSION`, versie-regex (~16, ~78).
- `electron/main/templates/ccli-skill.md` — skill-tekst + versie-comment.
- Origin: `docs/plans/2026-07-06-001-feat-ccli-open-browser-routing-plan.html` (requirements-only Product Contract).
