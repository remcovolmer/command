---
date: 2026-02-03
topic: workspace-dashboard
---

# Workspace Dashboard voor Command

## Probleem

Command focust op code/terminals, maar projecten omvatten meer:
- **Stakeholder notes** - meeting notes, beslissingen
- **Backlog/taken** - features, bugs, actiepunten
- **Project status** - waar staat het project, mijlpalen

Huidige situatie: Obsidian voor management, Code folder voor repos. Probleem:
1. **Geen startpunt** - waar begin je de dag?
2. **Context volgt niet** - todos in Obsidian, niet beschikbaar in code project
3. **Constant switchen** - Command én Obsidian open

## Wat We Bouwen

Een **Workspace** concept in Command met speciale status boven normale projecten, plus **twee project types** met verschillende UI.

### Core Concept

```
┌──────────────────────────────────────────────────┐
│ ★ Workspace                   altijd bovenaan    │
│   └── Dashboard (dagstart view)                  │
├──────────────────────────────────────────────────┤
│ Projecten                                        │
│   📁 project-a-docs    ← Workspace project       │
│   💻 project-a-code    ← Code project            │
│   📁 project-b-docs                              │
│   💻 project-b-code                              │
└──────────────────────────────────────────────────┘
```

### Twee Project Types

| Aspect | Code Project 💻 | Workspace Project 📁 |
|--------|-----------------|---------------------|
| **Doel** | Software development | Docs, management, analyse |
| **Terminal tabs** | ✅ Ja | ❌ Nee |
| **Git tab** | ✅ Ja | ❌ Nee |
| **File explorer** | ✅ Ja | ✅ Ja |
| **Markdown editor** | ✅ Ja | ✅ Ja |
| **Workspace link** | Optioneel (naar workspace project) | N/A |

### Workspace = Obsidian Folder

