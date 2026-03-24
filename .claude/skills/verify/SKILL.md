---
name: verify
description: Run type check and tests to catch errors before committing
---

Run the following commands in sequence to verify the project:

```bash
bun typecheck && bun test
```

If errors are found:
1. Read each error carefully — note the file path and line number
2. Fix the type errors or failing tests in the source files
3. Re-run `bun typecheck && bun test` to confirm all errors are resolved
4. Report what was fixed

If no errors: report "All clear — type check and tests passed."
