---
status: pending
priority: p2
issue_id: "062"
tags: [code-review, architecture, performance, readability]
dependencies: []
---

# Extract Inline SVG from Sidebar.tsx to LogoIcon Component

## Problem Statement

The new logo SVG path data (~30KB of coordinate data) is inlined directly in `Sidebar.tsx` at line 278. This makes the component file hard to navigate, difficult to diff in code reviews, and adds unnecessary cognitive load. Every review agent flagged this unanimously.

## Findings

- **Architecture strategist**: Extract to dedicated component for separation of concerns
- **Performance oracle**: Inline SVG causes React VDOM overhead on every render; extract and memoize
- **Pattern recognition**: Anti-pattern — 30KB data blob in a UI component
- **Code simplicity reviewer**: Old approach was 1 line (`<img>`), new approach bloats the file
- **TypeScript reviewer**: HIGH priority — extract to separate component

## Proposed Solutions

### Option A: LogoIcon.tsx component (Recommended)
Create `src/components/LogoIcon.tsx` with the SVG markup. Import in Sidebar.

```tsx
// src/components/LogoIcon.tsx
export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 206.44418 210.27495" fill="currentColor">
      <g transform="translate(-1.3162134,-2.2573985)">
        <path d="m 103.45163,211.34081 c ..." />
      </g>
    </svg>
  );
}
```

Sidebar usage: `<LogoIcon className="w-6 h-6 text-primary" />`

- Pros: Clean separation, same theme-responsiveness via `currentColor`, reusable
- Cons: One new file
- Effort: Small
- Risk: None

## Technical Details

- **Affected files**: `src/components/Sidebar/Sidebar.tsx`, new `src/components/LogoIcon.tsx`
- **Components**: Sidebar header logo

## Acceptance Criteria

- [ ] SVG path data lives in its own component file
- [ ] Sidebar.tsx imports LogoIcon and uses it at line 278
- [ ] Logo still renders with `text-primary` color and responds to theme changes
- [ ] No visual difference in rendered output

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-02 | Created from code review | Unanimous finding across all 8 review agents |

## Resources

- Branch: `feat/new-logo`