De bestaande Obsidian folder wordt de workspace:
- Bevat management, notes, docs (gesync'd via OneDrive/Teams)
- Daily notes in datum-gebaseerd format (bijv. `daily/2026-02-03.md`)
- Subfolders per project voor project-specifieke management
- Code repos blijven apart (niet in OneDrive vanwege Git/.git en node_modules)

### Folder Structuur: PARA Principe

```
Obsidian Vault/                      ← Workspace root
├── Dagelijkse Notities/             ← Daily notes (datum-gebaseerd)
│   └── 2026-02-03.md
├── Periodieke Notities/             ← Weekly/monthly reviews
├── 0 Inbox/                         ← Quick capture
├── 1 Project/                       ← Actieve projecten
│   ├── project-a/
│   │   ├── stakeholders.md
│   │   ├── meetings/
│   │   └── notes.md                 ← Todos verspreid in files
│   └── project-b/
├── 2 Area/                          ← Doorlopende verantwoordelijkheden
├── 3 Resources/                     ← Referentiemateriaal
├── 4 Archive/                       ← Afgeronde projecten
└── 6 Instellingen/                  ← Templates, config

Code/                                ← Code projecten (apart)
├── project-a/                       ← Git repo
│   └── CLAUDE.md                    ← Refs naar workspace project
└── project-b/
```

### Todo Format

Todos zijn **verspreid door alle markdown files** met standaard checkbox format:
- `- [ ]` = open todo
- `- [x]` = completed todo

Dashboard aggregeert todos door alle .md files te scannen (zoals Obsidian Tasks plugin).

## Key Features

### 1. Workspace als Meta-Laag

- Speciale sectie bovenaan sidebar, altijd zichtbaar
- Dashboard view als startpunt van de dag
- Toont: daily note, todos across projecten, project status

### 2. Project Types met Verschillende Icons

- 💻 **Code project** - voor Git repos, heeft terminal + git tabs
- 📁 **Workspace project** - voor docs/management, alleen file browser + editor

### 3. Project Toevoegen Dialog

Bij "Add Project":
1. Selecteer folder
2. Kies type: **Code** of **Workspace**
3. (Code projects) Optioneel: link naar workspace project folder

### 4. Project Settings

Nieuwe settings sectie (onderaan sidebar of in context menu):
- Project type wijzigen
- Workspace folder koppeling instellen (handmatig)
- Andere project-specifieke instellingen

### 5. Context Flow naar Code Projecten

- Handmatige koppeling tussen code project en workspace project folder
- CLAUDE.md in code project bevat referenties naar workspace content
- Claude Code krijgt automatisch context uit gekoppelde workspace folder

### 6. Skills voor Workflow Automation

- `/start-dag` - Open workspace dashboard, review todos
- `/meeting-notes [project]` - Maak meeting note, extract todos
- `/sync-context` - Update project CLAUDE.md met relevante workspace info

## UI Changes in Command

### Sidebar

```
┌──────────────────────────┐
│ ★ Workspace              │  ← Meta-laag, altijd zichtbaar
│   └── Dashboard          │
├──────────────────────────┤
│ Projects                 │
│   📁 project-a-docs      │  ← Workspace project
│   💻 project-a-code      │  ← Code project (linked)
│   📁 project-b-docs      │
│   💻 project-b-code      │
│   └── + Add Project      │
├──────────────────────────┤
│ ⚙️ Settings              │  ← Nieuw: instellingen
└──────────────────────────┘
```

### Center Area Behavior

| Selection | Center Area Shows |
|-----------|-------------------|
| Workspace | Dashboard view |
| Code project | Terminal tabs + Git tab |
| Workspace project | File browser + Editor tabs (geen terminal/git) |

### Add Project Dialog

```
┌─────────────────────────────────────┐
│ Add Project                         │
├─────────────────────────────────────┤
│ Folder: [Browse...]                 │
│                                     │
│ Type:                               │
│   ○ 💻 Code project                 │
│   ○ 📁 Workspace project            │
│                                     │
│ [Only for Code projects]            │
│ Link to workspace folder:           │
│   [Select folder...] (optional)     │
│                                     │
│ [Cancel]              [Add Project] │
└─────────────────────────────────────┘
```

## Data Model Changes

```typescript
// Project types
type ProjectType = 'code' | 'workspace';

// Updated Project interface
interface Project {
  id: string;
  name: string;
  path: string;
  type: ProjectType;                    // NEW: project type
  createdAt: number;
  sortOrder: number;
  workspaceProjectPath?: string;        // NEW: link to workspace folder (code projects only)
}

// Workspace configuration (singleton)
interface WorkspaceConfig {
  id: string;
  name: string;
  path: string;                         // Pad naar Obsidian vault
  dailyNotesPath: string;               // "Dagelijkse Notities"
  dailyNoteFormat: string;              // "YYYY-MM-DD"
  projectsPath: string;                 // "1 Project"
  areasPath: string;                    // "2 Area"
  resourcesPath: string;                // "3 Resources"
  archivePath: string;                  // "4 Archive"
  inboxPath: string;                    // "0 Inbox"
}

// Todo item (parsed from markdown)
interface TodoItem {
  text: string;
  completed: boolean;
  filePath: string;                     // Source file
  lineNumber: number;                   // For navigation
  project?: string;                     // Extracted from path if in 1 Project/
}
```

## Implementatie Fases

### Fase 1: Project Types
- Voeg `type` field toe aan Project interface
- Verschillende icons in sidebar per type
- Update "Add Project" dialog met type selectie
- Conditionele UI: geen terminal/git tabs voor workspace projects

### Fase 2: Workspace Setup
- Workspace configuratie (settings)
- Workspace sectie in sidebar
- Basic dashboard view (toont daily note)

### Fase 3: Dashboard Features
- **Todo aggregatie**: Scan alle .md files voor `- [ ]` checkboxes
- Todos gegroepeerd per project/file
- Klikbaar → opent file op betreffende regel
- Project status overzicht
- Quick actions (nieuwe meeting note, etc.)

### Fase 4: Project Linking
- Settings UI voor workspace folder koppeling
- Context beschikbaar in terminal (via CLAUDE.md)

### Fase 5: Skills
- `/start-dag`, `/meeting-notes`, `/sync-context`
- Automation van repetitieve taken

## Beslissingen

| Beslissing | Keuze | Rationale |
|------------|-------|-----------|
| Vault structuur | PARA principe | Projects, Areas, Resources, Archive |
| Daily note format | Datum-gebaseerd | Bestaand Obsidian format behouden |
| Todo format | `- [ ]` markdown | Standaard, verspreid door files |
| Todo aggregatie | Scan alle .md files | Zoals Obsidian Tasks plugin |
| Project linking | Handmatig configureren | Meer flexibiliteit, namen matchen niet altijd |
| Workspace projects | Geen terminal/git | Niet relevant voor docs, simpelere UI |
| Settings locatie | Onderaan sidebar | Toegankelijk maar niet in de weg |

## Next Steps

→ `/workflows:plan` voor implementatie Fase 1 (Project Types)
