# Claude Code Guidelines for dot-do-capnweb

## Process Management Rules

### Test Execution
1. Run ONE test file at a time
2. Use `npx vitest run` (not watch mode)
3. Never run multiple vitest instances in parallel
4. If you need to run multiple tests, run them sequentially with `&&`

Example:
```bash
# GOOD - Sequential execution
npx vitest run __tests__/session.test.ts && npx vitest run __tests__/rpc.test.ts

# BAD - Parallel execution (consumes all memory/CPU)
npx vitest run __tests__/session.test.ts &
npx vitest run __tests__/rpc.test.ts &
```

### Agent Guidelines
- When spawning parallel agents, ensure they don't all run tests simultaneously
- Prefer having agents work on different files/tasks rather than all running tests
- If an agent needs to run tests, it should run a single focused test file

## Build Commands
- `pnpm test` - Run all tests (use sparingly, prefer focused test runs)
- `pnpm build` - Build the project
- `npx tsc --noEmit` - Type check without emitting

## Beads Workflow
- Use `bd` commands for issue tracking
- Run `bd sync` at session end
- See `.beads/` for issue data
