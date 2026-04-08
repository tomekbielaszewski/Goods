# Claude Code Guidelines

## Bug fixing workflow

Always follow TDD when fixing bugs:

1. **Write a failing test first** that reproduces the bug exactly
2. **Show the test output** confirming it fails for the right reason
3. **Implement the fix**
4. **Show the test passing**

Do not guess at root causes based on reading implementation code alone. The test is the proof of understanding — if you can't write a test that fails in the expected way, you don't yet understand the bug.
