# Release Command

Create a new release with semantic versioning.

## Arguments

- `$ARGUMENTS` - Optional: `major`, `minor`, or `patch`

## Instructions

### With argument (major/minor/patch)

If `$ARGUMENTS` contains `major`, `minor`, or `patch`, execute immediately:

```bash
npm version <type> && git push && git push --tags
```

Report the new version number and confirm success.

### Without argument

1. Analyze recent changes:
   - Run `git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline` to see commits since last tag
   - Run `git diff $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --stat` to see changed files

2. Determine the suggested version bump:
   - **major**: Breaking changes, major rewrites, incompatible API changes
   - **minor**: New features, significant enhancements, new functionality
   - **patch**: Bug fixes, small improvements, documentation updates

3. Ask the user which version type to use with AskUserQuestion:
   - Show recent changes summary
   - Provide your recommendation as first option with "(Recommended)"
   - Options: the three version types

4. Execute the release and report success.
