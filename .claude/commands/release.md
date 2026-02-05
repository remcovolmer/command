# Release Command

Create a new release with semantic versioning.

## Arguments

- `$ARGUMENTS` - Optional: `major`, `minor`, or `patch`

## Instructions

1. If `$ARGUMENTS` contains `major`, `minor`, or `patch`, use that version type directly and skip to step 4.

2. If no argument provided, analyze recent changes:
   - Run `git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline` to see commits since last tag
   - Run `git diff $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --stat` to see changed files

3. Based on the changes, determine the suggested version bump:
   - **major**: Breaking changes, major rewrites, incompatible API changes
   - **minor**: New features, significant enhancements, new functionality
   - **patch**: Bug fixes, small improvements, documentation updates

4. Ask the user which version type to use with AskUserQuestion:
   - Show recent changes summary
   - Provide your recommendation as first option with "(Recommended)"
   - Options: the three version types

5. Once confirmed, execute the release:
   ```bash
   npm version <type> && git push && git push --tags
   ```

6. Report the new version number and confirm success.
